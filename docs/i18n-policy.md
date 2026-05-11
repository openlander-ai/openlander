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

| Register    | Translate?                                                                      | Examples                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Chrome**  | No — English only in both `en.ts` and `ko.ts`                                   | Buttons (Save, Cancel, Delete, Copy, Sign out), table column headers, primary nav, tabs, primitive single-word actions, form labels, brand names |
| **Content** | Yes — locale-native in `ko.ts`                                                  | Subtitles, descriptions, tooltips, error messages with context, paragraph help text, "what does this do?" copy                                   |
| **Hybrid**  | Default Chrome; switch to Content only when the English form genuinely misleads | Status pills you also expose in logs (`Connected`, `Listening`, `Unreachable` stay Chrome); short surface-only status copy with no log analogue  |

When in doubt, prefer **Chrome**. Korean readers working in
infrastructure tooling tend to read short English action verbs faster
than translated ones, and machine-readable strings (log lines, query
parameters) benefit from staying stable across locales. (This is an
audience assumption, not a universal rule — see _Pitfalls_ for when to
revisit.)

## Mechanical convention (key-name suffix heuristic)

To reduce per-key bikeshedding, default the register from the key name:

| Suffix / shape                                               | Default register | Override?                                                           |
| ------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------- |
| `*Action`, `*Button`, `submit`, `cancel`, `confirm`, `close` | Chrome           | rarely                                                              |
| Bare verbs (`save`, `reveal`, `regenerate`, `copy`)          | Chrome           | rarely                                                              |
| Bare nouns used as labels (`name`, `port`, `endpoint`)       | Chrome           | when the English form genuinely confuses Korean readers             |
| `title`                                                      | Chrome           | move to Content if the title is sentence-shaped, not a heading      |
| `subtitle`, `description`, `hint`, `*Hint`, `help`, `empty`  | Content          | rarely                                                              |
| `error*`, `*Failed`, `*Tooltip`, `confirmMessage`            | Content          | keep Chrome only if the text is one word                            |
| `*.col.*` (table column headers)                             | Chrome           | rarely                                                              |
| `nav.*`, `sidebar.*`, `tabs.*`                               | Chrome           | rarely                                                              |
| `status.*`                                                   | Chrome           | move to Content only when there is no machine-readable log analogue |

These are defaults, not laws. If a key falls between, name the register
explicitly in the PR.

## Examples

### Buttons (Chrome — English only)

```ts
// en.ts
account.popover.signOut: 'Sign out',

// ko.ts — same English text
account.popover.signOut: 'Sign out',
```

### Verbs paired with locale-targeted nouns

The "Switch language" row in `AccountPopover.tsx` follows the Chrome
rule on the verb. The right-aligned **target-locale autonym** ("한국어"
when the active locale is English, "English" when active is Korean) is
not an i18n key at all — it's rendered as a literal with a `lang=`
attribute by the component, so screen readers pronounce it correctly:

```ts
// en.ts
account.popover.switchLanguage: 'Switch language',

// ko.ts — Chrome rule applies; see note below.
account.popover.switchLanguage: 'Switch language',
```

> **Note (2026-05-11):** PR #18 currently ships `'언어 변경'` in `ko.ts`
> as a pre-policy decision. The AccountPopover Korean sweep (migration
> step 1 below) will flip this back to `'Switch language'` to match
> the policy.

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

`Connected`, `Listening`, `Unreachable` stay English in both files —
they double as machine-readable status names in backend logs, so
diverging the UI from log values is more friction than the translation
buys.

### Brand and product names (Chrome by default)

Never translate or transliterate `Claude Code`, `Cursor`, `Windsurf`,
`OpenLander`, `Traefik`, `Docker` in labels, buttons, or short config
hints. They are proper nouns and Korean infra audiences read them in
their vendor spelling.

**Exception:** in descriptive prose (`description`, `subtitle`,
`*Hint`), a Korean transliteration may improve flow when the surrounding
text is already Korean — for example `Traefik 설정을 확인하세요` reads
fine, while a forced `트래픽 설정...` does not. Default to vendor
spelling and only reach for transliteration if the prose feels awkward
with the English form embedded.

## Korean register guide

When you do write Korean (Content keys):

- **Honorific form** — use the polite `~합니다` / `~하세요` register.
  Avoid the deferential `~합니다요` (over-polite) and the casual `~해`
  (under-polite).
- **Security and warnings** — use direct, gravity-carrying wording.
  Soft hedges ("…할 수 있습니다") under-sell risk. Prefer
  "유출 시…", "되돌릴 수 없습니다", "주의하세요".
- **Avoid translationese** — if the English source reads like a manual,
  the Korean rendering should still read like a sentence a person
  would say. Sample reviews:
  - ❌ "비밀번호처럼 취급하세요." (literal "treat as a password")
  - ✅ "비밀번호와 같습니다."
  - ❌ "토큰 하나가 모든 프로젝트 접근 권한을 가집니다."
  - ✅ "토큰 하나로 모든 프로젝트에 접근합니다." (or the stronger
    risk-framed form above when describing exposure)

## Technical term handling

Distinct from brand/product names — these are common nouns the
ecosystem already uses.

**Keep vendor spelling (Latin script) in Chrome contexts:**

`MCP`, `JSON`, `YAML`, `Docker`, `Traefik`, `GitHub`, `Kubernetes`,
`URL`, `API`, `CI`, `CLI`, `DNS`, `TLS`, `HTTP/HTTPS`, `ACME`.

**Korean loanword / generic term in Content contexts:**

