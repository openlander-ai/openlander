# OpenLander 0.2 Roadmap

## 목표

0.2.0은 **Verified Failure Ticket**의 첫 beta를 출시한다.

0.1.x에서 안정화한 MCP 기반 배포/운영 경로 위에, OpenLander가 런타임
failure를 persisted ticket으로 만들고, 외부 coding agent가 MCP로 그
ticket을 읽어 수정한 뒤, OpenLander가 deterministic recovery receipt로
실제 복구 여부를 검증한다.

AI Ops Briefing Beta는 이 제품 계약의 구현 표면이다. LLM은 선택적
summary provider일 뿐이고, ticket 생성, action suggestion, verification은
deterministic rule이 소유한다.

제품 정의:

> OpenLander는 runtime failure를 MCP-readable ticket으로 만들고, coding
> agent가 그 ticket을 읽고 수정한 뒤, OpenLander가 deterministic recovery
> receipt로 실제 복구 여부를 검증한다. Web은 primary execution surface가
> 아니라 human inbox / audit / fallback surface다.

핵심 원칙:

- AI Ops는 기본 OFF다.
- LLM provider를 설정해도 AI Ops가 자동으로 켜지지 않는다.
- Project 단위로 `off | briefing`을 선택하고, Service는 `inherit | off | briefing`으로
  override할 수 있지만 기본 UX는 Project-level opt-in과 Project AI Ops feed를
  우선한다.
- classification, severity, suggested action은 deterministic rule이
  소유한다.
- LLM은 optional evidence summary만 담당한다.
- 자동 restart, redeploy, rollback, env edit은 제외한다.
- OpenLander는 built-in agent를 실행하지 않는다.
- detect / handoff / verify는 LLM을 호출하지 않는다.
- MCP agent가 web 없이 ticket을 찾고, evidence를 읽고, recovery receipt를
  보고할 수 있어야 한다.
- Telegram은 send-only 알림만 제공한다. Telegram inbound command는
  mutation으로 이어지지 않는다.

## 0.2 제품 계약

0.2의 중심 객체는 "브리핑 카드"가 아니라 **Failure Ticket**이다.

- Failure Ticket: persisted `ai_ops_briefings` row. Agent가
  `list_ai_ops_briefings` / `get_ai_ops_briefing`으로 발견하고 읽는 work item.
- Recovery Receipt: `diagnose_service(briefing_id)`가 반환하는 deterministic
  before/after verification result.
- `recovery_receipt.status="verified"`는 복구 신호다. `resolved`는 사람이
  명시적으로 누르는 ticket workflow 상태다.

OpenLander가 하지 않는 것:

- internal agent loop 실행
- repeated LLM loop 실행
- 자동 redeploy / rollback / env edit
- recovery receipt를 근거로 자동 resolve

자세한 release-scope lock은
[`V0_2_VERIFIED_FAILURE_TICKET_CONTRACT.md`](./V0_2_VERIFIED_FAILURE_TICKET_CONTRACT.md)를
따른다.

## 0.2.0 범위

### 1. Guardrail Baseline

먼저 기존 dormant AI Ops 경계가 살아있는지 고정한다.

- `RecoveryCoordinator.start()`는 app runtime에서 호출하지 않는다.
- `OpsAgent` runtime wiring은 켜지지 않는다.
- built-in chat/agent route는 재활성화하지 않는다.
- Telegram inbound webhook은 기본적으로 수신만 ack하고 작업을 실행하지
  않는다.
- 새 AI Ops MCP action은 `openlander_monitor` composite action 하위에만
  둔다.

### 2. Provider / Model / Usage Foundation

AI Ops ticket summary 전용 model profile을 추가한다.

- OpenAI-compatible provider와 Anthropic provider를 지원한다.
- provider secret은 기존 encryption helper를 재사용한다.
- `ai_ops_briefing` usage에는 provider, model, token, cost, project, service, ticket id를
  기록한다.
- provider configured 상태와 AI Ops enabled 상태를 분리한다.

#### 2.1 Provider Runtime Policy

0.2.0의 기본 LLM 상태는 **provider 없음**이다. Provider가 없으면 AI Ops는
deterministic briefing만 생성하고, LLM summary는 `skipped`로 남긴다.

공식 0.2 provider 범위:

