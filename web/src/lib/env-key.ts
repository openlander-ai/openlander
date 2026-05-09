/**
 * Environment variable key validation — single source of truth shared
 * with the backend. Mirrors `ENV_KEY_PATTERN` in
 * `src/web/api/service-env-routes.ts`.
 *
 * The backend rejects keys that don't match this regex with a 400
 * `{ error: 'INVALID_FIELD', message: 'variables keys must match
 * [A-Za-z_][A-Za-z0-9_]*' }`. Without client-side validation, users
 * type a bad key, hit Save, and see the raw English regex bubble up
 * through the error toast — bad UX in any locale, especially Korean.
 *
 * Keep this regex in sync with the backend constant. The regression
 * test in `test/web/env-key-validation.test.ts` pins the shape so a
 * future refactor that loosens one side without the other breaks CI.
 */

/** POSIX env name: letter or underscore, then letters/digits/underscores. */
export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidEnvKey(key: string): boolean {
  return ENV_KEY_PATTERN.test(key);
}

/**
 * Return the first key in `keys` that doesn't satisfy `ENV_KEY_PATTERN`,
 * or `null` if all keys are valid. The caller surfaces the offending
 * key in the form error so the user knows which row to fix.
 */
export function findInvalidEnvKey(keys: Iterable<string>): string | null {
  for (const key of keys) {
    if (!isValidEnvKey(key)) return key;
  }
  return null;
}
