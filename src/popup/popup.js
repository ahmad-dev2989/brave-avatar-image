/**
 * Popup Controller (Phase 4 - Custom Profile UI)
 *
 * Responsibilities:
 * - Manages clean, modern UI states: Loading, Active Avatar, Empty State, Preview, Remove Confirmation.
 * - Displays active profile friendly name with inline editing.
 * - Prominently showcases the custom circular avatar preserving aspect ratio.
 * - Displays clear status indicators ("Custom avatar active" vs "No custom avatar").
 * - Provides inline confirmation for destructive actions (removing avatar).
 * - Manages object URLs cleanly to avoid memory leaks.
 * - Handles errors gracefully with retry capabilities without crashing.
 * - Prevents race conditions during asynchronous operations.
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

// In-memory state tracking
let cachedDiagnostics = null;
let activeAvatarUrl = null;
let previewAvatarUrl = null;
let inFlightProcessedImage = null;
let isOperationInProgress = false;

document.addEventListener('DOMContentLoaded', async () => {
  log.info('Popup initialized in active Brave profile context.');

  // Set extension version & phase badge
  const versionBadge = document.getElementById('versionBadge');
  if (versionBadge) {
    versionBadge.textContent = `v${EXTENSION_CONFIG.VERSION} • Phase 4`;
  }

  // Bind all UI event listeners
  setupEventListeners();

  // Load profile identity and custom avatar
  await loadProfileAndAvatar();
});

// Clean up object URLs when the popup closes to prevent memory leaks
window.addEventListener('unload', () => {
  if (activeAvatarUrl) revokeObjectUrl(activeAvatarUrl);
  if (previewAvatarUrl) revokeObjectUrl(previewAvatarUrl);
});

/**
 * Loads the active profile record and retrieves the stored avatar from IndexedDB.
 */
async function loadProfileAndAvatar() {
  if (isOperationInProgress) return;
  setOperationState(true);
  showLoadingState(true);
  hideAlert();

  const profileNameText = document.getElementById('profileNameText');

  try {
    // 1. Resolve active profile partition identity
    const profile = await profileService.getOrCreateCurrentProfile();
    if (profileNameText) {
      profileNameText.textContent = profile.name || 'Brave Profile';
    }

    // 2. Fetch avatar record from isolated IndexedDB
    let avatarRecord = null;
    try {
      avatarRecord = await profileService.getProfileImage();
    } catch (storageErr) {
      log.warn('Storage read warning (will fall back gracefully):', storageErr);
    }

    if (avatarRecord && avatarRecord.imageData && avatarRecord.imageData instanceof Blob) {
      // Transition to Active State
      renderActiveState(avatarRecord.imageData);
    } else {
      // Transition to Empty State
      renderEmptyState();
    }

    // Refresh diagnostics if drawer is open
    const panel = document.getElementById('diagnosticsPanel');
    if (panel && !panel.classList.contains('hidden')) {
      await populateDiagnostics();
    }
  } catch (err) {
    log.error('Error loading profile and avatar:', err);
    showAlert('Could not load profile avatar.', 'error', true);
    renderEmptyState();
  } finally {
    showLoadingState(false);
    setOperationState(false);
  }
}

/**
 * Sets the UI to the "Active Avatar" state.
 *
 * @param {Blob} imageBlob
 */
function renderActiveState(imageBlob) {
  const profileAvatarWrapper = document.getElementById('profileAvatarWrapper');
  const profileAvatarImg = document.getElementById('profileAvatarImg');
  const profileAvatarEmpty = document.getElementById('profileAvatarEmpty');
  const avatarStatusBadge = document.getElementById('avatarStatusBadge');
  const avatarStatusText = document.getElementById('avatarStatusText');
  const emptyStateText = document.getElementById('emptyStateText');
  const btnAddImage = document.getElementById('btnAddImage');
  const activeActionButtons = document.getElementById('activeActionButtons');
  const removeConfirmBox = document.getElementById('removeConfirmBox');

  // Safely manage object URL
  if (activeAvatarUrl) {
    revokeObjectUrl(activeAvatarUrl);
  }
  activeAvatarUrl = createObjectUrl(imageBlob);

  if (profileAvatarImg) {
    profileAvatarImg.src = activeAvatarUrl;
    profileAvatarImg.classList.remove('hidden');
  }

  if (profileAvatarEmpty) {
    profileAvatarEmpty.classList.add('hidden');
  }

  if (profileAvatarWrapper) {
    profileAvatarWrapper.classList.remove('hidden');
  }

  // Update Status Pill
  if (avatarStatusBadge && avatarStatusText) {
    avatarStatusBadge.className = 'status-pill status-pill-active';
    avatarStatusText.textContent = 'Custom avatar active';
  }

  // Hide empty state hints
  if (emptyStateText) emptyStateText.classList.add('hidden');

  // Toggle Action Buttons
  if (btnAddImage) btnAddImage.classList.add('hidden');
  if (activeActionButtons) activeActionButtons.classList.remove('hidden');
  if (removeConfirmBox) removeConfirmBox.classList.add('hidden');
}

