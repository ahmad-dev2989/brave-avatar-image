/**
 * Environment & Profile Diagnostics Utility
 *
 * Collects runtime, platform, and storage properties to answer:
 * "When opening this extension in Brave Profile A vs. Profile B,
 * what values actually change, and what remains static?"
 */

import { EXTENSION_CONFIG, DB_CONFIG } from './constants.js';
import { createLogger } from './logger.js';
import { imageStorage } from '../storage/image-storage.js';

const log = createLogger('Diagnostics');

export class DiagnosticsCollector {
  /**
   * Performs an exhaustive probe of extension environment properties.
   *
   * @param {string} [currentProfileInstanceId] - The instance ID resolved by ProfileService
   * @returns {Promise<Object>} Formatted diagnostics report
   */
  static async collect(currentProfileInstanceId = null) {
    const report = {
      timestamp: new Date().toISOString(),
      extension: {
        name: EXTENSION_CONFIG.NAME,
        version: EXTENSION_CONFIG.VERSION,
        phase: EXTENSION_CONFIG.PHASE,
        id: (typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime.id : 'N/A',
        url: (typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime.getURL('') : 'N/A'
      },
      profileContext: {
        instanceId: currentProfileInstanceId || 'Unresolved',
        isolationModel: 'Storage-Scoped (Per-Profile Physical Partition)',
        isIsolatedPerProfile: true
      },
      platform: await this._getPlatformDiagnostics(),
      identityApi: await this._probeIdentityApi(),
      storage: await this._probeStorageDiagnostics()
    };

    log.debug('Collected environment diagnostics snapshot:', report);
    return report;
  }

  /**
   * Inspects chrome.runtime.getPlatformInfo
   * @private
   */
  static async _getPlatformDiagnostics() {
    if (typeof chrome === 'undefined' || !chrome.runtime?.getPlatformInfo) {
      return { os: 'unknown', arch: 'unknown', browser: 'Chromium / Brave' };
    }

    try {
      const info = await chrome.runtime.getPlatformInfo();
      return {
        os: info.os,
        arch: info.arch,
        nacl_arch: info.nacl_arch || 'none',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A'
      };
    } catch (err) {
      return { error: err.message };
    }
  }

  /**
   * Probes chrome.identity to verify Brave's privacy-preserving behavior
   * (Google Account sync is stripped/disabled in Brave).
   * @private
   */
  static async _probeIdentityApi() {
    if (typeof chrome === 'undefined' || !chrome.identity?.getProfileUserInfo) {
      return {
        available: false,
        status: 'API omitted (Standard for privacy-first Brave extension)'
      };
    }

    try {
      const userInfo = await new Promise((resolve) => {
        chrome.identity.getProfileUserInfo((info) => {
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message });
          } else {
            resolve(info || {});
          }
        });
      });

      return {
        available: true,
        emailExposed: Boolean(userInfo.email),
        idExposed: Boolean(userInfo.id),
        result: (userInfo.email || userInfo.id) ? 'Unexpected identity exposure' : 'Verified stripped by Brave (Returns empty)'
      };
    } catch (err) {
      return {
        available: false,
        error: err.message
      };
    }
  }

  /**
   * Checks IndexedDB and chrome.storage.local readiness and physical database scoping.
   * @private
   */
  static async _probeStorageDiagnostics() {
    const health = await imageStorage.checkHealth();
    let localKeys = [];

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const allLocal = await chrome.storage.local.get(null);
        localKeys = Object.keys(allLocal);
      } catch (e) {
        log.warn('Could not list chrome.storage.local keys:', e);
      }
    }

    return {
      indexedDbAvailable: health.available,
      databaseName: DB_CONFIG.NAME,
      localStorageKeys: localKeys,
      isolationConfirmation: 'Data written here is inaccessible from other Brave profiles.'
    };
  }
}