| 구분                  | 0.2.0 정책                                     | 비고                                                                                                                                                      |
| --------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI-compatible     | provider를 연결할 때의 1순위 권장 API provider | OpenAI API, OpenRouter, 사내 OpenAI-compatible endpoint를 같은 경로로 다룬다. 0.2.0은 어떤 provider도 기본 활성화하지 않는다.                             |
| Anthropic API         | 공식 대안 provider                             | API key 기반만 지원한다.                                                                                                                                  |
| Gemini / 기타 API     | 0.2.x 후보                                     | 모델 품질과 비용을 별도 QA한 뒤 하나씩 추가한다.                                                                                                          |
| Local account runtime | 0.2.x 실험 후보, core 기본값 아님              | 사용자가 로컬에서 로그인한 도구는 optional provider package로 연결할 수 있다. 구독 계정 bridge는 provider 약관 검토와 명시적 동의 게이트 전까지 보류한다. |

Local account runtime 정책:

- OpenLander core는 ChatGPT/Claude subscription session token, browser cookie,
  refresh token을 직접 읽거나 저장하지 않는다.
- 로컬 계정 연동은 optional npm package가 dependency import 방식으로 담당한다.
  이 package loader는 0.2.0 release criteria가 아니라 0.2.x 실험 설계 의도다.
- 0.2.0 core는 API-key provider만 release criteria로 본다. Local runtime은
  별도 experimental track에서 검증한다.
- 기본 통합 방식은 HTTP port bridge가 아니라 **optional dependency import**다.
  필요 시 package 내부에서 CLI/SDK subprocess를 격리할 수 있지만,
  OpenLander product surface에는 포트를 요구하지 않는다.
- OpenLander는 provider 약관을 위반하는 구독 계정 자동화를 기본 제공하거나
  권장하지 않는다. Local runtime 사용은 provider 약관 검토와 사용자 책임
  확인을 거쳐야 한다.
- 모든 provider 호출은 local runtime을 포함해 evidence secret redaction 이후에만
  수행한다.
- Local runtime은 서버 설치와 팀 운영에는 권장 기본값이 아니다. 같은 host에
  로그인된 로컬 CLI가 있어야 하며, token/cost 계산이 불완전할 수 있다.
- Local runtime 실패는 LLM 실패와 동일하게 deterministic briefing fallback으로
  처리한다. 실패가 briefing 생성이나 notification을 막지 않는다.

즉, 0.2.0은 "API-key provider로 공식 지원, 로컬 계정 provider는 core 밖
optional runtime"을 기준으로 한다. 사용자가 provider를 연결하지 않아도 AI Ops
Beta의 deterministic value는 유지되어야 한다.

0.2.0 core release gate:

- provider API key 저장만으로 AI Ops가 켜지지 않는다.
- provider 미설정, provider 실패, local runtime 실패는 모두 deterministic
  briefing fallback으로 처리한다.
- LLM provider 호출 전 redaction이 적용된다.

### 3. Opt-In / Budget / Durable Dedupe

AI Ops 실행 정책은 명시 opt-in이다.

- Project mode: `off | briefing`
- Service override: `inherit | off | briefing`
- 기본값: Project `off`, Service `inherit`
- 기본 project limit: 20/day
- 기본 instance limit: 200/day
- 기본 fingerprint cooldown: 30분
- dedupe key: project + service/resource + incident fingerprint
- budget 초과 시 LLM summary만 생략하고 deterministic briefing은 유지한다.

### 4. Deterministic Briefing Core

OpenLander rule이 운영 증거를 정규화하고 Failure Ticket을 만든다.

Evidence pack:

- route health
- representative traffic
- deploy log
- container state
- restart count
- runtime incident

Ticket row는 deterministic summary, severity, classification,
diagnostic/suggested MCP call, evidence, optional LLM summary를 저장한다.
Suggested call은 기존 MCP action만 사용할 수 있고, 자동 mutation action을
제안하지 않는다.

Ticket 생성 기준은 alert threshold가 아니라 **agent actionability**다.

- agent가 read-only diagnostic을 시작할 수 있으면 ticket 후보가 될 수 있다.
- caller가 이미 동기적으로 받은 foreground deploy error는 ticket으로 만들지
  않는다.
- log-tail-only evidence는 ticket으로 만들지 않는다.
- self-healed container die는 ticket으로 만들지 않는다.
- ambiguous warning은 ticket으로 만들지 않는다. 의심스러우면 ticket을 만들지
  않는다.
