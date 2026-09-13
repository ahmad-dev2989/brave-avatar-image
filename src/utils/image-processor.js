/**
 * Image Processing & Validation Utility
 *
 * Responsibilities:
 * - Validates file types (PNG, JPEG/JPG, WEBP) and file sizes (max 5 MB).
 * - Verifies image decodability to detect corrupted or spoofed image files.
 * - Center-crops non-square images into a 1:1 square avatar preserving aspect ratio.
 * - Pre-processes and resizes avatars to high-DPI standard dimensions (max 512x512).
 * - Converts image to an optimized binary Blob ready for IndexedDB storage.
 * - Manages object URLs safely to avoid memory leaks in the extension context.
 */

import { IMAGE_CONFIG } from './constants.js';
import { createLogger } from './logger.js';

const log = createLogger('ImageProcessor');

/**
 * Formats byte size into human-readable string (e.g., "120 KB", "2.4 MB").
 *
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Validates basic image file constraints (presence, MIME type, file size).
 *
 * @param {File|Blob} file
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateImageFile(file) {
  if (!file) {
    return { valid: false, error: 'No file was selected.' };
  }

  // Normalize and check MIME type
  let mimeType = file.type ? file.type.toLowerCase() : '';

  // Fallback check by file extension if MIME type is missing or generic octet-stream
  if (!mimeType || mimeType === 'application/octet-stream') {
    const fileName = file.name ? file.name.toLowerCase() : '';
    if (fileName.endsWith('.png')) mimeType = 'image/png';
    else if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) mimeType = 'image/jpeg';
    else if (fileName.endsWith('.webp')) mimeType = 'image/webp';
  }

  if (!IMAGE_CONFIG.SUPPORTED_MIME_TYPES.includes(mimeType)) {
    return {
      valid: false,
      error: `Unsupported image format (${mimeType || 'unknown'}). Please choose a PNG, JPEG, or WEBP image.`
    };
  }

  // Check file size (max 5 MB)
  if (file.size > IMAGE_CONFIG.MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File is too large (${formatBytes(file.size)}). Maximum allowed file size is ${IMAGE_CONFIG.MAX_FILE_SIZE_MB} MB.`
    };
  }

  return { valid: true };
}

/**
 * Decodes a File or Blob to verify that it represents a valid, renderable image.
 *
 * @param {File|Blob} fileOrBlob
 * @returns {Promise<{ width: number, height: number, source: ImageBitmap|HTMLImageElement }>}
 */
export async function decodeAndValidateImage(fileOrBlob) {
  // 1. Try modern createImageBitmap API
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(fileOrBlob);
      if (bitmap.width > 0 && bitmap.height > 0) {
        return { width: bitmap.width, height: bitmap.height, source: bitmap };
      }
      bitmap.close();
      throw new Error('Image dimensions are zero.');
    } catch (err) {
      log.warn('createImageBitmap failed, falling back to HTMLImageElement:', err);
    }
  }

  // 2. Fallback using HTMLImageElement
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(fileOrBlob);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve({
          width: img.naturalWidth,
          height: img.naturalHeight,
          source: img
        });
      } else {
        reject(new Error('Image has invalid natural dimensions.'));
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to decode image data. The file may be corrupt or not a valid image.'));
    };

    img.src = objectUrl;
  });
}

/**
 * Processes an input image into a standardized, center-cropped square avatar.
 *
 * Steps:
 * 1. Validates file constraints.
 * 2. Decodes image bitmap and checks validity.
 * 3. Calculates center-crop coordinates to enforce a 1:1 aspect ratio.
 * 4. Downscales to target avatar dimensions (max 512x512) using high-quality smoothing.
 * 5. Exports a binary Blob (default PNG to preserve transparency and edge crispness).
 *
 * @param {File|Blob} fileOrBlob
 * @param {Object} [options={}]
 * @param {number} [options.targetSize=512] - Max square output dimension
 * @param {string} [options.outputMimeType='image/png'] - Output format
 * @returns {Promise<{
 *   blob: Blob,
 *   width: number,
 *   height: number,
 *   originalWidth: number,
 *   originalHeight: number,
 *   sizeBytes: number,
 *   mimeType: string,
 *   originalName: string
 * }>}
 */
export async function processAvatarImage(fileOrBlob, options = {}) {
  // Step 1: Basic validation
  const validation = validateImageFile(fileOrBlob);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Step 2: Decode verification
  const decoded = await decodeAndValidateImage(fileOrBlob);
  const { width: origWidth, height: origHeight, source } = decoded;

  // Step 3: Compute center-crop square
  const side = Math.min(origWidth, origHeight);
  const sx = Math.floor((origWidth - side) / 2);
  const sy = Math.floor((origHeight - side) / 2);

  // Step 4: Determine output resolution (cap at targetSize, avoid unnecessary upscaling)
  const maxTarget = options.targetSize || IMAGE_CONFIG.AVATAR_TARGET_SIZE;
  const outputSize = Math.min(maxTarget, side);
  const outMimeType = options.outputMimeType || IMAGE_CONFIG.OUTPUT_MIME_TYPE;

  // Step 5: Render on Canvas with high-quality smoothing
  let canvas;
  let ctx;

  if (typeof OffscreenCanvas === 'function') {
    canvas = new OffscreenCanvas(outputSize, outputSize);
    ctx = canvas.getContext('2d');
  } else {
    canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    ctx = canvas.getContext('2d');
  }

  if (!ctx) {
    if (source && typeof source.close === 'function') source.close();
    throw new Error('Could not create 2D graphics canvas context.');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Draw center-cropped square slice into the target canvas
  ctx.drawImage(source, sx, sy, side, side, 0, 0, outputSize, outputSize);

  // Free source bitmap if it was an ImageBitmap
  if (source && typeof source.close === 'function') {
    source.close();
  }

  // Step 6: Convert to binary Blob
  let blob;
  if (canvas.convertToBlob) {
    blob = await canvas.convertToBlob({ type: outMimeType });
  } else {
    blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error('Failed to generate image blob from canvas.'));
      }, outMimeType);
    });
  }

  log.info(
    `Processed avatar: ${origWidth}x${origHeight} -> ${outputSize}x${outputSize} (${formatBytes(blob.size)})`
  );

  return {
    blob,
    width: outputSize,
    height: outputSize,
    originalWidth: origWidth,
    originalHeight: origHeight,
    sizeBytes: blob.size,
    mimeType: blob.type,
    originalName: fileOrBlob.name || 'avatar.png'
  };
}

/**
 * Creates a temporary object URL for displaying a Blob.
 *
 * @param {Blob} blob
 * @returns {string} Object URL
 */
export function createObjectUrl(blob) {
  if (!blob) return '';
  return URL.createObjectURL(blob);
}

/**
 * Safely revokes an object URL to prevent memory leaks.
 *
 * @param {string} url
 */
export function revokeObjectUrl(url) {
  if (url && typeof url === 'string' && url.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignore cleanup error
    }
  }
}
