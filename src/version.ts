/**
 * Application version — injected at build time from package.json by tsup.
 *
 * This is the single source of truth. Never hardcode version strings elsewhere.
 * To bump the version, edit package.json and rebuild.
 */
declare const __APP_VERSION__: string;

export const VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev';