- active restart-loop, representative-traffic failure, route/runtime mismatch,
  dependency failure처럼 agent가 structured diagnostic을 이어갈 수 있는 신호를
  우선한다.

### 5. Web / MCP Surface

MCP가 primary agent surface다. Web은 사람이 같은 queue를 보고 개입하는
inbox / audit / fallback surface다.

MCP:

- `openlander_monitor.list_ai_ops_briefings`
- `openlander_monitor.get_ai_ops_briefing`
- `openlander_monitor.diagnose_service` with `briefing_id`

Agent-primary happy path:

1. 사용자가 agent에게 "OpenLander에 열린 장애 있어?"라고 묻는다.
2. Agent가 `list_ai_ops_briefings(status="open", limit=10)`을 호출한다.
3. Agent가 선택한 ticket에 `get_ai_ops_briefing`을 호출한다.
4. Agent가 ticket의 `diagnostic_call` 또는 `suggested_call`을 따른다.
5. Fix 후 agent가 `diagnose_service({ service_id, briefing_id })`를 호출한다.
6. Agent가 `recovery_receipt.status`와 failed checks를 사용자에게 보고한다.

Web:

- Project AI Ops toggle
- Project AI Ops ticket feed
- Home AI Ops Inbox
- ticket detail dialog
- Open in Agent prompt as a convenience entry, not the primary execution path
- manual acknowledge / resolve
- token/cost 표시 for optional LLM summary

Service-level override exists in the policy model for future restricted /
contractor use, but the default v0.2 UX keeps service-level AI configuration out
of the main Service detail screen. Project Settings owns opt-in; Project AI Ops
and Home Inbox own reading and triage.

#### 5.1 AI Providers IA

LLM provider 설정은 Project 운영 화면이 아니라 instance-level 설정이다.
따라서 top-level Workspace 항목으로 두지 않고, sidebar의 Settings 섹션에
`AI Providers`를 추가한다.

권장 IA:

```text
Workspace
- Home
- Your Agent
- Projects
- Activity
- Monitoring
- Web Server

Settings
- Git Providers
- AI Providers
```

`AI Providers`는 OpenAI-compatible / Anthropic API key, model, baseURL
(OpenAI-compatible only), connection test를 관리한다. 이 화면에서 provider를
저장해도 Project AI Ops는 자동으로 켜지지 않는다.

책임 경계:

- `AI Providers`: instance에 LLM provider를 연결한다.
- Project `AI Ops Briefing`: 특정 Project에서 브리핑 생성을 opt in한다.
- Service override: backend policy model에 남아 있지만 기본 UX에서는 숨긴다.

Provider 미설정 상태에서도 Project AI Ops는 deterministic ticket을 만들 수
있다. LLM summary가 필요한 경우 `Settings -> AI Providers`로 이동하는 명확한
링크를 제공한다.

Web/API endpoint와 MCP action 추가는 freeze gate 대상이다. i18n은
`web/src/i18n/en.ts`와 `web/src/i18n/ko.ts`를 같은 PR에서 갱신한다.

### 6. LLM Summary

LLM은 ticket 설명만 담당한다.

- `aiOpsBriefing` model profile을 사용한다.
- prompt는 evidence 밖 원인, 존재하지 않는 action, remediation claim을
  금지한다.
- LLM 실패 시 deterministic template summary로 fallback한다.
- classification, severity, suggested call은 LLM 결과로 바꾸지 않는다.

### 7. Telegram Send-Only Notification

AI Ops briefing 알림은 Telegram 전용 send-only 경로로 시작한다.

- Project policy 또는 service override policy가 `briefing`일 때만 전송한다.
- durable fingerprint cooldown을 따른다.
- Telegram 미설정/미연결은 skip으로 처리한다.
- `broadcast` / `broadcastStructured` fanout을 쓰지 않아 Slack/Discord/email로
  새지 않는다.
- inbound Telegram update는 deploy/service/project mutation을 실행하지
  않는다.

### 8. Runtime Trigger Wiring

기존 passive monitor 신호를 ticket 생성 체인에 연결한다.

트리거는 자동 복구가 아니다. 이미 발생한 `health:degraded`,
`container:die`, `deploy:failed` 같은 신호를 evidence pack으로 정규화하고,
opt-in policy / budget / durable dedupe / actionability gate를 통과한 경우에만
ticket row를 쓴다.

