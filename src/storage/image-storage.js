/**
 * Profile Image Storage Engine (IndexedDB Implementation)
 *
 * ARCHITECTURAL DECISION & RATIONALE:
 * ------------------------------------
 * When persisting profile images locally across browser/computer restarts, two primary
 * browser storage mechanisms are available in Chromium/Brave extensions:
 *
 * 1. chrome.storage.local:
 *    - Quota is capped at 10 MB total by default (`QUOTA_BYTES`).
 *    - All values are serialized to JSON strings. Storing images requires Base64 data URLs,
 *      which incurs an immediate ~33% byte expansion and substantial CPU/memory overhead
 *      during serialization and deserialization of large strings.
 *
 * 2. IndexedDB (SELECTED):
 *    - Natively supports binary data (`Blob`, `ArrayBuffer`, `Uint8Array`) via structured cloning.
 *    - No Base64 conversion or stringification overhead.
 *    - Much higher storage ceiling (tens to hundreds of megabytes based on local disk).
 *    - Atomic transactional operations with robust error recovery.
 *    - Standard Web API supported natively in extension popups, options pages, and MV3 service workers.
 *    - Does not require special manifest permissions.
 *
 * This module encapsulates all low-level IndexedDB transactions behind clean, promise-based
 * methods ready for consumption by future profile management phases.
 */

import { DB_CONFIG } from '../utils/constants.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Storage');

class ImageStorageService {
  constructor() {
    /** @type {IDBDatabase|null} */
    this.db = null;
    /** @type {Promise<IDBDatabase>|null} */
    this._initPromise = null;
  }

  /**
   * Initializes and returns the IndexedDB database instance.
   * Caches the open connection or returns the in-flight initialization promise.
   *
   * @returns {Promise<IDBDatabase>}
   */
  async getDatabase() {
    if (this.db) {
      return this.db;
    }
    if (this._initPromise) {
      return this._initPromise;
    }

    this._initPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not supported in this runtime environment.'));
        return;
      }

      const request = indexedDB.open(DB_CONFIG.NAME, DB_CONFIG.VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        log.info(`Upgrading database "${DB_CONFIG.NAME}" to version ${DB_CONFIG.VERSION}`);

        // Store: profile_images (keyed by profileId string)
        if (!db.objectStoreNames.contains(DB_CONFIG.STORES.PROFILE_IMAGES)) {
          db.createObjectStore(DB_CONFIG.STORES.PROFILE_IMAGES, { keyPath: 'profileId' });
        }

        // Store: profile_metadata (optional metadata store for future phases)
        if (!db.objectStoreNames.contains(DB_CONFIG.STORES.PROFILE_METADATA)) {
          db.createObjectStore(DB_CONFIG.STORES.PROFILE_METADATA, { keyPath: 'profileId' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;

        // Reset cached connection if the database is closed externally or upgraded
        this.db.onclose = () => {
          log.warn('Database connection closed unexpectedly.');
          this.db = null;
          this._initPromise = null;
        };

        log.info('IndexedDB initialized successfully.');
        resolve(this.db);
      };

      request.onerror = (event) => {
        const err = event.target.error || new Error('Failed to open IndexedDB.');
        log.error('Database open error:', err);
        this._initPromise = null;
        reject(err);
      };
    });

    return this._initPromise;
  }

  /**
   * Checks if the storage engine is available and can open a transaction.
   *
   * @returns {Promise<{ available: boolean, engine: string, error?: string }>}
   */
  async checkHealth() {
    try {
      await this.getDatabase();
      return { available: true, engine: 'IndexedDB', database: DB_CONFIG.NAME };
    } catch (err) {
      return { available: false, engine: 'IndexedDB', error: err.message };
    }
  }

