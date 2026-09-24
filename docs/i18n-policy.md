# i18n Copy Policy

OpenLander ships in English and Korean. Every user-facing string must make the
current task understandable without requiring the reader to translate product
terminology in their head.

## Core rule

> **Localize the user's task, not every English token. Keep established developer
> terms when Korean wording would be less precise or harder to scan.**

Menus, buttons, tabs, headings, form labels, table headings, status labels,
empty states, errors, tooltips, and accessibility labels all express their
meaning in the selected locale. A Korean sentence may still contain familiar
developer terms such as `API`, `MCP`, `런타임`, `엔드포인트`, `브랜치`, `커밋`,
`릴리스`, `QA`, and `Dockerfile`. Internal API fields, database values, MCP
action names, log payloads, and source-code identifiers do not change when
display copy changes.

Both `web/src/i18n/en.ts` and `web/src/i18n/ko.ts` must keep the same key tree.
Components must call `t()` instead of embedding user-facing fallback copy.

## What stays in its original spelling

Keep vendor names, protocols, formats, and values users must copy or compare
with logs:

`OpenLander`, `MCP`, `Docker`, `Docker Compose`, `Traefik`, `GitHub`,
`GitLab`, `Bitbucket`, `Postgres`, `Redis`, `MinIO`, `Kubernetes`, `OAuth`,
`PAT`, `API`, `CLI`, `CI`, `URL`, `HTTP`, `HTTPS`, `DNS`, `TLS`, `JSON`,
`YAML`, `SQL`, `CPU`, `RAM`, `ID`, `SHA-256`, environment-variable names,
container/image names, Git branches, commit hashes, error codes, and MCP action
names.

An English word is not exempt merely because it is common in the source code.
Generic product nouns and actions must be localized:

| English     | Korean       |
| ----------- | ------------ |
| Project     | 프로젝트     |
| Application | 애플리케이션 |
| Resource    | 리소스       |
| Database    | 데이터베이스 |
| Cache       | 캐시         |
| Storage     | 스토리지     |
| Save        | 저장         |
| Cancel      | 취소         |
| Delete      | 삭제         |
| Copy        | 복사         |
| Settings    | 설정         |
| Activity    | 활동         |
| Monitoring  | 모니터링     |
| Deployment  | 배포         |
| Log         | 로그         |

## Korean writing guide

- Write for the action the user is taking now.
- Prefer familiar words over internal architecture terms.
- Keep established developer terms when translating them would reduce precision. Terms such as
  `런타임`, `엔드포인트`, `브랜치`, `커밋`, `릴리스`, and `Dockerfile` are acceptable in the
  deployment interface.
- Use `저장소`, `보관`, `재배포`, and `미리보기` consistently. Do not alternate them with
  `레포지토리`, `아카이브`, `리디플로이`, or `프리뷰` in the same product surface.
- Use one idea per sentence.
- Use `~합니다` for explanations and `~하세요` for instructions.
- Use short noun labels for fields and short verbs for buttons.
- Let the product speak as `OpenLander`; avoid first-person product copy such as `제가 처리합니다`.
- Translate stable wire values through their display keys. Do not render raw status values,
  server-generated English event titles, or API error prose as Korean UI copy.
- Replace abstract claims with consequences:
  - Avoid: `영구적 삭제 작업이 수행되었습니다.`
  - Prefer: `서비스를 삭제했습니다. 데이터 볼륨은 남아 있습니다.`
- Explain unavoidable identifiers:
  - Avoid: `논리 키`
  - Prefer: `서비스 식별자`
- Avoid mixed-language phrases when a natural Korean expression exists:
  - Avoid: `Project runtime 오류`
  - Prefer: `프로젝트 실행 오류`

Brand and protocol names may appear naturally inside Korean sentences. Do not
transliterate `GitHub`, `Docker`, or `MCP`.

## Adding or changing copy

1. Add the key to both locale files.
2. Write the Korean copy for the user outcome, not as a word-for-word
   translation.
3. Route visible component text and accessibility labels through `t()`.
4. Keep placeholders and interpolation variables identical across locales.
5. Run the i18n validation and the focused screen tests.
6. Inspect the Korean screen at the relevant empty, success, error, and
   destructive-confirmation states.

If a contributor cannot provide reviewed Korean copy, use `[TODO-KO]` so the
release validation fails visibly. Do not silently copy the English sentence
into `ko.ts`.

## Release checks

The release gate must verify:

- English and Korean key-tree parity.
- Matching interpolation placeholders.
- No `[TODO-KO]` markers.
- No newly hardcoded user-facing strings in migrated surfaces.
- No unapproved English-only or mixed-language Korean copy.
- Keyboard and screen-reader labels use the active locale.

Allowlisted technical names are not localization failures. The allowlist must
stay narrow and reviewed; it must not become a second English-interface policy.
