/**
 * Lightweight Scoped Logger
 *
 * Provides standardized, visually identifiable console output
 * across background workers, popups, and utility modules without external dependencies.
 */

export function createLogger(scope = 'App') {
  const prefix = `[BPI:${scope}]`;

  return {
    info(...args) {
      console.log(`%c${prefix}`, 'color: #FB542B; font-weight: bold;', ...args);
    },
    warn(...args) {
      console.warn(`%c${prefix}`, 'color: #FFB300; font-weight: bold;', ...args);
    },
    error(...args) {
      console.error(`%c${prefix}`, 'color: #E53935; font-weight: bold;', ...args);
    },
    debug(...args) {
      console.debug(`%c${prefix}`, 'color: #7E57C2; font-weight: bold;', ...args);
    }
  };
}

export const logger = createLogger('Core');
