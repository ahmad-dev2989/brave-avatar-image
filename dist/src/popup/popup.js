/**
 * Popup Controller (Phase 6 — UI/UX Polish & Production-Quality Interface)
 *
 * Coordinates the extension popup interface:
 * - Profile identity and custom circular avatar presentation (Hero Showcase).
 * - Modal & Sheet management (Source selector, Google flow, Image preview, Remove confirmation).
 * - Toast notification system (transient success, error recovery, auto-dismiss).
 * - Button system hierarchy (Primary, Secondary, Danger, Google).
 * - Clean object URL lifecycle management to avoid memory leaks.
 * - Profile-isolated IndexedDB persistence and 100% offline display.
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
import { ToastController } from './toast.js';
import { ModalManager } from './modal.js';

const log = createLogger('Popup');

// In-memory state tracking
let cachedDiagnostics = null;
let activeAvatarUrl = null;
let previewAvatarUrl = null;
let inFlightProcessedImage = null;
let isOperationInProgress = false;
let fileSelectionSequenceId = 0;

// Reusable UI controllers
let toast = null;
let modalManager = null;

document.addEventListener('DOMContentLoaded', async () => {
  log.info('Popup initialized in active Brave profile context.');

  // Set extension version badge
  const versionBadge = document.getElementById('versionBadge');
  if (versionBadge) {
    versionBadge.textContent = `v${EXTENSION_CONFIG.VERSION} • Production`;
  }

  // Initialize Toast and Modal controllers
  initializeControllers();

  // Bind UI event listeners
  setupEventListeners();

  // Load active profile and avatar
  await loadProfileAndAvatar();
});

// Clean up object URLs when the popup closes to prevent memory leaks
window.addEventListener('unload', () => {
  if (activeAvatarUrl) revokeObjectUrl(activeAvatarUrl);
  if (previewAvatarUrl) revokeObjectUrl(previewAvatarUrl);
});

/**
 * Initializes Toast and Modal controllers.
 */
function initializeControllers() {
  toast = new ToastController({
    container: document.getElementById('toastContainer'),
    icon: document.getElementById('toastIcon'),
    text: document.getElementById('toastText'),
    actionBtn: document.getElementById('btnToastAction'),
    dismissBtn: document.getElementById('btnDismissToast')
  });

  modalManager = new ModalManager();

  // Register Modal Dialogs
  modalManager.register('source-selector', {
    element: document.getElementById('sourceSelectorCard'),
    closeButtons: [document.getElementById('btnCloseSourceSelector')]
  });

  modalManager.register('google-flow', {
    element: document.getElementById('googleFlowCard'),
    closeButtons: [document.getElementById('btnCloseGoogleFlow')]
  });

  modalManager.register('remove-confirm', {
    element: document.getElementById('removeConfirmBox'),
    closeButtons: [document.getElementById('btnCancelRemove')]
  });

  modalManager.register('image-preview', {
    element: document.getElementById('imagePreviewCard'),
    closeButtons: [document.getElementById('btnCancelImage')],
    onClose: () => {
      // Free in-flight processed image and revoke preview object URL on ANY modal dismissal
      if (previewAvatarUrl) {
        revokeObjectUrl(previewAvatarUrl);
        previewAvatarUrl = null;
      }
      inFlightProcessedImage = null;
    }
  });
}

/**
 * Loads the active profile record and retrieves the stored avatar from IndexedDB.
 */
