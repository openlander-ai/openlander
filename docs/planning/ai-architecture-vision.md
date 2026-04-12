# AI-First 인프라 플랫폼 — 아키텍처 비전

**작성일**: 2026-03-27
**최종 업데이트**: 2026-03-28 (Phase 1 구현 상태 반영)
**상태**: 비전 문서 (구현 스펙 아님) — Phase 1 핵심 항목 구현 완료
**대상 버전**: v1.0 이후 중장기 방향

---

## 1. 비전

### 우리가 만들려는 것

> **"AI한테 인프라를 시킬 수 있는 최초의 플랫폼"**

Coolify는 훌륭한 제품이다. 6년, 52k stars, 검증된 UI 기반 셀프호스팅. 하지만 Coolify의 핵심 가정은 "사람이 UI를 조작한다"는 것이다. 폼을 채우고, 버튼을 누르고, 로그를 읽고, 설정을 바꾼다.

OpenLander의 핵심 가정은 다르다. **"AI가 인프라를 다룬다."**

코딩 에이전트(Cursor, Claude Code)가 MCP로 배포를 지시하고, 웹 에이전트가 브라우저에서 대화로 인프라를 관리하고, 백그라운드 AI가 장애를 감지해서 스스로 복구한다. 사람은 결과를 확인하고, 이상한 게 있으면 개입한다.

이건 Coolify의 복잡한 UI를 AI 대화로 대체하는 게 아니다. 인프라 관리의 패러다임 자체를 바꾸는 것이다.

### 경쟁 제품 비교

| 항목               | Coolify             | Vercel              | OpenLander               |
| ------------------ | ------------------- | ------------------- | ------------------------ |
| 핵심 인터페이스    | Web UI (폼, 버튼)   | Web UI (관리형)     | AI Agent (MCP + 웹 채팅) |
| 빌드 실패 시       | 로그 읽고 직접 수정 | 로그 읽고 직접 수정 | AI가 분석하고 자동 수정  |
| 컨테이너 크래시 시 | 알림 받고 직접 대응 | 알림 받고 직접 대응 | AI가 감지하고 복구 시도  |
| 코딩 에이전트 연동 | 없음                | 없음                | MCP 프로토콜 (60+ 도구)  |
| 호스팅 방식        | 셀프호스팅          | 관리형 클라우드     | 셀프호스팅               |
| 비용               | 서버 비용만         | $20+/월/서비스      | 서버 비용 + LLM API 비용 |
| 설치               | docker compose      | 없음 (SaaS)         | npm i -g                 |

### 도메인 특화 AI가 범용 AI를 이기는 영역

Cursor나 Claude Code 같은 범용 코딩 에이전트는 강력하다. 하지만 인프라 도메인에서는 OpenLander의 특화 AI가 더 잘할 수 있는 영역이 있다.

**배포 히스토리 기억**: "이 프로젝트는 Node 18에서 3번 빌드 실패했다. Node 20으로 바꿔야 한다." 범용 AI는 이 맥락을 모른다. OpenLander는 DB에 저장된 패턴을 안다.

**실시간 서버 상태 인지**: 현재 어떤 컨테이너가 돌고 있는지, 포트가 어디 쓰이는지, Traefik 라우팅이 어떻게 설정됐는지. 범용 AI는 물어봐야 안다. OpenLander는 항상 알고 있다.

**위험도 판단**: "이 배포는 DB 마이그레이션을 포함한다. 롤백이 어렵다. 확인이 필요하다." 범용 AI는 이 판단을 내리기 어렵다. OpenLander는 배포 히스토리와 서버 상태를 보고 판단한다.

**패턴 학습**: Next.js 프로젝트들이 공통으로 겪는 빌드 실패 패턴, FastAPI 프로젝트의 전형적인 환경변수 누락 패턴. 이런 도메인 지식은 범용 AI보다 특화 AI가 더 빠르게 적용한다.

---

## 2. 아키텍처

### 현재 상태 (v1.0.0-rc.5 → v1.0 Phase 1 구현 완료)

현재 코드베이스에 있는 것들:

```
AppContext (src/app.ts)
  ├── Pipeline (deploy, compose, blue-green, rollback)
  ├── Docker (dockerode 기반)
  ├── Traefik (라우팅 관리)
  ├── Database (Drizzle ORM + SQLite)
  │     ├── ai_usage_log 테이블 (토큰/비용 기록)           ← Phase 1 구현 완료
  │     └── action_runs 테이블 (복구 작업 추적)             ← Phase 1 구현 완료
  ├── AgentPool (src/llm/agent-pool.ts)                     ← Phase 1 구현 완료
  │     ├── 세션별 Agent 인스턴스 분리 (MAX_POOL_SIZE=5)
  │     └── idle timeout 기반 자동 정리
  ├── Context Assembler (src/llm/context-assembler.ts)      ← Phase 1 구현 완료
  │     ├── 프로젝트 상태 + 서버 상태 + 최근 배포 히스토리
  │     └── Memory Store 조회는 Phase 2에서 추가 예정
  ├── Transparency Layer (src/llm/transparency.ts)          ← Phase 1 구현 완료
  │     ├── PRICING_TABLE (모델별 토큰 단가)
  │     ├── calculateCost() + extractUsageFromResult()
  │     └── logAiUsage() → ai_usage_log DB 기록
  ├── ApprovalGate (src/pipeline/approval-gate.ts)          ← Phase 1 구현 완료
  │     ├── in-memory Promise 기반 승인 대기
  │     ├── approve() / reject() / waitForApproval()
  │     └── 10분 타임아웃 자동 거부
  ├── ToolDef Hub (src/tools/defs/)
  │     ├── 14개 카테고리, 60+ 도구
  │     ├── MCP 어댑터 (src/tools/adapters/mcp.ts)
  │     └── AI SDK 어댑터 (src/tools/adapters/ai-sdk.ts)
  ├── EventBus (40+ 이벤트 타입)
  ├── HealthMonitor + AlertMonitor
  ├── AutoRecovery (src/pipeline/auto-recovery.ts)          ← Phase 1 안정화 완료
  │     ├── 레시피 기반 fast-path (20+ 패턴)
  │     ├── LLM fallback + gate checks
  │     └── 고위험 도구 감지 → ApprovalGate 연동
  ├── AI Usage API (src/web/api/ai-usage-routes.ts)         ← Phase 1 구현 완료
  │     ├── GET /api/usage/summary (토큰/비용 집계)
  │     └── GET /api/usage/recent (최근 AI 호출 로그)
  ├── Approval API (src/web/api/approval-routes.ts)         ← Phase 1 구현 완료
  │     ├── GET /api/approvals/pending
  │     ├── POST /api/projects/:id/recovery/approve
  │     └── POST /api/projects/:id/recovery/reject
  └── AI Settings (config + API + UI)                       ← Phase 1 구현 완료
        ├── 7개 AI 기능 토글 (autoRecovery, buildDebugger 등)
        ├── AI Usage Dashboard (StatCard 4개 + 최근 호출 리스트)
        └── Approval Banner (폴링 기반 승인 알림 배너)
```

**남은 Agent 한계 (Phase 2+ 에서 해결)**:

- ~~히스토리가 메모리에만 있다. 서버 재시작하면 사라진다.~~ → chat_sessions 테이블 존재, Phase 2에서 확장
- ~~모든 세션이 같은 Agent 인스턴스를 공유한다.~~ → ✅ AgentPool로 세션별 분리 완료
- ~~위험도 판단 없이 도구를 실행한다.~~ → ✅ 자동복구 시 고위험 도구(4종) 승인 게이트 적용 완료. 전체 Decision Engine은 Phase 2-3
- ~~토큰 사용량을 기록하지 않는다.~~ → ✅ ai_usage_log 테이블 + transparency.ts로 전체 기록 + 대시보드 제공
- 과거 배포 패턴을 기억하지 않는다. 같은 실수를 반복할 수 있다. → Phase 2 Memory Store에서 해결

