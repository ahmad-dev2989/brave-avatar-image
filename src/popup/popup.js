/**
 * Popup Script
 *
 * Responsibilities in Phase 1:
 * - Verify extension initialization.
 * - Perform an asynchronous health check on the IndexedDB image storage engine.
 * - Update popup status indicators cleanly.
 */

import { EXTENSION_CONFIG } from '../utils/constants.js';
import { createLogger } from '../utils/logger.js';
import { imageStorage } from '../storage/image-storage.js';

const log = createLogger('Popup');

document.addEventListener('DOMContentLoaded', async () => {
  log.info('Popup opened. Checking extension environment and storage health...');

  // Set extension version dynamically from constants
  const versionBadge = document.getElementById('versionBadge');
  if (versionBadge) {
    versionBadge.textContent = `v${EXTENSION_CONFIG.VERSION}`;
  }

  const storageStatusEl = document.getElementById('storageStatus');
  const statusHeadlineEl = document.getElementById('statusHeadline');
  const statusSubtextEl = document.getElementById('statusSubtext');

  try {
    // Perform IndexedDB readiness check
    const health = await imageStorage.checkHealth();

    if (health.available) {
      if (storageStatusEl) {
        storageStatusEl.textContent = 'IndexedDB Ready';
        storageStatusEl.style.color = '#10B981';
      }
      log.info('Storage engine is online and operational.');
    } else {
      if (storageStatusEl) {
        storageStatusEl.textContent = 'Storage Error';
        storageStatusEl.style.color = '#EF4444';
      }
      if (statusHeadlineEl) {
        statusHeadlineEl.textContent = 'Storage initialization warning.';
      }
      if (statusSubtextEl) {
        statusSubtextEl.textContent = health.error || 'IndexedDB could not be opened.';
      }
      log.warn('Storage health check warning:', health.error);
    }
  } catch (err) {
    log.error('Unexpected error checking storage health:', err);
    if (storageStatusEl) {
      storageStatusEl.textContent = 'Unavailable';
      storageStatusEl.style.color = '#EF4444';
    }
  }
});
