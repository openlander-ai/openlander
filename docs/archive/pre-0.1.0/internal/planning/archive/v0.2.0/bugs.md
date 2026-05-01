# v0.2.0 Dashboard Redesign — 버그 & 개선사항 트래킹

> **도그푸딩 시작일**: 2026-03-07
> **테스터**: User (프로젝트 오너)
> **PM**: AI (Sisyphus)
> **검증 기준**: v0.2.0 구현 완료 상태 (빌드 ✅, 660/660 테스트 ✅)
>
> 버그 발견 시: 채팅으로 보고. PM이 이 문서에 등록 + GitHub Issue 생성.

---

## 해결된 버그

| ID      | 제목                                               | 심각도   | 유형 | 발견일     | 해결일     | 상태    |
| ------- | -------------------------------------------------- | -------- | ---- | ---------- | ---------- | ------- |
| BUG-014 | ask_user_question 호출 시 Web 배포 멈춤            | blocking | 버그 | 2026-03-07 | 2026-03-07 | ✅ 해결 |
| BUG-015 | 에이전트 스트리밍/thinking 과정 미노출             | major    | UX   | 2026-03-07 | 2026-03-07 | ✅ 해결 |
| BUG-016 | Running 프로젝트 타임라인 "Already running"만 표시 | major    | UX   | 2026-03-07 | 2026-03-07 | ✅ 해결 |
| BUG-017 | 로그 탭 접근성 — Logs 탭 전환 필요                 | minor    | UX   | 2026-03-07 | 2026-03-07 | ✅ 해결 |

---

## 상세

### BUG-014: ask_user_question 호출 시 Web 배포 멈춤 🔴

**심각도**: blocking
**환경**: Web Dashboard → New Project → Deploy 클릭
**재현**:

1. 새 프로젝트 배포 시작 (이전에 배포한 적 있는 레포 또는 Smart Defaults가 트리거되는 상황)
2. 에이전트가 `ask_user_question` 호출
3. UI에 "Running ask_user_question..." 표시 후 무한 대기

**기대**: 에이전트 질문이 UI에 카드 형태로 렌더링되어 사용자가 답변 가능
**실제**: 질문 렌더링 없이 "Running ask_user_question..." 텍스트만 보이고, 에이전트가 응답을 영원히 기다림

**근본 원인** (PM + Tech Lead 분석):

- `NewProjectFlow.tsx:116-138`의 SSE 이벤트 핸들러가 `thinking`, `tool_call`, `tool_result`, `message`, `error`만 처리
- `ask_user_question`의 `tool_call` 이벤트는 else 분기에 걸려 `setDeployStatus('Running ask_user_question...')`로만 표시
- QuestionBridge가 Promise 기반으로 에이전트를 pause하지만, 응답할 UI가 없어 영구 대기
- **Chicken-and-egg**: `build/stream`의 `question_pending` 핸들러는 `projectId` 기반이나, `ask_user_question`이 `deploy_project` 호출 전에 실행되면 projectId 미존재

**관련 코드**:

- `web/src/pages/NewProjectFlow.tsx:116-138` — SSE 이벤트 핸들러 (question 미처리)
- `src/web/api/routes.ts:391-535` — 배포 SSE 엔드포인트
- `src/web/api/routes.ts:725-741` — build/stream question_pending 핸들러
- `src/agent/question-bridge.ts` — Promise 기반 pause 메커니즘
- `src/agent/tools.ts:791` — ask_user_question 도구 정의

**Tech Lead 권고 해결책**:
프로젝트를 먼저 생성하고 모든 이벤트를 project-scoped로 통일. Deploy 흐름을 `POST /api/projects` (row 생성, projectId 반환) → `POST /api/projects/:id/deploy`로 분리하거나, 첫 SSE 이벤트로 `{type:'project_created', projectId}` 전송 후 즉시 redirect.

**공수 추정**: 2~4일

---

### BUG-015: 에이전트 스트리밍/thinking 과정 미노출 🟠

**심각도**: major
**환경**: Web Dashboard → 배포 진행 중
**재현**:

1. 새 프로젝트 배포 시작
2. 배포 중 화면 관찰

**기대**: 에이전트의 분석 과정, tool 호출, 추론이 타임라인에 표시
**실제**: "Agent is analyzing...", "Starting deployment..." 등 flat text 상태바만 보임. 에이전트 사고 과정 완전히 불투명.

**상세**:

- `NewProjectFlow` Phase A: 에이전트 SSE 이벤트를 받지만 `setDeployStatus()`로 텍스트 한 줄만 표시
- `ProjectDetail` Phase B: `build/stream` NDJSON만 소비 — 파이프라인 이벤트만 (cloning, building, starting)
- `event-types.ts`에 `agent_thinking`, `agent_tool_call`, `agent_message` 타입 + `agentEventToTimelineItem()` 함수가 정의되어 있으나 **dead code** — 어디에서도 호출되지 않음