### 목표 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                    진입점 (Entry Points)                      │
│                                                              │
│  Cursor / Claude Code  →  MCP 프로토콜                       │
│  웹 브라우저           →  Web Agent Chat (NDJSON 스트리밍)    │
│  웹 UI                 →  Hono REST API (버튼, 폼)           │
│  CLI                   →  Commander                          │
│  Slack / Discord       →  Channel Manager                    │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                  AI Agent Layer (신규)                        │
│                                                              │
│  ┌─────────────────┐    ┌──────────────────────────────┐    │
│  │  Decision Engine │    │       Memory Store           │    │
│  │                  │    │                              │    │
│  │  - 위험도 분류   │    │  deployment_patterns 테이블  │    │
│  │    Low / Med / High   │  - 프로젝트별 빌드 패턴      │    │
│  │  - 자동 실행     │    │  - 실패/성공 히스토리        │    │
│  │  - 알림 후 실행  │    │  - 환경변수 추론 패턴        │    │
│  │  - 승인 필요     │    │                              │    │
│  └─────────────────┘    │  agent_sessions 테이블        │    │
│                          │  - 대화 히스토리 영속화       │    │
│  ┌─────────────────┐    │  - 세션별 컨텍스트            │    │
│  │ Action Executor  │    └──────────────────────────────┘    │
│  │                  │                                        │
│  │  - 다단계 실행   │    ┌──────────────────────────────┐    │
│  │  - 롤백 포인트   │    │    Transparency Layer        │    │
│  │  - 실행 검증     │    │                              │    │
│  └─────────────────┘    │  - 토큰 사용량 기록           │    │
│                          │  - 비용 추적 ($/호출)         │    │
│                          │  - AI 액션 타임라인           │    │
│                          │  - 승인 게이트                │    │
│                          └──────────────────────────────┘    │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                  ToolDef Hub (60+ 도구)                       │
│                                                              │
│  MCP 어댑터 (src/tools/adapters/mcp.ts)                      │
│  AI SDK 어댑터 (src/tools/adapters/ai-sdk.ts)                │
│                                                              │
│  deploy / compose / env / git / infra / monitoring /         │
│  project-ops / service / volume / webhook / debug ...        │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                  Infrastructure Layer                         │
│                                                              │
│  Pipeline  |  Docker  |  Traefik  |  Database (SQLite)       │
│  Monitor   |  Events  |  Webhook  |  Cloudflare              │
└─────────────────────────────────────────────────────────────┘
```

### 핵심 설계 결정

**ToolDef가 허브다.** 모든 진입점(MCP, 웹 에이전트, CLI, 채널)이 같은 ToolDef를 호출한다. 도구 로직을 한 곳에서 관리하고, 어댑터만 바꾸면 어느 채널에서든 쓸 수 있다. 이 구조는 이미 있다. 건드리지 않는다.

**AI Agent Layer는 ToolDef 위에 위치한다.** 도구를 직접 실행하는 게 아니라, 도구를 조합하고 판단하는 "뇌" 역할이다. "이 도구를 실행해도 되는가?", "어떤 순서로 실행해야 하는가?", "실패하면 어떻게 복구하는가?"를 결정한다.

**Memory Store는 SQLite 테이블로 구현한다.** 별도 벡터 DB나 외부 서비스 없이, 이미 있는 SQLite에 `deployment_patterns`와 `agent_sessions` 테이블을 추가한다. 단순하고, 오프라인에서 동작하고, 백업이 쉽다.

**Decision Engine은 위험도 기반 분기다.** 모든 AI 액션을 세 단계로 분류한다:

- Low risk: 자동 실행 (env var 추가, 로그 조회)
- Medium risk: 알림 후 자동 실행 (재배포, 컨테이너 재시작)
- High risk: 유저 승인 필요 (롤백, DB 변경, 프로젝트 삭제)

**Transparency Layer는 신뢰의 기반이다.** AI가 뭘 했는지, 얼마나 썼는지 항상 볼 수 있어야 한다. 토큰 사용량과 비용을 각 AI 호출에 기록하고, 타임라인에 표시한다.

### AI Agent Layer 컴포넌트 상세

목표 아키텍처의 4개 컴포넌트 + 1개 신규 컴포넌트(Context Assembler)의 역할과 동작을 상세히 기술한다.

---

**Context Assembler**

매 AI 요청마다 실시간 컨텍스트를 조립해서 LLM 시스템 프롬프트에 주입한다. 이것이 "도메인 특화 AI"의 핵심 메커니즘이다. 범용 AI가 모르는 인프라 상태를 알려주는 역할.

조립하는 정보:

- 프로젝트 상태: running / stopped / crashed, 마지막 배포 결과, 컨테이너 ID
- 서버 상태: 디스크 사용량, 메모리, 실행 중인 컨테이너 목록, 포트 점유 현황
- Memory Store 패턴: 이 프로젝트가 과거에 겪은 빌드 실패 패턴과 해결책
- 최근 배포 히스토리: 마지막 N건의 배포 결과 요약

현재 코드에서 `src/llm/prompts.ts`의 `buildContextSnapshot()`이 초기 형태다. 이걸 확장해서 Memory Store 조회를 추가하면 Context Assembler가 된다.

---

**Decision Engine**

LLM 호출이 아닌 룰 기반으로 동작한다. 빠르고 예측 가능하다. LLM이 "이 작업 해도 돼?"를 판단하는 게 아니라, 미리 정의된 규칙이 판단한다.

입력: 도구 이름 + 파라미터
출력: `ALLOW` / `NOTIFY_THEN_ALLOW` / `REQUIRE_APPROVAL`

도구별 기본 위험도 매핑:

| 도구                                                 | 위험도 | 결과              |
| ---------------------------------------------------- | ------ | ----------------- |
| `get_deploy_status`, `get_logs`, `get_project_stats` | Low    | ALLOW             |
| `set_env_vars`, `list_env_vars`                      | Low    | ALLOW             |
| `redeploy_project`, `restart_project`                | Medium | NOTIFY_THEN_ALLOW |
| `rollback_project`, `deploy_blue_green`              | High   | REQUIRE_APPROVAL  |
| `remove_project`, `remove_service`                   | High   | REQUIRE_APPROVAL  |
| `create_database`                                    | High   | REQUIRE_APPROVAL  |

유저가 Settings에서 Medium risk 도구를 `REQUIRE_APPROVAL`로 올릴 수 있다. High risk를 낮추는 건 불가능하다. 위험도 매핑은 DB 또는 config 파일에 저장되어 코드 변경 없이 조정 가능하다.

**액션 가역성 분류**

Decision Engine은 위험도(low/medium/high)와 더불어 **가역성**으로도 판단한다. 롤백이 가능한지 여부가 실패 시 대응을 결정하기 때문이다.

| 분류                      | 설명                        | 예시                                           | 실패 시                                                 |
| ------------------------- | --------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| 가역 (reversible)         | 이전 상태로 완전 복원 가능  | env var 추가, 컨테이너 재시작                  | 자동 롤백                                               |
| 보상 가능 (compensatable) | 역작업으로 효과를 상쇄 가능 | 재배포 (이전 이미지로 롤백), 서비스 연결       | 보상 액션 실행                                          |
| 비가역 (irreversible)     | 되돌릴 수 없음              | DB 스키마 변경, 시크릿 로테이션, 외부 API 호출 | 반드시 유저 승인 후 실행, 실패 시 `manual_intervention` |

두 축을 조합한 판단 기준:

- low + reversible → 자동 실행
- medium + compensatable → 알림 후 자동 실행
- any + irreversible → 항상 승인 필요 (설정 불가)
- high + irreversible → 승인 필요 + 실행 전 경고: "이 작업은 되돌릴 수 없습니다"

---

**Memory Store**

`deployment_patterns` 테이블 스키마:

```
project_id       TEXT
pattern_type     TEXT  (build_failure / env_missing / port_conflict / node_version / ...)
error_signature  TEXT  (에러 메시지의 핵심 패턴, 정규화된 형태)
fix_action       TEXT  (JSON: 적용한 해결책)
success_count    INT
failure_count    INT
last_seen_at     DATETIME
created_at       DATETIME
```

동작 방식:

1. 자동복구 시도 후 결과를 패턴으로 저장
2. 다음 복구 시 Context Assembler가 조회 → 프롬프트에 주입
3. 과거 해결책이 있으면 LLM 호출 없이 즉시 적용 (비용 절약)
4. 해결책 적용 후 성공/실패 여부를 `success_count` / `failure_count`에 기록

---

**Action Executor**

다단계 실행을 안전하게 처리한다. 각 단계 전에 스냅샷을 찍고, 실패 시 롤백 포인트로 복구한다.

실행 흐름:

1. 실행 계획 수립 (어떤 도구를 어떤 순서로)
2. `action_runs` 테이블에 operation 생성 (status: `planned`)
3. Decision Engine 승인 → status: `approved`
4. 단계별 실행 + 각 단계 결과 검증 → status: `running`
5. 전체 완료 후 헬스체크 → status: `succeeded`
6. 실패 시 → 가역성에 따라 복구 → status: `rolled_back` / `manual_intervention`
7. Memory Store에 결과 패턴 저장

**Operation 상태 기계 (`action_runs` 테이블)**

모든 다단계 AI 액션은 이 테이블에 기록된다. "승인됐다"와 "실행됐다"가 in-memory 순간이 아니라 감사 가능한 사실이 된다.

```
action_runs
  id                TEXT (UUID)
  project_id        TEXT
  trigger_source    TEXT  (web_agent / auto_recovery / monitor / mcp)
  trigger_session_id TEXT (nullable)
  plan              TEXT  (JSON: 실행 계획 단계들)
  status            TEXT  planned → approved → running
                          → succeeded / failed / rolled_back / manual_intervention
                          (또는 partial → 부분 실패)
  current_step      INT
  total_steps       INT
  steps_completed   TEXT  (JSON: 각 단계별 결과 + 타임스탬프)
  correlation_id    TEXT  (요청 추적용)
  created_at        DATETIME
  updated_at        DATETIME
