/**
 * Popup Controller (Phase 5 - Google Account Profile Image Integration)
 *
 * Responsibilities:
 * - Manages UI states: Loading, Active Avatar, Empty State, Source Selector,
 *   Google Account Connect/Import, Image Preview, Remove Confirmation.
 * - Displays active profile friendly name with inline editing.
 * - Prominently showcases the custom circular avatar preserving aspect ratio.
 * - Supports two avatar sources:
 *     1. Local Computer (PNG, JPEG, WEBP via file picker)
 *     2. Google Account (Profile picture via OAuth 2.0 & Google Userinfo API)
 * - Persists Google avatars locally as binary Blobs in IndexedDB with source metadata.
 * - Manages object URLs cleanly to avoid memory leaks.
 * - Ensures 100% offline resilience and per-profile isolation.
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
import { googleAuthService } from '../google/google-auth-service.js';
import { googleProfileService } from '../google/google-profile-service.js';

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
    versionBadge.textContent = `v${EXTENSION_CONFIG.VERSION} • Phase 5`;
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
      renderActiveState(avatarRecord);
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
 * @param {Object} avatarRecord
 */
function renderActiveState(avatarRecord) {
  const profileAvatarWrapper = document.getElementById('profileAvatarWrapper');
  const profileAvatarImg = document.getElementById('profileAvatarImg');
  const profileAvatarEmpty = document.getElementById('profileAvatarEmpty');
  const avatarStatusBadge = document.getElementById('avatarStatusBadge');
  const avatarStatusText = document.getElementById('avatarStatusText');
  const emptyStateText = document.getElementById('emptyStateText');
  const btnAddImage = document.getElementById('btnAddImage');
  const activeActionButtons = document.getElementById('activeActionButtons');
  const removeConfirmBox = document.getElementById('removeConfirmBox');
  const avatarSourceTag = document.getElementById('avatarSourceTag');
  const avatarSourceText = document.getElementById('avatarSourceText');

  // Safely manage object URL
  if (activeAvatarUrl) {
    revokeObjectUrl(activeAvatarUrl);
  }
  activeAvatarUrl = createObjectUrl(avatarRecord.imageData);

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

  // Check if avatar was imported from Google
  if (avatarRecord.metadata && avatarRecord.metadata.source === 'google') {
    if (avatarSourceTag && avatarSourceText) {
      avatarSourceText.textContent = avatarRecord.metadata.email || avatarRecord.metadata.displayName || 'Google Account';
      avatarSourceTag.classList.remove('hidden');
    }
  } else {
    if (avatarSourceTag) {
      avatarSourceTag.classList.add('hidden');
    }
  }

  // Hide empty state hints
  if (emptyStateText) emptyStateText.classList.add('hidden');

  // Toggle Action Buttons
  if (btnAddImage) btnAddImage.classList.add('hidden');
  if (activeActionButtons) activeActionButtons.classList.remove('hidden');
  if (removeConfirmBox) removeConfirmBox.classList.add('hidden');
  hideSourceCards();
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
  const avatarSourceTag = document.getElementById('avatarSourceTag');

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

  // Hide source tag
  if (avatarSourceTag) avatarSourceTag.classList.add('hidden');

  // Show empty state text
  if (emptyStateText) emptyStateText.classList.remove('hidden');

  // Toggle Action Buttons
  if (btnAddImage) btnAddImage.classList.remove('hidden');
  if (activeActionButtons) activeActionButtons.classList.add('hidden');
  if (removeConfirmBox) removeConfirmBox.classList.add('hidden');
  hideSourceCards();
}

/**
 * Hides temporary source selection and Google cards.
 */
function hideSourceCards() {
  const sourceSelectorCard = document.getElementById('sourceSelectorCard');
  const googleFlowCard = document.getElementById('googleFlowCard');
  if (sourceSelectorCard) sourceSelectorCard.classList.add('hidden');
  if (googleFlowCard) googleFlowCard.classList.add('hidden');
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
  const btnConnectGoogle = document.getElementById('btnConnectGoogle');
  const btnSourceComputer = document.getElementById('btnSourceComputer');
  const btnSourceGoogle = document.getElementById('btnSourceGoogle');

  [btnAddImage, btnChangeImage, btnRemoveImage, btnSaveImage, btnConfirmRemove, btnConnectGoogle, btnSourceComputer, btnSourceGoogle].forEach((btn) => {
    if (btn) btn.disabled = inProgress;
  });
}

/**
 * Binds all interactive UI events.
 */
