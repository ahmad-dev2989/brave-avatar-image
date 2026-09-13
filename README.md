# Brave Profile Images (Local-First Extension)

A lightweight, personal browser extension designed specifically for **Brave Browser** on Windows to associate custom avatar images with individual Brave profiles.

---

## 1. Project Overview

Brave Browser allows users to create multiple browser profiles (e.g., Personal, Work, Uni, Research). However, customizing the visual identity of each profile is limited to built-in presets.

This project creates a **local-first extension** that enables assigning a custom image to each Brave profile, stored entirely on your local machine.

### Important Constraints & Non-Goals:
- **No Native Avatar Modification:** We do not attempt to hack or overwrite Brave's internal C++ UI binary or native titlebar avatar.
- **No Source Code Patches:** Brave's source code is untouched; this runs purely as a standard Chromium extension.
- **Personal Use Only:** Not built for public Chrome Web Store distribution.
- **100% Local Storage:** Images remain on the user's computer—no cloud servers, telemetry, or external APIs.

---

## 2. Phase 2 & 3 Architecture: Profile Identification & Local Image Storage

### Profile Identification & Partition Isolation
In Chromium-based browsers like Brave:
- Standard WebExtensions **cannot directly read** internal profile directory names (`Default`, `Profile 1`) or Google account identities (`chrome.identity` is stripped in Brave for privacy).
- However, Chromium extensions are **physically isolated by design**. Each Brave browser profile maintains a completely independent storage partition on disk:
  - **Profile A (e.g., "Personal"):** `User Data\Profile 1\IndexedDB\chrome-extension_<id>_0.indexeddb.leveldb`
  - **Profile B (e.g., "Uni"):** `User Data\Profile 2\IndexedDB\chrome-extension_<id>_0.indexeddb.leveldb`
- The extension employs the **Self-Scoped Profile Instance Model**:
  1. Generates a persistent, collision-resistant **Profile Instance ID** (`bpi_prof_<hex>`) on first run in each profile partition.
  2. The user can customize a friendly name (*"Personal"*, *"Uni"*, *"Work"*).
  3. Custom avatar images are stored directly in the profile partition's private IndexedDB.

### Phase 3: Image Selection, Validation, and Storage

| Feature | Specification | Rationale |
| :--- | :--- | :--- |
| **Supported Formats** | PNG, JPEG/JPG, WEBP | Standard browser formats supported by all modern platforms. |
| **Max Upload File Size** | 5 MB (`IMAGE_CONFIG.MAX_FILE_SIZE_BYTES`) | Prevents excessive memory consumption while accommodating high-res camera photos. |
| **Validation** | Format check, size check, decodability probe | Rejects corrupted files, non-images, or files exceeding 5 MB with user-friendly alerts. |
| **Cropping Strategy** | Automatic center-crop to 1:1 square | Ensures square avatar display without distortion or stretching. |
| **Avatar Output Dimension** | Max 512 × 512 px (high-DPI) | Crisp rendering at all icon scales (16px, 32px, 48px, 128px, 256px) while keeping file size small (~20–80 KB). |
| **Storage Engine** | **IndexedDB** (`BraveProfileImagesDB`) | Direct binary `Blob` persistence avoids ~33% Base64 inflation and string serialization overhead of `chrome.storage.local`. |
| **Network & Privacy** | **100% Local-First** | Zero external network calls, zero servers, zero tracking, no cloud dependencies. |
| **Permissions Required** | `["storage"]` | No extra permissions required. Standard `<input type="file">` and `IndexedDB` operate locally in sandbox. |

---

## 3. Project Structure

```text
brave-profile-image/
│
├── manifest.json                 # Manifest V3 extension configuration (v0.3.0)
├── .gitignore                    # Local and editor ignore patterns
├── README.md                     # Project documentation & testing guide
│
├── assets/
│   └── icons/                    # Crisp extension icons (16x16, 48x48, 128x128)
│
├── src/
│   ├── background/
│   │   └── background.js         # Service worker handling installation lifecycle
│   │
│   ├── popup/
│   │   ├── popup.html            # Profile card, avatar preview, image controls, diagnostics
│   │   ├── popup.css             # Modern dark-mode aesthetic styling
│   │   └── popup.js              # Profile controller & image selection lifecycle
│   │
│   ├── storage/
│   │   └── image-storage.js      # Promise-based IndexedDB binary storage engine
│   │
│   ├── profiles/
│   │   ├── profile-model.js      # Profile domain entity and ID generator
│   │   └── profile-service.js    # Self-scoped profile manager and storage adapter
│   │
│   └── utils/
│       ├── constants.js          # Shared configuration and image limits (v0.3.0)
│       ├── diagnostics.js        # Environment and API probe collector
│       ├── image-processor.js    # Validation, decoding, center-cropping, and resizing
│       └── logger.js             # Formatted console logging helper
│
└── tests/
    ├── test-runner.html          # Interactive browser test runner page
    └── test-suite.js             # 12 automated unit and integration tests
```

