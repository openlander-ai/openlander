# Operations Center UI/UX 개선 분석

> 분석 일자: 2025-07-13
> 분석 방법: Playwright 브라우저 접속 → 스크린샷 캡처 → 소스코드 대조
> 대상: `http://localhost:10114/operations` + `web/src/components/ops/*`
> 첨부 스크린샷: `docs/launchpad/ops-*.png`

---

## 현재 페이지 구조

브라우저에서 캡처한 Operations Center 페이지는 4개 섹션으로 구성:

```
┌─────────────────────────────────────────────────┐
│ [상단 배너] Recovery Approval Required           │
│  rollback · Project: zN6HQC7zxfMO · Attempt: 1 │
├─────────────────────────────────────────────────┤
│ Operations Center                               │
│ "Monitor agent activity, incidents..."          │
│ [All Projects ▾]                                │
├─────────────────────────────────────────────────┤
│ § Pending Approvals (1)                         │
│   zN6HQC7zxfMO · rollback · 4/5/2026 11:44    │
│   [Approve] [Reject]                            │
├─────────────────────────────────────────────────┤
│ § Circuit Breakers (15개 카드, 3열 그리드)       │
│   qa-rc7-pm   🟡 Half Open  53 failures  46m   │
│   kue5NJZobmIE 🔴 Open     40 failures  1h    │
│   ...13개 더 (대부분 🔴 Open, 5 failures)       │
├─────────────────────────────────────────────────┤
│ § Active Incidents (7개 그룹)                    │
│   udGZAq03mSae · Critical · Escalated           │
│   "critical incident" · 12 occurrences          │
│   ...반복...                                    │
├─────────────────────────────────────────────────┤
│ § Activity Feed [Disconnected]                  │
│   udGZAq03mSae  Incident  "Incident detected"  │
│   -LLuBwT0yzRC  Incident  "Incident detected"  │
│   ...50+개 동일 패턴 반복...                     │
└─────────────────────────────────────────────────┘
```

---

## 문제 #1: 승인 팝업/카드에 구체적 내용 없음

### 스크린샷에서 관찰된 실제 모습

**상단 배너:**

```
⚠ Recovery Approval Required  [rollback]
  Project: zN6HQC7zxfMO • Attempt: 1
  [Reject] [Approve]
```

**Pending Approvals 섹션:**

```
zN6HQC7zxfMO    rollback    4/5/2026, 11:44:22 AM    [Approve] [Reject]
```

**우하단 모달:**

```
Auto-recovery approval request
"Auto-recovery is requesting a high-risk action (rollback).
 Do you want to continue?"
[Approve] [Reject]
```

### 문제 분석

1. **프로젝트명이 ID로 표시됨** — `zN6HQC7zxfMO`는 내부 ID. 사용자는 이게 어떤 프로젝트인지 모름. (`projectNameById` 매핑이 실패하면 ID가 그대로 노출됨)
2. **실패 원인 없음** — 왜 rollback이 필요한지, 어떤 에러가 발생했는지 안 보임
3. **예상 행동 없음** — rollback이 실행되면 어떤 이미지로 돌아가는지, 다운타임이 있는지 안 보임
4. **모달이 배너와 중복** — 같은 정보가 3곳(배너, 섹션, 모달)에 표시되면서 모두 내용 부실

### 근본 원인 (소스코드)

`ApprovalQueue.tsx`의 `ActionRun` 인터페이스:

```typescript
// web/src/lib/api/projects.ts:39
export interface ActionRun {
  id: string;
  project_id: string;
  status: 'running' | 'succeeded' | 'failed';
  approval_tool: string | null;
  approval_requested_at: string | null;
  // ← 여기까지만! 아래 필드들이 없음
}
```

**하지만 백엔드 DB 스키마에는 이미 있음:**