실행 순서:

1. monitor signal 수신.
2. Project policy와 service override policy 확인. `off`면 종료.
3. deterministic ticket 후보 생성.
4. durable fingerprint cooldown 확인. 중복이면 종료.
5. budget 확인. 초과 시 LLM summary만 생략.
6. ticket row 저장.
7. LLM summary는 허용될 때만 시도하고 실패해도 deterministic ticket 유지.
8. Telegram send-only notification은 policy와 cooldown을 다시 존중한다.

이 트리거는 `RecoveryCoordinator`, `OpsAgent`, chat route, deploy/redeploy,
rollback, env edit을 호출하지 않는다.

Beta 한계: runtime trigger 귀속은 canonical service 우선이다. multi-Application
Project와 compose-child 단위 귀속, ticket escalation history, persisted receipt
history는 v0.2 이후 별도 개선한다.

## 0.2.x 후속 상태

0.2.0 final 이후에는 새 tool surface 확장보다 이미 들어간 Failure Ticket 경로의
가독성과 agent-primary acceptance를 우선한다. 다음 두 항목은 rc 후속 PR에서
코드 계약으로 닫혔고, 남은 일은 release QA와 demo 고정이다.

1. **Recovery Receipt readability** `[shipped, needs live QA]`
   - `diagnose_service(briefing_id)` 응답에서 status, `next_action`,
     `check_summary`, failed checks, latest deploy / serving-version mismatch가
     한눈에 보이게 한다.
   - Route 200만으로 verified라고 오해하지 않게 `route_health`,
     `container_status`, `restart_stability`, `latest_deploy` 체크를 분리한다.
   - `verified`는 signal이고 `resolved`는 human action이라는 문구를 Web/MCP
     양쪽에 유지한다.
2. **Agent-primary triage acceptance** `[shipped, needs live QA]`
   - Web button이 아니라 agent가 `list_ai_ops_briefings(status="open")`로
     시작하는 시나리오를 release QA에 고정한다.
   - `list` response는 tiny triage payload로 유지하고, full evidence는
     `get_ai_ops_briefing` detail read에 둔다.
   - Fix 후 agent가 `diagnose_service({ service_id, briefing_id })`로
     recovery receipt를 보고하는지 검증한다.
3. **60-second verified handoff demo**
   - 장애 생성 -> ticket 발견 -> agent diagnosis/fix -> recovery receipt report
     하나의 demo path를 고정한다.
   - 공개 카피는 경쟁사 비교 공격 대신 "OpenLander verifies fixes against
     runtime state"를 사용한다.

## 0.2.0에서 분리하는 작업

`Variables / Deployment Target / env-scope M1`은 AI Ops 0.2.0 rc 사슬에서
분리한다.

별도 milestone:

- target-aware env resolver
- interpolation validation
- scoped env write/read
- Deployment Target UI/API 정리
- `staging` reserved/future 유지

AI Ops PR에서는 env-scope resolver/policy 변경을 하지 않는다.

## 0.2.x Agent Handoff Scope Model

Open-in-Agent MVP는 토큰 없이 동작한다. #477 handoff prompt는 briefing id,
deterministic first call, suggested call, verification checklist를 제공하지만
plaintext token이나 short-lived token을 포함하지 않는다. 따라서 v0.2 출시에
새 token 권한 모델은 필요하지 않다.

현재 상태:

- Scope boundary는 #476에서 닫혔다. Multi-selector all-in-boundary와 적대 테스트가
  들어갔고, 새 selector를 추가할 때는 `AGENTS.md`의 MCP scope invariant를 따른다.
- Service-scoped token은 이미 있고, restricted/contractor mode로 보존한다.
- Environment는 0.2 표면에 없다. 0.2는 flat Deployment Target을 유지한다.
- Token-free handoff + verify-after-fix는 v0.2 AI Ops Beta 출시에 충분하다.

후속 token 모델은 세 축을 분리한다.

- **scope:** 토큰이 볼 수 있는 Project와 향후 Environment 경계.
- **capability:** 토큰이 할 수 있는 행위 종류. 처음에는 `read-only`와 `full` 두
  단계만 고려한다.
