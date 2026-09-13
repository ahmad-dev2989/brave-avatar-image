# Brave Profile Images (Local-First Extension v1.0.0)

A lightweight, personal browser extension designed specifically for **Brave Browser** on Windows to associate custom avatar images with individual Brave profiles.

---

## 1. Project Overview

Brave Browser allows users to create multiple browser profiles (e.g., Personal, Work, Uni, Research). However, customizing the visual identity of each profile is limited to built-in presets.

This project provides a **local-first extension** that enables assigning a custom image to each Brave profile, stored entirely on your local machine.

### Important Constraints & Non-Goals:
- **No Native Avatar Modification:** We do not attempt to hack or overwrite Brave's internal C++ UI binary or native titlebar avatar.
- **No Source Code Patches:** Brave's source code is untouched; this runs purely as a standard Chromium Manifest V3 extension.
- **Personal Use Only:** Not built for public Chrome Web Store distribution.
- **100% Local Storage:** Images remain on the user's computer—no cloud servers, telemetry, or external tracking.

---

## 2. Profile Identification & Storage Architecture

### 2.1 Profile Identification & Partition Isolation
In Chromium-based browsers like Brave:
- Standard WebExtensions **cannot directly read** internal profile directory names (`Default`, `Profile 1`) or Google account identities (`chrome.identity` profile lookup is intentionally restricted in Brave for privacy).
- Chromium extensions are **physically isolated by design**. Each Brave browser profile maintains a completely independent storage partition on disk:
  - **Profile A (e.g., "Personal"):** `User Data\Default\IndexedDB\chrome-extension_<id>_0.indexeddb.leveldb`
  - **Profile B (e.g., "Work"):** `User Data\Profile 1\IndexedDB\chrome-extension_<id>_0.indexeddb.leveldb`
- The extension employs the **Self-Scoped Profile Instance Model**:
  1. Generates a persistent, collision-resistant **Profile Instance ID** (`bpi_prof_<hex>`) on first run in each profile partition.
  2. The user can customize a friendly name (*"Personal"*, *"Work"*, *"Research"*) directly in the popup.
  3. Custom avatar images are stored directly in the profile partition's private IndexedDB.
  4. Internal profile instance IDs are kept in the developer diagnostics drawer and hidden from the main user-facing profile card.

### 2.2 Storage Model
- **IndexedDB Database:** `BraveProfileAvatarDB` (version 1)
- **Object Store:** `profile_images`
- **Key Path:** `profileId`
- **Stored Record Schema:**
  ```javascript
  {
    profileId: "bpi_prof_xxx",
    imageData: Blob,           // Raw binary Blob (PNG, 512x512 max)
    mimeType: "image/png",
    sizeBytes: 104280,
    updatedAt: 1718000000000,
    metadata: {
      source: "local" | "google", // Authoritative source
      fileName: "avatar.png",     // For local uploads
      email: "user@gmail.com",    // For Google imports
      importedAt: 1718000000000
    }
  }
  ```
- **Zero Base64 Encoding:** Binary Blobs are stored directly using the browser's structured clone algorithm, avoiding ~33% memory overhead and serialization latency.

---

## 3. Dual Avatar Workflows

### 3.1 Local Image Workflow
1. User clicks **Add Avatar** (or **Change Avatar**).
2. Selects **Upload from Computer**.
3. **Validation:** Checks MIME type (PNG, JPEG, WEBP) and file size (max 5 MB).
4. **Processing Pipeline (`image-processor.js`):**
   - Decodes image onto an in-memory canvas.
   - Performs a 1:1 center-crop (taking `min(width, height)`).
   - High-DPI downscaling to maximum 512×512 (never upscales smaller images).
   - Normalizes output format to `image/png` Blob.
5. **Persistence:** Saves the resulting Blob into IndexedDB under the profile's ID with `{ source: 'local' }`.
6. **Object URL Management:** Creates a temporary `blob:` URL for the `<img>` tag and automatically revokes previous URLs to prevent memory leaks.

### 3.2 Google Account Workflow
1. User clicks **Add Avatar** → **Use Google Account**.
2. Authenticates via official Google OAuth 2.0 flow using `chrome.identity.launchWebAuthFlow()`.
3. The user's Google profile photo URL is fetched via the OpenID UserInfo API (`https://www.googleapis.com/oauth2/v3/userinfo`).
4. The high-resolution photo is retrieved using the `=s512-c` parameter.
5. The downloaded image is passed through the **exact same normalization pipeline** (center-crop, 512×512 max, PNG conversion).
6. Persisted to IndexedDB with `{ source: 'google', email: '...' }`.
7. **Offline Autonomy:** Once saved, Google is never contacted again merely to display the avatar.
8. **Sign-Out Safety:** Disconnecting the Google session or experiencing a network failure never corrupts or deletes the stored avatar.

---

## 4. Google Cloud Configuration (2-Minute Setup)