function setupEventListeners() {
  // 1. Profile Name Inline Editing
  setupProfileNameEditor();

  // 2. Source Selection & Image Flow (Computer vs Google)
  setupSourceSelection();

  // 3. Local Image File Flow
  setupLocalImageActions();

  // 4. Google Account Flow
  setupGoogleFlow();

  // 5. Diagnostics Collapsible Drawer
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
 * Sets up the Source Selection Sheet (Choose from Computer vs Google Account).
 */
function setupSourceSelection() {
  const btnAddImage = document.getElementById('btnAddImage');
  const btnChangeImage = document.getElementById('btnChangeImage');
  const profileAvatarWrapper = document.getElementById('profileAvatarWrapper');

  const sourceSelectorCard = document.getElementById('sourceSelectorCard');
  const btnCloseSourceSelector = document.getElementById('btnCloseSourceSelector');
  const btnSourceComputer = document.getElementById('btnSourceComputer');
  const btnSourceGoogle = document.getElementById('btnSourceGoogle');

  const removeConfirmBox = document.getElementById('removeConfirmBox');
  const googleFlowCard = document.getElementById('googleFlowCard');
  const imagePreviewCard = document.getElementById('imagePreviewCard');
  const imageFileInput = document.getElementById('imageFileInput');

  const openSourceSelector = () => {
    if (isOperationInProgress) return;
    hideAlert();
    if (removeConfirmBox) removeConfirmBox.classList.add('hidden');
    if (googleFlowCard) googleFlowCard.classList.add('hidden');
    if (imagePreviewCard) imagePreviewCard.classList.add('hidden');

    if (sourceSelectorCard) {
      sourceSelectorCard.classList.remove('hidden');
    }
  };

  if (btnAddImage) btnAddImage.addEventListener('click', openSourceSelector);
  if (btnChangeImage) btnChangeImage.addEventListener('click', openSourceSelector);

  if (profileAvatarWrapper) {
    profileAvatarWrapper.addEventListener('click', openSourceSelector);
    profileAvatarWrapper.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openSourceSelector();
      }
    });
  }

  if (btnCloseSourceSelector) {
    btnCloseSourceSelector.addEventListener('click', () => {
      if (sourceSelectorCard) sourceSelectorCard.classList.add('hidden');
    });
  }

  // Choice 1: Local Computer
  if (btnSourceComputer) {
    btnSourceComputer.addEventListener('click', () => {
      if (sourceSelectorCard) sourceSelectorCard.classList.add('hidden');
      if (imageFileInput) {
        imageFileInput.value = '';
        imageFileInput.click();
      }
    });
  }

  // Choice 2: Google Account
  if (btnSourceGoogle) {
    btnSourceGoogle.addEventListener('click', async () => {
      if (sourceSelectorCard) sourceSelectorCard.classList.add('hidden');
      await openGoogleFlow();
    });
  }
}

/**
 * Opens and initializes the Google Account card.
 */
async function openGoogleFlow() {
  const googleFlowCard = document.getElementById('googleFlowCard');
  const googleUnconfiguredView = document.getElementById('googleUnconfiguredView');
  const googleConnectView = document.getElementById('googleConnectView');
  const googleLoadingView = document.getElementById('googleLoadingView');
  const inputCustomClientId = document.getElementById('inputCustomClientId');

  if (!googleFlowCard) return;

  hideAlert();
  googleFlowCard.classList.remove('hidden');
  if (googleLoadingView) googleLoadingView.classList.add('hidden');

  const isConfigured = await googleAuthService.isConfigured();

  if (!isConfigured) {
    // Show configuration guide
    if (googleUnconfiguredView) googleUnconfiguredView.classList.remove('hidden');
    if (googleConnectView) googleConnectView.classList.add('hidden');
    if (inputCustomClientId) {
      const currentId = await googleAuthService.getClientId();
      inputCustomClientId.value = currentId || '';
    }
  } else {
    // Show connect prompt
    if (googleUnconfiguredView) googleUnconfiguredView.classList.add('hidden');
    if (googleConnectView) googleConnectView.classList.remove('hidden');
  }
}

/**
 * Sets up Google OAuth and Profile picture import flows.
 */