- **target:** action 실행 시 선택되는 실제 Service. Service는 기본 token scope가
  아니라 런타임 대상이다.

Capability 세분화는 필요해질 때 추가한다. 초기 목표는 "read-only 장애조사 토큰"이다.
`redeploy`, `rollback`, `env-edit`을 각각 세분화하는 4티어 모델은 지금 구현하지 않는다.
특히 `env-edit`은 `DATABASE_URL`, auth secret, feature flag, runtime behavior를 바꿀 수
있으므로 나중에도 별도 경고와 approval이 필요한 sensitive 권한으로 취급한다.

Environment가 나중에 제품 표면에 추가되면 기존 token의 권한이 조용히 all-env로 넓어지면
안 된다. Environment 도입 시 기존 Project token은 재발급을 요구하거나 explicit all-env로
명시 migration한다. `null` environment는 자동 all-env가 아니다.

Mutation auto-target 규칙은 보수적으로 둔다. Read-only 조회는 후보가 하나면
auto-resolve할 수 있지만, mutation은 후보가 하나여도 명시 확인을 요구한다. Production
redeploy, rollback, env edit은 "서비스가 하나니까 그냥 실행"하지 않는다.

Capability 컬럼, environment 필드, scope vocab 재정의는 vocab + data-model 변경이다.
구현할 때는 freeze gate(vocab review, endpoint-collision grep, debt-ledger entry)를
통과해야 한다. #480 자체는 docs-only라 freeze gate 대상이 아니다.

## 역할 분리

릴리즈 체인은 구현과 검증을 분리한다.

- 구현 owner: public repository 코드, 테스트, PR, rc 릴리즈를 담당한다.
- 리뷰/QA owner: PR 리뷰, AWS smoke, weak-model QA, internal QA report를
  담당한다.

리뷰/QA owner는 public repository code를 직접 수정하지 않는다. 수정이
필요하면 리뷰 finding으로 남기고, 구현 owner가 후속 PR에 반영한다.

## PR / RC 체인

| 단계     | 내용                                                   | RC              |
| -------- | ------------------------------------------------------ | --------------- |
| PR0      | Guardrail baseline                                     |                 |
| PR1      | Provider / model / usage foundation                    |                 |
| PR2      | Opt-in / budget / durable dedupe                       | `v0.2.0-rc.1`   |
| PR3      | Deterministic briefing core                            |                 |
| PR4      | Web / MCP briefing surface                             | `v0.2.0-rc.2`   |
| PR5      | LLM summary                                            | `v0.2.0-rc.3`   |
| PR6      | Telegram send-only notification                        |                 |
| PR7      | Runtime trigger wiring                                 | `v0.2.0-rc.4`   |
| Final RC | AWS full QA, weak-model QA, public docs, release notes | final candidate |

## Local Test Gate

각 PR은 최소 다음을 통과해야 한다.

```bash
npm run typecheck
npm run lint -- --quiet
npm run test:backend:release
git diff --check
```

변경 영역별 focused Vitest도 PR 본문에 명시한다.

## 필수 불변식

- AI Ops default OFF.
- Provider configured 상태만으로 AI Ops가 켜지지 않음.
- Provider가 없거나 실패해도 deterministic ticket은 생성됨.
- LLM provider 설정 UI는 `Settings -> AI Providers`에 있고, Project AI Ops
  opt-in과 분리됨.
- Local account runtime은 core가 subscription token/cookie를 읽지 않는 optional
  package 경계 밖 실험 기능으로 유지.
- `RecoveryCoordinator` / `OpsAgent` / built-in chat route dormant 유지.
- 자동 restart / redeploy / rollback / env edit 없음.
- Telegram inbound webhook은 mutation을 실행하지 않음.
- LLM 실패는 deterministic ticket 생성을 막지 않음.
- runtime trigger는 Project/Service policy, budget, durable dedupe를 적용함.
- MCP response는 기존 contract helper만 사용.
- 새 AI Ops MCP action은 `openlander_monitor` 하위에만 위치.
- Web/API endpoint 추가 시 freeze gate를 통과.

## AWS Smoke

각 rc에서 다음을 확인한다.