async function loadProfileAndAvatar() {
  if (isOperationInProgress) return;
  setOperationState(true);
  showLoadingState(true);
  if (toast) toast.hide();

  const profileNameText = document.getElementById('profileNameText');

  try {
    // 1. Resolve active profile partition identity
    const profile = await profileService.getOrCreateCurrentProfile();
    if (profileNameText) {
      profileNameText.textContent = profile.name || 'Current Brave Profile';
    }

    // 2. Fetch avatar record from isolated IndexedDB
    let avatarRecord = null;
    try {
      avatarRecord = await profileService.getProfileImage();
    } catch (storageErr) {
      log.warn('Storage read warning (falling back gracefully):', storageErr);
    }

    if (avatarRecord && avatarRecord.imageData && avatarRecord.imageData instanceof Blob && avatarRecord.imageData.size > 0) {
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
    if (toast) {
      toast.show(
        ToastController.formatErrorMessage(err),
        'error',
        { actionText: 'Retry', onAction: loadProfileAndAvatar }
      );
    }
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
  const avatarSourceTag = document.getElementById('avatarSourceTag');
  const avatarSourceIcon = document.getElementById('avatarSourceIcon');
  const avatarSourceText = document.getElementById('avatarSourceText');
  const btnDisconnectGoogle = document.getElementById('btnDisconnectGoogle');

  // Safely manage object URL
  if (activeAvatarUrl) {
    revokeObjectUrl(activeAvatarUrl);
  }
  activeAvatarUrl = createObjectUrl(avatarRecord.imageData);

  if (profileAvatarImg) {
    // Attach error fallback to handle corrupt or unrenderable image blobs safely
    profileAvatarImg.onerror = () => {
      log.warn('Avatar image failed to render. Falling back to neutral placeholder.');
      if (activeAvatarUrl) {
        revokeObjectUrl(activeAvatarUrl);
        activeAvatarUrl = null;
      }
      profileAvatarImg.src = '';
      profileAvatarImg.classList.add('hidden');
      if (profileAvatarEmpty) profileAvatarEmpty.classList.remove('hidden');
      if (avatarStatusBadge && avatarStatusText) {
        avatarStatusBadge.className = 'status-pill status-pill-empty';
        avatarStatusText.textContent = 'Image display error';
      }
      if (toast) {
        toast.show('Saved avatar could not be displayed. Please choose a new image.', 'warning');
      }
    };

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

  // Configure Secondary Source Indicator
  if (avatarSourceTag && avatarSourceText) {
    if (avatarRecord.metadata && avatarRecord.metadata.source === 'google') {
      if (avatarSourceIcon) avatarSourceIcon.textContent = '🌐';
      const email = avatarRecord.metadata.email || avatarRecord.metadata.displayName;
      avatarSourceText.textContent = email ? `From Google (${email})` : 'From Google Account';
      if (btnDisconnectGoogle) btnDisconnectGoogle.classList.remove('hidden');
    } else {
      if (avatarSourceIcon) avatarSourceIcon.textContent = '📁';
      avatarSourceText.textContent = 'Uploaded from computer';
      if (btnDisconnectGoogle) btnDisconnectGoogle.classList.add('hidden');
    }
    avatarSourceTag.classList.remove('hidden');
  }

  // Hide empty state text
  if (emptyStateText) emptyStateText.classList.add('hidden');

  // Toggle Action Buttons
  if (btnAddImage) btnAddImage.classList.add('hidden');
  if (activeActionButtons) activeActionButtons.classList.remove('hidden');

  // Close any open transient sheets
  if (modalManager) {
    modalManager.closeAll();
  }
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
  const avatarSourceTag = document.getElementById('avatarSourceTag');

  // Revoke active object URL
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

  // Hide source tag in empty state
  if (avatarSourceTag) avatarSourceTag.classList.add('hidden');

  // Show empty state text
  if (emptyStateText) emptyStateText.classList.remove('hidden');

  // Toggle Action Buttons
  if (btnAddImage) btnAddImage.classList.remove('hidden');
  if (activeActionButtons) activeActionButtons.classList.add('hidden');

  // Close modals
  if (modalManager) {
    modalManager.closeAll();
  }
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
 * Disables buttons during asynchronous operations to prevent race conditions.
 *
 * @param {boolean} inProgress
 */
function setOperationState(inProgress) {
  isOperationInProgress = inProgress;

  const buttons = [
    document.getElementById('btnAddImage'),
    document.getElementById('btnChangeImage'),
    document.getElementById('btnRemoveImage'),
    document.getElementById('btnSaveImage'),
    document.getElementById('btnConfirmRemove'),
    document.getElementById('btnConnectGoogle'),
    document.getElementById('btnSourceComputer'),
    document.getElementById('btnSourceGoogle')
  ];

  buttons.forEach((btn) => {
    if (btn) btn.disabled = inProgress;
  });
}

/**
 * Binds all interactive UI events.
 */
function setupEventListeners() {
  // 1. Profile Name Inline Editing
  setupProfileNameEditor();

  // 2. Avatar Selection Flow (Computer vs Google)
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
      if (isOperationInProgress) return;
      const newName = inputProfileName.value.trim();
      if (newName) {
        try {
          setOperationState(true);
          const updated = await profileService.updateProfileName(newName);
          if (profileNameText) profileNameText.textContent = updated.name;
        } catch (err) {
          log.error('Failed to rename profile:', err);
          if (toast) toast.show('Failed to save profile name.', 'error');
        } finally {
          setOperationState(false);
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
  const btnSourceComputer = document.getElementById('btnSourceComputer');
  const btnSourceGoogle = document.getElementById('btnSourceGoogle');
  const imageFileInput = document.getElementById('imageFileInput');

  const openSourceSelector = (e) => {
    if (isOperationInProgress) return;
    if (toast) toast.hide();
    modalManager.open('source-selector', e?.currentTarget || btnAddImage);
  };

  if (btnAddImage) btnAddImage.addEventListener('click', openSourceSelector);
  if (btnChangeImage) btnChangeImage.addEventListener('click', openSourceSelector);

  if (profileAvatarWrapper) {
    profileAvatarWrapper.addEventListener('click', openSourceSelector);
    profileAvatarWrapper.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openSourceSelector(e);
      }
    });
  }

  // Option 1: Local Computer File
  if (btnSourceComputer) {
    btnSourceComputer.addEventListener('click', () => {
      modalManager.close('source-selector', false);
      if (imageFileInput) {
        imageFileInput.value = '';
        imageFileInput.click();
      }
    });
  }

  // Option 2: Google Account
  if (btnSourceGoogle) {
    btnSourceGoogle.addEventListener('click', async () => {
      modalManager.close('source-selector', false);
      await openGoogleFlow();
    });
  }
}

/**
 * Opens and initializes the Google Account card.
 */
async function openGoogleFlow() {
  const googleConnectView = document.getElementById('googleConnectView');
  const googleLoadingView = document.getElementById('googleLoadingView');
  const inputCustomClientId = document.getElementById('inputCustomClientId');

  if (toast) toast.hide();
  if (googleLoadingView) googleLoadingView.classList.add('hidden');
  if (googleConnectView) googleConnectView.classList.remove('hidden');

  if (inputCustomClientId) {
    const currentId = await googleAuthService.getClientId();
    inputCustomClientId.value = currentId || '';
  }

  modalManager.open('google-flow');
}

/**
 * Sets up Google OAuth and Profile picture import flows.
 */
function setupGoogleFlow() {
  const btnConnectGoogle = document.getElementById('btnConnectGoogle');
  const googleConnectView = document.getElementById('googleConnectView');
  const googleLoadingView = document.getElementById('googleLoadingView');
  const googleLoadingText = document.getElementById('googleLoadingText');

  const btnSaveClientId = document.getElementById('btnSaveClientId');
  const inputCustomClientId = document.getElementById('inputCustomClientId');
  const googleUnconfiguredView = document.getElementById('googleUnconfiguredView');
  const btnDisconnectGoogle = document.getElementById('btnDisconnectGoogle');

  // Save custom client ID entered in popup
  if (btnSaveClientId && inputCustomClientId) {
    btnSaveClientId.addEventListener('click', async () => {
      const val = inputCustomClientId.value.trim();
      if (!val) {
        if (toast) toast.show('Please paste a valid Google OAuth Client ID.', 'warning');
        return;
      }

      await googleAuthService.setCustomClientId(val);
      if (toast) toast.show('Google Client ID saved locally.', 'success');

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

        // Execute import pipeline with step status reporting
        const result = await googleProfileService.importGoogleAvatar({
          onProgress: (statusMsg) => {
            if (googleLoadingText) googleLoadingText.textContent = statusMsg;
          }
        });

        // Close Google Card
        modalManager.close('google-flow', false);

        // Render newly saved avatar
        renderActiveState({
          imageData: result.avatarRecord.blob,
          metadata: result.avatarRecord.metadata
        });

        if (toast) {
          toast.show('Google profile photo applied.', 'success');
        }

        // Refresh diagnostics if open
        const panel = document.getElementById('diagnosticsPanel');
        if (panel && !panel.classList.contains('hidden')) {
          await populateDiagnostics();
        }
      } catch (err) {
        log.error('Google avatar import error:', err);
        if (googleLoadingView) googleLoadingView.classList.add('hidden');
        if (googleConnectView) googleConnectView.classList.remove('hidden');

        const errMsg = err?.message || String(err);
        let friendlyMsg = ToastController.formatErrorMessage(err);
        if (errMsg.includes('redirect_uri_mismatch') || errMsg.includes('invalid_client') || errMsg.includes('Authorization failed')) {
          friendlyMsg = 'Google OAuth sign-in unavailable. You can paste your Google profile photo link below to import directly!';
        }
        if (toast) toast.show(friendlyMsg, 'error');
      } finally {
        setOperationState(false);
      }
    });
  }

  // Import photo via direct Google photo URL or web link
  const inputGooglePhotoUrl = document.getElementById('inputGooglePhotoUrl');
  const btnImportGoogleUrl = document.getElementById('btnImportGoogleUrl');

  if (btnImportGoogleUrl && inputGooglePhotoUrl) {
    btnImportGoogleUrl.addEventListener('click', async () => {
      if (isOperationInProgress) return;
      const rawUrl = inputGooglePhotoUrl.value.trim();
      if (!rawUrl) {
        if (toast) toast.show('Please paste a Google photo link or image address.', 'warning');
        return;
      }

      try {
        setOperationState(true);
        btnImportGoogleUrl.textContent = 'Importing...';

        let response;
        try {
          response = await fetch(rawUrl);
        } catch (netErr) {
          throw new Error('Could not download image from the provided link. Please check the URL.');
        }

        if (!response.ok) {
          throw new Error(`Failed to download image (HTTP ${response.status}).`);
        }

        const rawBlob = await response.blob();
        if (!rawBlob || rawBlob.size === 0) {
          throw new Error('Downloaded image file is empty.');
        }

        // Process through authoritative pipeline (center-crop 1:1, downscale max 512, PNG)
        const processed = await processAvatarImage(rawBlob, {
          targetSize: 512,
          outputMimeType: 'image/png'
        });

        const metadata = {
          source: 'google',
          provider: 'google',
          sourceImageUrl: rawUrl,
          width: processed.width,
          height: processed.height,
          sizeBytes: processed.sizeBytes,
          originalName: 'google-avatar.png',
          importedAt: Date.now()
        };

        const savedBlob = processed.blob;
        await profileService.saveProfileImage(savedBlob, metadata);

        modalManager.close('google-flow', false);
        inputGooglePhotoUrl.value = '';

        renderActiveState({
          imageData: savedBlob,
          metadata
        });

        if (toast) toast.show('Google profile photo applied.', 'success');

        const panel = document.getElementById('diagnosticsPanel');
        if (panel && !panel.classList.contains('hidden')) {
          await populateDiagnostics();
        }
      } catch (err) {
        log.error('URL import error:', err);
        const friendlyMsg = ToastController.formatErrorMessage(err);
        if (toast) toast.show(friendlyMsg, 'error');
      } finally {
        if (btnImportGoogleUrl) btnImportGoogleUrl.textContent = 'Import';
        setOperationState(false);
      }
    });
  }

  // Disconnect Google Account Session (preserves local avatar in IndexedDB)
  if (btnDisconnectGoogle) {
    btnDisconnectGoogle.addEventListener('click', async () => {
      if (isOperationInProgress) return;
      try {
        setOperationState(true);
        await googleAuthService.signOut();
        const avatarSourceTag = document.getElementById('avatarSourceTag');
        const avatarSourceIcon = document.getElementById('avatarSourceIcon');
        const avatarSourceText = document.getElementById('avatarSourceText');

        if (btnDisconnectGoogle) btnDisconnectGoogle.classList.add('hidden');
        if (avatarSourceIcon) avatarSourceIcon.textContent = '📁';
        if (avatarSourceText) avatarSourceText.textContent = 'Uploaded from computer';

        if (toast) {
          toast.show('Google account session disconnected. Local avatar remains saved.', 'info');
        }
      } catch (err) {
        log.error('Failed to disconnect Google account:', err);
      } finally {
        setOperationState(false);
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

  const imagePreviewImg = document.getElementById('imagePreviewImg');
  const previewFileName = document.getElementById('previewFileName');
  const previewMetaInfo = document.getElementById('previewMetaInfo');
  const btnSaveImage = document.getElementById('btnSaveImage');

  const btnConfirmRemove = document.getElementById('btnConfirmRemove');

  // File selected in native dialog
  if (imageFileInput) {
    imageFileInput.addEventListener('change', async (event) => {
      const files = event.target.files;
      if (!files || files.length === 0) return;

      const file = files[0];
      const seq = ++fileSelectionSequenceId;

      // Validate constraints (MIME type, size <= 5 MB)
      const validation = validateImageFile(file);
      if (!validation.valid) {
        if (toast) toast.show(validation.error, 'error');
        return;
      }

      // Process and decode
      try {
        setOperationState(true);
        const processed = await processAvatarImage(file);

        // Verify that this is still the most recent selection (race protection)
        if (seq !== fileSelectionSequenceId) {
          log.info('Discarding stale out-of-order file processing result.');
          return;
        }

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

        modalManager.open('image-preview');
        if (toast) toast.hide();
      } catch (err) {
        log.error('Image processing failed:', err);
        const friendlyMsg = ToastController.formatErrorMessage(err);
        if (toast) toast.show(friendlyMsg, 'error');
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

        // Capture image reference before any modal close hook can dereference it
        const currentProcessed = inFlightProcessedImage;
        const savedBlob = currentProcessed.blob;

        const metadata = {
          source: 'local',
          width: currentProcessed.width,
          height: currentProcessed.height,
          originalName: currentProcessed.originalName,
          sizeBytes: currentProcessed.sizeBytes,
          mimeType: currentProcessed.mimeType,
          importedAt: Date.now()
        };

        // 1. Save to profile-scoped IndexedDB
        await profileService.saveProfileImage(savedBlob, metadata);

        // 2. Clean up preview object URL and clear state
        if (previewAvatarUrl) {
          revokeObjectUrl(previewAvatarUrl);
          previewAvatarUrl = null;
        }
        inFlightProcessedImage = null;

        // 3. Hide preview modal
        modalManager.close('image-preview', false);

        // 4. Render active avatar immediately
        renderActiveState({
          imageData: savedBlob,
          metadata
        });

        if (toast) toast.show('Avatar updated.', 'success');

        // Refresh diagnostics if open
        const panel = document.getElementById('diagnosticsPanel');
        if (panel && !panel.classList.contains('hidden')) {
          await populateDiagnostics();
        }
      } catch (err) {
        log.error('Failed to save avatar image:', err);
        if (toast) {
          toast.show(
            ToastController.formatErrorMessage(err),
            'error',
            { actionText: 'Try Again', onAction: () => btnSaveImage?.click() }
          );
        }
      } finally {
        if (btnSaveImage) btnSaveImage.textContent = 'Use This Image';
        setOperationState(false);
      }
    });
  }

  // Show Remove Confirmation
  if (btnRemoveImage) {
    btnRemoveImage.addEventListener('click', (e) => {
      modalManager.open('remove-confirm', e.currentTarget);
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

        modalManager.close('remove-confirm', false);
        renderEmptyState();
        if (toast) toast.show('Avatar removed.', 'info');

        // Refresh diagnostics if open
        const panel = document.getElementById('diagnosticsPanel');
        if (panel && !panel.classList.contains('hidden')) {
          await populateDiagnostics();
        }
      } catch (err) {
        log.error('Failed to remove profile image:', err);
        if (toast) toast.show('Failed to remove avatar from local storage.', 'error');
      } finally {
        setOperationState(false);
        btnConfirmRemove.textContent = 'Remove';
      }
    });
  }
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
