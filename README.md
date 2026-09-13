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

## 2. Phase 4 Architecture: Custom Profile UI

### 2.1 Profile Identification & Partition Isolation
In Chromium-based browsers like Brave:
- Standard WebExtensions **cannot directly read** internal profile directory names (`Default`, `Profile 1`) or Google account identities (`chrome.identity` is stripped in Brave for privacy).
- Chromium extensions are **physically isolated by design**. Each Brave browser profile maintains a completely independent storage partition on disk:
  - **Profile A (e.g., "Personal"):** `User Data\Default\IndexedDB\chrome-extension_<id>_0.indexeddb.leveldb`
  - **Profile B (e.g., "Uni"):** `User Data\Profile 1\IndexedDB\chrome-extension_<id>_0.indexeddb.leveldb`
- The extension employs the **Self-Scoped Profile Instance Model**:
  1. Generates a persistent, collision-resistant **Profile Instance ID** (`bpi_prof_<hex>`) on first run in each profile partition.
  2. The user can customize a friendly name (*"Personal"*, *"Uni"*, *"Work"*) directly in the popup.
  3. Custom avatar images are stored directly in the profile partition's private IndexedDB.
  4. Internal profile instance IDs are kept in the developer diagnostics drawer and hidden from the main user-facing profile card.

### 2.2 UI State Machine & Components

The Phase 4 popup is structured around a resilient state machine:

| UI State | Avatar Display | Status Indicator | Available Actions |
| :--- | :--- | :--- | :--- |
| **Loading** | Animated skeleton pulse | Hidden | All actions disabled during loading |
| **Empty** | Stylized SVG profile silhouette | `No custom avatar` (neutral pill) | `[ 📷 Add Image ]` |
| **Active** | Circular custom avatar (80px, `object-fit: cover`) | `Custom avatar active` (green pulse) | `[ 🔄 Change Image ]`, `[ 🗑 Remove ]` |
| **Preview** | 1:1 cropped square preview with file metadata | Preserved | `[ Save Avatar ]`, `[ Cancel ]` |
| **Remove Confirm** | Preserved | Preserved | `[ Cancel ]`, `[ Remove ]` (destructive confirmation) |
| **Error Recovery** | Preserved or graceful fallback to Empty | Error banner with `[ Retry ]` | Interactive retry button |

### 2.3 Image Specifications & Storage Rules

| Feature | Specification | Rationale |
| :--- | :--- | :--- |
| **Supported Formats** | PNG, JPEG/JPG, WEBP | Standard browser image formats supported universally. |
| **Max Upload File Size** | 5 MB (`IMAGE_CONFIG.MAX_FILE_SIZE_BYTES`) | Enforces sensible disk limits while allowing high-resolution photos. |
| **Cropping Strategy** | Automatic center-crop to 1:1 square | Avoids image stretching or distortion for circular avatar frames. |
| **Avatar Output Dimension** | Max 512 × 512 px (high-DPI) | Crisp rendering across all scales (16px to 256px) with small file size (~20–80 KB). |
| **Storage Engine** | **IndexedDB** (`BraveProfileImagesDB`) | Native binary `Blob` persistence eliminates ~33% Base64 expansion and JSON overhead. |
| **Permissions Required** | `["storage"]` | Standard `<input type="file">` and `IndexedDB` run client-side without elevated permissions. |

---

## 3. Project Structure

