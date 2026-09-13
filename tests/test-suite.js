/**
 * Automated Test Suite for Phase 3 — Image Selection & Local Storage
 *
 * Tests:
 * 1. Image file validation (accepts PNG, JPEG, WEBP)
 * 2. Image file validation (rejects invalid MIME types)
 * 3. Image file validation (rejects oversized files > 5 MB)
 * 4. Image decoding & corruption detection
 * 5. Center-crop and square avatar aspect ratio preservation
 * 6. High-DPI downscaling to max 512x512
 * 7. IndexedDB binary Blob persistence (save & retrieve)
 * 8. Existence checking via hasProfileImage()
 * 9. Image replacement without duplicate records
 * 10. Image removal and clean database cleanup
 * 11. Multi-profile isolation simulation (Profile A vs Profile B)
 * 12. Object URL creation and revocation safety
 */

import { IMAGE_CONFIG } from '../src/utils/constants.js';
import {
  validateImageFile,
  decodeAndValidateImage,
  processAvatarImage,
  createObjectUrl,
  revokeObjectUrl,
  formatBytes
} from '../src/utils/image-processor.js';
import { imageStorage } from '../src/storage/image-storage.js';

// Helper: Generates a test image Blob using OffscreenCanvas or HTMLCanvasElement
async function createTestImageBlob(width, height, color = '#fb542b', mimeType = 'image/png') {
  let canvas;
  let ctx;

  if (typeof OffscreenCanvas === 'function') {
    canvas = new OffscreenCanvas(width, height);
    ctx = canvas.getContext('2d');
  } else {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext('2d');
  }

  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);

  // Add some distinct details
  ctx.fillStyle = '#ffffff';
  ctx.font = '20px sans-serif';
  ctx.fillText('TEST', 10, 30);

  if (canvas.convertToBlob) {
    return canvas.convertToBlob({ type: mimeType });
  }

  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), mimeType);
  });
}

// Helper: Generates a mock File object
function createMockFile(blob, name) {
  return new File([blob], name, { type: blob.type });
}