```

**부분 실패 처리**

3단계 실행 중 2단계가 실패하면:

- status = `partial`, `steps_completed`에 1단계 성공 + 2단계 실패 기록
- 2단계 액션이 보상 가능(compensatable)하면 → 보상 액션 자동 실행 → status = `rolled_back`
- 보상 불가능(irreversible)하면 → status = `manual_intervention` → 유저에게 알림 + 현재 상태 설명

---

**Transparency Layer**

`ai_usage_log` 테이블 스키마:

```
id            TEXT  (UUID)
project_id    TEXT  (nullable — 프로젝트 무관 작업도 있음)
session_id    TEXT  (nullable)
action_type   TEXT  (web_agent / auto_recovery / build_debugger / monitor_alert)
input_tokens  INT
output_tokens INT
cost_usd      REAL
tools_called  TEXT  (JSON 배열: 호출한 도구 목록)
result        TEXT  (success / failure / partial)
duration_ms   INT
created_at    DATETIME
```

모든 AI 호출 경로(웹 에이전트, 자동복구, 빌드 디버거)에서 이 테이블에 기록한다. 웹 대시보드에서 프로젝트별, 기간별, 기능별로 조회 가능.

> **Note**: `mcp_middleware` action_type은 Phase 4에서 추가될 예정입니다. 현재 Phase 1~3에서는 `build_debugger`로 빌드 에러 분석을 기록합니다.

---

### 진입점별 AI 레이어 경유 방식

5개 진입점이 AI Agent Layer를 어떻게 타는지 정리한다.

**① MCP (Cursor / Claude Code)**

- Phase 1~3: MCP → ToolDef 직접 호출. AI 레이어를 타지 않는다.
- Phase 4: MCP → Decision Engine 체크 → ToolDef.

Phase 4의 MCP 미들웨어는 "차단"이 목적이 아니다. `_agent_guidance` 필드에 컨텍스트 정보를 추가해서 외부 에이전트가 더 똑똑하게 판단하도록 돕는 것이 목적이다.

예시:

```
도구: execute_plan
_agent_guidance: "주의 — 5분 전 동일 프로젝트 배포 실패.
  원인: port 3000 conflict (ol-blog-backend가 점유 중).
  확인 후 진행 권장. 또는 다른 포트를 지정하세요."
```

외부 에이전트(Cursor의 Claude)는 이 정보를 보고 스스로 판단한다. OpenLander가 강제로 막는 게 아니라, 더 나은 판단을 위한 정보를 제공한다.

**advisory 모드의 한계**

`_agent_guidance`는 외부 에이전트가 무시할 수 있다. 또한 여러 개의 "안전한" 도구 호출이 조합되면 위험한 결과를 만들 수도 있다(예: env var 삭제 여러 번 = 설정 초기화). 단순 셀프호스팅 사용자에게는 advisory로 충분하지만, 기업용 포지셔닝을 위해서는 부족하다.

**파괴적 도구에 대한 강제 모드 (Phase 4+)**

`remove_project`, `rollback_project` 등 비가역/고위험 도구에 한해서만 서버 측 강제 승인을 적용한다. 대부분의 도구는 기존 advisory 그대로다.

동작 방식:

- 강제 모드 도구를 MCP로 호출하면: `approval_required: true` + `approval_token` 반환
- 외부 에이전트는 웹 대시보드 또는 채널(Slack 등)에서 승인을 받아야 한다
- 승인 완료 후 `approval_token`을 포함해 재호출하면 실행됨
- 토큰 없이 재호출하면 거부

이 방식의 장점: 외부 에이전트의 자율성을 최대한 존중하면서, 실제로 위험한 소수의 작업에만 강제 게이트를 둔다.

**② Web Agent (브라우저 채팅)**

항상 AI 레이어를 경유한다.

```
유저 메시지
  → Context Assembler (실시간 컨텍스트 조립)
  → LLM (판단 + 도구 선택)
  → 도구 호출 시 Decision Engine 체크
  → Action Executor (실행)
  → Transparency Layer (토큰/비용 기록)
  → Memory Store (패턴 저장)
  → 유저에게 결과 스트리밍
```

**③ Auto Recovery (배포 실패)**

EventBus 트리거 → AI 레이어 경유 → 자율 실행.

```
deploy:failed 이벤트
  → Gate Checks (재시도 횟수 초과? 인프라 에러? → 스킵)
  → Context Assembler (에러 로그 + 프로젝트 상태 + Memory 패턴)
  → Recovery Planner (3단계 전략 결정):
      (a) Memory hit → 과거 해결책 즉시 적용 (LLM 없이)
      (b) Recipe hit → Recipe의 fix action 실행 후 재배포
      (c) miss → LLM 분석 요청
  → Decision Engine (복구 액션 위험도 체크)
  → Action Executor (실행 + 검증 + 롤백)
  → Transparency Layer 기록
  → Memory Store 패턴 저장
```

**④ Monitor Alert (크래시 / 헬스체크 실패)**

③과 동일한 경로. 트리거만 다르다.

```
alert:new (container-crash) 또는 monitor:healthcheck (unhealthy)
  → ③과 동일한 Recovery 경로