```sql
-- src/db/schema.drizzle.ts
error_message TEXT,           -- 실패 원인
recovery_strategy TEXT,       -- recipe | llm | memory
plan TEXT,                    -- 전체 복구 계획 (JSON)
steps_json TEXT,              -- 실행 단계 목록 (JSON)
current_step INTEGER,         -- 현재 단계
total_steps INTEGER,          -- 전체 단계 수
trigger_source TEXT,          -- web_agent | auto_recovery | monitor
```

**데이터는 이미 있는데 프론트엔드로 안 내려줌.**

### 개선안

#### A. ActionRun 인터페이스 확장

```typescript
export interface ActionRun {
  // 기존 필드...
  error_message: string | null;
  recovery_strategy: 'recipe' | 'llm' | 'memory' | 'unknown' | null;
  plan: string | null;
  steps_json: string | null;
  current_step: number | null;
  total_steps: number | null;
  trigger_source: 'web_agent' | 'auto_recovery' | 'monitor' | 'mcp';
}
```

#### B. 승인 카드 UI 재설계

**Before (현재):**

```
┌────────────────────────────────────────────┐
│ [zN6HQC7zxfMO] [rollback]                 │
│ 4/5/2026, 11:44        [Approve] [Reject]  │
└────────────────────────────────────────────┘
```

**After (개선):**

```
┌────────────────────────────────────────────────┐
│ 🔴 hotdeal-api — 이전 버전으로 롤백 요청        │
│                                                │
│ 📋 원인                                        │
│    Container exited with code 137 (OOM Kill)   │
│                                                │
│ 🔄 예상 행동                                    │
│    이전 성공 이미지로 교체                        │
│    예상 다운타임: ~15초                          │
│                                                │
│ 🤖 복구 전략: LLM 진단 기반                     │
│    단계 2/3 (진단 완료 → 롤백 대기)              │
│                                                │
│ ⚠️  이 작업은 서비스를 일시 중단시킵니다          │
│                                                │
│ 11:44 · auto_recovery       [승인] [거절]       │
└────────────────────────────────────────────────┘
```

#### C. Tool명 → 평문 매핑 (i18n)

```typescript
// web/src/components/ops/utils.ts에 추가
const TOOL_HUMAN_LABELS: Record<
  string,
  { ko: string; en: string; impact_ko: string; impact_en: string }
> = {
  rollback: {
    ko: '이전 버전으로 롤백',
    en: 'Rollback to previous version',
    impact_ko: '서비스 일시 중단 (~15초)',
    impact_en: 'Brief service interruption (~15s)',
  },
  restart_container: {
    ko: '컨테이너 재시작',
    en: 'Restart container',
    impact_ko: '서비스 일시 중단 (~10초)',
    impact_en: 'Brief service interruption (~10s)',
  },
  diagnose_crash: {
    ko: '크래시 원인 분석',
    en: 'Analyze crash cause',
    impact_ko: '변경 없음 (읽기 전용)',
    impact_en: 'No changes (read-only)',
  },
  stop_project: {
    ko: '프로젝트 중지',
    en: 'Stop project',
    impact_ko: '서비스 완전 중단',
    impact_en: 'Full service shutdown',
  },
};
```

---

## 문제 #2: AI 호출 내역에 프로젝트명/상세 없음

### 스크린샷에서 관찰된 실제 모습

Activity Feed에서 AI recovery 이벤트:

```
udGZAq03mSae    Incident    "Incident detected"     11:54:57 AM    Active
-LLuBwT0yzRC    Incident    "Incident detected"     11:54:57 AM    Active
```

- 모든 항목이 **"Incident detected"** 라는 동일한 제목
- AI가 진단에 사용됐는지, 어떤 모델인지, 결과가 뭔지 **전혀 안 보임**
- 프로젝트명 대신 **ID(`udGZAq03mSae`)**가 표시됨

### 근본 원인