To enable the optional Google account sign-in:
1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g. *"Brave Profile Images"*).
3. Go to **APIs & Services** → **OAuth consent screen**:
   - User Type: **External** (or Internal if using Google Workspace).
   - App Name: *"Brave Profile Images"*.
   - Scopes: Add `openid`, `profile`, `email`.
   - Test Users: Add your Google email address while in Testing mode.
4. Go to **Credentials** → **Create Credentials** → **OAuth client ID**:
   - Application Type: **Web application** (or **Chrome extension**).
   - Authorized redirect URIs:
     ```text
     https://<your-extension-id>.chromiumapp.org/
     ```
     *(Find your extension ID in `brave://extensions` with Developer mode enabled, or click "Profile & Diagnostics" in the extension popup).*
5. Copy the **Client ID** (e.g. `1234567890-abcdef.apps.googleusercontent.com`).
   *(Note: Zero Client Secrets required. OAuth client IDs are public identifiers; secrets must never be placed in a browser extension).*
6. Enter the Client ID in the extension UI under **Google Account Setup** or pre-configure it in [`src/utils/constants.js`](file:///c:/Users/ahmad/Documents/brave%20profile%20image/src/utils/constants.js).

---

## 5. Manifest Permissions & Security

### Manifest V3 Configuration (`manifest.json`):
- `"manifest_version": 3`
- `"version": "1.0.0"`
- **Strictly Minimized Permissions:**
  - `"storage"`: Used exclusively to persist the user's custom profile friendly name and optional Client ID in `chrome.storage.local`.
  - `"identity"`: Required for `chrome.identity.launchWebAuthFlow()` to open Google's OAuth consent screen without hardcoded redirects.
- **Host Permissions:**
  - `"https://www.googleapis.com/*"`: Strictly for querying the OpenID UserInfo API.
  - `"https://*.googleusercontent.com/*"`: Strictly for downloading the user's profile photo.
- **Security Assurances:**
  - Zero permissions for `<all_urls>`, `tabs`, `webRequest`, `cookies`, `scripting`, or background network intercepts.
  - Zero remote code: Compliant with Manifest V3 Content Security Policy.
  - Zero third-party runtime libraries or external scripts.

---

## 6. Privacy & Local-First Policy

- **No Remote Servers:** The extension has no backend server, API gateway, or cloud storage.
- **No Analytics or Telemetry:** No tracking pixels, Google Analytics, Sentry, or data collection scripts.
- **No Data Sharing:** Images and profile identifiers never leave your local computer.
- **Zero Token Persistence:** Google OAuth access tokens are held exclusively in volatile memory for the duration of the photo fetch and discarded immediately afterwards.

---

## 7. Project File Structure

```text
brave-profile-image/
│
├── manifest.json                 # Manifest V3 extension definition (v1.0.0)
├── .gitignore                    # Git ignore rules for node/OS artifacts
├── README.md                     # Comprehensive project documentation
│
├── assets/
│   └── icons/                    # Extension action icons (16x16, 48x48, 128x128)
│
├── src/
│   ├── background/
│   │   └── background.js         # Service worker handling installation lifecycle
│   │
│   ├── google/
│   │   ├── google-auth-service.js    # OAuth 2.0 launchWebAuthFlow controller & token manager
│   │   └── google-profile-service.js # Google Userinfo & high-res photo download pipeline
│   │
│   ├── popup/
│   │   ├── popup.html            # Refined semantic popup layout with accessible dialogs
│   │   ├── popup.css             # Production styling with dark/light themes & motion tokens
│   │   ├── popup.js              # State controller managing UI workflows
│   │   ├── modal.js              # Modal/sheet manager with Escape key accessibility
│   │   └── toast.js              # Accessible toast notifications with error recovery
│   │
│   ├── profiles/
│   │   ├── profile-model.js      # Profile domain entity and ID generator
│   │   └── profile-service.js    # Self-scoped profile manager and storage adapter
│   │
│   ├── storage/
│   │   └── image-storage.js      # Promise-based IndexedDB binary storage engine
│   │
│   └── utils/
│       ├── constants.js          # App constants, image limits, DB stores, Google config (v1.0.0)
│       ├── diagnostics.js        # Multi-profile diagnostics data collector
│       ├── image-processor.js    # Center crop, 512x512 downscale, PNG normalization
│       └── logger.js             # Formatted console logging helper
│
└── tests/
    ├── test-runner.html          # Interactive browser test runner page (50 Tests)
    └── test-suite.js             # 50 automated unit and integration tests
```

---

## 8. UI/UX & Design System

- **Compact Popup Layout:** Sized to 330px width for quick, non-disruptive access without clipping or horizontal scrolling.
- **Button System Hierarchy:**
  - `btn-primary`: Prominent accent action (`+ Add Avatar`, `Use This Image`).
  - `btn-secondary`: Subtle card surface for secondary actions (`Change Avatar`, `Cancel`).
  - `btn-danger`: Red-tinted alert action for destructive removal (`Remove Avatar`).
  - `btn-google`: Clean Google-branded sign-in button with crisp SVG logo.
- **Hero Avatar Showcase:** Large 80×80px circular frame with neutral silhouette placeholder in empty state and glowing border in active state.
- **Secondary Source Indicator:** Subtle tag indicates whether the avatar was *"Uploaded from computer"* or *"From Google Account (email@gmail.com)"*.
- **Accessible Modal Controller (`modal.js`):** Single-dialog enforcement and `Escape` key dismissal.
- **Actionable Toast System (`toast.js`):** Auto-dismissing status toasts with friendly error translation and retry action.
- **System-Aware Light & Dark Themes:** Uses CSS custom properties with `@media (prefers-color-scheme: light)` to match OS and Brave themes.
- **Reduced Motion Support:** `@media (prefers-reduced-motion: reduce)` removes nonessential animations for accessibility.

---

## 9. Automated Verification Suite (50 Tests)

The project includes an end-to-end browser test suite running in [`tests/test-runner.html`](file:///c:/Users/ahmad/Documents/brave%20profile%20image/tests/test-runner.html):

- **Tests 1–4:** File validation (PNG, JPEG, WEBP, oversized rejection, corruption detection).
- **Tests 5–6:** Center-crop square slice and 512×512 downscaling pipeline.
- **Tests 7–10:** IndexedDB binary persistence, existence checks, replacement, and clean deletion.
- **Test 11:** Multi-profile isolation simulation.
- **Test 12:** Object URL memory lifecycle safety.
- **Tests 13–16:** Empty state reporting, removal idempotency, corrupt fallback, display name independence.
- **Tests 17–20:** Google auth URL builder, OAuth redirect parsing, cancellation error handling.
- **Tests 21–22:** Google high-res photo URL transformation (`=s512-c`) and processing pipeline.
- **Tests 23–25:** Google metadata persistence, sign-out avatar retention, multi-profile isolation.
- **Tests 26–27:** ToastController auto-dismiss, error sanitization, and retry hooks.
- **Tests 28–29:** ModalManager single-dialog enforcement and Escape key dismissal.
- **Tests 30–34:** Button hierarchy, DOM states, source tags, dialog semantics, and media queries.
- **Tests 35–39:** Edge case boundary checks (0-byte file, exact 5MB boundary, extreme 2000x200 aspect ratios, 5 consecutive replacements, 0-byte Blob rejection).
- **Tests 40–44:** Modal cleanup hooks, async file selection race protection, offline persistence, sign-out idempotency, and record schema constraints.
- **Test 45:** Version consistency check across configuration and manifest (`v1.0.0`).
- **Test 46:** Manifest permission minimization verification (`storage`, `identity`, minimal hosts).
- **Test 47:** End-to-end local avatar lifecycle (upload -> process -> persist -> read -> revoke -> delete).
- **Test 48:** End-to-end Google import lifecycle (auth URL -> token parse -> photo save -> offline read -> sign-out safety).
- **Test 49:** 3-Profile concurrent isolation stress test (Profile A, B, C concurrent operations without cross-contamination).
- **Test 50:** Zero-secret security audit (confirms no client secrets, passwords, or persistent tokens exist).

---

## 10. How to Load and Test Across Multiple Brave Profiles

### Loading the Extension:
1. Open Brave Browser.
2. Navigate to `brave://extensions`.
3. Enable **Developer mode** (toggle in top-right corner).
4. Click **Load unpacked** and select the root directory:
   ```text
   C:\Users\ahmad\Documents\brave profile image
   ```
5. Click the extension icon in the toolbar to open the popup.

### Testing Profile Isolation:
1. In Profile A (e.g. *"Personal"*): Click **Add Avatar** and upload an image.
2. Switch to Profile B (e.g. *"Work"*) using Brave's profile icon in the window frame.
3. Open `brave://extensions` in Profile B and click **Load unpacked** (select the same folder).
4. Open the extension popup in Profile B: notice Profile B starts in the empty state—Profile A's avatar is completely absent.
5. Set a distinct avatar in Profile B. Both profiles maintain their independent avatars across browser restarts and offline sessions.

---

## 11. Known Limitations

1. **Native Brave Titlebar Avatar:** WebExtensions in Chromium cannot modify Brave's internal C++ UI components (native window titlebar avatar or profile picker). The custom avatar is managed and displayed within the extension UI.
2. **First-Launch Profile ID:** Because Brave deliberately hides internal filesystem folder names (`Default`, `Profile 1`) for fingerprinting protection, the extension generates a stable `bpi_prof_<hex>` identifier per profile partition on first launch.
3. **Google Sign-In Scope:** Requires a one-time Google Cloud OAuth Client ID configuration if using Google profile photo import.
