/**
 * Application Constants
 *
 * Centralizes configuration keys, database definitions, and default values
 * used across background, popup, storage, and profile modules.
 */

export const EXTENSION_CONFIG = {
  NAME: 'Brave Profile Images',
  VERSION: '0.1.0',
  PHASE: 'Phase 1 - Architecture & Setup'
};

export const DB_CONFIG = {
  NAME: 'BraveProfileImagesDB',
  VERSION: 1,
  STORES: {
    // Primary object store for profile images and associated binary blobs
    PROFILE_IMAGES: 'profile_images',
    // Reserved store for lightweight profile metadata (Phase 2+)
    PROFILE_METADATA: 'profile_metadata'
  }
};

export const STORAGE_KEYS = {
  ACTIVE_PROFILE_ID: 'active_profile_id',
  EXTENSION_INITIALIZED: 'extension_initialized_at'
};
