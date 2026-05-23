declare const __APP_VERSION__: string | undefined;

export const APP_VERSION =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__.trim().length > 0
    ? __APP_VERSION__
    : '0.0.0-dev';

export const APP_VERSION_LABEL = `v${APP_VERSION.replace(/^v/i, '')}`;
