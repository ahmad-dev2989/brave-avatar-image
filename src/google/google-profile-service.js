/**
 * Google Profile Service
 *
 * Responsibilities:
 * - Retrieves user profile info (name, email, photo URL) from Google UserInfo API.
 * - Enhances Google photo URLs to request high-resolution (512x512) avatar assets.
 * - Fetches photo data and converts it into a native binary Blob.
 * - Pipes Google images through the existing image-processor pipeline (validation, center-crop, resize).
 * - Saves the processed avatar into the active Brave profile partition via ProfileService.
 */

import { GOOGLE_CONFIG } from '../utils/constants.js';
import { createLogger } from '../utils/logger.js';
import { googleAuthService } from './google-auth-service.js';
import { processAvatarImage } from '../utils/image-processor.js';
import { profileService } from '../profiles/profile-service.js';

const log = createLogger('GoogleProfile');

export class GoogleProfileService {
  /**
   * Fetches the user profile from Google's OpenID Connect UserInfo endpoint.
   *
   * @param {string} accessToken
   * @returns {Promise<{ sub: string, name: string, email: string, picture: string }>}
   */
  async fetchUserProfile(accessToken) {
    if (!accessToken) {
      throw new Error('Access token is required to fetch Google profile information.');
    }

    log.info('Requesting Google user profile information...');

    let response;
    try {
      response = await fetch(GOOGLE_CONFIG.USERINFO_ENDPOINT, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json'
        }
      });
    } catch (netErr) {
      log.error('Network error during Google userinfo request:', netErr);
      throw new Error('Network error connecting to Google. Please check your internet connection.');
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Google authorization token has expired or is invalid. Please sign in again.');
      }
      throw new Error(`Google profile request failed (HTTP ${response.status}).`);
    }

    const data = await response.json();

    if (!data || !data.sub) {
      throw new Error('Invalid user profile response received from Google.');
    }

    return {
      sub: data.sub,
      name: data.name || 'Google User',
      email: data.email || '',
      picture: data.picture || null
    };
  }

  /**
   * Modifies a Google profile photo URL to request high-resolution (default 512x512) output.
   * Google photo URLs typically end in size directives such as `=s96-c`.
   *
   * @param {string} pictureUrl
   * @param {number} [targetSize=512]
   * @returns {string}
   */
  getHighResPhotoUrl(pictureUrl, targetSize = 512) {
    if (!pictureUrl || typeof pictureUrl !== 'string') return '';

    // Replace existing size directive (e.g. "=s96-c" -> "=s512-c")
    if (/=s\d+(-c)?$/i.test(pictureUrl)) {
      return pictureUrl.replace(/=s\d+(-c)?$/i, `=s${targetSize}-c`);
    }

    // Append size directive if none exists
    const separator = pictureUrl.includes('?') ? '&' : '=';
    if (separator === '=') {
      return `${pictureUrl}=s${targetSize}-c`;
    }
    return `${pictureUrl}&sz=${targetSize}`;
  }

  /**
   * Downloads the remote Google photo as a binary Blob.
   *
   * @param {string} photoUrl
   * @returns {Promise<Blob>}
   */
  async fetchProfilePhotoBlob(photoUrl) {
    if (!photoUrl) {
      throw new Error('No profile picture URL provided.');
    }

    log.info('Fetching Google profile picture asset...');

    let response;
    try {
      response = await fetch(photoUrl);
    } catch (netErr) {
      log.error('Network error downloading Google photo:', netErr);
      throw new Error('Failed to download Google profile photo. Please check your internet connection.');
    }

    if (!response.ok) {
      throw new Error(`Failed to download profile photo from Google (HTTP ${response.status}).`);
    }

    const blob = await response.blob();

    if (!blob || blob.size === 0) {
      throw new Error('Downloaded photo contains empty data.');
    }

    return blob;
  }

  /**
   * Orchestrates the complete Google avatar import workflow:
   * 1. Authenticates via GoogleAuthService (or uses active token).
   * 2. Retrieves user profile information from Google.
   * 3. Fetches the high-resolution photo Blob.
   * 4. Passes photo through the EXISTING image-processor pipeline (validation, center-crop, resize).
   * 5. Persists the processed avatar locally in the active Brave profile via ProfileService.
   *
   * @param {Object} [options={}]
   * @param {string} [options.token] - Optional already-acquired access token
   * @param {function(string): void} [options.onProgress] - Optional progress callback
   * @returns {Promise<{ user: Object, avatarRecord: Object }>}
   */
  async importGoogleAvatar(options = {}) {
    const notify = (msg) => {
      if (typeof options.onProgress === 'function') {
        options.onProgress(msg);
      }
    };

    // 1. Acquire token
    let token = options.token || googleAuthService.getActiveToken();
    if (!token) {
      notify('Connecting to Google...');
      token = await googleAuthService.signIn();
    }

    // 2. Fetch profile info
    notify('Retrieving profile information...');
    const userProfile = await this.fetchUserProfile(token);

    if (!userProfile.picture) {
      throw new Error(
        `The Google account (${userProfile.email || userProfile.name}) does not have a profile picture set.`
      );
    }

    // 3. Fetch high-res photo Blob
    notify('Downloading profile photo...');
    const highResUrl = this.getHighResPhotoUrl(userProfile.picture, 512);
    const rawPhotoBlob = await this.fetchProfilePhotoBlob(highResUrl);

    // 4. Process image through existing pipeline (validate, center-crop 1:1, resize max 512x512, PNG)
    notify('Optimizing avatar image...');
    const processed = await processAvatarImage(rawPhotoBlob, {
      targetSize: 512,
      outputMimeType: 'image/png'
    });

    // 5. Store locally with Google source metadata
    notify('Saving avatar locally...');
    const metadata = {
      source: 'google',
      provider: 'google',
      accountId: userProfile.sub,
      email: userProfile.email || null,
      displayName: userProfile.name || null,
      sourceImageUrl: userProfile.picture,
      width: processed.width,
      height: processed.height,
      sizeBytes: processed.sizeBytes,
      originalName: 'google-avatar.png',
      importedAt: Date.now()
    };

    const saveResult = await profileService.saveProfileImage(processed.blob, metadata);

    log.info(`Google profile avatar saved for current Brave profile (${metadata.email || metadata.displayName})`);

    return {
      user: userProfile,
      avatarRecord: {
        blob: processed.blob,
        saveResult,
        metadata
      }
    };
  }
}

export const googleProfileService = new GoogleProfileService();
export default googleProfileService;