1. `ActivityItem.type`에 `'ai_call'` 같은 별도 타입이 없음 — AI 관련 이벤트가 `recovery`나 `incident`에 섞임
2. `ActivityItem`에 AI 메타데이터(모델명, 토큰, 소요시간) 필드 없음
3. 프로젝트명은 `item.projectName`으로 렌더링하는데, 백엔드에서 이름 대신 ID를 내려주는 경우가 있음

### 개선안

#### A. ActivityItem에 AI 메타데이터 추가

```typescript
export interface ActivityItem {
  // 기존 필드...
  aiMetadata?: {
    model: string; // 'gemini-2.5-flash'
    tokensUsed?: number; // 340
    durationMs?: number; // 1200
    diagnosisSummary?: string; // 'OOM Kill 감지 → 메모리 제한 부족'
  };
}
```

#### B. Activity Feed에서 AI 이벤트 시각적 구분

```
┌──────────────────────────────────────────────────┐
│ [hotdeal-api] [🤖 recovery]                      │
│ 자동 복구: OOM Kill 진단 → 컨테이너 재시작        │
│ gemini-2.5-flash · 340 tokens · 1.2s             │
│ 2분 전                                   [Active] │
└──────────────────────────────────────────────────┘
```

- `🤖` 아이콘으로 AI 관여 이벤트 시각 구분
- 모델명 + 토큰 + 소요시간 서브라인
- 진단 요약을 title에 포함

#### C. 타입 필터에 `ai_diagnosis` 추가

현재 `ACTIVITY_TYPES`:

```typescript
['all', 'incident', 'recovery', 'approval', 'alert', 'circuit_breaker', 'cleanup'];
```

추가:

```typescript
['all', 'incident', 'recovery', 'ai_diagnosis', 'approval', 'alert', 'circuit_breaker', 'cleanup'];
```

---

## 문제 #3: 활동 피드가 너무 간략 — 상세 보기 없음

### 스크린샷에서 관찰된 실제 모습

Activity Feed 전체가 이런 패턴의 반복:

```
udGZAq03mSae  Incident  "Incident detected"  4/5/2026, 11:54:57 AM  Active
-LLuBwT0yzRC  Incident  "Incident detected"  4/5/2026, 11:54:57 AM  Active
ap3M27ehVe-r  Incident  "Incident detected"  4/5/2026, 11:54:57 AM  Active
DrRK6grK_Kch  Incident  "Incident detected"  4/5/2026, 11:54:57 AM  Active
udGZAq03mSae  Incident  "Incident detected"  4/5/2026, 11:54:27 AM  Active
...50+개 더...
```

**핵심 문제:**

1. **모든 항목이 "Incident detected"** — 어떤 인시던트인지 구분 불가
2. **description 필드 미렌더링** — `ActivityItem`에 `description`이 있지만 `ActivityFeed.tsx`에서 안 그림
3. **클릭/확장 불가** — 항목을 클릭해도 상세 정보를 볼 수 없음
4. **노이즈 폭탄** — 같은 프로젝트의 "Incident detected"가 30초 간격으로 반복, 스크롤이 끝없이 늘어남
5. **correlation 그룹이 작동하지만 부족** — `groupByCorrelation()`이 있으나 같은 correlationId를 공유하지 않는 반복 이벤트는 그룹화 안 됨

### 개선안

#### A. Collapsible 상세 보기 추가

```tsx
// ActivityFeed.tsx 각 항목에 ChevronDown + Collapsible 추가
<Collapsible>
  <CollapsibleTrigger>
    {/* 기존 한 줄 요약 */}
    <ChevronRight className="h-3 w-3 transition-transform" />
  </CollapsibleTrigger>
  <CollapsibleContent className="mt-2 pl-4 border-l-2 border-agent/30">
    {/* 설명 전문 */}
    <p className="text-sm text-secondary-ol">{item.description}</p>

    {/* correlation 그룹 하위 이벤트 */}
    {group.items.length > 1 && (
      <div className="mt-2 space-y-1">
        <span className="text-xs text-muted-ol font-semibold">
          관련 이벤트 {group.items.length}건
        </span>
        {group.items.slice(1, 6).map((sub) => (
          <div key={sub.id} className="text-xs text-muted-ol flex gap-2">
            <span>{relativeTime(new Date(sub.timestamp).getTime())}</span>
            <span>{sub.title}</span>
          </div>
        ))}
      </div>
    )}

    {/* AI 진단 결과 */}
    {item.aiMetadata?.diagnosisSummary && (
      <div className="mt-2 rounded bg-agent/5 border border-agent/20 p-2 text-xs">
        🤖 {item.aiMetadata.diagnosisSummary}
      </div>
    )}
  </CollapsibleContent>
</Collapsible>
```

