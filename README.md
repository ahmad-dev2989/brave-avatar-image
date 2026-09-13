# Brave Profile Images (Local-First Extension)

A lightweight, personal browser extension designed specifically for **Brave Browser** on Windows to associate custom images with individual Brave profiles.

---

## 1. Project Overview

Brave Browser allows users to create multiple browser profiles (e.g., Personal, Work, Research). However, customizing the visual identity of each profile is limited to built-in presets.

This project creates a **local-first extension** that enables assigning a custom image to each Brave profile, stored entirely on your local machine.

### Important Constraints & Non-Goals:
- **No Native Avatar Modification:** We do not attempt to hack or overwrite Brave's internal C++ UI binary or native titlebar avatar.
- **No Source Code Patches:** Brave's source code is untouched; this runs purely as a standard Chromium extension.
- **Personal Use Only:** Not built for public Chrome Web Store distribution.
- **100% Local Storage:** Images remain on the user's computer—no cloud servers, telemetry, or external APIs.

---

## 2. Phase 1 Scope: Architecture & Setup

Phase 1 establishes the **technical foundation**:
- Modern **Manifest V3** extension setup.
- Clean, modular **vanilla JavaScript (ES Modules)** architecture with zero dependencies and no build steps.
- **IndexedDB-backed image storage layer** designed for binary data persistence across restarts.
- Domain models and abstraction interfaces for profile records.
- Minimal, modern popup UI to verify initialization.

---

## 3. How to Load the Extension in Brave

Because this is a personal extension, you load it directly from disk using Brave's developer mode:

1. Open **Brave Browser**.
2. Navigate to:
   ```text
   brave://extensions
   ```
   *(or click the 3 horizontal lines menu $\rightarrow$ **Extensions**)*.
3. In the top-right corner of the Extensions page, toggle **Developer mode** to **ON**.
4. In the top-left corner, click **Load unpacked**.
5. Browse to and select this project directory:
   ```text
   C:\Users\ahmad\Documents\brave profile image
   ```
6. Click **Select Folder**.
7. The **Brave Profile Images** extension will now appear in your extensions list.
8. Click the Extensions puzzle piece icon in the Brave toolbar and pin **Brave Profile Images** to inspect the popup.

---

## 4. Project Structure

```text
brave-profile-image/
│
├── manifest.json                 # Manifest V3 extension configuration
├── .gitignore                    # Local and editor ignore patterns
├── README.md                     # Project documentation and manual loading guide
│
├── assets/
│   └── icons/                    # Crisp extension icons
│       ├── icon-16.png           # 16x16 toolbar icon
│       ├── icon-48.png           # 48x48 extensions management icon
│       └── icon-128.png          # 128x128 high-DPI icon
│
└── src/
    ├── background/
    │   └── background.js         # Service worker handling installation lifecycle
    │
    ├── popup/
    │   ├── popup.html            # Minimal initialization UI
    │   ├── popup.css             # Modern dark-mode aesthetic styling
    │   └── popup.js              # Popup logic and storage health verification
    │
    ├── storage/
    │   └── image-storage.js      # Promise-based IndexedDB storage engine
    │
    ├── profiles/
    │   └── profile-model.js      # Profile domain model and abstraction contracts
    │
    └── utils/
        ├── constants.js          # Shared configuration and store keys
        └── logger.js             # Formatted console logging helper
```

---

## 5. Storage Architecture Decision

### Comparison: `chrome.storage.local` vs. `IndexedDB`

| Property | `chrome.storage.local` | `IndexedDB` (Selected) |
| :--- | :--- | :--- |
| **Data Storage Format** | JSON-serialized strings | Structured clone (native `Blob`, `ArrayBuffer`, `File`) |
| **Image Overhead** | Requires Base64 encoding (+33% size inflation, high memory/CPU usage) | Stores binary blobs directly with zero serialization inflation |
| **Storage Quota** | 10 MB total (`QUOTA_BYTES`) unless requesting `"unlimitedStorage"` | Hundreds of megabytes to gigabytes based on local disk availability |
| **Permissions Required** | Requires `"storage"` in `manifest.json` | Web standard; requires **no manifest permissions** |
| **MV3 Service Worker** | Supported natively | Supported natively |

### Storage Decision Rationale
For storing user-selected profile images, **IndexedDB** is chosen as the primary image database.
- Images are stored directly as binary `Blob` objects, preserving full resolution and eliminating Base64 encode/decode latency.
- The `src/storage/image-storage.js` module provides a clean Promise API:
  - `saveProfileImage(profileId, imageData, metadata)`
  - `getProfileImage(profileId)`
  - `removeProfileImage(profileId)`
  - `listProfileImages()`
  - `clearAllProfileImages()`
- `chrome.storage.local` is reserved solely for lightweight metadata or preference flags if needed.

---

## 6. What Is Intentionally NOT Implemented in Phase 1

To maintain strict architectural boundaries, the following features are **deferred**:
- ❌ Image file pickers, drag-and-drop file uploaders, or image cropping.
- ❌ Automatic Brave profile detection or reading Brave profile directories.
- ❌ Generating fake or temporary profile IDs.
- ❌ Modifying Brave's native UI or inserting custom avatar overlays into pages.
- ❌ Profile card management UI.

---

## 7. What Phase 2 Will Investigate

Phase 2 focuses on **Profile Association and Identification**:
1. **Profile Isolation in Brave:**
   - In Chromium, each browser profile has its own separate extension storage sandbox. We will investigate how extensions installed across multiple profiles interact or whether each profile manages its own image locally.
2. **Profile Identifier Discovery:**
   - Chromium does not expose a `chrome.profiles.getCurrentProfileId()` API.
   - `chrome.identity` is stripped in Brave.
   - Phase 2 will evaluate strategies:
     - Profile-scoped storage (where the extension in Profile A only ever needs to store Profile A's image).
     - Local profile naming/labeling by the user.
     - Filesystem inspection or lightweight native messaging if global awareness is required.
3. **Avatar Presentation Mechanics:**
   - Determining where and how the user's custom avatar should be displayed (e.g. extension badge, new tab page overlay, custom dashboard, or floating indicator).
