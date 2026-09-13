/**
 * Profile Domain Model
 *
 * ARCHITECTURAL DESIGN (PHASE 2 - SELF-SCOPED PROFILE MODEL):
 * -----------------------------------------------------------
 * In Chromium/Brave, extensions operate inside isolated per-profile storage sandboxes.
 * Because there is no standard public API to query Brave's internal profile name or
 * folder path, our architecture uses the browser profile's native physical storage
 * boundary as the profile scope.
 *
 * Each Brave profile partition maintains its own `Profile` instance record:
 * - `instanceId`: A persistent, high-entropy unique identifier generated on first run
 *   inside that specific profile's storage sandbox (e.g. `bpi_prof_4f89a1...`).
 * - `name`: A user-customizable display label (e.g. "Personal", "Uni", "Work").
 * - `image`: Custom image Blob/data (to be populated in Phase 3).
 * - `metadata`: Timestamp and diagnostic attributes.
 */

/**
 * @typedef {Object} ProfileMetadata
 * @property {number} createdAt - Epoch timestamp of profile instance creation
 * @property {number} updatedAt - Epoch timestamp of last modification
 * @property {string} [storageEngine='IndexedDB'] - Active storage mechanism
 * @property {Object} [customPreferences={}] - Optional UI preferences
 */

/**
 * @typedef {Object} Profile
 * @property {string} instanceId - Persistent identifier scoped to this profile sandbox
 * @property {string} name - Friendly display name for this profile
 * @property {Blob|ArrayBuffer|string|null} image - Stored image data (Blob preferred)
 * @property {ProfileMetadata} metadata - Profile instance metadata
 */

/**
 * Generates a collision-resistant profile instance identifier.
 * Uses Web Crypto API when available for cryptographic randomness.
 *
 * @returns {string} Unique instance ID (e.g., 'bpi_prof_7f2b1a9c8d4e')
 */
export function generateProfileInstanceId() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `bpi_prof_${hex}`;
  }

  // Fallback if crypto is unavailable
  const rand = Math.random().toString(36).substring(2, 10);
  const time = Date.now().toString(36);
  return `bpi_prof_${time}_${rand}`;
}

/**
 * Creates a validated Profile instance.
 *
 * @param {Object} params
 * @param {string} [params.instanceId] - Existing instance ID, or auto-generated if omitted
 * @param {string} [params.name='Brave Profile'] - Display name
 * @param {Blob|ArrayBuffer|string|null} [params.image=null] - Image data
 * @param {Object} [params.metadata={}] - Additional metadata
 * @returns {Profile}
 */
export function createProfile({
  instanceId = null,
  name = 'Brave Profile',
  image = null,
  metadata = {}
} = {}) {
  const resolvedId = instanceId ? String(instanceId) : generateProfileInstanceId();
  const now = Date.now();

  return {
    instanceId: resolvedId,
    name: String(name || 'Brave Profile').trim(),
    image: image || null,
    metadata: {
      createdAt: metadata.createdAt || now,
      updatedAt: metadata.updatedAt || now,
      storageEngine: metadata.storageEngine || 'IndexedDB',
      ...metadata
    }
  };
}

/**
 * Validates a profile object structure.
 *
 * @param {any} obj
 * @returns {boolean}
 */
export function isValidProfile(obj) {
  return Boolean(
    obj &&
    typeof obj === 'object' &&
    typeof obj.instanceId === 'string' &&
    obj.instanceId.startsWith('bpi_prof_') &&
    typeof obj.name === 'string'
  );
}