**관련 코드**:

- `web/src/pages/NewProjectFlow.tsx:112-139` — flat status 표시
- `web/src/lib/event-types.ts:222-278` — agentEventToTimelineItem() (미사용)
- `web/src/hooks/use-timeline.ts` — build/stream NDJSON만 소비
- `web/src/components/timeline/TimelineFeed.tsx` — 타임라인 렌더링

**Tech Lead 권고 해결책**:
에이전트 + 파이프라인을 하나의 project-scoped 이벤트 스트림으로 통합. 이벤트를 DB에 persist하고 `build/stream`에서 함께 전송. `agentEventToTimelineItem()` 연결.

**Design 가이드**: 에이전트 카드는 접힌 상태가 기본, 펼칠 수 있게 (dashboard 감성 유지).

**공수 추정**: 2~5일 (이슈 1 이후)

---

### BUG-016: Running 프로젝트 타임라인 "Already running"만 표시 🟠

**심각도**: major
**환경**: Web Dashboard → 프로젝트 상세 → Timeline 탭
**재현**:

1. 이미 running 중인 프로젝트 상세 페이지 진입
2. Timeline 탭 확인

**기대**: 마지막 배포 히스토리, 에이전트 인사이트, 컨테이너 상태 등 표시
**실제**: "Already running" 한 줄만 표시. 이전 배포 정보 없음, 인사이트 없음.

**원인**:

```typescript
// routes.ts:748-753
if (fresh.status === 'running') {
  write({ type: 'complete', message: `Already running`, projectId: project.id });
  cleanup();
  void s.close();
  return;
}
```

**Tech Lead 권고 해결책**:
마지막 배포의 이벤트 히스토리를 burst로 전송 → 현재 상태 카드("Currently running") → 활성 배포 있으면 live 계속.

**공수 추정**: 1~2일 (BUG-015 이후, persist 구조 재활용)

---

### BUG-017: 로그 탭 접근성 🟢

**심각도**: minor
**환경**: Web Dashboard → 프로젝트 상세
**재현**: 프로젝트 상세에서 실시간 로그를 보려면 Logs 탭으로 전환해야 함

**현재 구현 (정상 동작)**:

- Follow 모드: `GET /api/projects/:id/logs?follow=true` — 실시간 tail 스트리밍
- Static 모드: `GET /api/projects/:id/logs?lines=500` — 최근 500줄
- 스크롤 올리면 자동으로 follow 해제
- Follow 토글 버튼 있음

**개선 제안**: Timeline 탭 내에 접을 수 있는 "Live Logs" 미니 패널 추가. 배포 중엔 기본 열림, idle이면 접힘.

**공수 추정**: 0.5~1일

---

## 아키텍처 노트 (Tech Lead 경고)

> 현재 2-phase SSE→NDJSON 구조가 BUG-014, 015, 016의 공통 근본 원인.
>
> **지속 가능한 방향**: 하나의 project-scoped 이벤트 모델.
>
> - projectId를 즉시 생성
> - 모든 이벤트(에이전트 + 파이프라인 + 질문)를 DB에 persist
> - history + live를 하나의 스트림 엔드포인트로 노출
> - QuestionBridge의 Promise 기반 pause → DB 기반 persist + resume으로 전환 (내구성 확보)

---

## 실행 순서 (Tech Lead 권고)

```
1. BUG-014 — ask_user_question 멈춤 [blocking]         2~4일
   └─ 프로젝트 먼저 생성 → 모든 이벤트 project-scoped
2. BUG-015 — 에이전트 스트리밍 노출 [major UX]         2~5일
   └─ 통합 이벤트 persist + stream + 타임라인 연결
3. BUG-016 — Running 타임라인 히스토리 [major UX]       1~2일
   └─ BUG-015의 persist 구조 재활용, 자연스럽게 해결
4. BUG-017 — 로그 미니 패널 [minor UX]                 0.5~1일
   └─ 독립적
                                        총 ~5.5~12일
```

---

## 심각도 기준

| 심각도       | 설명                                            | 조치                               |
| ------------ | ----------------------------------------------- | ---------------------------------- |
| **blocking** | 핵심 기능 사용 불가. 배포 자체가 안 됨.         | 즉시 수정. 릴리즈 불가.            |
| **major**    | 기능은 되지만 심각한 UX 문제. 사용자 경험 저해. | 릴리즈 전 수정 권장.               |
| **minor**    | 불편하지만 사용 가능. UI 개선, 편의 기능.       | User 판단으로 다음 버전 이관 가능. |

---

## 도그푸딩 종료 조건

- [x] blocking 버그 0개
- [x] major 버그 0개 (또는 User 판단으로 이관)
- [x] minor 버그 0개
- [ ] E2E 배포 시나리오 통과 (New Project → Deploy → Running → Logs 확인)
- [ ] User가 "OK" 선언