/**
 * Sets the UI to the "Empty State" (no custom avatar).
 */
function renderEmptyState() {
  const profileAvatarWrapper = document.getElementById('profileAvatarWrapper');
  const profileAvatarImg = document.getElementById('profileAvatarImg');
  const profileAvatarEmpty = document.getElementById('profileAvatarEmpty');
  const avatarStatusBadge = document.getElementById('avatarStatusBadge');
  const avatarStatusText = document.getElementById('avatarStatusText');
  const emptyStateText = document.getElementById('emptyStateText');
  const btnAddImage = document.getElementById('btnAddImage');
  const activeActionButtons = document.getElementById('activeActionButtons');
  const removeConfirmBox = document.getElementById('removeConfirmBox');

  // Revoke any existing active URL
  if (activeAvatarUrl) {
    revokeObjectUrl(activeAvatarUrl);
    activeAvatarUrl = null;
  }

  if (profileAvatarImg) {
    profileAvatarImg.src = '';
    profileAvatarImg.classList.add('hidden');
  }

  if (profileAvatarEmpty) {
    profileAvatarEmpty.classList.remove('hidden');
  }

  if (profileAvatarWrapper) {
    profileAvatarWrapper.classList.remove('hidden');
  }

  // Update Status Pill
  if (avatarStatusBadge && avatarStatusText) {
    avatarStatusBadge.className = 'status-pill status-pill-empty';
    avatarStatusText.textContent = 'No custom avatar';
  }

  // Show empty state text
  if (emptyStateText) emptyStateText.classList.remove('hidden');

  // Toggle Action Buttons
  if (btnAddImage) btnAddImage.classList.remove('hidden');
  if (activeActionButtons) activeActionButtons.classList.add('hidden');
  if (removeConfirmBox) removeConfirmBox.classList.add('hidden');
}

/**
 * Toggles the loading skeleton display.
 *
 * @param {boolean} isLoading
 */
function showLoadingState(isLoading) {
  const avatarSkeleton = document.getElementById('avatarSkeleton');
  const profileAvatarWrapper = document.getElementById('profileAvatarWrapper');
  const avatarStatusBadge = document.getElementById('avatarStatusBadge');

  if (avatarSkeleton) {
    avatarSkeleton.classList.toggle('hidden', !isLoading);
  }
  if (profileAvatarWrapper && isLoading) {
    profileAvatarWrapper.classList.add('hidden');
  }
  if (avatarStatusBadge && isLoading) {
    avatarStatusBadge.classList.add('hidden');
  } else if (avatarStatusBadge) {
    avatarStatusBadge.classList.remove('hidden');
  }
}

/**
 * Disables buttons to prevent duplicate / conflicting in-flight clicks.
 *
 * @param {boolean} inProgress
 */
function setOperationState(inProgress) {
  isOperationInProgress = inProgress;

  const btnAddImage = document.getElementById('btnAddImage');
  const btnChangeImage = document.getElementById('btnChangeImage');
  const btnRemoveImage = document.getElementById('btnRemoveImage');
  const btnSaveImage = document.getElementById('btnSaveImage');
  const btnConfirmRemove = document.getElementById('btnConfirmRemove');

  [btnAddImage, btnChangeImage, btnRemoveImage, btnSaveImage, btnConfirmRemove].forEach((btn) => {
    if (btn) btn.disabled = inProgress;
  });
}

/**
 * Binds all interactive UI events.
 */
function setupEventListeners() {
  // 1. Profile Name Inline Editing
  setupProfileNameEditor();

  // 2. Image Selection & Processing Flow
  setupImageActions();

  // 3. Diagnostics Collapsible Drawer
  setupDiagnosticsView();
}

/**
 * Sets up profile name editing and validation.
 */
