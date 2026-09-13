/**
 * Popup Controller (Phase 3 - Image Selection & Local Storage)
 *
 * Responsibilities:
 * - Initializes and displays the active profile instance identity.
 * - Supports renaming the friendly display name for the current profile sandbox.
 * - Provides image picker, validation, preview, confirmation, and deletion.
 * - Persists avatar images locally in the profile's private IndexedDB partition.
 * - Collects and renders live environment & profile diagnostics.
 * - Manages memory cleanly by revoking temporary object URLs.
 */

import { EXTENSION_CONFIG, DB_CONFIG } from '../utils/constants.js';
import { createLogger } from '../utils/logger.js';
import { profileService } from '../profiles/profile-service.js';
import { DiagnosticsCollector } from '../utils/diagnostics.js';
import {
  validateImageFile,
  processAvatarImage,
  createObjectUrl,
  revokeObjectUrl,
  formatBytes
} from '../utils/image-processor.js';

const log = createLogger('Popup');

// In-memory state
let cachedDiagnostics = null;
let activeAvatarUrl = null;
let previewAvatarUrl = null;
let inFlightProcessedImage = null;

document.addEventListener('DOMContentLoaded', async () => {
  log.info('Popup initialized in active Brave profile context.');

  // Set extension version & phase badge
  const versionBadge = document.getElementById('versionBadge');
  if (versionBadge) {
    versionBadge.textContent = `v${EXTENSION_CONFIG.VERSION} • Phase 3`;
  }

  // 1. Initialize Active Profile Identity & Stored Avatar
  await initProfileView();

  // 2. Setup Image Selection & Storage Flow
  setupImagePicker();

  // 3. Setup Diagnostics Drawer & Actions
  setupDiagnosticsView();
});

// Clean up object URLs when the popup closes to prevent memory leaks
window.addEventListener('unload', () => {
  if (activeAvatarUrl) revokeObjectUrl(activeAvatarUrl);
  if (previewAvatarUrl) revokeObjectUrl(previewAvatarUrl);
});

/**
 * Loads the active profile record, renders identity, and retrieves any stored avatar.
 */
async function initProfileView() {
  const profileNameText = document.getElementById('profileNameText');
  const profileNameDisplay = document.getElementById('profileNameDisplay');
  const profileEditForm = document.getElementById('profileEditForm');
  const inputProfileName = document.getElementById('inputProfileName');
  const btnEditName = document.getElementById('btnEditName');
  const btnCancelEdit = document.getElementById('btnCancelEdit');

  try {
    const profile = await profileService.getOrCreateCurrentProfile();

    updateProfileDisplay(profile);

    // Bind Edit Button
    if (btnEditName && profileEditForm && profileNameDisplay && inputProfileName) {
      btnEditName.addEventListener('click', () => {
        inputProfileName.value = profile.name;
        profileNameDisplay.classList.add('hidden');
        profileEditForm.classList.remove('hidden');
        inputProfileName.focus();
        inputProfileName.select();
      });
    }

    // Bind Cancel Button
    if (btnCancelEdit && profileEditForm && profileNameDisplay) {
      btnCancelEdit.addEventListener('click', () => {
        profileEditForm.classList.add('hidden');
        profileNameDisplay.classList.remove('hidden');
      });
    }

    // Bind Save Form Submit
    if (profileEditForm && profileNameDisplay && inputProfileName) {
      profileEditForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newName = inputProfileName.value.trim();
        if (newName) {
          const updated = await profileService.updateProfileName(newName);
          updateProfileDisplay(updated);
        }
        profileEditForm.classList.add('hidden');
        profileNameDisplay.classList.remove('hidden');
      });
    }

    // Load any existing profile image from IndexedDB
    await loadProfileAvatar();
  } catch (err) {
    log.error('Error initializing profile view:', err);
    if (profileNameText) profileNameText.textContent = 'Error Loading Profile';
  }
}

/**
 * Updates DOM with current profile attributes (name, initials, instance ID).
 */
