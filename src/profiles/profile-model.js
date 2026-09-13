/**
 * Profile Domain Model & Abstraction
 *
 * CRITICAL ARCHITECTURAL CONTEXT & PHASE 2 BOUNDARY:
 * ----------------------------------------------------
 * In Chromium-based browsers (including Brave):
 * 1. Each browser profile runs in its own isolated storage environment. An extension
 *    installed in "Profile 1" does not share extension storage with "Profile 2".
 * 2. Chromium does NOT expose a standard WebExtension API such as
 *    `chrome.profiles.getCurrentProfileId()`.
 * 3. The `chrome.identity` API is tied to Google Account authentication, which Brave
 *    deliberately disables and strips out for user privacy.
 *
 * DO NOT ATTEMPT IN PHASE 1:
 * - Do not invent random UUIDs and pretend they represent Brave profiles.
 * - Do not assume `chrome.identity` can provide profile information.
 * - Do not guess or fake profile IDs.
 *
 * In Phase 2, we will systematically investigate:
 * - Whether profile directory names (e.g. "Default", "Profile 1") can be identified
 *   via native messaging, extension filesystem introspection, or local user configuration.
 * - How to handle multi-profile extension instances or centralized mapping.
 *
 * This module establishes the domain model and interface contracts for future phases.
 */

/**
 * @typedef {Object} ProfileMetadata
 * @property {number} [createdAt] - Epoch timestamp when the profile record was created
 * @property {number} [updatedAt] - Epoch timestamp when the profile was last modified
 * @property {string} [notes] - Optional user notes
 * @property {Object} [displayOptions] - Future UI presentation preferences
 */

/**
 * @typedef {Object} Profile
 * @property {string|null} id - Unique identifier (to be resolved in Phase 2; null until discovered)
 * @property {string} name - User-facing profile name
 * @property {Blob|ArrayBuffer|string|null} image - Local custom image data (Blob preferred)
 * @property {ProfileMetadata} metadata - Additional profile metadata
 */

/**
 * Creates a validated Profile domain object.
 *
 * @param {Object} params
 * @param {string|null} [params.id=null] - The profile identifier (null until Phase 2 discovery)
 * @param {string} [params.name='Unnamed Profile'] - Display name
 * @param {Blob|ArrayBuffer|string|null} [params.image=null] - Image data
 * @param {ProfileMetadata} [params.metadata={}] - Optional metadata
 * @returns {Profile}
 */
export function createProfile({
  id = null,
  name = 'Unnamed Profile',
  image = null,
  metadata = {}
} = {}) {
  return {
    id: id !== null ? String(id) : null,
    name: String(name || 'Unnamed Profile'),
    image: image || null,
    metadata: {
      createdAt: metadata.createdAt || Date.now(),
      updatedAt: metadata.updatedAt || Date.now(),
      ...metadata
    }
  };
}

/**
 * Profile Service Contract / Interface
 *
 * Outlines the high-level profile operations that subsequent phases will implement
 * once profile detection mechanisms are investigated and finalized in Phase 2.
 */
export class ProfileService {
  /**
   * Identifies the current Brave profile context.
   *
   * @abstract
   * @throws {Error} Throws until Phase 2 implements a verified profile resolution strategy.
   * @returns {Promise<string>}
   */
  async getCurrentProfileId() {
    throw new Error(
      'ProfileService.getCurrentProfileId() is not implemented in Phase 1. ' +
      'Brave profile identification requires dedicated investigation in Phase 2.'
    );
  }

  /**
   * Retrieves profile details for a given ID.
   *
   * @abstract
   * @param {string} profileId
   * @returns {Promise<Profile|null>}
   */
  async getProfile(profileId) {
    throw new Error(
      `ProfileService.getProfile(${profileId}) is not implemented in Phase 1.`
    );
  }
}