function setupProfileNameEditor() {
  const profileNameText = document.getElementById('profileNameText');
  const profileNameDisplay = document.getElementById('profileNameDisplay');
  const profileEditForm = document.getElementById('profileEditForm');
  const inputProfileName = document.getElementById('inputProfileName');
  const btnEditName = document.getElementById('btnEditName');
  const btnCancelEdit = document.getElementById('btnCancelEdit');

  if (btnEditName && profileEditForm && profileNameDisplay && inputProfileName) {
    btnEditName.addEventListener('click', () => {
      inputProfileName.value = profileNameText.textContent;
      profileNameDisplay.classList.add('hidden');
      profileEditForm.classList.remove('hidden');
      inputProfileName.focus();
      inputProfileName.select();
    });
  }

  if (btnCancelEdit && profileEditForm && profileNameDisplay) {
    btnCancelEdit.addEventListener('click', () => {
      profileEditForm.classList.add('hidden');
      profileNameDisplay.classList.remove('hidden');
    });
  }

  if (profileEditForm && profileNameDisplay && inputProfileName) {
    profileEditForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newName = inputProfileName.value.trim();
      if (newName) {
        try {
          const updated = await profileService.updateProfileName(newName);
          if (profileNameText) profileNameText.textContent = updated.name;
        } catch (err) {
          log.error('Failed to rename profile:', err);
          showAlert('Failed to save profile name.', 'error');
        }
      }
      profileEditForm.classList.add('hidden');
      profileNameDisplay.classList.remove('hidden');
    });
  }
}

/**
 * Sets up image selection, preview, saving, and deletion flows.
 */
