/**
 * Modal & Sheet Manager (Phase 6 — UI/UX Polish)
 *
 * Coordinates accessible dialogs, sheets, and overlay panels.
 *
 * Features:
 * - Single-dialog enforcement: Closes other modals to prevent multiple overlapping workflows.
 * - Keyboard accessibility: Listens for Escape key to close active dialog.
 * - Focus management: Focuses initial interactive control and restores focus on close.
 * - Backdrop click to dismiss.
 */

export class ModalManager {
  constructor() {
    this.modals = new Map();
    this.activeModalId = null;
    this.boundKeyHandler = this.handleKeyDown.bind(this);
  }

  /**
   * Registers a modal or sheet element.
   *
   * @param {string} id
   * @param {Object} config
   * @param {HTMLElement} config.element - The modal root element
   * @param {HTMLElement|Array<HTMLElement>} [config.closeButtons] - Button(s) that close this modal
   * @param {Function} [config.onOpen] - Callback triggered when modal opens
   * @param {Function} [config.onClose] - Callback triggered when modal closes
   */
  register(id, { element, closeButtons = [], onOpen = null, onClose = null } = {}) {
    if (!element) return;

    const buttons = Array.isArray(closeButtons) ? closeButtons : [closeButtons];
    buttons.forEach((btn) => {
      if (btn) {
        btn.addEventListener('click', () => this.close(id));
      }
    });

    this.modals.set(id, {
      element,
      closeButtons: buttons,
      onOpen,
      onClose,
      triggerElement: null
    });
  }

  /**
   * Opens a modal.
   *
   * @param {string} id
   * @param {HTMLElement} [triggerElement=null] - Element that triggered the modal (for focus restoration)
   */
  open(id, triggerElement = null) {
    const modal = this.modals.get(id);
    if (!modal) return;

    // Close any other open modal first
    if (this.activeModalId && this.activeModalId !== id) {
      this.close(this.activeModalId, false);
    }

    modal.triggerElement = triggerElement || document.activeElement;
    modal.element.classList.remove('hidden');
    modal.element.setAttribute('aria-hidden', 'false');

    this.activeModalId = id;

    // Attach global Escape key listener
    document.addEventListener('keydown', this.boundKeyHandler);

    // Call onOpen callback if provided
    if (typeof modal.onOpen === 'function') {
      modal.onOpen();
    }

    // Auto-focus first interactive control
    setTimeout(() => {
      const focusable = modal.element.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable) {
        focusable.focus();
      }
    }, 50);
  }

  /**
   * Closes a modal.
   *
   * @param {string} [id=null] - Modal to close (defaults to currently active)
   * @param {boolean} [restoreFocus=true] - Whether to return focus to the trigger element
   */
  close(id = null, restoreFocus = true) {
    const targetId = id || this.activeModalId;
    if (!targetId) return;

    const modal = this.modals.get(targetId);
    if (!modal) return;

    modal.element.classList.add('hidden');
    modal.element.setAttribute('aria-hidden', 'true');

    if (this.activeModalId === targetId) {
      this.activeModalId = null;
      document.removeEventListener('keydown', this.boundKeyHandler);
    }

    // Trigger onClose callback
    if (typeof modal.onClose === 'function') {
      modal.onClose();
    }

    // Restore focus to trigger element
    if (restoreFocus && modal.triggerElement && typeof modal.triggerElement.focus === 'function') {
      modal.triggerElement.focus();
    }
  }

  /**
   * Closes all registered modals.
   */
  closeAll() {
    this.modals.forEach((_, id) => {
      this.close(id, false);
    });
  }

  /**
   * Global keydown handler for Escape key.
   *
   * @param {KeyboardEvent} e
   */
  handleKeyDown(e) {
    if (e.key === 'Escape' && this.activeModalId) {
      e.preventDefault();
      this.close(this.activeModalId, true);
    }
  }

  /**
   * Returns whether a given modal is currently open.
   *
   * @param {string} id
   * @returns {boolean}
   */
  isOpen(id) {
    return this.activeModalId === id;
  }
}