---

## 4. Running the Automated Test Suite

To verify image validation, decoding, center-cropping, downscaling, IndexedDB binary persistence, and multi-profile isolation:

1. Open Brave Browser.
2. Open a new tab and navigate to:
   ```text
   file:///c:/Users/ahmad/Documents/brave profile image/tests/test-runner.html
   ```
3. The 12 automated test cases will execute and report live status. All 12 should display **PASS**:
   - `test-1`: Validation accepts PNG, JPEG, WEBP.
   - `test-2`: Validation rejects invalid MIME types (text, pdf, exe).
   - `test-3`: Validation rejects images > 5 MB.
   - `test-4`: Decoding detects and rejects corrupted/fake image data.
   - `test-5`: Image processor center-crops rectangular images to 1:1 square.
   - `test-6`: Downscaling large images to target max 512×512.
   - `test-7`: IndexedDB saves and retrieves binary Blobs without Base64 overhead.
   - `test-8`: `hasProfileImage()` accurately reports record existence.
   - `test-9`: Image replacement cleanly overwrites previous record.
   - `test-10`: Image removal cleanly deletes record from IndexedDB.
   - `test-11`: Multi-profile isolation simulation prevents data leakage.
   - `test-12`: Object URL creation and revocation safety.

---

## 5. How to Load and Test Across Multiple Brave Profiles

### Loading in Profile A (e.g., "Personal"):
1. Open Brave in your first profile.
2. Navigate to `brave://extensions`.
3. Enable **Developer mode** (toggle in top right).
4. Click **Load unpacked** and select:
   ```text
   C:\Users\ahmad\Documents\brave profile image
   ```
5. Click the extension icon in the Brave toolbar.
6. Note the **Profile Instance ID** (e.g., `bpi_prof_1a2b...`).
7. Click the pencil icon (✎) next to the name, enter a nickname (e.g. *"Personal Profile"*), and click **Save**.
8. Click **📷 Add Image** (or click the avatar circle).
9. Select an image (`imageA.png`) from your computer.
10. Notice the **New Avatar Preview** card showing the 1:1 square preview and file metadata.
11. Click **Save Avatar**:
    - The avatar circle immediately updates to show `imageA`.
    - Buttons switch to **Change Image** and **Remove**.

### Loading in Profile B (e.g., "Uni" or "Work"):
1. Switch to a second Brave profile via Brave's profile avatar icon in the window frame.
2. Navigate to `brave://extensions`.
3. Enable **Developer mode** and click **Load unpacked** (select the same folder).
4. Open the extension popup in this second profile:
   - Notice the **Profile Instance ID is completely different** from Profile A!
   - Notice the name is at its default *"Brave Profile"*.
   - Notice the avatar shows the default initials fallback—**`imageA` is NOT present**!
5. Click **📷 Add Image** and select a different image (`imageB.png`).
6. Click **Save Avatar**.
   - Profile B now shows `imageB`.

### Multi-Profile Independence & Persistence Verification:
1. **Switch back to Profile A**:
   - Open the extension popup: **`imageA` is still active and unchanged**!
   - `imageB` did not contaminate Profile A.
2. **Close Brave completely** (close all windows and processes).
3. **Reopen Brave**:
   - Profile A retains `imageA` and its custom name.
   - Profile B retains `imageB` and its custom name.
4. **Image Replacement**:
   - In Profile A, click **Change Image**, select a new image (`imageA2.png`), and click **Save Avatar**.
   - Verify `imageA2` replaced `imageA` smoothly.
5. **Image Removal**:
   - In Profile A, click **Remove**.
   - The avatar returns to the initials circle and the button returns to **Add Image**.
   - Switch to Profile B: Profile B's avatar remains intact.