function setupImageActions() {
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

  const removeConfirmBox = document.getElementById('removeConfirmBox');
  const btnCancelRemove = document.getElementById('btnCancelRemove');
  const btnConfirmRemove = document.getElementById('btnConfirmRemove');

  const btnDismissAlert = document.getElementById('btnDismissAlert');
  const btnRetryAction = document.getElementById('btnRetryAction');

  // Trigger file picker
  const triggerPicker = () => {
    if (isOperationInProgress) return;
    hideAlert();
    if (removeConfirmBox) removeConfirmBox.classList.add('hidden');
    if (imageFileInput) {
      imageFileInput.value = '';
      imageFileInput.click();
    }
  };

  if (btnAddImage) btnAddImage.addEventListener('click', triggerPicker);
  if (btnChangeImage) btnChangeImage.addEventListener('click', triggerPicker);

  if (profileAvatarWrapper) {
    profileAvatarWrapper.addEventListener('click', triggerPicker);
    // Keyboard accessibility: Enter / Space triggers picker
    profileAvatarWrapper.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        triggerPicker();
      }
    });
  }

  // File selected in native dialog
  if (imageFileInput) {
    imageFileInput.addEventListener('change', async (event) => {
      const files = event.target.files;
      if (!files || files.length === 0) return;

      const file = files[0];

      // Validate constraints (MIME type, size <= 5 MB)
      const validation = validateImageFile(file);
      if (!validation.valid) {
        showAlert(validation.error, 'error');
        return;
      }

      // Process and decode
      try {
        setOperationState(true);
        const processed = await processAvatarImage(file);
        inFlightProcessedImage = processed;

        // Revoke previous preview URL
        if (previewAvatarUrl) {
          revokeObjectUrl(previewAvatarUrl);
        }
        previewAvatarUrl = createObjectUrl(processed.blob);

        if (imagePreviewImg) imagePreviewImg.src = previewAvatarUrl;
        if (previewFileName) previewFileName.textContent = file.name;
        if (previewMetaInfo) {
          previewMetaInfo.textContent = `${processed.width} × ${processed.height} • ${formatBytes(processed.sizeBytes)}`;
        }

        if (imagePreviewCard) imagePreviewCard.classList.remove('hidden');
        hideAlert();
      } catch (err) {
        log.error('Image processing failed:', err);
        showAlert(err.message || 'Failed to decode or crop image file.', 'error');
      } finally {
        setOperationState(false);
      }
    });
  }

  // Save Avatar Confirmation
  if (btnSaveImage) {
    btnSaveImage.addEventListener('click', async () => {
      if (!inFlightProcessedImage || isOperationInProgress) return;

      try {
        setOperationState(true);
        btnSaveImage.textContent = 'Saving...';

        await profileService.saveProfileImage(inFlightProcessedImage.blob, {
          width: inFlightProcessedImage.width,
          height: inFlightProcessedImage.height,
          originalName: inFlightProcessedImage.originalName,
          sizeBytes: inFlightProcessedImage.sizeBytes,
          mimeType: inFlightProcessedImage.mimeType
        });

        // Hide preview and clean up preview URL
        if (imagePreviewCard) imagePreviewCard.classList.add('hidden');
        if (previewAvatarUrl) {
          revokeObjectUrl(previewAvatarUrl);
          previewAvatarUrl = null;
        }

        const savedBlob = inFlightProcessedImage.blob;
        inFlightProcessedImage = null;

        // Render active avatar immediately
        renderActiveState(savedBlob);
        showAlert('Custom avatar saved successfully.', 'success');

        // Refresh diagnostics if open
        const panel = document.getElementById('diagnosticsPanel');
        if (panel && !panel.classList.contains('hidden')) {
          await populateDiagnostics();
        }
      } catch (err) {
        log.error('Failed to save avatar image:', err);
        showAlert('Failed to save avatar to local storage. Please try again.', 'error');
      } finally {
        setOperationState(false);
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

  // Show Remove Confirmation
  if (btnRemoveImage) {
    btnRemoveImage.addEventListener('click', () => {
      if (removeConfirmBox) {
        removeConfirmBox.classList.remove('hidden');
      }
    });
  }

  // Cancel Remove Action
  if (btnCancelRemove) {
    btnCancelRemove.addEventListener('click', () => {
      if (removeConfirmBox) {
        removeConfirmBox.classList.add('hidden');
      }
    });
  }

  // Confirm Remove Action
  if (btnConfirmRemove) {
    btnConfirmRemove.addEventListener('click', async () => {
      if (isOperationInProgress) return;

      try {
        setOperationState(true);
        btnConfirmRemove.textContent = 'Removing...';

        await profileService.removeProfileImage();

        if (removeConfirmBox) removeConfirmBox.classList.add('hidden');
        renderEmptyState();
        showAlert('Custom avatar removed.', 'info');

        // Refresh diagnostics if open
        const panel = document.getElementById('diagnosticsPanel');
        if (panel && !panel.classList.contains('hidden')) {
          await populateDiagnostics();
        }
      } catch (err) {
        log.error('Failed to remove profile image:', err);
        showAlert('Failed to delete avatar from local storage.', 'error');
      } finally {
        setOperationState(false);
        btnConfirmRemove.textContent = 'Remove';
      }
    });
  }

  // Dismiss alert
  if (btnDismissAlert) {
    btnDismissAlert.addEventListener('click', hideAlert);
  }

  // Retry action
  if (btnRetryAction) {
    btnRetryAction.addEventListener('click', async () => {
      hideAlert();
      await loadProfileAndAvatar();
    });
  }
}

/**
 * Displays an alert banner inside the popup.
 *
 * @param {string} message
 * @param {'error'|'warning'|'success'|'info'} [type='error']
 * @param {boolean} [showRetry=false]
 */
function showAlert(message, type = 'error', showRetry = false) {
  const imageAlert = document.getElementById('imageAlert');
  const imageAlertText = document.getElementById('imageAlertText');
  const alertIcon = document.getElementById('alertIcon');
  const btnRetryAction = document.getElementById('btnRetryAction');

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

  if (btnRetryAction) {
    btnRetryAction.classList.toggle('hidden', !showRetry);
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
  const diagPlatform = document.getElementById('diagPlatform');
  const diagDbName = document.getElementById('diagDbName');
  const diagAvatarStatus = document.getElementById('diagAvatarStatus');
  const diagInstanceId = document.getElementById('diagInstanceId');

  try {
    const currentId = await profileService.getProfileInstanceId();
    cachedDiagnostics = await DiagnosticsCollector.collect(currentId);

    if (diagInstanceId) {
      diagInstanceId.textContent = currentId;
    }

    if (diagExtensionId) {
      diagExtensionId.textContent = cachedDiagnostics.extension.id;
    }

    if (diagPlatform) {
      const os = cachedDiagnostics.platform.os || 'Windows';
      const arch = cachedDiagnostics.platform.arch || 'x64';
      diagPlatform.textContent = `${os} (${arch})`;
    }

    if (diagDbName) {
      diagDbName.textContent = DB_CONFIG.NAME;
    }

    if (diagAvatarStatus) {
      const avatar = await profileService.getProfileImage();
      if (avatar && avatar.imageData) {
        const w = avatar.metadata?.width || 512;
        const h = avatar.metadata?.height || 512;
        const format = (avatar.mimeType || 'image/png').replace('image/', '').toUpperCase();
        diagAvatarStatus.textContent = `${w}×${h} ${format} (${formatBytes(avatar.sizeBytes)})`;
      } else {
        diagAvatarStatus.textContent = 'None (Default placeholder)';
      }
    }
  } catch (err) {
    log.error('Diagnostics population error:', err);
  }
}
