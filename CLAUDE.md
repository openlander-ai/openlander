# CLAUDE.md

Behavioral guidelines for Claude Code agents working in this repository.

These rules **add to** Claude Code's built-in system prompt; they do not repeat it. Topics
already covered by the system prompt — simplicity, no unrequested features, no comments by
default, no premature abstraction, no adjacent-code "improvements", no error handling for
impossible scenarios — are intentionally omitted.

## 1. Surgical Changes

- Every changed line should trace back to the user's request or to keeping the touched
  code compiling. If you can't justify a line, remove it.
- When your changes create orphans, remove the imports / variables / functions / tests
  that **your own change** made unused. Do **not** remove pre-existing dead code unless
  explicitly asked — flag it instead.
- If you notice unrelated dead code or a separate bug, mention it. Do not fix it silently.

## 2. Conflicts and Scope

- If a request conflicts with repo policy below, name the conflict and propose the
  smallest policy-compatible alternative before editing.
- Prefer narrow PRs. Bundling is acceptable only when splitting would create more churn
  than review surface (typically: in-area refactors) — confirm with the user in those
  cases rather than assuming.

## 3. Verification carve-outs

- UI / behavior changes: the system prompt already requires a dev-server check. Honor it.
- Docs / config / copy-only changes: verify by reading the diff — **except** when
  touching any i18n key in `web/src/i18n/{en,ko}.ts`. Those need a `grep` over `test/`
  for snapshot tests pinning the key (release gate fails otherwise — cf. PR #116, where
  `test/web/mcp-your-agent-surface.test.ts` snapshotted a Korean title).
- Bugs: reproduce with a failing test when the cost is reasonable.

## 4. This repository — facts you cannot infer from the code

- **Remotes**: check `git remote -v` before any `push` or `gh pr create`. In this
  workspace, `public` is the intended GitHub remote (`github.com/openlander-ai/openlander`)
  and `origin` may point to an archived private repo; do not push to a private remote
  unless explicitly instructed.
- **Two-repo model**: code and public docs live here. Internal planning, QA notes, and
  scratch live in a sibling private repo `openlander-internal`. Do not add new `.omc/`
  planning or scratch artifacts to public commits.
- **i18n PR rule**: `web/src/i18n/en.ts` and `ko.ts` are edited in the same PR
  (patch-only mode was rescinded 2026-05-06 for v0.1).
- **i18n chrome convention**: section card titles, nav labels, and link affordances
  like "View all" / "Full timeline" stay English in both locales. Subtitles, empty
  states, hints, and body copy are translated.
- **Data-model freeze (1.0 → 1.1)**: any new deployable-touching MCP action or REST
  route needs a vocab review, an endpoint-collision grep, and a debt-ledger entry
  before landing.
- **Commit prefixes**: follow the existing log shape — `fix(web): …`, `feat(web): …`,
  `test(web): …`, `fix(monitor): …`. Subject in imperative; body explains _why_, not
  _what_.
- **Branding**: a rename may happen later. Avoid introducing unnecessary new hardcoded
  "OpenLander" strings in user-facing code; reuse existing vocabulary and constants where
  practical.
- **Positioning**: this is an agent-first PaaS. The MCP surface is the primary
  interface; the web UI exists for humans to observe and intervene. Frame IA and
  feature decisions accordingly.

## 5. PR review delivery

When asked to review a PR, return the review in chat only. Do not run `gh pr review`
unless explicitly told to post. Reviews skip positive findings — lead with a one-line
verdict, then findings and fixes only.