1. exact rc 설치/업그레이드.
2. MCP connection 확인.
3. Provider만 설정했을 때 AI Ops OFF 확인.
4. `Settings -> AI Providers`에서 provider 연결/connection test 확인.
5. Project AI Ops ON.
6. route failure 또는 restart-loop 유발.
7. Failure Ticket 생성 확인.
8. MCP ticket 조회 확인.
9. Telegram send-only notification 확인.
10. 동일 fingerprint 재발 시 cooldown 확인.
11. 자동 mutation이 발생하지 않았는지 확인.
12. `diagnose_service(briefing_id)`가 recovery receipt를 반환하는지 확인.

### AWS Web UI Smoke

AI Ops Web UI는 rc smoke에서 브라우저로도 확인한다.

1. Project detail/settings 화면에서 AI Ops 카드가 보이고 기본값이 `Off`인지
   확인한다.
2. Sidebar Settings 섹션에 `AI Providers`가 있고, provider 저장과 connection
   test가 가능한지 확인한다.
3. Provider만 설정한 상태에서는 Project AI Ops가 자동으로 켜지지 않는지
   확인한다.
4. Project mode를 `Briefing`으로 바꾸고 새로고침 후에도 저장되는지
   확인한다.
5. Service detail에 기본 AI configuration tab이 노출되지 않는지 확인한다.
6. route failure 또는 restart-loop 유발 후 Home Inbox와 Project AI Ops에
   ticket이 생성되는지 확인한다.
7. Home AI Ops Inbox와 Project AI Ops tab에 같은 briefing이 보이고 status
   filter가 동작하는지 확인한다.
8. ticket detail dialog에서 severity, classification, summary, token/cost,
   diagnostic/suggested MCP call, evidence, after-fix verification prompt가 보이는지 확인한다.
9. evidence와 summary에 token, API key, database password 같은 secret이
   노출되지 않는지 확인한다.
10. 언어를 en/ko로 전환했을 때 깨진 i18n key가 없는지 확인한다.
11. Web UI 조작만으로 restart, redeploy, rollback, env edit이 실행되지
    않는지 확인한다.

## Weak-Model QA

PR5 이후 weak-model QA를 시작한다.

필수 케이스:

- route failure
- dependency failure
- restart-loop
- bad deploy preserved by blue-green

성공 기준:

- 모델이 자동 mutation을 시도하지 않는다.
- ticket의 diagnostic/suggested call을 올바르게 식별한다.
- evidence 밖 원인을 지어내지 않는다.
- 사용자 입력이 필요하면 멈추고 요청한다.
- fix 후 recovery receipt를 확인하고 `verified`, `needs_attention`, `unknown`을
  구분해 보고한다.

## Final AWS Full QA

최종 rc에서만 전체 QA를 실행한다.

- D1 managed-deps deploy 정상.
- D2 route failure briefing.
- D2 dependency failure briefing.
- D3 bad deploy with blue-green old version preserved.
- D4 honesty:
  - lying health
  - no healthcheck + traffic 500
  - late crash / restart loop
- AI Ops OFF baseline.
- deterministic briefing.
- LLM summary.
- Telegram notification.
- budget / cooldown.
- archived project noise 없음.
- legacy `RecoveryCoordinator` / `OpsAgent` 미가동 확인.
- Weak-model QA pass.

## Release Criteria

0.2.0은 다음 조건을 만족할 때 final로 승격한다.

- AI Ops가 보이지만 기본 OFF다.
- Provider setup만으로 AI Ops가 실행되지 않는다.
- Project ON 상태에서 deterministic Failure Ticket이 생성된다.
- OpenAI-compatible과 Anthropic provider로 LLM summary가 동작한다.
- Provider 미설정 또는 provider 실패 상태에서도 deterministic ticket fallback이 동작한다.
- LLM 실패가 clean fallback으로 처리된다.
- token/cost usage가 기록된다.
- Telegram send-only notification이 동작한다.
- duplicate incident가 durable cooldown으로 dedupe된다.
- Telegram inbound가 command를 실행하지 않는다.
- 자동 remediation이 없다.
- MCP agent가 ticket과 diagnostic/suggested call을 조회할 수 있다.
- MCP agent가 `diagnose_service(briefing_id)`로 recovery receipt를 조회할 수 있다.
- Recovery receipt `verified`는 자동 `resolved` 전환을 만들지 않는다.
- Web i18n en/ko parity가 통과한다.
- weak model이 ticket에서 올바른 next MCP action을 고를 수 있다.
- AWS full QA가 통과한다.