```text
brave-profile-image/
│
├── manifest.json                 # Manifest V3 extension configuration (v0.4.0)
├── .gitignore                    # Local and editor ignore patterns
├── README.md                     # Project documentation & multi-profile testing guide
│
├── assets/
│   └── icons/                    # Crisp extension icons (16x16, 48x48, 128x128)
│
├── src/
│   ├── background/
│   │   └── background.js         # Service worker handling installation lifecycle
│   │
│   ├── popup/
│   │   ├── popup.html            # Redesigned profile avatar manager UI (Phase 4)
│   │   ├── popup.css             # Modern dark-mode aesthetic styling & focus rings
│   │   └── popup.js              # State machine controller, preview, confirmation, lifecycle
│   │
│   ├── storage/
│   │   └── image-storage.js      # Promise-based IndexedDB binary storage engine
│   │
│   ├── profiles/
│   │   ├── profile-model.js      # Profile domain entity and ID generator
│   │   └── profile-service.js    # Self-scoped profile manager and storage adapter
│   │
│   └── utils/
│       ├── constants.js          # Shared configuration and image limits (v0.4.0)
│       ├── diagnostics.js        # Environment and API probe collector
│       ├── image-processor.js    # Validation, decoding, center-cropping, and resizing
│       └── logger.js             # Formatted console logging helper
│
└── tests/
    ├── test-runner.html          # Interactive browser test runner page (Phase 4)
    └── test-suite.js             # 16 automated unit and integration tests
```

---

## 4. Running the Automated Test Suite

To verify image validation, decoding, center-cropping, downscaling, IndexedDB binary persistence, state machine resilience, and multi-profile isolation:

1. Open Brave Browser.
2. Open a new tab and navigate to:
   ```text
   file:///c:/Users/ahmad/Documents/brave profile image/tests/test-runner.html
   ```
3. All 16 automated test cases will execute and report live status. All 16 should display **PASS**:
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
   - `test-13`: Empty state correctly reported when profile has no custom avatar.
   - `test-14`: Removing image from an empty profile succeeds gracefully without throwing.
   - `test-15`: Corrupt/non-Blob storage entries are handled without crashing.
   - `test-16`: Profile display name updates and avatar storage remain fully independent.

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
5. Click the extension icon in the Brave toolbar:
   - Notice the clean, modern interface: Profile name, default avatar placeholder, and **No custom avatar** status pill.
   - Notice no technical identifiers (`bpi_prof_...`) are visible on the main card.
6. Click the pencil icon (✎) next to the profile name, enter *"Personal"*, and click **Save**.
7. Click **📷 Add Image** (or click the avatar circle).
8. Select an image (`imageA.png`) from your computer.
9. Notice the **New Avatar Preview** card showing the 1:1 square preview and file metadata.
10. Click **Save Avatar**:
    - The avatar circle immediately renders `imageA` with a circular frame and subtle glow.
    - Status pill updates to **Custom avatar active** with a glowing green dot.
    - Actions switch to **🔄 Change Image** and **🗑 Remove**.

### Loading in Profile B (e.g., "Uni" or "Work"):
1. Switch to a second Brave profile via Brave's profile avatar icon in the window frame.
2. Navigate to `brave://extensions`.
3. Enable **Developer mode** and click **Load unpacked** (select the same folder).
4. Open the extension popup in this second profile:
   - Notice the profile name is at its default *"Brave Profile"*.
   - Notice the avatar shows the default placeholder and **No custom avatar**—**`imageA` is NOT present**!
5. Click **📷 Add Image** and select a different image (`imageB.png`).
6. Click **Save Avatar**:
   - Profile B now shows `imageB` with **Custom avatar active**.

### Multi-Profile Independence & Verification:
1. **Switch back to Profile A**:
   - Open the extension popup: **`imageA` is still active and unchanged**!
   - `imageB` did not contaminate Profile A.
2. **Close Brave completely** (close all windows and processes).
3. **Reopen Brave**:
   - Profile A retains `imageA` and its custom name.
   - Profile B retains `imageB` and its custom name.
4. **Change Image**:
   - In Profile A, click **Change Image**, pick a new image (`imageA2.png`), and click **Save Avatar**.
   - Verify `imageA2` replaced `imageA` smoothly.
5. **Remove Confirmation**:
   - In Profile A, click **Remove**.
   - An inline prompt appears: *"Remove this custom avatar? [Cancel] [Remove]"*.
   - Click **Cancel**: The prompt closes and the avatar remains intact.
   - Click **Remove** again, then click **Remove**:
     - The avatar is deleted from IndexedDB.
     - The UI smoothly transitions back to the Empty State (placeholder avatar, "No custom avatar" status, and "Add Image" button).
   - Switch to Profile B: Profile B's avatar remains active and intact.