```

**⑤ Web UI (버튼 클릭)**

AI 레이어를 타지 않는다. 유저가 명시적으로 클릭한 것은 AI가 개입할 이유가 없다.

```
버튼 클릭 → Hono REST API → ToolDef → Infrastructure
```

Stop, Start, Restart, Redeploy, Rollback, Delete — 모두 직접 실행. LLM 없이도 동작한다.

### Web Agent vs MCP Agent 역할 분담

두 진입점은 같은 ToolDef를 쓰지만, 사용 패턴이 다르다.

**Web Agent (브라우저 채팅)**:

- 사람이 직접 대화하는 인터페이스
- "왜 빌드가 실패했어?", "메모리 사용량이 왜 높아?" 같은 진단 질문
- 간단한 작업 지시: "이 프로젝트 재배포해줘"
- 결과를 실시간으로 보면서 상호작용

**MCP Agent (Cursor, Claude Code 등)**:

- 코딩 에이전트가 코드 작성 중에 배포를 지시
- "방금 수정한 코드 배포해줘", "스테이징 환경에 올려줘"
- 더 자율적이고 덜 대화적
- Phase 4에서는 AI Agent Layer를 경유해서 위험 평가를 받는다

Web Agent는 항상 AI Agent Layer를 통과한다. MCP는 Phase 1~3에서는 ToolDef를 직접 호출하고, Phase 4에서 AI Agent Layer(Decision Engine 체크 + `_agent_guidance` 주입)를 경유한다.

### 확장성 모델

AI Agent Layer의 설계는 새 기능과 새 진입점을 최소한의 작업으로 추가할 수 있도록 되어 있다.

**새 기능(도구) 추가 시**:

1. `src/tools/defs/`에 ToolDef 추가 (예: `setup_ssl`, `create_backup`)
2. Decision Engine에 위험도 등록 (DB 또는 config에 한 줄)
3. 끝.

MCP, 웹 에이전트, 자동복구, 채널 — 모든 진입점에서 자동으로 접근 가능해진다. 각 진입점에 별도로 도구를 등록할 필요가 없다.

**새 진입점 추가 시** (예: GitHub App, Telegram 봇):

1. 새 어댑터 작성 (진입점 → AI Agent Layer 연결)
2. 끝.

같은 Context Assembler, Decision Engine, Transparency Layer, Memory Store를 공유한다. 진입점마다 별도 AI 로직을 구현할 필요가 없다.

**Decision Engine 규칙 변경**:

- 도구별 위험도는 코드가 아니라 설정(DB 또는 config 파일)에 저장
- 유저가 Settings에서 Medium risk 도구를 `REQUIRE_APPROVAL`로 올릴 수 있음
- 새 도구 추가 시 default risk level 자동 적용 (미등록 도구는 Medium으로 처리)
- 코드 배포 없이 위험도 정책 변경 가능

### 동시성 모델

같은 프로젝트에 여러 AI 액션이 동시에 요청될 때의 처리 규칙이다. 현재는 `Agent` 클래스 내의 `lockPromise`로 직렬화되지만, 이는 단일 에이전트 인스턴스 수준의 락이다. 여러 진입점(웹 에이전트 + MCP + 자동복구)이 동시에 같은 프로젝트를 건드릴 수 있어서 더 명확한 규칙이 필요하다.

**Renewable lease 모델**:

`action_runs`의 `running` 레코드가 락을 소유한다. 단순 타임아웃이 아니라 heartbeat 또는 step 진행으로 lease를 연장한다. 진행 중인 작업이 살아있는 한 락을 유지한다. heartbeat가 일정 시간(3분) 없으면 stale로 판정하고 정리 대상으로 표시한다.

**취소 요청 상태**:

수동 작업(Web UI 버튼)이 자동복구를 즉시 중단시키지 않는다. 대신 `action_runs`를 `cancellation_requested` 상태로 전환한다. 자동복구는 현재 단계를 완료하거나 안전한 경계(롤백 완료, 헬스체크 후)에 도달한 후에 중단한다. 이후 수동 작업이 프로젝트 제어를 인계받는다.

빌드 중간에 락을 강제로 빼앗으면 컨테이너가 불완전한 상태로 남을 수 있기 때문이다.

**동시성 규칙 요약**:

1. 자동복구 실행 중 수동 배포 요청 → 자동복구에 `cancellation_requested` → 안전 경계 후 수동에 인계
2. 수동 배포 실행 중 자동복구 트리거 → 자동복구 양보 (사람 의도 우선)
3. 웹 에이전트 vs MCP 에이전트 동시 요청 → `action_runs` 기반 직렬화, 후속 요청은 "진행 중" 반환
4. Stale lease → heartbeat 3분 없으면 자동 정리 가능

**구현**:

기존 `deploy_lock_session` 컬럼을 AI 레이어 수준의 프로젝트 락으로 확장한다. `action_runs`에 `last_heartbeat_at` 컬럼을 추가해 stale 감지에 활용한다.

---

## 3. 로드맵

### Phase 1: 관찰 + 격리 (v1.0)

**목표**: AI가 뭘 하는지 볼 수 있게 한다. 세션을 분리한다. 자동복구를 안정화한다.

**v1.0에 포함되는 것**:

- ✅ Transparency v1 (토큰/비용 로깅) — `ai_usage_log` 테이블 + `transparency.ts` + AI Usage API (`/api/usage/summary`, `/api/usage/recent`) + Settings AI 탭 대시보드 (StatCard 4개 + 최근 호출 리스트)
- ✅ Context Assembler lite (프로젝트 상태 + 최근 배포 결과 — Memory 패턴 조회 제외) — `src/llm/context-assembler.ts`
- ✅ Recovery Planner (자동복구 전용 — 범용 Action Executor 아님) — `src/pipeline/auto-recovery.ts` + `recovery-dispatch.ts` + `recipes.ts` (20+ 레시피 패턴)
- ✅ 간단한 승인 게이트 (자동복구가 고위험/비가역 액션 감지 시에만) — `src/pipeline/approval-gate.ts` (in-memory Promise + 10분 타임아웃) + 승인 API 3개 (`/api/approvals/pending`, `/api/projects/:id/recovery/approve`, `/api/projects/:id/recovery/reject`) + 폴링 기반 배너 UI (`ApprovalBanner.tsx`)
- ✅ AgentPool — 세션별 Agent 인스턴스 분리 — `src/llm/agent-pool.ts` (MAX_POOL_SIZE=5, idle timeout)
- ✅ Operation 레저 (`action_runs` 테이블) — auto-recovery 전용, 상태 추적 (`running` / `succeeded` / `failed` / `pending_approval`). 전체 상태 기계(`partial`, `rolled_back`, `manual_intervention`, `cancelled`)는 Phase 2~3에서 확장
- ✅ 자동 복구 안정화 — 레시피 기반 fast-path + LLM fallback + gate checks + 고위험 도구 승인 게이트 연동
- ⬜ MCP 도구 품질 강화 — `mcpDescription` 전체 적용, `_agent_guidance` 개선 (미구현)
- ⬜ 운영 모니터링 기본 대응: 컨테이너 크래시 반복 시 자동 재시작, 디스크 80% 도달 시 감지 + 정리 권장 알림 + 원클릭 실행 (자동 정리는 v1.x), 헬스체크 연속 실패 시 롤백 제안 (AlertMonitor + rollback:suggested 이벤트 활용) (미구현)
- ✅ AI 기능 설정화: 모든 AI 관련 기능을 개별 on/off 설정으로 제어 가능하게 리팩토링 — 7개 토글 (`autoRecovery`, `buildDebugger`, `webAgent`, `envDetection`, `secretScan`, `rollbackSuggestion`, `operationalMonitoring`) + config + API (`/api/setup/ai-features`) + Settings UI (`AiSettingsTab.tsx`, `LlmSettingsTab.tsx`)

**AI 기능 설정 항목**:

| 설정 키                            | 기본값 | 설명                                     |
| ---------------------------------- | ------ | ---------------------------------------- |
| `ai.autoRecovery.enabled`          | `true` | 빌드 실패 시 자동 복구 시도              |
| `ai.buildDebugger.enabled`         | `true` | 빌드 로그 AI 분석                        |
| `ai.webAgent.enabled`              | `true` | 웹 에이전트 채팅 인터페이스              |
| `ai.envDetection.enabled`          | `true` | .env.example 기반 환경변수 자동 감지     |
| `ai.secretScan.enabled`            | `true` | 하드코딩된 시크릿 감지                   |
| `ai.rollbackSuggestion.enabled`    | `true` | 헬스체크 실패 시 롤백 제안               |
| `ai.operationalMonitoring.enabled` | `true` | 운영 중 크래시/디스크/헬스 모니터링 대응 |

API 키가 없으면 모든 AI 기능이 자동 비활성화 (현재와 동일). API 키가 있어도 개별 기능을 끌 수 있음. 설정은 `~/.openlander/config.yml`과 웹 대시보드 Settings 양쪽에서 관리.

**v1.0에 포함되지 않는 것**:

- 범용 Action Executor (자동복구 외의 다단계 실행)
- MCP 미들웨어
- Memory Store (deployment_patterns)
- 크로스 프로젝트 학습
- Decision Engine 전체 구현 (가역성 분류 포함)

**Transparency v1**:

- 각 AI 호출에 토큰 사용량 기록 (`ai_usage_log` 테이블)
- 웹 타임라인에 AI 액션 표시: `빌드 에러 분석 — 1,247 tokens ($0.002)`

**AgentPool**:

- 현재: 단일 `Agent` 인스턴스, `lockPromise`로 직렬화
- v1.0: 세션별 Agent 인스턴스 풀. 웹 에이전트 세션 A와 세션 B가 병렬 실행 가능
- 단, 같은 프로젝트에 대한 상태 변경 작업은 동시성 규칙에 따라 직렬화

**Context Assembler lite**:

- 현재 `buildContextSnapshot()`을 구조화된 모듈로 추출
- 프로젝트 상태, 최근 배포 히스토리, 서버 상태 조립
- Memory Store 조회는 Phase 2에서 추가

**자동 복구 안정화**:

- 빌드 실패 → AI 분석 → Dockerfile 수정 → 재시도 루프 이미 있음
- 레시피 기반 fast-path와 LLM fallback 이미 있음
- 개선: 엣지 케이스 처리, 재시도 한도 강화, 에러 메시지 표준화

**MCP 도구 품질 강화**:

- `_agent_guidance` 필드 개선: 다음 단계를 명확히 안내
- 에러 메시지 표준화: 코딩 에이전트가 에러를 파싱하기 쉽게
- `mcpDescription` 필드 전체 적용

**Phase 1 구현 완료된 코드 변경**:

- ✅ `src/llm/agent.ts` → `src/llm/agent-pool.ts`: AgentPool로 추출
- ✅ `src/llm/prompts.ts` → `src/llm/context-assembler.ts`: 모듈화
- ✅ `src/llm/transparency.ts`: PRICING_TABLE + calculateCost + logAiUsage
- ✅ `src/db/schema.drizzle.ts`: `ai_usage_log`, `action_runs` 테이블 추가 (+ `pending_approval` 상태)
- ✅ `src/pipeline/approval-gate.ts`: ApprovalGate 클래스 (in-memory Promise + 10분 타임아웃)
- ✅ `src/pipeline/auto-recovery.ts`: 고위험 도구 감지 → ApprovalGate 연동 (throw 대신 blocking)
- ✅ `src/web/api/ai-usage-routes.ts`: AI Usage API (summary + recent)
- ✅ `src/web/api/approval-routes.ts`: Approval API (pending + approve + reject)
- ✅ `web/src/components/settings/AiSettingsTab.tsx`: AI Usage 대시보드 (StatCard 4개 + 최근 호출 리스트)
- ✅ `web/src/components/layout/ApprovalBanner.tsx`: 승인 알림 배너
- ✅ `web/src/hooks/use-ai-usage.ts`: AI 사용량 폴링 훅
- ✅ `web/src/hooks/use-approval-check.ts`: 승인 상태 폴링 훅
- ✅ `web/src/lib/api/usage.ts`: 프론트엔드 API 클라이언트
- ✅ `web/src/components/timeline/RecoveryCard.tsx`: 토큰 사용량 표시 컴포넌트
- ✅ `web/src/i18n/en.ts` + `ko.ts`: i18n 키 추가 (settings.ai.usage._, approval.banner._)

---

### 자동복구 상세 설계

#### 현재 구조의 문제점 (AS-IS)

`src/pipeline/auto-recovery.ts`가 이미 있고 동작한다. 하지만 5가지 구조적 문제가 있다.

**1. LLM 모드의 "알아서 해" 문제**

`agent.chatStream()`에 "이거 고쳐줘"를 던지면 LLM이 뭘 할지 예측할 수 없다. 잘못된 도구를 호출할 수 있고, 실행 결과를 검증하지 않으며, 토큰 사용량이 얼마나 될지 모른다.

**2. Programmatic 모드의 "무조건 재시도" 문제**

Recipe가 에러를 진단만 하고 fix action이 없다. 고치지 않고 바로 `redeploy()`를 호출해서 같은 에러가 반복된다.

**3. 복구 간 상태 공유 없음**

1차 시도에서 뭘 했는지 2차 시도가 모른다. in-memory Map에 `count`와 `lastError`만 저장한다. 서버 재시작하면 카운터도 초기화된다.

**4. 이벤트 종료 감지 불안정**

`waitForRecoveryOutcome()`이 60초 타임아웃으로 동작한다. 빌드가 5분 걸리는 프로젝트는 복구 성공 여부를 판단하기 전에 타임아웃이 난다.

**5. 위험도 판단 없음**

LLM이 "DB 스키마 변경이 필요합니다"라는 결론을 내리면 그냥 실행한다. 승인 게이트가 없다.

#### 개선된 자동복구 플로우 (TO-BE)

```
EventBus 트리거 (deploy:failed / alert:new)
  │
  ▼