export const tests = [
  {
    id: 'test-1-validation-valid-formats',
    name: 'Validation accepts PNG, JPEG, and WEBP formats',
    async run() {
      const pngFile = new File(['dummy content'], 'avatar.png', { type: 'image/png' });
      const jpgFile = new File(['dummy content'], 'avatar.jpg', { type: 'image/jpeg' });
      const webpFile = new File(['dummy content'], 'avatar.webp', { type: 'image/webp' });

      const resPng = validateImageFile(pngFile);
      const resJpg = validateImageFile(jpgFile);
      const resWebp = validateImageFile(webpFile);

      if (!resPng.valid) throw new Error(`PNG rejected: ${resPng.error}`);
      if (!resJpg.valid) throw new Error(`JPEG rejected: ${resJpg.error}`);
      if (!resWebp.valid) throw new Error(`WEBP rejected: ${resWebp.error}`);

      return 'PNG, JPEG, and WEBP MIME types validated successfully.';
    }
  },

  {
    id: 'test-2-validation-rejects-invalid-type',
    name: 'Validation rejects invalid MIME types (text, pdf, executable)',
    async run() {
      const textFile = new File(['hello world'], 'notes.txt', { type: 'text/plain' });
      const pdfFile = new File(['pdf data'], 'doc.pdf', { type: 'application/pdf' });
      const exeFile = new File(['binary'], 'run.exe', { type: 'application/x-msdownload' });

      const resText = validateImageFile(textFile);
      const resPdf = validateImageFile(pdfFile);
      const resExe = validateImageFile(exeFile);

      if (resText.valid) throw new Error('Expected text/plain to be rejected.');
      if (resPdf.valid) throw new Error('Expected application/pdf to be rejected.');
      if (resExe.valid) throw new Error('Expected application/x-msdownload to be rejected.');

      return `Rejected unsupported formats with message: "${resText.error}"`;
    }
  },

  {
    id: 'test-3-validation-rejects-oversized',
    name: 'Validation rejects images larger than 5 MB',
    async run() {
      // 5 MB + 1 byte
      const oversizedSize = IMAGE_CONFIG.MAX_FILE_SIZE_BYTES + 1024;
      const oversizedBlob = new Blob([new Uint8Array(oversizedSize)], { type: 'image/png' });
      const oversizedFile = new File([oversizedBlob], 'huge.png', { type: 'image/png' });

      const result = validateImageFile(oversizedFile);
      if (result.valid) {
        throw new Error(`Expected oversized file (${formatBytes(oversizedSize)}) to be rejected.`);
      }

      return `Oversized file correctly rejected: "${result.error}"`;
    }
  },

  {
    id: 'test-4-corruption-detection',
    name: 'Decoding detects and rejects corrupted/fake image data',
    async run() {
      // Create a corrupted file disguised as image/png
      const fakeImage = new File(['not an actual image file at all'], 'corrupt.png', {
        type: 'image/png'
      });

      let caught = false;
      try {
        await decodeAndValidateImage(fakeImage);
      } catch (err) {
        caught = true;
      }

      if (!caught) {
        throw new Error('Decoder failed to reject corrupted/fake image.');
      }

      return 'Corrupted image file correctly triggered decoding failure.';
    }
  },

  {
    id: 'test-5-center-crop-aspect-ratio',
    name: 'Image processor center-crops rectangular images to 1:1 square',
    async run() {
      // Create a wide rectangular image (800 x 400, 2:1 aspect ratio)
      const rectBlob = await createTestImageBlob(800, 400, '#3b82f6', 'image/png');
      const rectFile = createMockFile(rectBlob, 'wide.png');

      const processed = await processAvatarImage(rectFile, { targetSize: 512 });

      if (processed.width !== processed.height) {
        throw new Error(`Processed avatar is not square: ${processed.width}x${processed.height}`);
      }

      if (processed.originalWidth !== 800 || processed.originalHeight !== 400) {
        throw new Error(`Original dimensions not recorded: ${processed.originalWidth}x${processed.originalHeight}`);
      }

      // Height was the smaller dimension (400), targetSize is 512, output should be min(512, 400) = 400
      if (processed.width !== 400) {
        throw new Error(`Expected output 400x400, got ${processed.width}x${processed.height}`);
      }

      return `Center-cropped 800x400 to ${processed.width}x${processed.height} square (${formatBytes(processed.sizeBytes)})`;
    }
  },

  {
    id: 'test-6-downscaling-target-dimensions',
    name: 'Image processor downscales large image to target max 512x512',
    async run() {
      // Create a huge square image (1200 x 1200)
      const largeBlob = await createTestImageBlob(1200, 1200, '#10b981', 'image/png');
      const largeFile = createMockFile(largeBlob, 'large.png');

      const processed = await processAvatarImage(largeFile, { targetSize: 512 });

      if (processed.width !== 512 || processed.height !== 512) {
        throw new Error(`Expected downscaled output 512x512, got ${processed.width}x${processed.height}`);
      }

      if (!(processed.blob instanceof Blob)) {
        throw new Error('Processed output is not a valid Blob.');
      }

      return `Downscaled 1200x1200 to crisp 512x512 square (${formatBytes(processed.sizeBytes)})`;
    }
  },

  {
    id: 'test-7-indexeddb-binary-persistence',
    name: 'IndexedDB saves and retrieves binary Blob without Base64 overhead',
    async run() {
      const testProfileId = 'test_prof_unit_' + Date.now();
      const testBlob = await createTestImageBlob(100, 100, '#e11d48', 'image/png');

      // Save to IndexedDB
      const saveRes = await imageStorage.saveProfileImage(testProfileId, testBlob, {
        width: 100,
        height: 100,
        originalName: 'avatar.png'
      });

      if (!saveRes || saveRes.profileId !== testProfileId) {
        throw new Error('Save operation did not return matching profile ID.');
      }

      // Retrieve from IndexedDB
      const record = await imageStorage.getProfileImage(testProfileId);
      if (!record) {
        throw new Error('Retrieved record is null.');
      }

      if (!(record.imageData instanceof Blob)) {
        throw new Error(`Expected Blob in storage, got ${typeof record.imageData}`);
      }

      if (record.imageData.size !== testBlob.size) {
        throw new Error(`Blob size mismatch: expected ${testBlob.size}, got ${record.imageData.size}`);
      }

      // Clean up test key
      await imageStorage.removeProfileImage(testProfileId);

      return `Binary Blob persisted and verified (${record.imageData.size} bytes, type: ${record.mimeType})`;
    }
  },

  {
    id: 'test-8-has-profile-image',
    name: 'hasProfileImage() accurately reports record existence',
    async run() {
      const testProfileId = 'test_prof_exists_' + Date.now();

      // Before saving: should be false
      const existsBefore = await imageStorage.hasProfileImage(testProfileId);
      if (existsBefore !== false) {
        throw new Error('hasProfileImage should be false before saving.');
      }

      // Save dummy blob
      const testBlob = await createTestImageBlob(50, 50, '#6366f1', 'image/png');
      await imageStorage.saveProfileImage(testProfileId, testBlob);

      // After saving: should be true
      const existsAfter = await imageStorage.hasProfileImage(testProfileId);
      if (existsAfter !== true) {
        throw new Error('hasProfileImage should be true after saving.');
      }

      // Clean up
      await imageStorage.removeProfileImage(testProfileId);

      // After removal: should be false
      const existsRemoved = await imageStorage.hasProfileImage(testProfileId);
      if (existsRemoved !== false) {
        throw new Error('hasProfileImage should be false after removal.');
      }

      return 'Existence checks accurate: false -> true -> false.';
    }
  },

  {
    id: 'test-9-image-replacement',
    name: 'Replacing an avatar overwrites the previous record cleanly',
    async run() {
      const testProfileId = 'test_prof_replace_' + Date.now();
      const blob1 = await createTestImageBlob(64, 64, '#ff0000', 'image/png');
      const blob2 = await createTestImageBlob(128, 128, '#00ff00', 'image/png');

      await imageStorage.saveProfileImage(testProfileId, blob1, { version: 1 });
      const rec1 = await imageStorage.getProfileImage(testProfileId);
      if (rec1.metadata.version !== 1) throw new Error('First save failed.');

      // Replace with second image
      await imageStorage.saveProfileImage(testProfileId, blob2, { version: 2 });
      const rec2 = await imageStorage.getProfileImage(testProfileId);

      if (rec2.metadata.version !== 2) throw new Error('Replacement save failed.');
      if (rec2.imageData.size !== blob2.size) throw new Error('Replaced blob size mismatch.');

      // Clean up
      await imageStorage.removeProfileImage(testProfileId);

      return 'Image replaced cleanly; verified updated version and byte size.';
    }
  },

  {
    id: 'test-10-image-removal',
    name: 'removeProfileImage() completely deletes data with no stale leftovers',
    async run() {
      const testProfileId = 'test_prof_del_' + Date.now();
      const blob = await createTestImageBlob(64, 64, '#a855f7', 'image/png');

      await imageStorage.saveProfileImage(testProfileId, blob);
      const removed = await imageStorage.removeProfileImage(testProfileId);

      if (!removed) throw new Error('removeProfileImage returned false.');

      const record = await imageStorage.getProfileImage(testProfileId);
      if (record !== null) throw new Error('Record still exists after removal.');

      return 'Record deleted completely; verified null on subsequent query.';
    }
  },

  {
    id: 'test-11-profile-isolation-simulation',
    name: 'Multi-profile isolation prevents cross-profile data leakage',
    async run() {
      const profileA = 'bpi_prof_sim_alpha_' + Date.now();
      const profileB = 'bpi_prof_sim_beta_' + Date.now();

      const blobA = await createTestImageBlob(100, 100, '#fb542b', 'image/png');
      const blobB = await createTestImageBlob(200, 200, '#7e57c2', 'image/png');

      // Save Image A for Profile A
      await imageStorage.saveProfileImage(profileA, blobA, { owner: 'Profile A' });

      // Check Profile B is still empty
      const checkB = await imageStorage.getProfileImage(profileB);
      if (checkB !== null) throw new Error('Profile B leaked data from Profile A.');

      // Save Image B for Profile B
      await imageStorage.saveProfileImage(profileB, blobB, { owner: 'Profile B' });

      // Verify Profile A still has Image A
      const verifyA = await imageStorage.getProfileImage(profileA);
      if (verifyA.metadata.owner !== 'Profile A' || verifyA.imageData.size !== blobA.size) {
        throw new Error('Profile A data was corrupted or altered.');
      }

      // Verify Profile B has Image B
      const verifyB = await imageStorage.getProfileImage(profileB);
      if (verifyB.metadata.owner !== 'Profile B' || verifyB.imageData.size !== blobB.size) {
        throw new Error('Profile B data was corrupted or altered.');
      }

      // Remove Profile A: Profile B must remain untouched
      await imageStorage.removeProfileImage(profileA);
      const verifyBAfterA = await imageStorage.getProfileImage(profileB);
      if (!verifyBAfterA) throw new Error('Profile B was deleted when Profile A was removed.');

      // Clean up Profile B
      await imageStorage.removeProfileImage(profileB);

      return 'Complete multi-profile isolation verified: 0% cross-contamination.';
    }
  },

  {
    id: 'test-12-object-url-memory-safety',
    name: 'Object URL creation and safe revocation prevent memory leaks',
    async run() {
      const blob = await createTestImageBlob(50, 50, '#10b981', 'image/png');
      const url = createObjectUrl(blob);

      if (!url || !url.startsWith('blob:')) {
        throw new Error(`Invalid Object URL generated: ${url}`);
      }

      // Revoke without error
      revokeObjectUrl(url);

      // Harmless to revoke null/invalid
      revokeObjectUrl(null);
      revokeObjectUrl('invalid');

      return `Object URL ${url.substring(0, 25)}... safely created and revoked.`;
    }
  }
];
