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

## FDE delivery vocabulary

The following labels are the canonical Korean display terms. Internal entity
names and API fields remain unchanged.

| Internal name        | Korean display term | Meaning                                                                |
| -------------------- | ------------------- | ---------------------------------------------------------------------- |
| Engagement           | 고객 과제           | A customer outcome or initiative grouping related Projects             |
| Engagement Portfolio | 고객 과제 현황      | Cross-project view for FDE work                                        |
| Delivery             | 납품 건             | One reviewable and finalizable delivery unit                           |
| Delivery Workspace   | 납품 관리           | Area for preparing and confirming deliveries                           |
| Receipt              | 납품 확인서         | Final evidence PDF for a Delivery                                      |
| Recovery Receipt     | 복구 검증 결과      | Deterministic verification after incident recovery                     |
| Artifact             | 산출물              | File or report included in a Delivery                                  |
| Gate                 | 통과 기준           | Required or optional quality/review condition                          |
| Blocker              | 진행을 막는 항목    | Condition preventing a Delivery from progressing                       |
| Work Item            | 검토 항목           | Decision, question, or requested change                                |
| Maturity             | 납품 단계           | Readiness stage shown to users                                         |
| Runtime health       | 실행 상태           | Current runtime condition                                              |
| Revision             | 버전                | Version of an artifact                                                 |
| Evidence             | 근거 자료           | Information supporting a decision or result                            |
| Recipe               | 자동 복구 규칙      | Internal known-error recovery rule; do not expose as a primary UI noun |

Do not force one Korean word onto unrelated concepts. In particular,
`Delivery Receipt` is `납품 확인서`, while `Recovery Receipt` is
`복구 검증 결과`.

## Korean writing guide

- Write for the action the user is taking now.
- Prefer familiar words over internal architecture terms.
- Keep established developer terms when translating them would reduce precision. Terms such as
  `런타임`, `엔드포인트`, `브랜치`, `커밋`, `릴리스`, and `Dockerfile` are acceptable in the
  FDE interface.
- Use `저장소`, `보관`, `재배포`, and `미리보기` consistently. Do not alternate them with
  `레포지토리`, `아카이브`, `리디플로이`, or `프리뷰` in the same product surface.
- Use one idea per sentence.
- Use `~합니다` for explanations and `~하세요` for instructions.
- Use short noun labels for fields and short verbs for buttons.
- Let the product speak as `OpenLander`; avoid first-person product copy such as `제가 처리합니다`.
- Translate stable wire values through their display keys. Do not render raw status values,
  server-generated English event titles, or API error prose as Korean UI copy.
- Replace abstract claims with consequences:
  - Avoid: `불변 Receipt가 확정되었습니다.`
  - Prefer: `납품 확인서가 확정되어 더 이상 변경할 수 없습니다.`
- Explain unavoidable identifiers:
  - Avoid: `논리 키`
  - Prefer: `산출물 식별자`
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