function updateProfileDisplay(profile) {
  const profileNameText = document.getElementById('profileNameText');
  const profileInstanceId = document.getElementById('profileInstanceId');
  const avatarInitials = document.getElementById('avatarInitials');

  if (profileNameText) profileNameText.textContent = profile.name;
  if (profileInstanceId) profileInstanceId.textContent = profile.instanceId;

  if (avatarInitials) {
    const words = profile.name.trim().split(/\s+/);
    if (words.length >= 2) {
      avatarInitials.textContent = (words[0][0] + words[1][0]).toUpperCase();
    } else if (words.length === 1 && words[0].length > 0) {
      avatarInitials.textContent = words[0].substring(0, 2).toUpperCase();
    } else {
      avatarInitials.textContent = 'BP';
    }
  }
}

/**
 * Loads the active profile image from IndexedDB and displays it in the avatar circle.
 */
async function loadProfileAvatar() {
  const profileAvatarImg = document.getElementById('profileAvatarImg');
  const profileAvatarFallback = document.getElementById('profileAvatarFallback');
  const btnAddImage = document.getElementById('btnAddImage');
  const btnChangeImage = document.getElementById('btnChangeImage');
  const btnRemoveImage = document.getElementById('btnRemoveImage');

  try {
    const record = await profileService.getProfileImage();

    if (record && record.imageData) {
      // Revoke any previously assigned object URL
      if (activeAvatarUrl) {
        revokeObjectUrl(activeAvatarUrl);
      }

      // Convert stored Blob to object URL
      activeAvatarUrl = createObjectUrl(record.imageData);

      if (profileAvatarImg) {
        profileAvatarImg.src = activeAvatarUrl;
        profileAvatarImg.classList.remove('hidden');
      }
      if (profileAvatarFallback) {
        profileAvatarFallback.classList.add('hidden');
      }

      // Show "Change" and "Remove", hide "Add"
      if (btnAddImage) btnAddImage.classList.add('hidden');
      if (btnChangeImage) btnChangeImage.classList.remove('hidden');
      if (btnRemoveImage) btnRemoveImage.classList.remove('hidden');

      log.info(`Active avatar loaded (${formatBytes(record.sizeBytes)})`);
    } else {
      // Revert to initials fallback
      if (activeAvatarUrl) {
        revokeObjectUrl(activeAvatarUrl);
        activeAvatarUrl = null;
      }

      if (profileAvatarImg) {
        profileAvatarImg.src = '';
        profileAvatarImg.classList.add('hidden');
      }
      if (profileAvatarFallback) {
        profileAvatarFallback.classList.remove('hidden');
      }

      // Show "Add", hide "Change" and "Remove"
      if (btnAddImage) btnAddImage.classList.remove('hidden');
      if (btnChangeImage) btnChangeImage.classList.add('hidden');
      if (btnRemoveImage) btnRemoveImage.classList.add('hidden');
    }
  } catch (err) {
    log.error('Failed to load profile avatar from storage:', err);
  }
}

/**
 * Configures the image picker input, preview confirmation, and remove actions.
 */
