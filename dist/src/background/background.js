/**
 * Background Service Worker (Manifest V3)
 *
 * Responsibilities in Phase 1:
 * - Listen for extension installation/update lifecycle events.
 * - Log extension initialization.
 * - Act as a clean entry point for future background tasks (e.g. cross-context messaging).
 */

import { EXTENSION_CONFIG, STORAGE_KEYS } from '../utils/constants.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Background');

chrome.runtime.onInstalled.addListener((details) => {
  log.info(
    `${EXTENSION_CONFIG.NAME} (v${EXTENSION_CONFIG.VERSION}) installed. Reason: ${details.reason}`
  );

  // Record initial installation timestamp for diagnostics
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({
      [STORAGE_KEYS.EXTENSION_INITIALIZED]: Date.now()
    }).catch((err) => {
      log.warn('Could not record initialization timestamp:', err);
    });
  }
});

chrome.runtime.onStartup.addListener(() => {
  log.info(`${EXTENSION_CONFIG.NAME} service worker started.`);
});
