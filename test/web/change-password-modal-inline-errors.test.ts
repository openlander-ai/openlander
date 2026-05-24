import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

// ChangePasswordModal — inline-error UX parity with the SetupPassword
// screen. The pre-fix Save button was hard-disabled when
// `next.length < MIN_LENGTH || next !== confirm`, which left users
// stuck with no message explaining why the button refused to react.
// We now keep the button enabled as long as all three fields have
// _some_ value and surface the length / mismatch failures from the
// submit handler with the existing i18n strings.
//
// This suite source-pins the disabled condition + the form/input
// attributes so a future refactor can't silently regress to the
// silent hard-disable form.
describe('ChangePasswordModal — inline error UX', () => {
  const modalSource = readRepoFile('web/src/components/account/ChangePasswordModal.tsx');

  // Extract the submit button's disabled prop expression so the
  // regression checks below operate on JUST the predicate, not the
  // whole file (the submit-handler still mentions `next.length` and
  // `next !== confirm` for the inline-error path — those are correct).
  const submitDisabledMatch = modalSource.match(/type="submit"[\s\S]*?disabled=\{([^}]+)\}/);
  const submitDisabledExpr = submitDisabledMatch?.[1] ?? '';

  it('disables Save only when a field is empty or the request is in flight', () => {
    expect(submitDisabledExpr).toMatch(/^submitting \|\| !current \|\| !next \|\| !confirm$/);
  });

  it('does not gate the Save button on the password length (regression guard)', () => {
    // The pre-fix condition included `next.length < MIN_LENGTH`. That
    // is exactly the silent hard-disable we are removing — tooShort is
    // now a submit-handler error, not a button-disable predicate.
    expect(submitDisabledExpr).not.toMatch(/next\.length/);
    expect(submitDisabledExpr).not.toMatch(/MIN_LENGTH/);
  });

  it('uses the same 8 character minimum as first-run setup', () => {
    const policySource = readRepoFile('web/src/lib/auth/password-policy.ts');
    expect(policySource).toMatch(/MIN_PASSWORD_LENGTH = 8/);
    expect(modalSource).toContain("from '@/lib/auth/password-policy'");
    expect(modalSource).not.toMatch(/const MIN_LENGTH = 12;/);
    expect(modalSource).not.toMatch(/const MIN_LENGTH = 8;/);
  });

  it('does not gate the Save button on the confirmation match (regression guard)', () => {
    // Same reasoning as the length guard — mismatch is surfaced by
    // the submit handler with `account.changePassword.mismatch`.
    expect(submitDisabledExpr).not.toMatch(/!==/);
  });

  it('opts the form out of native HTML5 validation so the inline error path runs', () => {
    expect(modalSource).toMatch(/noValidate/);
  });

  it('drops the native minLength on the new-password input', () => {
    // The native attribute would short-circuit submit before our
    // handler runs (browser focuses the input + shows a popover
    // instead of letting React render the inline error banner).
    expect(modalSource).not.toMatch(/minLength=\{MIN_PASSWORD_LENGTH\}/);
  });

  it('still validates length + mismatch in the submit handler with the existing i18n keys', () => {
    expect(modalSource).toMatch(/isPasswordTooShort\(next\)/);
    expect(modalSource).toMatch(/account\.changePassword\.tooShort/);
    expect(modalSource).toMatch(/next !== confirm/);
    expect(modalSource).toMatch(/account\.changePassword\.mismatch/);
  });
});