  /**
   * Saves or updates an image record for a given profile ID.
   *
   * NOTE for Future Phases:
   * `imageData` can be a binary `Blob`, `ArrayBuffer`, or a clean object.
   * Storing binary blobs directly avoids Base64 overhead.
   *
   * @param {string} profileId - Unique profile identifier
   * @param {Blob|ArrayBuffer|string} imageData - Image data (Blob preferred)
   * @param {Object} [metadata={}] - Optional metadata (mimeType, size, name, timestamp)
   * @returns {Promise<{ profileId: string, savedAt: number }>}
   */
  async saveProfileImage(profileId, imageData, metadata = {}) {
    if (!profileId || typeof profileId !== 'string') {
      throw new TypeError('A valid string profileId is required to save an image.');
    }
    if (!imageData) {
      throw new TypeError('imageData cannot be null or undefined.');
    }

    const db = await this.getDatabase();
    const record = {
      profileId,
      imageData,
      mimeType: metadata.mimeType || (imageData instanceof Blob ? imageData.type : 'image/png'),
      sizeBytes: metadata.sizeBytes || (imageData instanceof Blob ? imageData.size : null),
      updatedAt: Date.now(),
      metadata
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction([DB_CONFIG.STORES.PROFILE_IMAGES], 'readwrite');
      const store = tx.objectStore(DB_CONFIG.STORES.PROFILE_IMAGES);
      const request = store.put(record);

      request.onsuccess = () => {
        log.debug(`Saved profile image for [${profileId}]`);
        resolve({ profileId, savedAt: record.updatedAt });
      };

      request.onerror = (event) => {
        log.error(`Failed to save image for [${profileId}]:`, event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Retrieves the stored image record for a specific profile ID.
   *
   * @param {string} profileId - Unique profile identifier
   * @returns {Promise<{ profileId: string, imageData: Blob|ArrayBuffer|string, mimeType: string, updatedAt: number, metadata: Object } | null>}
   */
  async getProfileImage(profileId) {
    if (!profileId || typeof profileId !== 'string') {
      throw new TypeError('A valid string profileId is required.');
    }

    const db = await this.getDatabase();

    return new Promise((resolve, reject) => {
      const tx = db.transaction([DB_CONFIG.STORES.PROFILE_IMAGES], 'readonly');
      const store = tx.objectStore(DB_CONFIG.STORES.PROFILE_IMAGES);
      const request = store.get(profileId);

      request.onsuccess = (event) => {
        const result = event.target.result || null;
        resolve(result);
      };

      request.onerror = (event) => {
        log.error(`Failed to retrieve image for [${profileId}]:`, event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Removes an image record associated with a profile ID.
   *
   * @param {string} profileId - Unique profile identifier
   * @returns {Promise<boolean>} True if removed successfully
   */
  async removeProfileImage(profileId) {
    if (!profileId || typeof profileId !== 'string') {
      throw new TypeError('A valid string profileId is required.');
    }

    const db = await this.getDatabase();

    return new Promise((resolve, reject) => {
      const tx = db.transaction([DB_CONFIG.STORES.PROFILE_IMAGES], 'readwrite');
      const store = tx.objectStore(DB_CONFIG.STORES.PROFILE_IMAGES);
      const request = store.delete(profileId);

      request.onsuccess = () => {
        log.debug(`Removed profile image for [${profileId}]`);
        resolve(true);
      };

      request.onerror = (event) => {
        log.error(`Failed to remove image for [${profileId}]:`, event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Lists all stored profile image IDs and their metadata (without loading full blobs).
   *
   * @returns {Promise<Array<{ profileId: string, mimeType: string, updatedAt: number, sizeBytes: number|null }>>}
   */
  async listProfileImages() {
    const db = await this.getDatabase();

    return new Promise((resolve, reject) => {
      const tx = db.transaction([DB_CONFIG.STORES.PROFILE_IMAGES], 'readonly');
      const store = tx.objectStore(DB_CONFIG.STORES.PROFILE_IMAGES);
      const request = store.getAll();

      request.onsuccess = (event) => {
        const records = event.target.result || [];
        // Map lightweight summary to avoid keeping heavy binary references in memory
        const summaries = records.map((r) => ({
          profileId: r.profileId,
          mimeType: r.mimeType,
          updatedAt: r.updatedAt,
          sizeBytes: r.sizeBytes
        }));
        resolve(summaries);
      };

      request.onerror = (event) => {
        log.error('Failed to list profile images:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Clears all stored profile images from the database.
   *
   * @returns {Promise<boolean>}
   */
  async clearAllProfileImages() {
    const db = await this.getDatabase();

    return new Promise((resolve, reject) => {
      const tx = db.transaction([DB_CONFIG.STORES.PROFILE_IMAGES], 'readwrite');
      const store = tx.objectStore(DB_CONFIG.STORES.PROFILE_IMAGES);
      const request = store.clear();

      request.onsuccess = () => {
        log.info('Cleared all profile images from storage.');
        resolve(true);
      };

      request.onerror = (event) => {
        log.error('Failed to clear profile images:', event.target.error);
        reject(event.target.error);
      };
    });
  }
}

// Export singleton instance as the standard storage service
export const imageStorage = new ImageStorageService();
export default imageStorage;
