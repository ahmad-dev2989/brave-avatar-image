/**
 * Application Constants
 *
 * Centralizes configuration keys, database definitions, and default values
 * used across background, popup, storage, and profile modules.
 */

export const EXTENSION_CONFIG = {
  NAME: 'Brave Profile Images',
  VERSION: '0.4.0',
  PHASE: 'Phase 4 - Custom Profile UI'
};

export const DB_CONFIG = {
  NAME: 'BraveProfileImagesDB',
  VERSION: 1,
  STORES: {
    // Primary object store for profile images and associated binary blobs
    PROFILE_IMAGES: 'profile_images',
    // Reserved store for lightweight profile metadata
    PROFILE_METADATA: 'profile_metadata'
  }
};

export const STORAGE_KEYS = {
  PROFILE_INSTANCE_ID: 'bpi_profile_instance_id',
  PROFILE_DISPLAY_NAME: 'bpi_profile_display_name',
  PROFILE_CREATED_AT: 'bpi_profile_created_at',
  PROFILE_UPDATED_AT: 'bpi_profile_updated_at',
  EXTENSION_INITIALIZED: 'extension_initialized_at'
};

export const IMAGE_CONFIG = {
  // 5 Megabytes maximum input file size
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024,
  MAX_FILE_SIZE_MB: 5,
  SUPPORTED_MIME_TYPES: ['image/png', 'image/jpeg', 'image/webp'],
  SUPPORTED_EXTENSIONS: ['.png', '.jpg', '.jpeg', '.webp'],
  // Target dimensions for high-DPI square avatar (1:1 aspect ratio)
  AVATAR_TARGET_SIZE: 512,
  // Default storage format: lossless PNG preserves crisp edges & transparency
  OUTPUT_MIME_TYPE: 'image/png'
};
