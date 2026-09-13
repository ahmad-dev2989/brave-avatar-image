/**
 * Toast Notification Controller (Phase 6 — UI/UX Polish)
 *
 * Provides non-intrusive, accessible notifications for success, warnings,
 * informational updates, and actionable error recovery.
 *
 * Features:
 * - Auto-dismiss for transient messages (success, info: 3500ms).
 * - Persistent display for errors until explicitly dismissed or retried.
 * - Recovery action button support (e.g. "Try Again").
 * - Error message sanitization converting raw technical/OAuth errors to human-friendly text.
 * - Safe DOM manipulation (prevents XSS).
 * - Accessible announcements (aria-live, role="status" / role="alert").
 */

export class ToastController {
  /**
   * @param {Object} elements
   * @param {HTMLElement} elements.container - The toast container element
   * @param {HTMLElement} elements.icon - The icon element
   * @param {HTMLElement} elements.text - The message text container
   * @param {HTMLElement} elements.actionBtn - Optional action/retry button
   * @param {HTMLElement} elements.dismissBtn - Dismiss (✕) button
   */
  constructor({ container, icon, text, actionBtn, dismissBtn } = {}) {
    this.container = container;
    this.icon = icon;
    this.text = text;
    this.actionBtn = actionBtn;
    this.dismissBtn = dismissBtn;
    this.timeoutId = null;
    this.currentActionCallback = null;

    if (this.dismissBtn) {
      this.dismissBtn.addEventListener('click', () => this.hide());
    }

    if (this.actionBtn) {
      this.actionBtn.addEventListener('click', () => {
        if (typeof this.currentActionCallback === 'function') {
          const cb = this.currentActionCallback;
          this.hide();
          cb();
        }
      });
    }
  }

  /**
   * Translates raw technical errors or OAuth exceptions into clear, actionable advice.
   *
   * @param {Error|string} err
   * @returns {string}
   */
  static formatErrorMessage(err) {
    if (!err) return 'An unexpected issue occurred. Please try again.';
    const msg = typeof err === 'string' ? err : err.message || String(err);

    // Image decoding errors
    if (msg.includes('createImageBitmap') || msg.includes('decode') || msg.includes('Corrupt')) {
      return 'That image could not be decoded. Please choose another image file.';
    }

    // Google OAuth errors
    if (msg.includes('access_denied') || msg.includes('cancelled') || msg.includes('canceled') || msg.includes('User closed')) {
      return 'Google authorization was cancelled. You can connect anytime.';
    }
    if (msg.includes('invalid_grant') || msg.includes('invalid_client') || msg.includes('400') || msg.includes('401')) {
      return 'Google authorization could not be completed. Please verify your Client ID or try again.';
    }

    // Network / Offline errors
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('offline')) {
      return 'Network connection is unavailable. Please check your internet connection.';
    }

    // Storage errors
    if (msg.includes('IndexedDB') || msg.includes('QuotaExceededError') || msg.includes('storage')) {
      return 'Local storage operation failed. Please try again.';
    }

    // Return sanitized original message or fallback
    return msg.length > 120 ? msg.substring(0, 117) + '...' : msg;
  }

  /**
   * Shows a toast message.
   *
   * @param {string} message
   * @param {'success'|'error'|'warning'|'info'} [type='info']
   * @param {Object} [options={}]
   * @param {number} [options.duration] - Milliseconds before auto-dismiss (0 for permanent)
   * @param {string} [options.actionText] - Label for action button (e.g. "Retry")
   * @param {Function} [options.onAction] - Callback when action button is clicked
   */
  show(message, type = 'info', options = {}) {
    if (!this.container || !this.text) return;

    // Clear any active auto-dismiss timer
    this.clearTimer();

    // Set message text safely
    this.text.textContent = message;

    // Reset modifier classes
    this.container.classList.remove('toast-success', 'toast-error', 'toast-warning', 'toast-info', 'hidden');
    this.container.classList.add(`toast-${type}`);

    // Update ARIA role according to severity
    if (type === 'error') {
      this.container.setAttribute('role', 'alert');
      this.container.setAttribute('aria-live', 'assertive');
    } else {
      this.container.setAttribute('role', 'status');
      this.container.setAttribute('aria-live', 'polite');
    }

    // Update icon
    if (this.icon) {
      switch (type) {
        case 'success':
          this.icon.textContent = '✓';
          break;
        case 'error':
          this.icon.textContent = '✕';
          break;
        case 'warning':
          this.icon.textContent = '⚠';
          break;
        case 'info':
        default:
          this.icon.textContent = 'ℹ';
          break;
      }
    }

    // Action button setup
    if (this.actionBtn) {
      if (options.actionText && typeof options.onAction === 'function') {
        this.actionBtn.textContent = options.actionText;
        this.currentActionCallback = options.onAction;
        this.actionBtn.classList.remove('hidden');
      } else {
        this.actionBtn.classList.add('hidden');
        this.currentActionCallback = null;
      }
    }

    // Determine auto-dismiss duration
    let duration = options.duration;
    if (duration === undefined) {
      // Default: auto-dismiss for success and info (3500ms), stay open for errors/warnings
      duration = (type === 'success' || type === 'info') ? 3500 : 0;
    }

    if (duration > 0) {
      this.timeoutId = setTimeout(() => {
        this.hide();
      }, duration);
    }
  }

  /**
   * Hides the toast notification.
   */
  hide() {
    this.clearTimer();
    this.currentActionCallback = null;
    if (this.container) {
      this.container.classList.add('hidden');
    }
  }

  /**
   * Clears any active dismissal timer.
   */
  clearTimer() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}
