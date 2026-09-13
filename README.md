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

## 2. Phase 5 Architecture: Multi-Source Avatars & Local Storage

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

### 2.2 Supported Avatar Sources

The extension supports two distinct ways to assign an avatar:
1. **Choose from Computer**: Upload a local PNG, JPEG, or WEBP image.
2. **Use Google Account**: Import your Google profile picture via official OAuth 2.0 and OpenID UserInfo API.

Both sources pass through the same client-side processing pipeline and are stored as local binary Blobs in IndexedDB.

---

## 3. Google Account Integration

### 3.1 What the Feature Does
Allows the user to authenticate with their Google Account, select an account if multiple are active, and import their Google profile photo as the avatar for the active Brave profile. The photo is downloaded, center-cropped into an exact 1:1 square, resized up to 512×512, and stored completely offline in the profile's local IndexedDB.

### 3.2 Required Google Cloud Configuration (2-Minute Setup)
To enable Google account sign-in for your local extension:
1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g. *"Brave Profile Images"*).
3. Go to **APIs & Services** → **OAuth consent screen**:
   - User Type: **External** (or Internal if using Google Workspace).
   - App Name: *"Brave Profile Images"*.
   - User Support Email: your email.
   - Developer Contact Info: your email.
   - Scopes: Add `.../auth/userinfo.profile`, `.../auth/userinfo.email`, `openid`.
   - Test Users: Add your Google email address while in Testing mode.
4. Go to **Credentials** → **Create Credentials** → **OAuth client ID**:
   - Application Type: **Web application** (or **Chrome extension**).
   - Authorized redirect URIs:
     Add your extension's redirect URI:
     ```text
     https://<your-extension-id>.chromiumapp.org/
     ```
     *(You can find your extension ID in `brave://extensions` with Developer mode enabled, or click "Profile & Diagnostics" in the extension popup).*
5. Copy the **Client ID** (e.g. `1234567890-abcdef.apps.googleusercontent.com`).
   *(Note: You do NOT need the Client Secret. Client secrets must NEVER be put in an extension).*

### 3.3 Required API(s)
- **Google People API** or **OpenID Connect UserInfo API** (`https://www.googleapis.com/oauth2/v3/userinfo`).

### 3.4 Required OAuth Scopes
- `openid`: OpenID Connect identifier.
- `profile`: Access to user's name and high-resolution profile photo URL.
- `email`: Basic email address display for account verification.
*(Zero access to Gmail, Google Drive, Calendar, Contacts, or user files is requested).*

### 3.5 Permissions in `manifest.json`
- `"identity"`: Required for `chrome.identity.launchWebAuthFlow()`.
- `"host_permissions"`:
  - `"https://www.googleapis.com/*"` (Userinfo API)
  - `"https://*.googleusercontent.com/*"` (Profile photo downloading)