#### B. 중복 이벤트 접기 (Noise Reduction)

현재: 같은 프로젝트 + 같은 title이 30초 간격으로 50개 나열됨.

개선: `groupByCorrelation()`을 확장하여 **같은 projectId + 같은 title + 5분 이내** 이벤트를 자동 그룹화:

```typescript
function groupByProjectAndTitle(items: ActivityItem[]): GroupedActivity[] {
  // 기존 correlationId 기반 + 추가로:
  // 같은 projectId + 같은 title + 5분 이내 → 하나의 그룹
  const key = `${item.projectId}::${item.title}::${Math.floor(ts / 300_000)}`;
}
```

**Before:** 50개 "Incident detected" 행
**After:** `[hotdeal-api] Incident detected  ×12  (11:50~11:54)  [Active]`

#### C. 상대 시간 + Tooltip

현재: `4/5/2026, 11:54:57 AM` (절대 시간만)
개선: `2분 전` (상대 시간) + hover 시 절대 시간 tooltip

---

## 문제 #4: 전문 용어만 표시 — 서킷브레이커/인시던트

### 스크린샷에서 관찰된 실제 모습

**Circuit Breakers 섹션:**

```
kue5NJZobmIE     🔴 Open     40 failures    1h ago    [Reset]
qa-ops-chain     🔴 Open     31 failures    44m ago   [Reset]
qa-rc7-pm        🟡 Half Open  53 failures  46m ago   [Reset]
hotdeal-worker   🟡 Half Open  5 failures   18h ago   [Reset]
```

**StatusHeroCard (프로젝트별 OperationsTab):**

```
CB: OPEN 3/5
```

**문제:**

1. **"Open" = 차단됨** — 일상 언어에서 "열림"은 정상을 의미하지만, CB에서는 반대
2. **"Half Open" = 뭐?** — 반쯤 열림? 반쯤 닫힘? 무슨 뜻인지 즉각적 이해 불가
3. **"40 failures"** — 무엇의 실패? API 호출? 복구 시도? 컨테이너 재시작?
4. **"Reset"** — 리셋하면 뭐가 되는지? 실패 카운트 초기화? 복구 재시도?
5. **프로젝트명이 ID인 경우** — `kue5NJZobmIE`, `-LLuBwT0yzRC` 등 읽을 수 없는 ID

### 개선안

#### A. 서킷브레이커 상태 평문화

```typescript
// web/src/components/ops/utils.ts 추가
export function describeCBState(
  state: string,
  failures: number,
  threshold = 5,
  lang: 'ko' | 'en' = 'ko',
): { label: string; explanation: string } {
  const labels = {
    open: {
      ko: {
        label: '🛑 자동 복구 중단',
        explanation: `연속 ${failures}회 복구 실패로 자동 복구가 일시 중단되었습니다`,
      },
      en: {
        label: '🛑 Recovery Paused',
        explanation: `Auto-recovery paused after ${failures} consecutive failures`,
      },
    },
    half_open: {
      ko: {
        label: '🔄 복구 재시도 중',
        explanation: `${failures}회 실패 후 복구를 다시 시도하고 있습니다`,
      },
      en: {
        label: '🔄 Testing Recovery',
        explanation: `Retrying recovery after ${failures} failures`,
      },
    },
    closed: {
      ko: { label: '✅ 정상', explanation: '자동 복구가 정상 작동 중입니다' },
      en: { label: '✅ Healthy', explanation: 'Auto-recovery is operating normally' },
    },
  };
  return labels[state]?.[lang] ?? { label: state, explanation: '' };
}
```