function setupGoogleFlow() {
  const btnCloseGoogleFlow = document.getElementById('btnCloseGoogleFlow');
  const googleFlowCard = document.getElementById('googleFlowCard');
  const btnConnectGoogle = document.getElementById('btnConnectGoogle');
  const googleConnectView = document.getElementById('googleConnectView');
  const googleLoadingView = document.getElementById('googleLoadingView');
  const googleLoadingText = document.getElementById('googleLoadingText');

  const btnSaveClientId = document.getElementById('btnSaveClientId');
  const inputCustomClientId = document.getElementById('inputCustomClientId');
  const googleUnconfiguredView = document.getElementById('googleUnconfiguredView');

  const btnDisconnectGoogle = document.getElementById('btnDisconnectGoogle');

  // Close Google flow card
  if (btnCloseGoogleFlow) {
    btnCloseGoogleFlow.addEventListener('click', () => {
      if (googleFlowCard) googleFlowCard.classList.add('hidden');
    });
  }

  // Save custom client ID entered in popup
  if (btnSaveClientId && inputCustomClientId) {
    btnSaveClientId.addEventListener('click', async () => {
      const val = inputCustomClientId.value.trim();
      if (!val) {
        showAlert('Please paste a valid Google OAuth Client ID.', 'warning');
        return;
      }

      await googleAuthService.setCustomClientId(val);
      showAlert('Google Client ID saved locally.', 'success');

      if (googleUnconfiguredView) googleUnconfiguredView.classList.add('hidden');
      if (googleConnectView) googleConnectView.classList.remove('hidden');
    });
  }

  // Connect Google Account & Import Photo
  if (btnConnectGoogle) {
    btnConnectGoogle.addEventListener('click', async () => {
      if (isOperationInProgress) return;

      try {
        setOperationState(true);
        if (googleConnectView) googleConnectView.classList.add('hidden');
        if (googleLoadingView) googleLoadingView.classList.remove('hidden');

        // Execute complete import pipeline
        const result = await googleProfileService.importGoogleAvatar({
          onProgress: (statusMsg) => {
            if (googleLoadingText) googleLoadingText.textContent = statusMsg;
          }
        });

        // Close Google Card
        if (googleFlowCard) googleFlowCard.classList.add('hidden');

        // Render newly saved avatar
        renderActiveState({
          imageData: result.avatarRecord.blob,
          metadata: result.avatarRecord.metadata
        });

        showAlert(
          `Imported Google avatar for ${result.user.name || result.user.email}.`,
          'success'
        );

        // Refresh diagnostics if open
        const panel = document.getElementById('diagnosticsPanel');
        if (panel && !panel.classList.contains('hidden')) {
          await populateDiagnostics();
        }
      } catch (err) {
        log.error('Google avatar import error:', err);
        if (googleLoadingView) googleLoadingView.classList.add('hidden');
        if (googleConnectView) googleConnectView.classList.remove('hidden');

        const message = err.message || 'Failed to import Google profile photo.';
        showAlert(message, 'error');
      } finally {
        setOperationState(false);
      }
    });
  }

  // Disconnect Google Account Session (leaves local avatar intact)
  if (btnDisconnectGoogle) {
    btnDisconnectGoogle.addEventListener('click', async () => {
      try {
        await googleAuthService.signOut();
        const avatarSourceTag = document.getElementById('avatarSourceTag');
        if (avatarSourceTag) avatarSourceTag.classList.add('hidden');

        showAlert('Google account session disconnected. Local avatar remains saved.', 'info');
      } catch (err) {
        log.error('Failed to disconnect Google account:', err);
      }
    });
  }
}

/**
 * Sets up local computer image file selection, preview, saving, and deletion.
 */
function setupLocalImageActions() {
  const imageFileInput = document.getElementById('imageFileInput');
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

        const metadata = {
          source: 'local',
          width: inFlightProcessedImage.width,
          height: inFlightProcessedImage.height,
          originalName: inFlightProcessedImage.originalName,
          sizeBytes: inFlightProcessedImage.sizeBytes,
          mimeType: inFlightProcessedImage.mimeType,
          importedAt: Date.now()
        };

        await profileService.saveProfileImage(inFlightProcessedImage.blob, metadata);

        // Hide preview and clean up preview URL
        if (imagePreviewCard) imagePreviewCard.classList.add('hidden');
        if (previewAvatarUrl) {
          revokeObjectUrl(previewAvatarUrl);
          previewAvatarUrl = null;
        }

        const savedBlob = inFlightProcessedImage.blob;
        inFlightProcessedImage = null;

        // Render active avatar immediately
        renderActiveState({
          imageData: savedBlob,
          metadata
        });
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
  const diagAvatarSource = document.getElementById('diagAvatarSource');
  const diagGoogleStatus = document.getElementById('diagGoogleStatus');
  const diagRedirectUri = document.getElementById('diagRedirectUri');
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

    // Google config status
    if (diagGoogleStatus) {
      const isConfigured = await googleAuthService.isConfigured();
      diagGoogleStatus.textContent = isConfigured ? 'Configured (OAuth Ready)' : 'Not Configured (Missing Client ID)';
      diagGoogleStatus.className = isConfigured ? 'diag-val highlight-green' : 'diag-val';
    }

    if (diagRedirectUri) {
      diagRedirectUri.textContent = googleAuthService.getRedirectUri();
    }

    // Custom avatar status and source
    if (diagAvatarStatus) {
      const avatar = await profileService.getProfileImage();
      if (avatar && avatar.imageData) {
        const w = avatar.metadata?.width || 512;
        const h = avatar.metadata?.height || 512;
        const format = (avatar.mimeType || 'image/png').replace('image/', '').toUpperCase();
        diagAvatarStatus.textContent = `${w}×${h} ${format} (${formatBytes(avatar.sizeBytes)})`;

        if (diagAvatarSource) {
          if (avatar.metadata?.source === 'google') {
            diagAvatarSource.textContent = `Google (${avatar.metadata.email || 'account'})`;
          } else {
            diagAvatarSource.textContent = 'Local File';
          }
        }
      } else {
        diagAvatarStatus.textContent = 'None (Default placeholder)';
        if (diagAvatarSource) diagAvatarSource.textContent = 'None';
      }
    }
  } catch (err) {
    log.error('Diagnostics population error:', err);
  }
}