function setupImagePicker() {
  const imageFileInput = document.getElementById('imageFileInput');
  const profileAvatarWrapper = document.getElementById('profileAvatarWrapper');
  const btnAddImage = document.getElementById('btnAddImage');
  const btnChangeImage = document.getElementById('btnChangeImage');
  const btnRemoveImage = document.getElementById('btnRemoveImage');

  const imagePreviewCard = document.getElementById('imagePreviewCard');
  const imagePreviewImg = document.getElementById('imagePreviewImg');
  const previewFileName = document.getElementById('previewFileName');
  const previewMetaInfo = document.getElementById('previewMetaInfo');
  const btnSaveImage = document.getElementById('btnSaveImage');
  const btnCancelImage = document.getElementById('btnCancelImage');
  const btnDismissAlert = document.getElementById('btnDismissAlert');

  // Trigger file picker
  const triggerPicker = () => {
    hideAlert();
    if (imageFileInput) {
      imageFileInput.value = ''; // Reset selection so identical file can be re-picked
      imageFileInput.click();
    }
  };

  if (btnAddImage) btnAddImage.addEventListener('click', triggerPicker);
  if (btnChangeImage) btnChangeImage.addEventListener('click', triggerPicker);
  if (profileAvatarWrapper) profileAvatarWrapper.addEventListener('click', triggerPicker);

  // File chosen in file dialog
  if (imageFileInput) {
    imageFileInput.addEventListener('change', async (event) => {
      const files = event.target.files;
      if (!files || files.length === 0) return;

      const file = files[0];

      // 1. Validate file type and size
      const validation = validateImageFile(file);
      if (!validation.valid) {
        showAlert(validation.error, 'error');
        return;
      }

      // 2. Decode and process avatar (center-crop, resize to max 512x512, convert to Blob)
      try {
        const processed = await processAvatarImage(file);
        inFlightProcessedImage = processed;

        // Clean up any previous preview URL
        if (previewAvatarUrl) {
          revokeObjectUrl(previewAvatarUrl);
        }

        previewAvatarUrl = createObjectUrl(processed.blob);

        if (imagePreviewImg) imagePreviewImg.src = previewAvatarUrl;
        if (previewFileName) previewFileName.textContent = file.name;
        if (previewMetaInfo) {
          previewMetaInfo.textContent = `${processed.width} × ${processed.height} • ${formatBytes(processed.sizeBytes)}`;
        }

        if (imagePreviewCard) {
          imagePreviewCard.classList.remove('hidden');
        }
        hideAlert();
      } catch (err) {
        log.error('Image processing failed:', err);
        showAlert(err.message || 'Failed to decode or process image file.', 'error');
      }
    });
  }

  // Save Confirmed Avatar
  if (btnSaveImage) {
    btnSaveImage.addEventListener('click', async () => {
      if (!inFlightProcessedImage) return;

      try {
        btnSaveImage.disabled = true;
        btnSaveImage.textContent = 'Saving...';

        await profileService.saveProfileImage(inFlightProcessedImage.blob, {
          width: inFlightProcessedImage.width,
          height: inFlightProcessedImage.height,
          originalName: inFlightProcessedImage.originalName,
          sizeBytes: inFlightProcessedImage.sizeBytes,
          mimeType: inFlightProcessedImage.mimeType
        });

        // Hide preview card and reset in-flight state
        if (imagePreviewCard) imagePreviewCard.classList.add('hidden');
        if (previewAvatarUrl) {
          revokeObjectUrl(previewAvatarUrl);
          previewAvatarUrl = null;
        }
        inFlightProcessedImage = null;

        // Refresh avatar display
        await loadProfileAvatar();
        showAlert('Profile avatar saved locally.', 'success');

        // Refresh diagnostics if open
        const panel = document.getElementById('diagnosticsPanel');
        if (panel && !panel.classList.contains('hidden')) {
          await populateDiagnostics();
        }
      } catch (err) {
        log.error('Failed to save avatar image:', err);
        showAlert('Could not save avatar to local storage. Please try again.', 'error');
      } finally {
        btnSaveImage.disabled = false;
        btnSaveImage.textContent = 'Save Avatar';
      }
    });
  }

  // Cancel Preview
  if (btnCancelImage) {
    btnCancelImage.addEventListener('click', () => {
      if (imagePreviewCard) imagePreviewCard.classList.add('hidden');
      if (previewAvatarUrl) {
        revokeObjectUrl(previewAvatarUrl);
        previewAvatarUrl = null;
      }
      inFlightProcessedImage = null;
    });
  }

  // Remove Avatar
  if (btnRemoveImage) {
    btnRemoveImage.addEventListener('click', async () => {
      try {
        await profileService.removeProfileImage();
        await loadProfileAvatar();
        showAlert('Custom avatar removed.', 'info');

        // Refresh diagnostics if open
        const panel = document.getElementById('diagnosticsPanel');
        if (panel && !panel.classList.contains('hidden')) {
          await populateDiagnostics();
        }
      } catch (err) {
        log.error('Failed to remove profile image:', err);
        showAlert('Failed to remove avatar from storage.', 'error');
      }
    });
  }

  // Dismiss alert
  if (btnDismissAlert) {
    btnDismissAlert.addEventListener('click', hideAlert);
  }
}

/**
 * Displays an alert banner inside the popup.
 *
 * @param {string} message
 * @param {'error'|'warning'|'success'|'info'} [type='error']
 */
