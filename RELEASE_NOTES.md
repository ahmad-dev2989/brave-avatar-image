# Release Notes — Brave Profile Images v1.0.0

**Product:** Brave Profile Images (Local-First Extension)  
**Version:** `1.0.0` (Production Release)  
**Release Date:** September 2026  
**Package:** `brave-custom-profile-avatar-v1.0.0.zip` (45.6 KB)  
**Target Environment:** Brave Browser on Windows (Chromium Manifest V3)  

---

## 1. Overview

Brave Profile Images is a lightweight, privacy-focused browser extension that allows users to assign custom avatars to individual Brave browser profiles. The extension is completely local-first: all images and profile identities are stored directly on your computer with zero telemetry, zero cloud synchronizations, and zero external tracking.

---

## 2. Core Features

- **Custom Avatar per Brave Profile:** Assign a distinct, high-DPI avatar to each Brave profile (e.g., Personal, Work, School, Research).
- **Local Image Upload:** Select any local PNG, JPEG, or WEBP photo up to 5 MB.
- **Client-Side Image Processing:** Automatic 1:1 center-cropping and downscaling to maximum 512×512 resolution; normalized to lossless PNG.
- **Persistent Local Storage:** Saved directly as raw binary Blobs in the profile partition's private IndexedDB database (`BraveProfileImagesDB`), avoiding Base64 encoding overhead and serialization delays.
- **Google Account Profile Image Import:** Import your official Google Account profile picture via standard OAuth 2.0 (`launchWebAuthFlow`), automatically fetching high-resolution photos (`=s512-c`).
- **Strict Profile Partition Isolation:** Leverages Chromium's physical filesystem partitioning per profile directory. Avatars assigned in Profile A never leak into Profile B.
- **100% Offline Availability:** Once stored, images are loaded directly from local disk. Google or the internet is never contacted merely to display an existing avatar.
- **Polished, Accessible UI:** Modern dark/light theme matching OS preferences, WCAG-compliant dialogs with Escape key dismissal, actionable error-recovery toasts, and reduced-motion animation support.

---

## 3. Technical Architecture

- **Platform:** Chromium Manifest V3 WebExtension.
- **Permissions:** Strictly minimized to `storage` (custom friendly display names) and `identity` (Google OAuth consent sheet).
- **Security:** Zero client secrets, zero passwords, zero token persistence. Tokens are kept in volatile memory only during photo download and discarded immediately.
- **CSP Compliance:** Zero remote code, zero `eval()`, zero external CDN dependencies. Pure Vanilla JavaScript, CSS, and HTML5.

---

## 4. Known Limitations

1. **Native Brave Titlebar Avatar:** WebExtensions in Chromium cannot access or modify Brave's internal C++ UI binary (such as the native window titlebar avatar or Brave's native profile picker). The custom avatar is managed and displayed inside the extension's popup interface.
2. **Profile Identifier Discovery:** Chromium deliberately withholds internal filesystem folder names (`Default`, `Profile 1`) from extensions for anti-fingerprinting. The extension generates a stable, collision-resistant profile instance ID (`bpi_prof_<hex>`) on first launch within each profile sandbox.
3. **Google OAuth Client ID:** If utilizing the optional Google account import, users must provide their own Google Cloud OAuth Client ID (or pre-configure it in `constants.js`).

---

## 5. Installation Instructions

1. Download or locate `brave-custom-profile-avatar-v1.0.0.zip` (or extract it to a local folder).
2. Open Brave Browser and navigate to:
   ```text
   brave://extensions
   ```
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked**.
5. Select the `dist/` directory (or the extracted folder containing `manifest.json` at its root).
6. Click the extension icon in the toolbar to begin customizing your profile avatars.

---

## 6. Project Release Status

**Status:** **READY FOR USE**  
All 50 automated tests passed. Release archive validated with zero missing dependencies and zero secret leakages.