**Before:**

```
kue5NJZobmIE    🔴 Open    40 failures    [Reset]
```

**After:**

```
hotdeal-api     🛑 자동 복구 중단                    [복구 재시도]
                연속 40회 복구 실패로 일시 중단됨
                마지막 실패: 1시간 전
```

#### B. CircuitBreakerBadge 교체

**Before (`CircuitBreakerBadge.tsx`):**

```tsx
CB: {
  state.toUpperCase();
}
{
  state !== 'closed' && `${failures}/5`;
}
// 출력: "CB: OPEN 3/5"
```

**After:**

```tsx
// 평문 표시 + Tooltip에 기술 용어
<Tooltip content={`Circuit Breaker: ${state} (${failures}/${threshold})`}>
  <span>{describeCBState(state, failures, threshold, language).label}</span>
</Tooltip>
```

#### C. 인시던트 상태 평문화

현재 인시던트 카드:

```
udGZAq03mSae · Critical · Escalated
"critical incident"
12 occurrences · First: Apr 5 · Last: just now
```

**문제:**

- `Escalated` → 뭐로 에스컬레이션? 누구한테?
- `"critical incident"` → 내용이 없는 제목
- 프로젝트명이 ID

**After:**

```
hotdeal-api · 위험 · 수동 개입 필요
컨테이너 OOM Kill 반복 발생 — 자동 복구 실패
12회 발생 · 최초: 4월 5일 · 최근: 방금
```

#### D. 전체 용어 변환 테이블 (i18n 키)

| 원래 용어       | 한국어                | 영어 (개선)           |
| --------------- | --------------------- | --------------------- |
| `CB: OPEN`      | `자동 복구 일시 중단` | `Recovery Paused`     |
| `CB: HALF_OPEN` | `복구 재시도 중`      | `Testing Recovery`    |
| `CB: CLOSED`    | `정상`                | `Healthy`             |
| `Escalated`     | `수동 개입 필요`      | `Needs Manual Action` |
| `Active`        | `진행 중`             | `In Progress`         |
| `Resolved`      | `해결됨`              | `Resolved`            |
| `Reset` (버튼)  | `복구 재시도`         | `Retry Recovery`      |
| `failures`      | `복구 실패 횟수`      | `recovery failures`   |

---

## 문제 #5: 에이전트 실시간 상태 없음

### 스크린샷에서 관찰된 실제 모습

Operations Center에 **에이전트 관련 섹션이 전혀 없음.** 현재 구성:

1. Pending Approvals
2. Circuit Breakers
3. Active Incidents
4. Activity Feed

에이전트가 실행 중인지, 어떤 프로젝트를 진단 중인지, 몇 단계까지 진행됐는지 **알 수 있는 방법이 없음.**

상단 바에 "AI Online" 초록 점이 있지만 이것은 LLM 연결 상태일 뿐, 현재 실행 중인 복구 작업 정보가 아님.

### 개선안

#### A. 새 컴포넌트: `AgentActivityPanel.tsx`

OpsCenter 페이지의 **최상단** (Pending Approvals 위)에 배치:

```
┌──────────────────────────────────────────────────────────┐
│ 🤖 에이전트 현황                              실시간 🟢  │
│                                                          │
│ ┌─ hotdeal-api ──────────────────────────────────────┐   │
│ │ 🔄 크래시 진단 중...                    단계 1/3   │   │
│ │ ████████████░░░░░░░░░░░░░░  33%                   │   │
│ │ gemini-2.5-flash · 시작 2분 전                     │   │
│ └────────────────────────────────────────────────────┘   │
│                                                          │
│ ┌─ qa-ops-chain ─────────────────────────────────────┐   │
│ │ ⏳ 승인 대기: 롤백 실행                             │   │
│ │ OOM Kill 감지 → 이전 버전 롤백 제안                  │   │
│ │ 요청 시각: 11:44                  [승인] [거절]     │   │
│ └────────────────────────────────────────────────────┘   │
│                                                          │
│ 📊 최근 1시간 요약                                       │
│ ✅ 3건 자동 복구 성공 (평균 4.2초)                       │
│ ❌ 1건 진단 실패 (timeout)                               │
│ ⏳ 1건 승인 대기 중                                      │
└──────────────────────────────────────────────────────────┘
```

#### B. 백엔드 API

```
GET /api/ops/agent/active
```

Response:

```json
{
  "running": [
    {
      "id": "...",
      "projectId": "...",
      "projectName": "hotdeal-api",
      "triggerSource": "auto_recovery",
      "recoveryStrategy": "llm",
      "currentStep": 1,
      "totalSteps": 3,
      "stepDescription": "크래시 원인 진단 중",
      "startedAt": "2026-04-05T11:52:00Z",
      "model": "gemini-2.5-flash"
    }
  ],
  "pendingApproval": [...],
  "recentCompleted": [...]
}
```

#### C. 프론트엔드 훅

```typescript
function useAgentActivity(projectId?: string) {
  // running 상태 존재 시 3초 polling
  // idle 시 10초 polling
  // currentStep / totalSteps로 진행률 바 렌더링
}
```

#### D. OpsCenter 레이아웃 변경

```tsx
// 현재:
<ApprovalQueue />
<CircuitBreakerMap />
<IncidentMap />
<ActivityFeed />

// 개선:
<AgentActivityPanel />      // ← 새로 추가 (최상단)
<ApprovalQueue />           // ← 승인 대기는 AgentActivityPanel에도 인라인 표시
<IncidentMap />             // ← 인시던트를 CB보다 위로 (더 중요)
<CircuitBreakerMap />
<ActivityFeed />
```

---

## 추가 발견 사항 (스크린샷 분석에서)

### 6. 프로젝트 ID가 이름 대신 표시되는 문제

스크린샷에서 확인된 ID 노출 사례:

- 승인 배너: `Project: zN6HQC7zxfMO`
- 서킷브레이커: `kue5NJZobmIE`, `-LLuBwT0yzRC`, `SRYjPy85zDJf`, `0l5r6DKlGHAj`, `TXfDSdKj4obm`, `UVVpi_UHTKKg`, `aL0VIqTxA9-C`, `wCGI6nWuLqNy`
- 인시던트: `udGZAq03mSae`, `G1p8YlONtcWZ`, `xhfAIFlCjIGP`

**15개 서킷브레이커 중 10개 이상이 ID로 표시됨.** 이는 삭제되었거나 `projectNameById` 맵에서 누락된 프로젝트들.

**개선안:**

- 삭제된 프로젝트의 인시던트/CB는 `[삭제된 프로젝트] (ID: abc123)` 형식으로 표시
- 또는 `(archived)` 라벨 추가
- 정리 기능: "삭제된 프로젝트의 서킷브레이커/인시던트 일괄 정리" 버튼

### 7. Activity Feed "Disconnected" 상태

스크린샷에서 Activity Feed 헤더에 `Disconnected` 배지가 표시됨.
SSE 스트림 연결이 실패한 상태에서 사용자에게 왜 끊어졌는지, 재연결 시도 중인지 안내 없음.

**개선안:**

```
Activity Feed  [🔴 연결 끊김 — 재연결 시도 중... (3/5)]
               자동 재연결 실패 시 [수동 재연결] 버튼
```

### 8. i18n 미적용 하드코딩

스크린샷에서 확인된 영문 하드코딩:

- `"Recovery Approval Required"`
- `"Monitor agent activity, incidents, and system health across all projects."`
- `"Incident detected"`
- `"critical incident"`
- `"failures"`
- `"Reset"`
- `"View Timeline"` / `"Acknowledge"`
- `"Connected"` / `"Disconnected"`
- `relativeTime()` 반환값: `"42m ago"`, `"1h ago"`, `"just now"`

### 9. 인시던트 내용 없음

Active Incidents 섹션에서 모든 인시던트의 설명이:

```
"critical incident"
```

한 가지뿐. 어떤 종류의 인시던트인지 (OOM? health check 실패? 배포 실패?) 구분 불가.

유일하게 구체적 내용이 있는 항목:

```
Restart failed: (HTTP code 404) no such container - No such container: 0d92845b...
```

이 수준의 구체성이 모든 항목에 필요.

### 10. 모달 위치/중복

우하단 모달이 대시보드의 프로젝트 카드를 가림. 동시에 상단 배너 + Pending Approvals 섹션에도 같은 정보가 있어 3중 중복.

**개선안:** 모달 제거, 상단 배너를 더 상세하게 만들어서 단일 진입점으로 통합.

---

## 구현 우선순위

| 순위   | 문제                             | 변경 범위                  | 예상 임팩트                                            |
| ------ | -------------------------------- | -------------------------- | ------------------------------------------------------ |
| **P0** | #6 프로젝트 ID→이름 변환 실패    | API + 프론트엔드           | 전 섹션에 영향. 이거 안 고치면 나머지 개선도 의미 없음 |
| **P0** | #4 전문 용어 평문화              | 프론트엔드만 (매핑 테이블) | 코드 변경 최소, 체감 개선 최대                         |
| **P0** | #1 승인 카드 상세화              | API 필드 확장 + UI         | 사용자가 뭘 승인하는지 모르는 건 치명적                |
| **P1** | #3 Activity Feed 노이즈/상세보기 | 프론트엔드                 | 50개 "Incident detected" 반복은 쓸모없음               |
| **P1** | #5 에이전트 실시간 상태          | 새 API + 새 컴포넌트       | 핵심 가시성 부재                                       |
| **P2** | #2 AI 호출 메타데이터            | API + 프론트엔드           | #5 구현하면 상당 부분 해소                             |
| **P2** | #8 i18n 미적용                   | 문자열 래핑                | ko 사용자 경험                                         |
| **P3** | #7 SSE 재연결 안내               | 프론트엔드                 | 엣지 케이스                                            |
| **P3** | #10 모달 중복                    | 프론트엔드                 | 정리 수준                                              |

---

## 핵심 결론

**이 페이지의 가장 큰 문제는 "데이터 부재"가 아니라 "데이터 미전달"이다.**

1. 백엔드 `action_runs` 테이블에 `error_message`, `plan`, `steps_json`, `recovery_strategy`, `current_step`, `total_steps` 필드가 **이미 존재**
2. `ActivityItem`에 `description` 필드가 있지만 **렌더링 안 함**
3. `projectNameById` 맵이 있지만 **삭제/아카이브된 프로젝트에 대해 빈 값**

프론트엔드 `ActionRun` 인터페이스에 6개 필드를 추가하고, 문자열 매핑 테이블을 넣는 것만으로 #1, #2, #4의 대부분이 해결된다. 백엔드 수정은 최소화할 수 있다.

---

## 첨부 스크린샷

| 파일                    | 내용                                          |
| ----------------------- | --------------------------------------------- |
| `ops-01-dashboard.png`  | 대시보드 — 승인 배너 + 모달 + 프로젝트 그리드 |
| `ops-02-operations.png` | Operations Center 상단 — 승인 + 서킷브레이커  |
| `ops-03-incidents.png`  | 서킷브레이커 그리드 (스크롤)                  |
| `ops-04-activity.png`   | Activity Feed 영역                            |
| `ops-05-bottom.png`     | 페이지 하단                                   |
