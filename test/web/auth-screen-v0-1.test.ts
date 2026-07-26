import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('AuthScreen v0.1 — single page, two modes', () => {
  const source = readRepoFile('web/src/pages/LoginPage.tsx');
  const appSource = readRepoFile('web/src/App.tsx');
  const enSource = readRepoFile('web/src/i18n/en.ts');
  const koSource = readRepoFile('web/src/i18n/ko.ts');

  it('decides mode from /api/setup/status hasPassword', () => {
    expect(source).toContain('getSetupStatus');
    expect(source).toMatch(/hasPassword === false \? 'setup' : 'signin'/);
  });

  it('falls back to signin on status fetch error', () => {
    expect(source).toMatch(/\.catch\([^)]*\)\s*=>\s*\{[\s\S]*?setMode\('signin'\)/);
  });

  it('renders a skeleton with descriptive copy while mode is null', () => {
    expect(source).toMatch(/if \(mode == null\)/);
    expect(source).toContain('Loader2');
    expect(source).toContain("t('login.checkingStatus')");
    expect(source).toContain("t('login.loadingLabel')");
    expect(source).toMatch(/role="status"/);
  });

  it('uses the dedicated tooShort key (not empty) for sub-8-char passwords', () => {
    expect(source).toContain("t('setup.password.tooShort')");
    expect(source).toMatch(/isPasswordTooShort\(password\)/);
  });

  it('does not require a setup secret on first-run password setup', () => {
    expect(source).not.toMatch(/setupSecret/);
    expect(source).not.toContain("t('setup.password.secretEmpty')");
    expect(source).toMatch(/await setupPassword\(password\)/);
    for (const dict of [enSource, koSource]) {
      expect(dict).not.toMatch(/secretPlaceholder:/);
      expect(dict).not.toMatch(/secretHint:/);
      expect(dict).not.toMatch(/secretEmpty:/);
    }
  });

  it('confirms password match before setup submit', () => {
    expect(source).toMatch(/password !== confirm/);
    expect(source).toContain("t('setup.password.mismatch')");
  });

  it('hard-reloads to /setup via replace() after setupPassword instead of double-login', () => {
    // R2 (2026-05-13): redirect lands on /setup directly. The earlier
    // /projects path bounced through SetupGuard on every first boot
    // (no docker/traefik yet ⇒ ready=false ⇒ redirect to /setup),
    // adding a flicker and a brittle "what if ready=true already"
    // edge case. /setup owns the post-password handoff now.
    expect(source).toMatch(
      /await setupPassword\([\s\S]*?\);[\s\S]*?window\.location\.replace\(['"]\/setup['"]\)/,
    );
    // The follow-up `await login(password)` from the original PR #200
    // shape is now removed — backend cookie is enough.
    expect(source).not.toMatch(/await setupPassword\([\s\S]*?\);[\s\S]*?await login\(password\)/);
    // assign() would push /login onto the back-stack — keep replace()
    // so the back button doesn't return the user to the auth screen.
    expect(source).not.toContain("window.location.assign('/setup')");
    // Old /projects redirect must stay gone (R2 contract).
    expect(source).not.toContain("window.location.replace('/projects')");
  });

  it('disables native HTML5 minLength so JS handler can show tooShort inline', () => {
    // The setup form must opt out of native HTML5 validation so submit
    // reaches handleSetup() (otherwise the browser blocks short
    // passwords with its own pop-up and the tooShort copy never shows).
    expect(source).toMatch(/<form[\s\S]*?handleSetup[\s\S]*?noValidate/);
    // Belt-and-braces: the setup password input must also NOT carry
    // minLength — even with noValidate on the form, leaving minLength
    // could trip future linters / a11y checks.
    expect(source).not.toMatch(/<Input[\s\S]*?id="setup-password"[\s\S]*?minLength=\{MIN_LENGTH\}/);
  });

  it('uses errorGeneric fallbacks instead of button labels', () => {
    expect(source).toContain('localizeApiError');
    expect(source).toContain("'login.errorGeneric'");
    expect(source).toContain("'setup.password.errorGeneric'");
    // Ensure we did not regress to the PR #200 shape that surfaced
    // button labels as error text.
    expect(source).not.toMatch(/setError\([^)]*t\('login\.signIn'\)/);
    expect(source).not.toMatch(/setError\([^)]*t\('setup\.password\.submit'\)/);
  });

  it('only disables submit on empty inputs / in-flight, not on length rule', () => {
    // The setup submit button must allow a click when password is short
    // so the user actually sees the tooShort message. Length validation
    // happens inline on submit.
    expect(source).toMatch(/disabled=\{loading \|\| !password \|\| !confirm\}/);
    expect(source).not.toMatch(/disabled=\{[^}]*password\.length < MIN_LENGTH/);
  });

  it('shows the setup title h1 in setup mode', () => {
    expect(source).toMatch(/mode === 'setup' \? t\('setup\.password\.title'\) : 'OpenLander'/);
  });

  it('guards setState calls against post-unmount writes', () => {
    expect(source).toContain('mountedRef');
    expect(source).toMatch(/mountedRef\.current = false/);
    expect(source).toMatch(/if \(mountedRef\.current\) setLoading\(false\)/);
  });

  it('routes first boot through /login so setup mode is reachable', () => {
    expect(appSource).toMatch(
      /if \(!setupStatus\.hasPassword\) \{\s*return <Navigate to="\/login" replace \/>;\s*\}/,
    );
    expect(appSource).not.toMatch(
      /if \(!setupStatus\.hasPassword\) \{\s*return <Navigate to="\/setup" replace \/>;\s*\}/,
    );
  });

  it('defines tooShort + errorGeneric keys in both en and ko', () => {
    for (const dict of [enSource, koSource]) {
      expect(dict).toMatch(/tooShort:/);
      // login.errorGeneric and setup.password.errorGeneric are namespaced
      // duplicates — assert both lines exist.
      expect(dict.match(/errorGeneric:/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
      expect(dict).toMatch(/checkingStatus:/);
      expect(dict).toMatch(/loadingLabel:/);
      expect(dict).toMatch(/lengthHint:/);
      // loginAfterSetupFailed was speculatively added but never wired —
      // removed in the CCG follow-up. Assert it stays gone so future
      // changes don't reintroduce dead i18n surface.
      expect(dict).not.toMatch(/loginAfterSetupFailed:/);
    }
  });
});

describe('SetupScreen — PasswordStep + LanguageStep removed', () => {
  const setupSource = readRepoFile('web/src/components/setup/SetupScreen.tsx');

  it('no longer imports or renders PasswordStep', () => {
    expect(setupSource).not.toMatch(/from '\.\/PasswordStep'/);
    expect(setupSource).not.toMatch(/<PasswordStep\b/);
  });

  // Onboarding R1 (2026-05-13): LanguageStep retired in favour of the
  // /login header toggle + AccountPopover toggle.
  it('no longer imports or renders LanguageStep', () => {
    expect(setupSource).not.toMatch(/from '\.\/LanguageStep'/);
    expect(setupSource).not.toMatch(/<LanguageStep\b/);
  });

  it('renders 3 steps (Infra / GitHub / MCP)', () => {
    expect(setupSource).toMatch(/\[0, 1, 2\]\.map/);
    expect(setupSource).not.toMatch(/\[0, 1, 2, 3\]\.map/);
    expect(setupSource).toContain('const MAX_STEP = 2');
  });

  it('migrates legacy localStorage step values into the new range', () => {
    // Legacy values: Language=0, Infra=1, GitHub=2, MCP=3. After R1
    // both Language(0) and Infra(1) collapse onto new Infra(0); 2/3 shift
    // one earlier to GitHub(1) / MCP(2).
    expect(setupSource).toMatch(/if \(parsed <= 1\) return 0/);
    expect(setupSource).toMatch(/return Math\.min\(parsed - 1, MAX_STEP\)/);
  });

  // Onboarding R2 (2026-05-13): localStorage-restored step must be
  // clamped against the live status. If docker is not OK, the user has
  // no way to be meaningfully past Infra, so snap back to step 0.
  // Guards against the "restart Docker, wizard drops me on MCP" footgun.
  // Optional chaining on docker.ok defends against the anonymous-payload
  // shape that omits the `docker` key entirely.
  it('clamps step back to Infra when docker.ok is false', () => {
    expect(setupSource).toMatch(/status\.docker\?\.ok === false && step > 0/);
    expect(setupSource).toMatch(/setStep\(0\)/);
  });

  // CCG Gemini feedback: silent step jump confuses the user. Surface
  // a toast so the strict step regression has a visible reason.
  it('emits a toast (deduped) when clamping back to Infra', () => {
    expect(setupSource).toContain("toast.warning(t('setup.infra.dockerReturned'))");
    expect(setupSource).toMatch(/dockerClampToastShownRef/);
  });
});

describe('App SetupAccessGuard — R2 guards /setup route', () => {
  const appSource = readRepoFile('web/src/App.tsx');

  it('wires /setup through SetupAccessGuard instead of mounting SetupScreen directly', () => {
    expect(appSource).toMatch(/<Route path="\/setup" element=\{<SetupAccessGuard \/>\} \/>/);
  });

  // The guard must let first-boot users (hasPassword=false) AND
  // authenticated sessions through, and bounce everyone else to /login.
  // Codex CCG flagged that the previous shape exposed /setup to any
  // drive-by visitor and called `status.docker.ok` against an anonymous
  // payload that intentionally omits the field.
  it('allows first boot or authenticated session through, bounces the rest to /login', () => {
    expect(appSource).toMatch(/function SetupAccessGuard\(\)/);
    expect(appSource).toMatch(/!setupStatus\.hasPassword \|\| isAuthenticated/);
    expect(appSource).toMatch(/<Navigate to="\/login" replace \/>/);
  });
});
