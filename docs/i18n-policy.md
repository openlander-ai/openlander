# i18n Copy Policy (v0.1)

The OpenLander dashboard ships in English and Korean. This document
records **what gets translated and what does not**, and is the
authoritative reference when adding or editing UI copy. It is the
output of the i18n cleanup discussion in 2026-05-11.

## TL;DR

> **Menu/button labels stay in English. Descriptions translate.**

Both `web/src/i18n/en.ts` and `web/src/i18n/ko.ts` must remain in
lockstep on key shape, but a key whose role is "UI chrome" carries the
**same English string** in both files. A key whose role is "content"
carries the locale's native rendering.

## Why a written policy

Up to v0.1 the i18n surface grew ad-hoc: some Korean strings were direct
translations of English ones (often awkward), some were short labels
that gained no clarity from being Korean ("저장" vs "Save"), and some
were genuinely informative paragraphs where Korean readers benefited
from native rendering ("비밀번호와 같습니다. 유출 시 모든 프로젝트가
노출되니 주의하세요.").

A written rule lets multiple contributors and review agents converge
on the same decision without per-PR debate.

## Register glossary

We use three registers. Pick one per key.

| Register    | Translate?                                                                              | Examples                                                                                                                              |
| ----------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Chrome**  | No — English only in both `en.ts` and `ko.ts`                                           | Buttons (Save, Cancel, Delete, Copy, Sign out), table column headers, primary nav, primitive single-word actions, brand/product names |
| **Content** | Yes — locale-native in `ko.ts`                                                          | Subtitles, descriptions, tooltips, error messages with context, paragraph help text, "what does this do?" copy                        |
| **Hybrid**  | Default Chrome; switch to Content if the English form is non-obvious to a Korean reader | Section headings, form labels, status pills                                                                                           |

When in doubt, prefer **Chrome**. A Korean speaker who works in
infrastructure tooling is comfortable with English action verbs; the
real translation value is in explanatory copy.

## Examples

### Buttons (Chrome — English only)

```ts
// en.ts
account.popover.signOut: 'Sign out',
account.popover.changePassword: 'Change password',

// ko.ts — same English text
account.popover.signOut: 'Sign out',
account.popover.changePassword: 'Change password',
```

### Verbs paired with locale-targeted nouns (Hybrid)

The "Switch language" row shows the **target** locale's autonym; the
verb itself stays English on the Korean side too because it is a one-
word action:

```ts
// en.ts
account.popover.switchLanguage: 'Switch language',

// ko.ts — verb left in English (Chrome), but the autonym (target side)
// is rendered with a `lang=` attribute by the component, not in the
// translation file.
account.popover.switchLanguage: 'Switch language',
```

### Descriptive copy (Content — translate fully)

```ts
// en.ts
mcpServer.tokens.passwordHint:
  'Treat like a password — one token unlocks every project. Regenerate if lost.',

// ko.ts — locale-native, not a literal translation
mcpServer.tokens.passwordHint:
  '비밀번호와 같습니다. 유출 시 모든 프로젝트가 노출되니 주의하세요.',
```

### Section subtitle (Content)

```ts
// en.ts
mcpServer.setup.subtitle: 'Pick your MCP client and paste the snippet into its config.',

// ko.ts
mcpServer.setup.subtitle: '클라이언트를 선택하고 설정 스니펫을 붙여넣으세요.',
```

### Status pill (Hybrid — defaults to Chrome)

`Connected`, `Listening`, `Unreachable` stay English in both files.
A Korean reader monitoring infra status reads these faster than a
translation, and they double as machine-readable status names in
backend logs.

### Brand and product names (Chrome)

Never translate `Claude Code`, `Cursor`, `Windsurf`, `OpenLander`,
`Traefik`, `Docker`. They are proper nouns.

## Korean register guide

When you do write Korean (Content keys):

- **Honorific form** — use the polite `~합니다` / `~하세요` register.
  Avoid the deferential `~ 합니다요` (over-polite) and the casual
  `~해` (under-polite).
- **Security and warnings** — use direct, gravity-carrying wording.
  Soft hedges ("…할 수 있습니다") under-sell risk. Prefer
  "유출 시…", "되돌릴 수 없습니다", "주의하세요".
- **Avoid translationese** — if the English source reads like a manual,
  the Korean rendering should still read like a sentence a person
  would say. Sample reviews:
  - ❌ "비밀번호처럼 취급하세요." (literal "treat as a password")
  - ✅ "비밀번호와 같습니다."
  - ❌ "토큰 하나가 모든 프로젝트 접근 권한을 가집니다."
  - ✅ "토큰 하나로 모든 프로젝트에 접근합니다." (or stronger form
    above when describing risk)
- **Common loanwords to keep in Latin script** — `token` → `토큰`,
  `config` → `설정`, `MCP`, `Docker`, `Traefik`, `Endpoint` → `엔드포인트`.
  Avoid `구성` (reads like 1990s Windows) and `구동` for "run".

## Pitfalls

- **Don't translate single-word actions.** "Save" → "저장" doubles
  visible width on a button without adding clarity. Keep English.
- **Don't translate brand or protocol names.** `MCP` stays `MCP` in
  both files; `Claude Desktop` stays `Claude Desktop`.
- **Don't drop a key from one locale.** Both files must always have
  the same key tree. CI fails on missing keys.
- **Don't put the autonym of a foreign locale through `t()`.** Render
  it as a literal with `lang=` attribute (see `AccountPopover.tsx`).

## Migration plan

Existing copy will be migrated screen-by-screen, **not in one large PR**.
Each migration PR scope:

1. One screen or one feature surface at a time.
2. Restate the chrome/content split inline in the PR body.
3. Touch both `en.ts` and `ko.ts` together in the same commit.
4. Run a CCG (Codex + Gemini) review pass for register questions.

Migration priority (roughly user-facing volume first):

1. Account popover, sidebar, primary nav ✅ (this PR + #18)
2. MCP / Your Agent ✅ (PR #17 set the precedent)
3. Service detail and tabs (Domains, Logs, Env, …)
4. Project list, project detail, danger zone
5. Activity feed, notifications
6. Setup wizard (lowest priority — first-boot only)

## Adding a new key

When you add a new i18n key:

1. Decide its register (Chrome / Content / Hybrid).
2. Add it to **both** `en.ts` and `ko.ts` in the same commit.
3. If the role is Chrome, the Korean value is the same English string.
4. If the role is Content, write the Korean by hand — do not run an MT
   pass. Cross-check against the register guide above.

## Where this lives

This document is the policy. The actual strings live in
`web/src/i18n/{en,ko}.ts`. The `t()` helper, language toggle, and
`<html lang>` sync live in `web/src/i18n/context.tsx`. Setup wizard
language step is `web/src/components/setup/LanguageStep.tsx`. The
in-app switcher is the Globe row in `web/src/components/account/AccountPopover.tsx`.