Gate Checks
  - 재시도 횟수 초과? → 중단
  - 인프라 에러 (Docker 데몬 다운 등)? → 중단, 알림만
  - 이미 복구 진행 중? → 중단
  │
  ▼
Context Assembler
  - 에러 로그 수집
  - 프로젝트 상태 스냅샷
  - Memory Store 조회 (이 에러를 전에 겪었나?)
  │
  ▼
Recovery Planner — 3단계 전략 결정
  (a) Memory hit: 과거 해결책 있음
      → 즉시 적용 (LLM 호출 없음, 비용 0)
  (b) Recipe hit: 알려진 에러 패턴 매칭
      → Recipe의 fix action 실행 후 재배포
  (c) Miss: 알 수 없는 에러
      → LLM 분석 요청 (Context Assembler 결과 포함)
  │
  ▼
Decision Engine
  - 복구 액션의 위험도 체크
  - Low/Medium: 자동 진행
  - High: 유저 알림 + 승인 대기
  │
  ▼
Action Executor
  1. 롤백 포인트 스냅샷
  2. fix action 실행 (Dockerfile 수정, env var 추가 등)
  3. 재배포
  4. 결과 검증 (헬스체크 통과 여부, 타임아웃 없이 이벤트 기반)
  5. 성공 → Memory Store에 패턴 저장 + Transparency 기록
  6. 실패 → 롤백 포인트 복구 + 실패 패턴 저장 + 다음 전략으로
```

핵심 개선점:

- Recovery Planner가 전략을 명시적으로 결정한다. LLM에게 "알아서 해"를 던지지 않는다.
- Memory hit 시 LLM 호출이 없다. 비용이 0이고 속도가 빠르다.
- 결과 검증이 타임아웃 기반이 아니라 이벤트 기반이다. (`deploy:success` / `deploy:failed` 이벤트 수신)
- 모든 시도 결과가 DB에 저장된다. 서버 재시작 후에도 히스토리가 유지된다.

---

### Phase 2: 기억 + 승인 (v1.x)

**목표**: AI가 과거를 기억하고, 같은 실수를 반복하지 않는다. 승인 게이트가 제대로 동작한다.

**Memory Store 도입 (프로젝트 스코프만)**:

크로스 프로젝트 학습은 Phase 4까지 보류한다. Phase 2에서는 단일 프로젝트 내의 패턴만 저장한다.

새 DB 테이블:

```
deployment_patterns
  project_id, tenant_id (nullable),
  pattern_type  (build_failure / env_missing / port_conflict / ...)
  error_signature  (정규화된 에러 패턴)
  fix_action  (JSON: 해결책)
  success_count, failure_count
  last_seen_at, created_at