function showAlert(message, type = 'error') {
  const imageAlert = document.getElementById('imageAlert');
  const imageAlertText = document.getElementById('imageAlertText');
  const alertIcon = document.getElementById('alertIcon');

  if (!imageAlert || !imageAlertText) return;

  imageAlertText.textContent = message;

  imageAlert.classList.remove('alert-warning', 'alert-success', 'hidden');

  if (type === 'warning') {
    imageAlert.classList.add('alert-warning');
    if (alertIcon) alertIcon.textContent = '⚠️';
  } else if (type === 'success') {
    imageAlert.classList.add('alert-success');
    if (alertIcon) alertIcon.textContent = '✓';
  } else if (type === 'info') {
    imageAlert.classList.add('alert-warning');
    if (alertIcon) alertIcon.textContent = 'ℹ️';
  } else {
    if (alertIcon) alertIcon.textContent = '⚠️';
  }

  imageAlert.classList.remove('hidden');
}

/**
 * Hides the alert banner.
 */
function hideAlert() {
  const imageAlert = document.getElementById('imageAlert');
  if (imageAlert) imageAlert.classList.add('hidden');
}

/**
 * Configures the collapsible diagnostics drawer and data collection.
 */
function setupDiagnosticsView() {
  const btnToggle = document.getElementById('btnToggleDiagnostics');
  const panel = document.getElementById('diagnosticsPanel');
  const btnCopy = document.getElementById('btnCopyDiagnostics');
  const copyFeedback = document.getElementById('copyFeedback');

  if (btnToggle && panel) {
    btnToggle.addEventListener('click', async () => {
      const isExpanded = btnToggle.getAttribute('aria-expanded') === 'true';
      btnToggle.setAttribute('aria-expanded', String(!isExpanded));
      btnToggle.classList.toggle('expanded', !isExpanded);
      panel.classList.toggle('hidden', isExpanded);

      if (!isExpanded) {
        // Collect diagnostics on open
        await populateDiagnostics();
      }
    });
  }

  if (btnCopy && copyFeedback) {
    btnCopy.addEventListener('click', async () => {
      try {
        if (!cachedDiagnostics) {
          const currentId = await profileService.getProfileInstanceId();
          cachedDiagnostics = await DiagnosticsCollector.collect(currentId);
        }
        const jsonText = JSON.stringify(cachedDiagnostics, null, 2);
        await navigator.clipboard.writeText(jsonText);

        copyFeedback.classList.remove('hidden');
        setTimeout(() => {
          copyFeedback.classList.add('hidden');
        }, 2000);
      } catch (err) {
        log.error('Failed to copy diagnostics:', err);
      }
    });
  }
}

/**
 * Runs diagnostics collector and populates UI table.
 */
async function populateDiagnostics() {
  const diagExtensionId = document.getElementById('diagExtensionId');
  const diagIdentityStatus = document.getElementById('diagIdentityStatus');
  const diagPlatform = document.getElementById('diagPlatform');
  const diagDbName = document.getElementById('diagDbName');
  const diagAvatarStatus = document.getElementById('diagAvatarStatus');

  try {
    const currentId = await profileService.getProfileInstanceId();
    cachedDiagnostics = await DiagnosticsCollector.collect(currentId);

    if (diagExtensionId) {
      diagExtensionId.textContent = cachedDiagnostics.extension.id;
    }

    if (diagIdentityStatus) {
      diagIdentityStatus.textContent = cachedDiagnostics.identityApi.available
        ? cachedDiagnostics.identityApi.result
        : 'Stripped / Disabled in Brave';
    }

    if (diagPlatform) {
      const os = cachedDiagnostics.platform.os || 'Windows';
      const arch = cachedDiagnostics.platform.arch || 'x64';
      diagPlatform.textContent = `${os} (${arch})`;
    }

    if (diagDbName) {
      diagDbName.textContent = DB_CONFIG.NAME;
    }

    // Check custom avatar status
    if (diagAvatarStatus) {
      const avatar = await profileService.getProfileImage();
      if (avatar && avatar.imageData) {
        const w = avatar.metadata?.width || 512;
        const h = avatar.metadata?.height || 512;
        const format = (avatar.mimeType || 'image/png').replace('image/', '').toUpperCase();
        diagAvatarStatus.textContent = `${w}×${h} ${format} (${formatBytes(avatar.sizeBytes)})`;
      } else {
        diagAvatarStatus.textContent = 'None (Initials fallback)';
      }
    }
  } catch (err) {
    log.error('Diagnostics population error:', err);
  }
}
