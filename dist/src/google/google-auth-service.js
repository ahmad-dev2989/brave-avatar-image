/**
 * Google Authentication Service (OAuth 2.0 via chrome.identity.launchWebAuthFlow)
 *
 * Responsibilities:
 * - Constructs standard Google OAuth 2.0 authorization requests with minimal scopes.
 * - Launches interactive authentication flow allowing account selection.
 * - Extracts and manages short-lived access tokens in memory (zero persistent credential storage).
 * - Disconnects / invalidates sessions cleanly.
 * - Degrades gracefully when OAuth Client ID is not yet configured.
 */

import { GOOGLE_CONFIG, STORAGE_KEYS } from '../utils/constants.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('GoogleAuth');

class GoogleAuthService {
  constructor() {
    /** @type {string|null} */
    this._accessToken = null;
    /** @type {number|null} */
    this._tokenExpiresAt = null;
    /** @type {Object|null} */
    this._cachedUserProfile = null;
  }

  /**
   * Retrieves the configured Google OAuth Client ID.
   * Checks custom user-supplied storage first, then falls back to constants.
   *
   * @returns {Promise<string>}
   */
  async getClientId() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const stored = await chrome.storage.local.get(STORAGE_KEYS.GOOGLE_CUSTOM_CLIENT_ID);
        const customId = stored[STORAGE_KEYS.GOOGLE_CUSTOM_CLIENT_ID];
        if (customId && typeof customId === 'string' && customId.trim()) {
          return customId.trim();
        }
      } catch (err) {
        log.warn('Could not read custom client ID from storage:', err);
      }
    }

    return (GOOGLE_CONFIG.CLIENT_ID || '').trim();
  }

  /**
   * Allows saving a custom Client ID locally to chrome.storage.local.
   *
   * @param {string} clientId
   * @returns {Promise<void>}
   */
  async setCustomClientId(clientId) {
    const sanitized = String(clientId || '').trim();
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      if (sanitized) {
        await chrome.storage.local.set({
          [STORAGE_KEYS.GOOGLE_CUSTOM_CLIENT_ID]: sanitized
        });
      } else {
        await chrome.storage.local.remove(STORAGE_KEYS.GOOGLE_CUSTOM_CLIENT_ID);
      }
    }
  }

  /**
   * Checks if a Google OAuth Client ID is currently configured.
   *
   * @returns {Promise<boolean>}
   */
  async isConfigured() {
    const clientId = await this.getClientId();
    return Boolean(clientId && clientId.length > 5);
  }

  /**
   * Returns the OAuth redirect URI for this extension.
   *
   * @returns {string} e.g. "https://<extension-id>.chromiumapp.org/"
   */
  getRedirectUri() {
    if (typeof chrome !== 'undefined' && chrome.identity?.getRedirectURL) {
      return chrome.identity.getRedirectURL();
    }
    // Standard fallback structure for MV3 Chromium extensions
    const extId = (typeof chrome !== 'undefined' && chrome.runtime?.id) ? chrome.runtime.id : 'unknown';
    return `https://${extId}.chromiumapp.org/`;
  }

  /**
   * Constructs the full Google OAuth 2.0 authorization URL.
   *
   * @param {string} clientId
   * @param {string} redirectUri
   * @returns {string}
   */
  buildAuthUrl(clientId, redirectUri) {
    if (!clientId) {
      throw new Error('A Google OAuth Client ID is required to build authorization URL.');
    }

    const url = new URL(GOOGLE_CONFIG.AUTH_ENDPOINT);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'token');
    url.searchParams.set('scope', GOOGLE_CONFIG.SCOPES.join(' '));
    // Prompt user to select account when multiple Google accounts are active
    url.searchParams.set('prompt', 'select_account');

    return url.toString();
  }

  /**
   * Parses the redirect URL returned by Google OAuth.
   * Google Implicit Flow returns token in URL fragment (#access_token=...&expires_in=...).
   *
   * @param {string} redirectUrl
   * @returns {{ accessToken?: string, expiresIn?: number, error?: string, errorDescription?: string }}
   */
  parseRedirectUrl(redirectUrl) {
    if (!redirectUrl || typeof redirectUrl !== 'string') {
      return { error: 'empty_response', errorDescription: 'No redirect URL returned.' };
    }

    try {
      const url = new URL(redirectUrl);

      // 1. Check for error parameters in hash or query
      const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
      const queryParams = url.searchParams;

      const error = hashParams.get('error') || queryParams.get('error');
      const errorDescription = hashParams.get('error_description') || queryParams.get('error_description');

      if (error) {
        return { error, errorDescription: errorDescription || error };
      }

      // 2. Extract access_token from hash fragment
      const accessToken = hashParams.get('access_token');
      const expiresIn = parseInt(hashParams.get('expires_in') || '3600', 10);

      if (accessToken) {
        return { accessToken, expiresIn };
      }

      return {
        error: 'missing_token',
        errorDescription: 'Redirect URL did not contain an access_token parameter.'
      };
    } catch (err) {
      return { error: 'parse_failed', errorDescription: err.message };
    }
  }

  /**
   * Initiates Google OAuth sign-in via chrome.identity.launchWebAuthFlow.
   *
   * @returns {Promise<string>} Valid access token
   */
  async signIn() {
    // Verify configuration
    const clientId = await this.getClientId();
    if (!clientId) {
      throw new Error(
        'Google OAuth Client ID is not configured. Please set your Client ID in constants.js or the extension settings.'
      );
    }

    if (typeof chrome === 'undefined' || !chrome.identity?.launchWebAuthFlow) {
      throw new Error('chrome.identity.launchWebAuthFlow is not available in this environment.');
    }

    const redirectUri = this.getRedirectUri();
    const authUrl = this.buildAuthUrl(clientId, redirectUri);

    log.info('Launching Google WebAuthFlow for account authorization...');

    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(
        {
          url: authUrl,
          interactive: true
        },
        (responseUrl) => {
          if (chrome.runtime.lastError) {
            const lastErrMsg = chrome.runtime.lastError.message || 'Authorization failed';
            log.warn('Google WebAuthFlow error:', lastErrMsg);

            if (lastErrMsg.includes('User cancelled') || lastErrMsg.includes('user did not approve')) {
              reject(new Error('Google sign-in was canceled.'));
            } else {
              reject(new Error(`Google authorization failed: ${lastErrMsg}`));
            }
            return;
          }

          if (!responseUrl) {
            reject(new Error('No response URL received from Google authorization flow.'));
            return;
          }

          const parsed = this.parseRedirectUrl(responseUrl);
          if (parsed.error) {
            log.error('OAuth redirect contained error:', parsed.error, parsed.errorDescription);
            if (parsed.error === 'access_denied') {
              reject(new Error('Access was denied to your Google account profile.'));
            } else {
              reject(new Error(`Google authorization error: ${parsed.errorDescription || parsed.error}`));
            }
            return;
          }

          if (!parsed.accessToken) {
            reject(new Error('Did not receive a valid access token from Google.'));
            return;
          }

          // Cache in memory
          this._accessToken = parsed.accessToken;
          this._tokenExpiresAt = Date.now() + (parsed.expiresIn * 1000) - 60000; // 1-minute buffer

          log.info('Google authorization successful. Token acquired.');
          resolve(this._accessToken);
        }
      );
    });
  }

  /**
   * Returns active token if still valid.
   *
   * @returns {string|null}
   */
  getActiveToken() {
    if (this._accessToken && this._tokenExpiresAt && Date.now() < this._tokenExpiresAt) {
      return this._accessToken;
    }
    return null;
  }

  /**
   * Disconnects the active Google session and clears cached in-memory tokens.
   */
  async signOut() {
    const token = this._accessToken;
    this._accessToken = null;
    this._tokenExpiresAt = null;
    this._cachedUserProfile = null;

    // Optional fire-and-forget token revocation at Google endpoint
    if (token) {
      try {
        fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }).catch(() => {});
      } catch {
        // Ignore network errors on revoke
      }
    }

    log.info('Google account disconnected in current session.');
  }
}

export const googleAuthService = new GoogleAuthService();
export default googleAuthService;