```

**패턴 학습 예시**:

- "이 프로젝트는 Node 18에서 3번 빌드 실패 → Node 20으로 바꿔야 함" 자동 학습
- 다음 배포 시 Context Assembler가 조회 → 시스템 프롬프트에 주입
- 같은 에러 → 과거 성공한 해결책 즉시 적용 (LLM 호출 없이)

**승인 게이트**:

`action_runs` 상태 기계를 활용한다. `planned` → `approved` 전환에 유저 승인이 필요한 작업은 대기 큐에 머문다. 웹 대시보드에서 승인/거부 UI 제공.

**동시성 규칙 적용**:

Phase 1의 기본 동시성 규칙을 완성한다. renewable lease 모델, `cancellation_requested` 상태, stale 감지(heartbeat 3분), 수동 작업 우선 인계.

**세션 영속화**:

- 현재: 서버 재시작하면 대화 히스토리 사라짐
- Phase 2: `agent_sessions` 테이블에 저장, 재시작 후에도 이어서 대화 가능
- 이미 있는 `chat_sessions` 테이블을 확장

**Transparency v2**:

- 월별 사용량 대시보드: 프로젝트별, 기능별 토큰 사용량
- 일일/월간 상한선 설정: 초과 시 AI 기능 자동 비활성화
- 비용 예측: "이 작업은 약 $0.01이 예상됩니다"

**신규 파일**:

- `src/llm/memory.ts`: Memory Store 모듈 (패턴 저장/조회/적용)

---

### Phase 3: 자율 운영 (v2.0)

**목표**: 모니터링 → 판단 → 실행이 자동으로 돌아간다. 사람은 이상한 것만 확인한다.

이 Phase의 범위는 의도적으로 좁게 잡는다. "원클릭 서비스 확장" 같은 기능은 별도 트랙으로 분리한다. 핵심은 Decision Engine 완성과 Recovery Planner의 Memory 기반 자동화다.

**Decision Engine 완성**:

Phase 1에서 단순 버전(auto-recovery 전용)으로 시작한 Decision Engine을 위험도 + 가역성 두 축의 완전한 구현으로 확장한다.

- 전체 ToolDef 60+에 대한 위험도/가역성 매핑 완성
- 웹 에이전트 도구 호출에도 Decision Engine 적용
- 유저가 Settings에서 Medium risk 정책 조정 가능

**Recovery Planner — Memory 기반 자동화**:

Phase 2의 Memory Store를 Recovery Planner와 연결한다.

- Memory hit → LLM 호출 없이 즉시 적용 (비용 0)
- 복구 성공률이 높은 패턴은 자동 적용, 낮은 패턴은 LLM으로 fallback

**자동 운영 루프**:

```
컨테이너 크래시 감지 (AlertMonitor)
  → Context Assembler (로그 + Memory 패턴 조회)
  → Recovery Planner (Memory hit? Recipe hit? LLM?)
  → Decision Engine (위험도 + 가역성 체크)
  → 자동 실행 또는 유저 승인 대기

메모리 누수 감지 (HealthMonitor)
  → 알림: "hotdeal-api 메모리 사용량 87% — 재시작을 권장합니다"
  → Medium risk: 알림 + 5분 후 자동 재시작
```

**범용 Action Executor**:

자동복구 전용이었던 Action Executor를 범용화한다. 웹 에이전트가 "DB 프로비저닝 → env var 설정 → 배포 → 헬스체크"를 한 번에 요청해도 `action_runs` 상태 기계를 통해 안전하게 실행된다.

**신규 파일**:

- `src/llm/decision.ts`: Decision Engine 완성 (위험도 + 가역성 분류)
- `src/llm/executor.ts`: 범용 Action Executor (다단계 실행 + 롤백)

---

### Phase 4: 생태계 (v3.0)

**목표**: MCP 호출도 AI Agent Layer를 경유한다. 크로스 프로젝트 학습이 시작된다. 단, 테넌시 모델이 확립된 후에만.

**MCP 미들웨어 (advisory + 강제 모드)**:

현재 MCP 호출은 ToolDef를 직접 실행한다. Phase 4에서는 두 가지 모드로 개입한다.

advisory 모드 (대부분의 도구):

```
Cursor: "배포해줘"
  → MCP 도구 호출
  → _agent_guidance에 컨텍스트 주입
    "5분 전 동일 커밋에서 빌드 실패. 원인: port conflict. 확인 권장."
  → 외부 에이전트가 정보를 보고 스스로 판단
```

강제 모드 (비가역/고위험 도구만):

```
Cursor: "프로젝트 삭제해줘"
  → MCP 도구 호출
  → approval_required: true + approval_token 반환
  → 웹 대시보드 또는 Slack에서 승인
  → approval_token 포함 재호출 → 실행
```

**크로스 프로젝트 학습 (테넌시 확립 후)**:

크로스 프로젝트 학습은 테넌트 경계 안에서만 수행한다. 기업용 확장 섹션에 정의된 `tenant_id` 스코핑이 완성된 후에 활성화한다.

- 같은 서버(또는 같은 팀)의 다른 프로젝트 패턴에서 학습
- "Next.js 프로젝트들은 보통 `NEXT_PUBLIC_API_URL` 환경변수가 필요합니다"
- "FastAPI 프로젝트들은 `uvicorn` 포트 설정이 자주 누락됩니다"

**커뮤니티 패턴 공유 (옵트인)**:

- 익명화된 빌드 실패/성공 패턴을 커뮤니티와 공유
- 커뮤니티 패턴을 로컬 Memory Store에 적용
- 완전 옵트인, 기본값은 비활성화

**인프라 기능 확장**:

- SSL 자동화 (Let's Encrypt 통합)
- DB 백업 자동화 (S3/로컬)
- 서버 리소스 관리 (디스크 정리, 이미지 정리 자동화)

---

## 4. 신뢰와 투명성

### 원칙

AI가 인프라를 다루는 플랫폼에서 신뢰는 선택이 아니라 필수다. 유저의 API 키로 LLM을 호출하고, 유저의 서버에서 컨테이너를 조작한다. 이 모든 것이 투명해야 한다.

**가시성**: 모든 AI 액션은 유저가 볼 수 있다. AI가 뭘 했는지, 왜 했는지, 결과가 어떻게 됐는지.

**예측 가능성**: 비용이 예측 가능하다. 이 작업을 하면 얼마가 드는지 미리 알 수 있다.

**제어 가능성**: 유저가 AI 행동 범위를 설정할 수 있다. 자동화 수준을 조절하고, 특정 작업은 항상 승인을 요구하도록 설정할 수 있다.

### 구현

**토큰/비용 표시**:

각 AI 호출 결과에 사용량 표시:

```
빌드 에러 분석 완료 — 1,247 tokens ($0.002)
자동 복구 시도 — 3,891 tokens ($0.006)
```

타임라인에 AI 액션 로그:

```
[14:23] AI: 빌드 실패 감지 → 로그 분석 시작
[14:23] AI: 원인 파악 — Node 버전 불일치 (18 → 20)
[14:24] AI: Dockerfile 수정 후 재시도
[14:26] AI: 빌드 성공 — 총 2,847 tokens ($0.004)
```

**Settings > AI 설정**:

```
자동 복구
  [ON/OFF] 빌드 실패 시 자동 복구 시도

사용량 제한
  일일 토큰 상한: [____] tokens
  월간 토큰 상한: [____] tokens
  상한 초과 시: [알림만] / [AI 기능 비활성화]

위험도별 승인 정책
  Low risk:    [자동 실행]
  Medium risk: [알림 후 자동] / [항상 승인]
  High risk:   [항상 승인] (변경 불가)

프로젝트별 AI 사용
  hotdeal-api:  [ON]
  blog-backend: [OFF]

API Key 관리
  [OpenLander가 암호화 저장] / [매 세션마다 직접 입력]
