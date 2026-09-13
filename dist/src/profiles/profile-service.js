/**
 * Profile Service (Self-Scoped Profile Manager)
 *
 * Responsibilities:
 * - Manages the profile identity lifecycle within the active profile's storage sandbox.
 * - Guarantees that each Brave profile automatically receives and maintains its own
 *   independent profile instance ID and friendly display name.
 * - Survives browser restarts, extension reloads, and computer restarts.
 */

import { STORAGE_KEYS } from '../utils/constants.js';
import { createLogger } from '../utils/logger.js';
import { createProfile, generateProfileInstanceId } from './profile-model.js';
import { imageStorage } from '../storage/image-storage.js';

const log = createLogger('ProfileService');

class ProfileService {
  constructor() {
    /** @type {import('./profile-model.js').Profile|null} */
    this._cachedProfile = null;
    /** @type {Promise<import('./profile-model.js').Profile>|null} */
    this._initPromise = null;
  }

  /**
   * Retrieves or initializes the Profile record for the current Brave profile sandbox.
   *
   * @returns {Promise<import('./profile-model.js').Profile>}
   */
  async getOrCreateCurrentProfile() {
    if (this._cachedProfile) {
      return this._cachedProfile;
    }
    if (this._initPromise) {
      return this._initPromise;
    }

    this._initPromise = (async () => {
      try {
        const stored = await this._readStoredProfileData();

        if (stored.instanceId) {
          log.info(`Loaded existing profile instance [${stored.instanceId}] ("${stored.name}")`);
          this._cachedProfile = createProfile({
            instanceId: stored.instanceId,
            name: stored.name,
            metadata: {
              createdAt: stored.createdAt,
              updatedAt: stored.updatedAt
            }
          });
        } else {
          // First launch in this specific Brave profile partition: Generate new instance identity
          const newInstanceId = generateProfileInstanceId();
          const defaultName = 'Brave Profile';
          const now = Date.now();

          log.info(`First launch in this profile. Initialized new profile instance [${newInstanceId}]`);

          await this._writeStoredProfileData({
            instanceId: newInstanceId,
            name: defaultName,
            createdAt: now,
            updatedAt: now
          });

          this._cachedProfile = createProfile({
            instanceId: newInstanceId,
            name: defaultName,
            metadata: {
              createdAt: now,
              updatedAt: now
            }
          });
        }

        return this._cachedProfile;
      } catch (err) {
        log.error('Failed to initialize or read current profile:', err);
        // Resilient in-memory fallback
        this._cachedProfile = createProfile({
          name: 'Brave Profile (Transient)'
        });
        return this._cachedProfile;
      } finally {
        this._initPromise = null;
      }
    })();

    return this._initPromise;
  }

  /**
   * Updates the friendly display name for the current profile instance.
   *
   * @param {string} newName - User-provided name (e.g., 'Personal', 'Work', 'Uni')
   * @returns {Promise<import('./profile-model.js').Profile>}
   */
  async updateProfileName(newName) {
    const profile = await this.getOrCreateCurrentProfile();
    const sanitized = String(newName || '').trim() || 'Brave Profile';
    const now = Date.now();

    profile.name = sanitized;
    profile.metadata.updatedAt = now;

    await this._writeStoredProfileData({
      instanceId: profile.instanceId,
      name: sanitized,
      createdAt: profile.metadata.createdAt,
      updatedAt: now
    });

    log.info(`Updated profile name to "${sanitized}" for [${profile.instanceId}]`);
    return profile;
  }

  /**
   * Convenience getter for the profile instance ID.
   *
   * @returns {Promise<string>}
   */
  async getProfileInstanceId() {
    const profile = await this.getOrCreateCurrentProfile();
    return profile.instanceId;
  }

  /**
   * Saves a profile image for the active Brave profile partition.
   * Automatically uses the persistent instance ID of this profile.
   *
   * @param {Blob|ArrayBuffer|string} imageData - Binary Blob of the avatar image
   * @param {Object} [metadata={}] - Optional metadata (width, height, originalName, etc.)
   * @returns {Promise<{ profileId: string, savedAt: number }>}
   */
  async saveProfileImage(imageData, metadata = {}) {
    const instanceId = await this.getProfileInstanceId();
    const result = await imageStorage.saveProfileImage(instanceId, imageData, metadata);
    if (this._cachedProfile) {
      this._cachedProfile.image = imageData;
      this._cachedProfile.metadata.updatedAt = result.savedAt;
    }
    return result;
  }

  /**
   * Retrieves the stored profile image record for the active Brave profile partition.
   *
   * @returns {Promise<{ profileId: string, imageData: Blob, mimeType: string, updatedAt: number, metadata: Object } | null>}
   */
  async getProfileImage() {
    const instanceId = await this.getProfileInstanceId();
    return imageStorage.getProfileImage(instanceId);
  }

  /**
   * Removes the profile image for the active Brave profile partition.
   *
   * @returns {Promise<boolean>}
   */
  async removeProfileImage() {
    const instanceId = await this.getProfileInstanceId();
    const removed = await imageStorage.removeProfileImage(instanceId);
    if (this._cachedProfile) {
      this._cachedProfile.image = null;
      this._cachedProfile.metadata.updatedAt = Date.now();
    }
    return removed;
  }

  /**
   * Checks whether the active Brave profile partition has a saved profile image.
   *
   * @returns {Promise<boolean>}
   */
  async hasProfileImage() {
    const instanceId = await this.getProfileInstanceId();
    return imageStorage.hasProfileImage(instanceId);
  }

  // --- Internal Storage Helpers ---

  /**
   * Reads profile identity keys from chrome.storage.local.
   * @private
   */
  async _readStoredProfileData() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const result = await chrome.storage.local.get([
        STORAGE_KEYS.PROFILE_INSTANCE_ID,
        STORAGE_KEYS.PROFILE_DISPLAY_NAME,
        STORAGE_KEYS.PROFILE_CREATED_AT,
        STORAGE_KEYS.PROFILE_UPDATED_AT
      ]);

      return {
        instanceId: result[STORAGE_KEYS.PROFILE_INSTANCE_ID] || null,
        name: result[STORAGE_KEYS.PROFILE_DISPLAY_NAME] || null,
        createdAt: result[STORAGE_KEYS.PROFILE_CREATED_AT] || null,
        updatedAt: result[STORAGE_KEYS.PROFILE_UPDATED_AT] || null
      };
    }

    // Fallback if chrome.storage is not ready
    return { instanceId: null, name: null, createdAt: null, updatedAt: null };
  }

  /**
   * Persists profile identity keys to chrome.storage.local.
   * @private
   */
  async _writeStoredProfileData({ instanceId, name, createdAt, updatedAt }) {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.PROFILE_INSTANCE_ID]: instanceId,
        [STORAGE_KEYS.PROFILE_DISPLAY_NAME]: name,
        [STORAGE_KEYS.PROFILE_CREATED_AT]: createdAt,
        [STORAGE_KEYS.PROFILE_UPDATED_AT]: updatedAt
      });
    }
  }
}

export const profileService = new ProfileService();
export default profileService;