### 3.6 Where the Client ID Goes
You can configure your Client ID in either of two places:
1. **In the Code**: Open [`src/utils/constants.js`](file:///c:/Users/ahmad/Documents/brave%20profile%20image/src/utils/constants.js) and set `GOOGLE_CONFIG.CLIENT_ID`:
   ```javascript
   export const GOOGLE_CONFIG = {
     CLIENT_ID: 'YOUR_CLIENT_ID_HERE.apps.googleusercontent.com',
     ...
   };
   ```
2. **In the Extension UI**: Click **Add Image** → **Use Google Account** → paste your Client ID into the input field and click **Save**. It will be securely remembered in `chrome.storage.local`.

### 3.7 How to Authorize Google
1. Click **📷 Add Image** or **🔄 Change Image**.
2. Click **🌐 Use Google Account**.
3. Click **Connect Google Account**.
4. Brave will open the Google sign-in window. Select your Google account and grant basic profile access.
5. The extension will automatically download the photo, optimize it, and display it as your avatar.

### 3.8 How the Image Is Stored
- The Google photo is converted into a binary **`Blob`** (`image/png`) and saved directly into the profile partition's IndexedDB (`BraveProfileImagesDB`, store `profile_images`).
- **No external hosting**: The image is NOT stored on any server or third-party cloud. It lives 100% locally on your computer.

### 3.9 What Data Is Stored Locally
- Stored record metadata:
  ```json
  {
    "source": "google",
    "provider": "google",
    "accountId": "1092837465...",
    "email": "user@gmail.com",
    "displayName": "Alex Smith",
    "sourceImageUrl": "https://lh3.googleusercontent.com/a/...",
    "importedAt": 1726250000000
  }
  ```

### 3.10 What Data Is NOT Stored
- ❌ NO Google passwords.
- ❌ NO long-lived OAuth refresh tokens or permanent credentials.
- ❌ NO client secrets.
- ❌ NO browser cookies or Google session tokens.
- ❌ NO browsing history or telemetry.

### 3.11 How to Disconnect
- When an active avatar originated from Google, an account badge is shown: `Google Account: user@gmail.com [Disconnect]`.
- Clicking **Disconnect** terminates the in-memory Google session.
- **Important**: Disconnecting Google will **NOT** delete your saved avatar! Your locally stored avatar remains active until you explicitly click **Remove**.

### 3.12 Troubleshooting
- **"Google OAuth Client ID is not configured"**: Set your Client ID in `constants.js` or paste it in the popup.
- **"User cancelled"**: The Google sign-in window was closed before completing consent. Click "Connect Google Account" to try again.
- **"Redirect URI mismatch"**: Verify that `https://<your-extension-id>.chromiumapp.org/` is listed in your Google Cloud Console Authorized Redirect URIs.
- **"Access denied"**: Ensure you added your Google email address as a Test User in the OAuth consent screen.

---

## 4. Project Structure

```text
brave-profile-image/
│
├── manifest.json                 # Manifest V3 extension configuration (v0.5.0)
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
│   ├── google/
│   │   ├── google-auth-service.js    # OAuth 2.0 launchWebAuthFlow controller & token manager
│   │   └── google-profile-service.js # Google Userinfo & high-res photo download pipeline
│   │
│   ├── popup/
│   │   ├── popup.html            # Profile card, source selector, Google card, diagnostics
│   │   ├── popup.css             # Modern dark-mode styling & Google action components
│   │   └── popup.js              # State machine controller with Google & local image support
│   │
│   ├── storage/
│   │   └── image-storage.js      # Promise-based IndexedDB binary storage engine
│   │
│   ├── profiles/
│   │   ├── profile-model.js      # Profile domain entity and ID generator
│   │   └── profile-service.js    # Self-scoped profile manager and storage adapter
│   │
│   └── utils/
│       ├── constants.js          # Shared configuration, Google endpoints & limits (v0.5.0)
│       ├── diagnostics.js        # Environment, storage, and identity probe collector
│       ├── image-processor.js    # Validation, decoding, center-cropping, and resizing
│       └── logger.js             # Formatted console logging helper
│   ├── popup/
│   │   ├── popup.html            # Refined semantic popup layout with accessible dialogs
│   │   ├── popup.css             # Production styling with dark/light themes & motion tokens
│   │   ├── popup.js              # State controller managing UI workflows
│   │   ├── modal.js              # Modal/sheet manager with Escape key accessibility
│   │   └── toast.js              # Accessible toast notifications with error recovery
│   │
│   ├── google/
│   │   ├── google-auth-service.js     # OAuth 2.0 via chrome.identity.launchWebAuthFlow
│   │   └── google-profile-service.js  # Userinfo API fetch & image download pipeline
│   │
│   ├── profiles/
│   │   ├── profile-model.js      # Data structure representing a profile
│   │   └── profile-service.js    # Profile instance resolution and image association
│   │
│   ├── storage/
│   │   └── image-storage.js      # IndexedDB engine for profile-scoped image Blobs
│   │
│   └── utils/
│       ├── constants.js          # App constants, image limits, DB stores, Google config
│       ├── diagnostics.js        # Multi-profile diagnostics data collector
│       ├── image-processor.js    # Center crop, 512x512 downscale, PNG normalization
│       └── logger.js             # Scoped console logging utility
│
└── tests/
    ├── test-runner.html          # Interactive browser test runner page (Phase 6)
    └── test-suite.js             # 34 automated unit and integration tests
```

---

## 5. UI/UX Polish & Production Interface (Phase 6)

### 5.1 Visual Hierarchy & Design System
- **Compact Popup Design**: Sized to 330px width for quick, non-disruptive access without clipping or horizontal scrolling.
- **Button System Hierarchy**:
  - `btn-primary`: Prominent accent action (`+ Add Avatar`, `Use This Image`).
  - `btn-secondary`: Subtle card surface for secondary actions (`Change Avatar`, `Cancel`).
  - `btn-danger`: Red-tinted alert action for destructive removal (`Remove Avatar`).
  - `btn-google`: Clean Google-branded sign-in button with crisp SVG logo.
- **Hero Avatar Showcase**: Large 80×80px circular frame with neutral silhouette placeholder in empty state and glowing border in active state.
- **Secondary Source Indicator**: Subtle tag indicates whether the avatar was *"Uploaded from computer"* or *"From Google Account (email@gmail.com)"*.

### 5.2 Toast Notification System (`toast.js`)
- Floating status toast container positioned at the top of the popup body.
- Types: `success`, `error`, `warning`, `info`.
- Auto-dismiss for transient messages (3.5s for success/info).
- Actionable recovery: Translates raw technical DOMExceptions and OAuth codes into friendly advice with an actionable `[ Retry ]` button.

### 5.3 Accessible Modal & Sheet Controller (`modal.js`)
- Single-dialog enforcement: Opening one modal (e.g. source selector) automatically closes another to prevent overlapping workflows.
- Keyboard accessibility: Pressing `Escape` closes any active sheet/dialog and returns focus to the triggering element.
- Semantic HTML: Uses `role="dialog"` or `role="alertdialog"`, `aria-modal="true"`, and `aria-labelledby`.

### 5.4 Theme & Motion Support
- **System-Aware Light & Dark Themes**: Uses CSS custom properties with `@media (prefers-color-scheme: light)` to match the user's OS and Brave theme seamlessly.
- **Reduced Motion Support**: `@media (prefers-reduced-motion: reduce)` removes nonessential animations and transforms for users with motion sensitivity.
- **Visible Focus Rings**: Clean `:focus-visible` styling (`outline: 2px solid var(--accent-orange)`) across all interactive elements.

---

## 6. Running the Automated Test Suite

To verify Google authentication URL building, redirect parsing, high-res photo transformations, image processing, binary IndexedDB persistence, toast notifications, modal accessibility, and multi-profile isolation:

1. Open Brave Browser.
2. Open a new tab and navigate to:
   ```text
   file:///c:/Users/ahmad/Documents/brave profile image/tests/test-runner.html
   ```
3. All **34 automated test cases** execute live. All 34 will display **PASS**:
   - `test-1` to `test-3`: File validation (PNG, JPEG, WEBP, size limits).
   - `test-4`: Image corruption detection.
   - `test-5` & `test-6`: Center-crop square slice and 512×512 downscaling.
   - `test-7` to `test-10`: IndexedDB binary persistence, existence checks, image replacement, clean removal.
   - `test-11`: Multi-profile isolation simulation.
   - `test-12`: Object URL memory safety.
   - `test-13` to `test-16`: Empty state reporting, removal idempotency, corrupt data fallback, profile name independence.
   - `test-17` to `test-20`: Google services loading, auth URL builder, OAuth redirect parsing, cancellation error handling.
   - `test-21` & `test-22`: Google photo URL high-res transformation (`=s512-c`) and mock processing pipeline.
   - `test-23` to `test-25`: Google metadata persistence, disconnect avatar preservation, and Google multi-profile isolation.
   - `test-26`: ToastController styling, auto-dismiss (3.5s), and action callback.
   - `test-27`: ToastController error sanitization (translates technical errors to friendly instructions).
   - `test-28`: ModalManager single-dialog enforcement (no overlapping modals).
   - `test-29`: ModalManager keyboard accessibility (Escape key dismissal).
   - `test-30`: Button system hierarchy (Primary, Secondary, Danger, Google) and disabled state handling.
   - `test-31`: Empty vs active state DOM rendering.
   - `test-32`: Secondary source indicator formatting (Computer vs Google).
   - `test-33`: Accessible dialog semantics (`role="dialog"`, `aria-modal="true"`, labels).
   - `test-34`: CSS stylesheet media query verification (`prefers-reduced-motion` and `prefers-color-scheme`).

---

## 7. How to Load and Test Across Multiple Brave Profiles

### Loading in Profile A (e.g., "Personal"):
1. Open Brave in your first profile.
2. Navigate to `brave://extensions`.
3. Enable **Developer mode** (toggle in top right).
4. Click **Load unpacked** and select:
   ```text
   C:\Users\ahmad\Documents\brave profile image
   ```
5. Click the extension icon in the Brave toolbar.
6. Click **📷 Add Avatar**.
7. In the **Choose Avatar Source** sheet:
   - Click **📁 Upload from Computer** to select a local photo (`imageA.png`), OR
   - Click **🌐 Use Google Account** to connect your Google account and import your profile photo!
8. Notice the avatar renders crisp and centered. Status displays **Custom avatar active**.

### Loading in Profile B (e.g., "Work"):
1. Switch to a second Brave profile via Brave's profile avatar icon in the window frame.
2. Navigate to `brave://extensions` and click **Load unpacked** (select the same folder).
3. Open the extension popup:
   - Profile B shows **No custom avatar**—**Profile A's image is NOT present**!
4. Click **📷 Add Avatar** and choose a different image or connect a different Google account.
5. Profile B now displays its own independent avatar.

### Offline & Persistence Verification:
1. Close and reopen Brave.
2. Disconnect your internet connection.
3. Open the extension popup in Profile A and Profile B.
4. Both avatars continue displaying immediately from local IndexedDB with zero network requests.
