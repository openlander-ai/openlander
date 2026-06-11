# OpenLander 0.2 Roadmap

## 목표

0.2.0은 **AI Ops Briefing Beta**를 출시한다.

0.1.x에서 안정화한 MCP 기반 배포/운영 경로 위에, OpenLander가 런타임
증거를 모아 사람이 읽기 쉬운 운영 브리핑으로 정리한다. 이 릴리스의
AI는 조치 실행자가 아니라 **요약자**다.

핵심 원칙:

- AI Ops는 기본 OFF다.
- LLM provider를 설정해도 AI Ops가 자동으로 켜지지 않는다.
- Project 단위로 `off | briefing`을 선택하고, Service는 `inherit | off |
briefing`으로 override한다.
- classification, severity, suggested action은 deterministic rule이
  소유한다.
- LLM은 evidence 요약만 담당한다.
- 자동 restart, redeploy, rollback, env edit은 제외한다.
- MCP agent가 브리핑만 읽고 다음 확인 action을 고를 수 있어야 한다.
- Telegram은 send-only 알림만 제공한다. Telegram inbound command는
  mutation으로 이어지지 않는다.

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

AI Ops briefing 전용 model profile을 추가한다.

- OpenAI-compatible provider와 Anthropic provider를 지원한다.
- provider secret은 기존 encryption helper를 재사용한다.
- `ai_ops_briefing` usage에는 provider, model, token, cost, project,
  service, briefing id를 기록한다.
- provider configured 상태와 AI Ops enabled 상태를 분리한다.

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

OpenLander rule이 운영 증거를 정규화하고 브리핑을 만든다.

Evidence pack:

- route health
- representative traffic
- deploy log
- recent log tail
- container state
- restart count
- runtime incident

Briefing row는 deterministic summary, severity, classification,
suggested MCP call, evidence, optional LLM summary를 저장한다. Suggested
call은 기존 MCP action만 사용할 수 있고, 자동 mutation action을 제안하지
않는다.

### 5. Web / MCP Surface

사람과 MCP agent가 브리핑을 읽을 수 있게 한다.

MCP:

- `openlander_monitor.list_ai_ops_briefings`
- `openlander_monitor.get_ai_ops_briefing`

Web:

- Project AI Ops toggle
- Service override
- Briefing card
- Briefing detail drawer
- token/cost 표시

Web/API endpoint와 MCP action 추가는 freeze gate 대상이다. i18n은
`web/src/i18n/en.ts`와 `web/src/i18n/ko.ts`를 같은 PR에서 갱신한다.

### 6. LLM Summary

LLM은 브리핑 설명만 담당한다.

- `aiOpsBriefing` model profile을 사용한다.
- prompt는 evidence 밖 원인, 존재하지 않는 action, remediation claim을
  금지한다.
- LLM 실패 시 deterministic template summary로 fallback한다.
- classification, severity, suggested call은 LLM 결과로 바꾸지 않는다.

### 7. Telegram Send-Only Notification

AI Ops briefing 알림은 Telegram 전용 send-only 경로로 시작한다.

- Project/Service AI Ops policy가 `briefing`일 때만 전송한다.
- durable fingerprint cooldown을 따른다.
- Telegram 미설정/미연결은 skip으로 처리한다.
- `broadcast` / `broadcastStructured` fanout을 쓰지 않아 Slack/Discord/email로
  새지 않는다.
- inbound Telegram update는 deploy/service/project mutation을 실행하지
  않는다.

### 8. Runtime Trigger Wiring

마지막으로 기존 passive monitor 신호를 briefing 생성 체인에 연결한다.

트리거는 자동 복구가 아니다. 이미 발생한 `health:degraded`,
`container:die`, `deploy:failed` 같은 신호를 evidence pack으로 정규화하고,
opt-in policy / budget / durable dedupe를 통과한 경우에만 briefing row를
쓴다.

실행 순서:

1. monitor signal 수신.
2. Project/Service AI Ops policy 확인. `off`면 종료.
3. deterministic briefing 후보 생성.
4. durable fingerprint cooldown 확인. 중복이면 종료.
5. budget 확인. 초과 시 LLM summary만 생략.
6. briefing row 저장.
7. LLM summary는 허용될 때만 시도하고 실패해도 deterministic briefing 유지.
8. Telegram send-only notification은 policy와 cooldown을 다시 존중한다.

이 트리거는 `RecoveryCoordinator`, `OpsAgent`, chat route, deploy/redeploy,
rollback, env edit을 호출하지 않는다.

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
- `RecoveryCoordinator` / `OpsAgent` / built-in chat route dormant 유지.
- 자동 restart / redeploy / rollback / env edit 없음.
- Telegram inbound webhook은 mutation을 실행하지 않음.
- LLM 실패는 deterministic briefing 생성을 막지 않음.
- runtime trigger는 Project/Service policy, budget, durable dedupe를 적용함.
- MCP response는 기존 contract helper만 사용.
- 새 AI Ops MCP action은 `openlander_monitor` 하위에만 위치.
- Web/API endpoint 추가 시 freeze gate를 통과.

## AWS Smoke

각 rc에서 다음을 확인한다.

1. exact rc 설치/업그레이드.
2. MCP connection 확인.
3. Provider만 설정했을 때 AI Ops OFF 확인.
4. Project AI Ops ON.
5. route failure 또는 restart-loop 유발.
6. Web briefing 생성 확인.
7. MCP briefing 조회 확인.
8. Telegram send-only notification 확인.
9. 동일 fingerprint 재발 시 cooldown 확인.
10. 자동 mutation이 발생하지 않았는지 확인.

## Weak-Model QA

PR5 이후 weak-model QA를 시작한다.

필수 케이스:

- route failure
- dependency failure
- restart-loop
- bad deploy preserved by blue-green

성공 기준:

- 모델이 자동 mutation을 시도하지 않는다.
- briefing의 suggested call을 올바르게 식별한다.
- evidence 밖 원인을 지어내지 않는다.
- 사용자 입력이 필요하면 멈추고 요청한다.

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
- Project ON 상태에서 deterministic briefing이 생성된다.
- Service override가 동작한다.
- OpenAI-compatible과 Anthropic provider로 LLM summary가 동작한다.
- LLM 실패가 clean fallback으로 처리된다.
- token/cost usage가 기록된다.
- Telegram send-only notification이 동작한다.
- duplicate incident가 durable cooldown으로 dedupe된다.
- Telegram inbound가 command를 실행하지 않는다.
- 자동 remediation이 없다.
- MCP agent가 briefing과 suggested call을 조회할 수 있다.
- Web i18n en/ko parity가 통과한다.
- weak model이 briefing에서 올바른 next MCP action을 고를 수 있다.
- AWS full QA가 통과한다.