| English              | Korean     | Notes                                                           |
| -------------------- | ---------- | --------------------------------------------------------------- |
| token                | 토큰       | loanword, standard in dev tooling                               |
| config               | 설정       | translation; avoid `구성` (1990s Windows feel)                  |
| endpoint             | 엔드포인트 | loanword                                                        |
| dashboard            | 대시보드   | loanword                                                        |
| deployment           | 배포       | translation                                                     |
| log                  | 로그       | loanword                                                        |
| restart              | 재시작     | translation; avoid `구동` for "run"                             |
| rollback             | 롤백       | loanword                                                        |
| environment variable | 환경 변수  | standard translation                                            |
| secret               | 시크릿     | loanword, standard in K8s/Docker; avoid `비밀`                  |
| domain               | 도메인     | loanword                                                        |
| service              | 서비스     | loanword                                                        |
| repository           | 레포지토리 | loanword (also `저장소`, but the dev community uses 레포지토리) |
| webhook              | 웹훅       | loanword                                                        |

This list is non-exhaustive — extend it as new terms enter the UI.

## Pitfalls

- **Don't translate single-word actions.** "Save" → "저장" doubles
  visible width on a button without adding clarity. Keep English.
- **Don't translate brand or protocol names** in labels/buttons. `MCP`
  stays `MCP`; `Claude Desktop` stays `Claude Desktop`. See the
  Content-prose exception above.
- **Don't drop a key from one locale.** Both files must always have
  the same key tree. No CI check enforces this today
  (`scripts/validate-i18n-keys.ts` is a planned follow-up — see
  _Tooling gaps_ below), so reviewers verify by hand. Until enforcement
  lands, paste-then-write is the safe workflow.
- **Don't put the autonym of a foreign locale through `t()`.** Render
  it as a literal with `lang=` attribute (see `AccountPopover.tsx`).
- **Audience assumption check.** "Korean infra readers prefer English
  action verbs" is an opinionated default, not a universal claim. If
  user feedback flags Chrome-rule strings as confusing, revisit per
  surface — don't argue from the policy alone.

## Adding a new key

When you add a new i18n key:

1. Decide its register using the _Mechanical convention_ table above.
2. Add it to **both** `en.ts` and `ko.ts` in the same commit.
3. If the role is Chrome, the Korean value is the same English string.
4. If the role is Content **and you can write Korean**, write it by
   hand — do not run a machine translation pass. Cross-check against
   the Korean register guide.
5. If the role is Content **and you cannot write Korean**:
   - Copy the English string into `ko.ts`.
   - Prefix the Korean value with `[TODO-KO]` so it is obvious in
     review and in product (`[TODO-KO] Treat like a password — …`).
   - Label the PR `i18n-required` so the Korean polish pass is
     scheduled before release.

## Migration plan

Existing copy will be migrated screen-by-screen, **not in one large PR**.
Each migration PR scope:

1. One screen or one feature surface at a time.
2. Restate the chrome/content split inline in the PR body.
3. Touch both `en.ts` and `ko.ts` together in the same commit.
4. Run a CCG (Codex + Gemini) review pass for register questions.

Migration priority (audit accuracy: as of 2026-05-11, none of the items
below are merged — they are open PRs or pending work):

1. **AccountPopover, sidebar, primary nav.** PR #18 is open and applies
   Content rendering to `switchLanguage` / `changePassword` / `signOut`.
   This step finishes the Chrome conversion: those three keys should
   end up with the same English string in both locales.
2. **Setup wizard.** First impression for every new install. If the
   user picks Korean in step 1 and the next four steps still read
   English-only, the product feels unfinished. Smaller scope than the
   feature surfaces below, so it goes early.
3. **MCP / Your Agent.** PR #17 set a precedent for _descriptive_ copy
   (`passwordHint`, `setup.subtitle`, `restartHint`). The Chrome-side
   conversion (`Connected`, `Listening`, `Unreachable`, `Copy`,
   `Reveal`, `Hide`, `Regenerate`, `Setup`, `Copy config`) is still
   pending — that is a separate sweep on this namespace.
4. **Web Server.** Primary nav item with the largest current en/ko
   divergence (~64 keys at last count). High visibility, high value.
5. **Service detail and tabs** (Domains, Logs, Env, Resources, …).
6. **Project list, project detail, danger zone.**
7. **Activity feed.**
8. **Notifications.** Hidden from the v0.1 sidebar; lowest priority.

## Tooling gaps (planned, not in this PR)

- **`scripts/validate-i18n-keys.ts`** — verify `en.ts` and `ko.ts` have
  the same key tree, fail CI on missing keys. Today this is hand-
  reviewed; the rule is documented but not mechanized.
- **`scripts/grep-todo-ko.ts`** — block release if any `[TODO-KO]`
  prefixes remain unresolved in `ko.ts`.
- **Typed `register` tag.** A discriminated union (`{ value: string;
register: 'chrome' | 'content' }`) could make the chrome/content
  decision visible at the key-definition site. Not blocked on; the
  suffix heuristic above is what we use until then.

## Discoverability

The policy is referenced from:

- `CONTRIBUTING.md` — Internationalization section.
- `web/src/i18n/README.md` — short pointer that lives next to the
  translation files so the first person who tries to add a string
  finds it.

Update both when this doc moves or its name changes.

## Where this lives

This document is the policy. The actual strings live in
`web/src/i18n/{en,ko}.ts`. The `t()` helper, language toggle, and
`<html lang>` sync live in `web/src/i18n/context.tsx`. Setup wizard
language step is `web/src/components/setup/LanguageStep.tsx`. The
in-app switcher is the Globe row in
`web/src/components/account/AccountPopover.tsx`.