```

**AI 액션 타임라인**:

웹 대시보드에 별도 탭 또는 섹션으로 제공. 에이전트가 한 모든 작업을 시간순으로 표시. 각 항목에 토큰 사용량, 비용, 결과 포함. 실패한 액션은 빨간색으로 표시하고 원인 설명 포함.

---

## 5. 현재 코드베이스와의 갭 분석

### 이미 있는 것

| 컴포넌트                     | 위치                            | 상태 |
| ---------------------------- | ------------------------------- | ---- |
| AppContext + 의존성 주입     | `src/app.ts`                    | 완료 |
| ToolDef 60+ 도구             | `src/tools/defs/`               | 완료 |
| MCP / AI SDK 어댑터          | `src/tools/adapters/`           | 완료 |
| Agent 클래스 (기본 루프)     | `src/llm/agent.ts`              | 완료 |
| EventBus (40+ 이벤트)        | `src/events/index.ts`           | 완료 |
| HealthMonitor + AlertMonitor | `src/monitor/`                  | 완료 |
| AutoRecovery                 | `src/pipeline/auto-recovery.ts` | 완료 |
| 웹 에이전트 채팅             | `src/web/api/chat-routes.ts`    | 완료 |
| 세션 DB 저장                 | `src/db/repos/chat.repo.ts`     | 완료 |

### Phase 1에서 필요한 것

| 항목               | 파일                             | 작업                           | 상태      |
| ------------------ | -------------------------------- | ------------------------------ | --------- |
| AI 호출 토큰 기록  | `src/llm/agent.ts`               | AI SDK `usage` 필드 추출       | ✅ 완료   |
| 사용량 DB 저장     | `src/db/schema.drizzle.ts`       | `ai_usage_log` 테이블 추가     | ✅ 완료   |
| 타임라인 표시      | `web/src/components/timeline/`   | 토큰 사용량 컴포넌트           | ✅ 완료   |
| 자동 복구 안정화   | `src/pipeline/auto-recovery.ts`  | 엣지 케이스 처리               | ✅ 완료   |
| AgentPool          | `src/llm/agent-pool.ts`          | 세션별 Agent 인스턴스 분리     | ✅ 완료   |
| Context Assembler  | `src/llm/context-assembler.ts`   | 구조화된 모듈 추출             | ✅ 완료   |
| Transparency       | `src/llm/transparency.ts`        | 비용 계산 + 로깅 모듈          | ✅ 완료   |
| 승인 게이트        | `src/pipeline/approval-gate.ts`  | 고위험 도구 승인 메커니즘      | ✅ 완료   |
| AI Usage API       | `src/web/api/ai-usage-routes.ts` | 사용량 조회 엔드포인트         | ✅ 완료   |
| Approval API       | `src/web/api/approval-routes.ts` | 승인 API 엔드포인트            | ✅ 완료   |
| AI 설정 UI         | `web/src/components/settings/`   | AI 기능 토글 + 사용량 대시보드 | ✅ 완료   |
| 승인 배너 UI       | `web/src/components/layout/`     | 폴링 기반 승인 알림 배너       | ✅ 완료   |
| MCP 도구 품질      | `src/tools/defs/`                | mcpDescription 전체 적용       | ⬜ 미구현 |
| 운영 모니터링 대응 | `src/monitor/`                   | 크래시 재시작, 디스크 알림     | ⬜ 미구현 |

### Phase 2에서 필요한 것

| 항목                      | 파일                             | 작업                                                                       |
| ------------------------- | -------------------------------- | -------------------------------------------------------------------------- |
| 배포 패턴 테이블          | `src/db/schema.drizzle.ts`       | `deployment_patterns` 테이블                                               |
| 세션 영속화 확장          | `src/db/schema.drizzle.ts`       | `agent_sessions` 테이블 확장                                               |
| Memory Store 모듈         | `src/llm/memory.ts`              | 신규 파일                                                                  |
| 패턴 시스템 프롬프트 주입 | `src/llm/prompts.ts`             | `buildContextSnapshot()` 확장                                              |
| 사용량 대시보드           | `web/src/pages/SettingsPage.tsx` | 월별 대시보드 + 비용 상한선 (Phase 1에서 기본 StatCard 대시보드 구현 완료) |

### Phase 3에서 필요한 것

| 항목             | 파일                        | 작업                                                          |
| ---------------- | --------------------------- | ------------------------------------------------------------- |
| Decision Engine  | `src/llm/decision.ts`       | 신규 파일                                                     |
| Action Executor  | `src/llm/executor.ts`       | 신규 파일                                                     |
| 위험도 분류 로직 | `src/llm/decision.ts`       | 도구별 위험도 매핑                                            |
| 승인 게이트 UI   | `web/src/components/agent/` | 웹 에이전트용 승인 UI (Phase 1에서 자동복구용 배너 구현 완료) |
| 자동 운영 루프   | `src/app.ts`                | EventBus 리스너 확장                                          |

### Phase 4에서 필요한 것

| 항목                 | 파일                | 작업                       |
| -------------------- | ------------------- | -------------------------- |
| MCP 미들웨어         | `src/mcp/server.ts` | 도구 호출 전 AI Layer 개입 |
| 크로스 프로젝트 분석 | `src/llm/memory.ts` | 패턴 집계 로직             |
| 커뮤니티 패턴 API    | 신규                | 옵트인 패턴 공유           |

### AI 컴포넌트 테스트 전략

AI 레이어는 LLM에 의존하는 부분과 그렇지 않은 부분이 섞여 있다. 컴포넌트별로 적합한 테스트 방법이 다르다.

**Decision Engine**

순수 단위 테스트. LLM이 없다. 입력(도구 이름 + 파라미터 + identity) → 판정(ALLOW / NOTIFY / REQUIRE_APPROVAL)이 결정론적이어야 한다. 위험도 테이블의 모든 도구에 대해 예상 판정을 검증한다.

**Context Assembler**

골든 테스트(golden test). 고정된 DB 상태(특정 프로젝트 상태 + 최근 배포 + Memory 패턴)를 입력으로 주면 예상되는 컨텍스트 문자열이 나와야 한다. LLM 없이 출력 형태만 검증한다.

**Recovery Planner**

실제 배포 실패 로그 리플레이 테스트. 과거에 발생한 배포 실패 케이스들(Node 버전 에러, OOM, 포트 충돌 등)을 고정된 입력으로 재현했을 때, Recovery Planner가 올바른 전략(Memory hit / Recipe hit / LLM fallback)을 선택하는지 검증한다.

**Memory Store**

단위 테스트: 패턴 저장, 동일 프로젝트 패턴 조회, 성공/실패 카운터 업데이트, 오래된 패턴 만료 처리.

**Transparency Layer**

토큰 기록 정합성 테스트. 웹 에이전트 호출 후 `ai_usage_log`에 올바른 레코드가 삽입됐는지, 토큰 수가 실제 AI SDK 응답과 일치하는지 검증한다.

**도구 안전성**

각 ToolDef의 멱등성(idempotency) 계약 테스트. 같은 파라미터로 두 번 호출했을 때 부작용이 없어야 하는 도구(조회류)와, 두 번 호출하면 안 되는 도구(실행류)를 명확히 분류하고 테스트한다.

**통합 테스트**

가짜 `deploy:failed` 이벤트를 EventBus에 발행 → Gate Checks 통과 → Context Assembler 조립 → Recovery Planner 전략 선택 → Action Executor 실행 → `action_runs` 테이블 상태 검증 → Memory Store 저장 검증. LLM 호출은 모킹(mocking)한다.

---

## 6. 기업용 확장 대비

### 핵심 질문: 기존 아키텍처를 뜯지 않아도 되는가?

결론부터: **컴포넌트 구조 자체는 안 뜯어도 된다. 하지만 모든 컴포넌트의 입출력 인터페이스에 `identity`(누가, 어떤 팀)가 현재 빠져있다.** 지금 인터페이스 설계 시 optional 필드로 예약해두면 기업용 확장 시 아예 안 뜯어도 된다.

### 컴포넌트별 영향 분석

**Decision Engine**

- 현재 설계: `입력: 도구 이름 + 파라미터 → 출력: ALLOW / NOTIFY_THEN_ALLOW / REQUIRE_APPROVAL`
- 부족한 점: "누가 요청했는지"를 받는 인터페이스가 없음
- 기업용 필요: `입력: 도구 이름 + 파라미터 + userId + role + tenantId`
- 해결: 입력 인터페이스에 optional identity 필드 예약. 위험도 매핑 테이블에 `tenant_id` 컬럼 예약 → 테넌트별 정책 가능. 조회 우선순위: user > tenant > global

**Context Assembler**

- 현재 설계: 프로젝트 상태 + 서버 상태 + Memory 패턴 조립
- 부족한 점: 테넌트 스코핑이 없음 → 팀 A 패턴이 팀 B 프롬프트에 노출 가능
- 해결: 컨텍스트 조회 시 tenantId 필터 적용. Memory Store 조회, 프로젝트 목록 조회 모두 tenant 스코핑 필요

**Memory Store**

- 현재 설계: `deployment_patterns` 테이블에 `project_id`만 있음
- 부족한 점: `tenant_id` 스코핑 없음. 크로스 프로젝트 학습(Phase 4)이 테넌트 경계를 넘을 수 있음
- 해결: 테이블에 `tenant_id` 컬럼 예약 (nullable, 기본 NULL = 단일 유저 모드). Phase 4 크로스 프로젝트 학습도 tenant 내에서만 수행

**Transparency Layer**

- 현재 설계: `ai_usage_log`에 `project_id`, `session_id`만 있음
- 부족한 점: `user_id`, `tenant_id` 없음 → 기업용 감사 로그에 "누가 트리거했는지" 빠짐
- 해결: 테이블에 `user_id`, `tenant_id` 컬럼 예약

**MCP 미들웨어 (Phase 4)**

- 현재 설계: `_agent_guidance`에 경고 추가
- 부족한 점: 인증된 MCP 클라이언트 구분이 없음 → 팀 A의 Cursor가 팀 B 프로젝트 접근 가능
- 해결: MCP 인증 시 tenant/user 정보 추출, ToolContext에 주입

### Identity 인터페이스 예약 설계

모든 컴포넌트가 공유하는 identity 타입:

```
RequestIdentity {
  userId?:      string   // 감사 기준 책임자 (accountable owner)
  tenantId?:    string   // 소속 팀/조직
  role?:        string   // admin / member / viewer (향후 enum으로 강화)
  source:       'web' | 'mcp' | 'auto-recovery' | 'monitor'  // 기술적 진입점
  initiatedBy?: string   // 사람 기준 요청자 (source와 구분)
}
```

`source`와 `initiatedBy`의 구분이 중요하다:

- `source`: 기술적 진입점. 어떤 경로로 요청이 들어왔는지. auto-recovery가 실행하면 `source = 'auto-recovery'`.
- `initiatedBy` / `userId`: 감사 기준 책임자. 누가 이 액션의 owner인지. auto-recovery가 실행해도 해당 프로젝트 owner가 감사 대상. MCP 호출이면 MCP 클라이언트를 인증한 유저가 `userId`.

예시: 자동복구가 rollback을 실행할 때 `source = 'auto-recovery'`, `userId = 프로젝트_owner`. 감사 로그에는 "프로젝트 owner의 프로젝트에서 auto-recovery가 rollback 실행"으로 기록된다.

이 타입을 아래 인터페이스에 optional로 포함:

- `ToolContext` → `identity?: RequestIdentity`
- Decision Engine 입력 → `identity?: RequestIdentity`
- Context Assembler 입력 → `identity?: RequestIdentity`
- `ai_usage_log` 테이블 → `user_id`, `tenant_id`, `source` 컬럼
- `deployment_patterns` 테이블 → `tenant_id` 컬럼
- EventBus 페이로드 → `tenantId?: string`

단일 유저 모드에서는 모든 identity 필드가 생략된다. 기존 동작과 완전히 동일하다. 기업용 활성화 시 미들웨어에서 자동 주입한다.

**주의**: 단일 유저 모드에서 `tenantId = null`이 "스코핑 스킵"의 숏컷이 되어선 안 된다. 코드에서 단일 유저 모드를 별도 플래그로 명시적으로 확인해야 한다. `tenantId = null`을 보고 "전체 조회"로 해석하는 버그는 기업용 전환 시 데이터 누출로 이어진다.

### 종합 판정

| 컴포넌트           | 구조 변경 | 실제 작업                                  |
| ------------------ | --------- | ------------------------------------------ |
| Decision Engine    | 안 뜯음   | 입력 인터페이스에 optional 필드 추가       |
| Context Assembler  | 안 뜯음   | 조회 시 tenantId 필터 추가                 |
| Memory Store       | 안 뜯음   | 테이블에 tenant_id 컬럼 추가               |
| Transparency Layer | 안 뜯음   | 테이블에 user_id / tenant_id 추가          |
| MCP 미들웨어       | 안 뜯음   | 인증에서 identity 추출 후 ToolContext 주입 |
| ToolDef 허브       | 안 뜯음   | ToolContext에 identity 필드 추가           |
| EventBus           | 안 뜯음   | 페이로드에 tenantId 추가                   |

**`RequestIdentity`를 지금 인터페이스에 optional로 예약해두면, 기업용 확장 시 구조 변경 없이 필드를 채우기만 하면 된다.**

### 멀티서버 (현재 범위 밖)

현재 설계는 단일 서버 모델이다. Docker, SQLite, Traefik이 모두 같은 머신에 있다.

멀티서버를 지원하려면:

- 컨트롤 플레인 (중앙 AI Agent Layer + 공유 DB)
- 노드 에이전트 (각 서버의 Docker + Traefik 조작)
- 노드 간 통신 프로토콜

이것은 기존 아키텍처 "위에 얹는" 것이 아니라 새로운 아키텍처 경계(seam)가 필요한 작업이다. Phase 4 이후, 단일 서버 모델이 충분히 안정화된 후에 별도 검토한다.

---

## 7. 설계 원칙 (변하지 않는 것)

이 비전이 어떻게 진화하든, 다음 원칙은 바뀌지 않는다.

**1. AI는 보조다, 주인이 아니다.**
모든 AI 액션에는 수동 대안이 있다. LLM이 없어도 배포, 롤백, 모니터링이 동작한다. AI는 더 빠르고 더 스마트하게 만들 뿐이다.

**2. 실행은 결정론적이다.**
AI는 판단하고 지시한다. 실제 Docker 명령, Traefik 설정, DB 쿼리는 항상 결정론적 파이프라인이 실행한다. AI가 직접 인프라를 건드리지 않는다.

**3. 비용은 투명하다.**
유저의 API 키로 호출하는 모든 LLM 요청은 토큰 수와 비용을 기록하고 표시한다. 숨겨진 비용이 없다.

**4. 위험한 작업은 항상 확인한다.**
High risk 작업(롤백, DB 변경, 삭제)은 자동화 수준 설정과 무관하게 항상 유저 확인을 요구한다. 이건 설정으로 바꿀 수 없다.

**5. 데이터는 로컬에 있다.**
Memory Store, 세션 히스토리, 배포 패턴 — 모두 로컬 SQLite에 저장된다. 외부 서비스에 데이터를 보내지 않는다. 커뮤니티 패턴 공유는 완전 옵트인이다.

---

## 참고

- `docs/planning/v1-architecture-decision.md` — BUTTON/FORM/AGENT 인터랙션 모델
- `src/llm/agent.ts` — 현재 Agent 구현 (히스토리 관리, 스트리밍)
- `src/tools/defs/` — ToolDef 카테고리별 도구 정의
- `src/app.ts` — AppContext 의존성 그래프
- `src/pipeline/auto-recovery.ts` — 현재 자동 복구 구현
