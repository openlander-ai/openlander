# v0.2.0 — Dashboard Redesign

## 개요

- **한 줄 요약**: 채팅 인터페이스를 제거하고, Vercel-inspired 라이트 모드 대시보드로 전면 전환
- **핵심 문제**: 현재 UI가 "Cyber-Industrial" 다크 테마 + 채팅 중심 → 프로페셔널 배포 플랫폼과 괴리
- **해결 방법**: 라이트 모드 + 클린 디자인 + 대시보드 퍼스트 레이아웃. AI는 백그라운드 어시스트.
- **관련 결정**: DEC-023 (방향 전환), DEC-024 (UI/UX), DEC-025 (MVP 스코프)

## 제품 포지셔닝 변경

> **이전**: "서버 상태를 아는 배포 에이전트" — 채팅이 메인 인터페이스
> **이후**: "실패를 스스로 고치는 셀프호스트 배포 플랫폼" — 대시보드가 메인, AI는 어시스트

**포지셔닝**: Coolify의 Docker 기반 + Vercel의 깔끔한 UX + AI 자동 수정

---

## 변경 범위

### 삭제 대상

| 파일/디렉토리                       | 이유                                                             |
| ----------------------------------- | ---------------------------------------------------------------- |
| `web/src/components/chat/`          | ChatPanel, ChatInput, ChatMessage, ToolCallCard — 채팅 전면 제거 |
| `web/src/hooks/use-chat.ts`         | 채팅 관련 훅                                                     |
| `web/src/index.css` 내 Cyber 스타일 | scanline, glow, grid-pattern, progress-stripes                   |

### 수정 대상

| 파일                                      | 변경 내용                                |
| ----------------------------------------- | ---------------------------------------- |
| `web/src/index.css`                       | 디자인 토큰 전체 교체 (다크 → 라이트)    |
| `web/tailwind.config.js`                  | 라이트 모드 색상 시스템                  |
| `web/src/components/layout/AppLayout.tsx` | 채팅 slide-over/FAB 제거, 2컬럼 레이아웃 |
| `web/src/components/layout/Header.tsx`    | 채팅 토글 제거, 라이트 스타일            |
| `web/src/pages/ProjectsGrid.tsx`          | 라이트 모드 카드 스타일                  |
| `web/src/pages/ProjectDetail.tsx`         | 탭 구조 재설계 + 라이트 스타일           |
| `web/src/pages/NewProjectFlow.tsx`        | 라이트 스타일                            |
| `web/src/pages/SettingsPage.tsx`          | 라이트 스타일                            |
| 모든 UI 컴포넌트                          | 다크 하드코딩 → 라이트 모드 전환         |

### 신규 생성

| 파일                                 | 용도                                          |
| ------------------------------------ | --------------------------------------------- |
| `web/src/pages/DeploymentDetail.tsx` | 개별 배포 상세 (빌드 로그 스트리밍 + AI 분석) |
| Deployments 탭 (ProjectDetail 내)    | 배포 히스토리 리스트                          |

---

## 디자인 시스템

### 컬러 팔레트 (라이트 모드)

```css
:root {
  /* ── Layout ── */
  --bg-app: #ffffff;
  --bg-panel: #fafafa;
  --bg-subtle: #f4f4f5; /* zinc-100 */

  /* ── Border ── */
  --border-default: #e4e4e7; /* zinc-200 */
  --border-hover: #d4d4d8; /* zinc-300 */

  /* ── Text ── */
  --text-primary: #09090b; /* zinc-950 */
  --text-secondary: #71717a; /* zinc-500 */
  --text-muted: #a1a1aa; /* zinc-400 */

  /* ── Status ── */
  --color-success: #22c55e; /* green-500 */
  --color-warning: #f59e0b; /* amber-500 */
  --color-error: #ef4444; /* red-500 */

  /* ── Brand Accent ── */
  --color-accent: #2563eb; /* blue-600 — 라이트 배경에서 가독성 우수 */

  /* ── shadcn/ui semantic (라이트) ── */
  --background: 0 0% 100%;
  --foreground: 240 10% 4%;
  --card: 0 0% 98%;
  --card-foreground: 240 10% 4%;
  --popover: 0 0% 100%;
  --popover-foreground: 240 10% 4%;
  --primary: 221 83% 53%; /* blue-600 */
  --primary-foreground: 0 0% 100%;
  --secondary: 240 5% 96%;
  --secondary-foreground: 240 6% 10%;
  --muted: 240 5% 96%;
  --muted-foreground: 240 4% 46%;
  --accent: 240 5% 96%;
  --accent-foreground: 240 6% 10%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 0 0% 100%;
  --border: 240 6% 90%;
  --input: 240 6% 90%;
  --ring: 221 83% 53%;
  --radius: 0.5rem;
}
```

### 타이포그래피

| 용도      | 서체           | 비고 |
| --------- | -------------- | ---- |
| 제목      | Outfit         | 유지 |
| 본문      | Manrope        | 유지 |
| 코드/로그 | JetBrains Mono | 유지 |

### 컴포넌트 스타일 가이드

| 컴포넌트             | 스타일                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| **카드**             | `bg-white border border-zinc-200 rounded-lg` → hover: `border-zinc-300 shadow-sm`                      |
| **버튼 (primary)**   | `bg-zinc-950 text-white hover:bg-zinc-800 rounded-md` (Vercel 스타일)                                  |
| **버튼 (secondary)** | `bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-50`                                       |
| **버튼 (accent)**    | `bg-blue-600 text-white hover:bg-blue-700` (Deploy 등 핵심 액션)                                       |
| **상태 dot**         | `h-2 w-2 rounded-full` + 색상만 (glow 없음)                                                            |
| **Badge**            | `text-xs px-2 py-0.5 rounded-full font-medium` + 색상별 bg/text                                        |
| **입력 필드**        | `bg-white border border-zinc-200 rounded-md focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500` |
| **사이드바**         | `bg-zinc-50 border-r border-zinc-200`                                                                  |
| **헤더**             | `bg-white border-b border-zinc-200`                                                                    |

### 제거할 CSS 효과

- ❌ `.glow-success`, `.glow-agent`, `.glow-error`
- ❌ `.bg-grid-pattern`
- ❌ `.scanline`, `.scanline::after`
- ❌ `.progress-glow`, `.progress-stripes`
- ❌ `@keyframes scan`, `@keyframes progress-stripes`
- ❌ shadow에 `var(--color-*)` 사용하는 발광 효과

### 유지할 CSS 효과

- ✅ `.card-hover` (translateY -1px — Vercel도 사용)
- ✅ `.timeline-item-enter` (slide-in — 빌드 로그 스트리밍에 재활용)
- ✅ `@keyframes accordion-down/up` (UI 인터랙션)

---

## 페이지 구조

### 레이아웃 (채팅 제거 후)

```
┌─ Header ────────────────────────────────────────┐
│  Logo    Projects   Settings                    │
├──────────┬──────────────────────────────────────┤
│ Sidebar  │  Main Content Area                    │
│ 240px    │                                       │
│          │                                       │
│ Projects │                                       │
│ - app-1  │                                       │
│ - app-2  │                                       │
│          │                                       │
│ System   │                                       │
│ Stats    │                                       │
└──────────┴──────────────────────────────────────┘
```

**변경**: 3컬럼(sidebar + main + chat) → 2컬럼(sidebar + main). 메인 콘텐츠 영역 확대.

### 라우트 구조

| 경로                                  | 페이지                 | 설명                              |
| ------------------------------------- | ---------------------- | --------------------------------- |
| `/`                                   | → `/projects` 리디렉트 |                                   |
| `/projects`                           | ProjectsGrid           | 프로젝트 카드 그리드              |
| `/projects/new`                       | NewProjectFlow         | Git URL 입력 → Deploy             |
| `/projects/:id`                       | ProjectDetail          | 탭 구조 (아래 참조)               |
| `/projects/:id/deployments/:deployId` | DeploymentDetail       | 빌드 로그 + AI 분석               |
| `/settings`                           | SettingsPage           | AI Model, GitHub, Secrets, System |
| `/setup`                              | SetupScreen            | 초기 설정 (기존 유지)             |

### /projects — Projects Grid

프로젝트 카드 그리드. 기존 구조 유지, 스타일만 라이트 모드.

카드 내용:

- 프로젝트명 + 상태 badge (Live/Deploying/Failed/Stopped)
- URL (있으면)
- Git branch + 마지막 배포 시간
- 호버 시: Redeploy, Visit, Settings 버튼

### /projects/:id — Project Detail

탭 구조:

```
[Overview]  [Deployments]  [Domains]  [Environment]  [Settings]
```

#### Overview 탭

- 현재 배포 상태 (큰 상태 표시)
- 최근 배포 요약 (커밋 해시, 메시지, 시간, 소요 시간)
- 빠른 액션: Redeploy 버튼, Visit 버튼
- 프로젝트 URL 표시

#### Deployments 탭 (신규)

배포 히스토리 리스트. 데이터 소스: `deploy_logs` 테이블 (이미 존재).

```
┌──────────────────────────────────────────────────────┐
│ ● Production  abc123f  feat: add login     2m ago    │
│   Duration: 38s   Trigger: git push                  │
├──────────────────────────────────────────────────────┤
│ ✕ Error       def456a  fix: config         1h ago    │
│   Duration: 12s   Trigger: manual                    │
│   ⚠ AI: Missing environment variable PORT           │
├──────────────────────────────────────────────────────┤
│ ○ Previous    789abc0  initial deploy      2d ago    │
│   Duration: 45s   Trigger: manual                    │
└──────────────────────────────────────────────────────┘
```

각 항목 클릭 → `/projects/:id/deployments/:deployId`

#### Domains 탭

기존 DomainsPanel 유지 + LAN 접속 정보. 스타일만 라이트 모드.

#### Environment 탭

기존 EnvVarsTable 유지. 스타일만 라이트 모드.

#### Settings 탭

Git 설정, 빌드 설정, Danger Zone (프로젝트 삭제).

### /projects/:id/deployments/:deployId — Deployment Detail (신규)

빌드 로그 스트리밍 페이지:

```
┌─ Deployment Header ─────────────────────────────────┐
│  ● Production   abc123f   feat: add login           │
│  Started 2m ago · Duration 38s · Trigger: git push  │
├─────────────────────────────────────────────────────┤
│  Build Logs                                          │
│  ┌─────────────────────────────────────────────────┐ │
│  │ 14:32:01  Cloning repository...              ✓ │ │
│  │ 14:32:03  Building Docker image...           ✓ │ │
│  │ 14:32:15  Step 1/8: FROM node:20-alpine        │ │
│  │ 14:32:16  Step 2/8: WORKDIR /app               │ │
│  │ ...                                             │ │
│  │ 14:32:38  Container started                  ✓ │ │
│  │ 14:32:39  Health check passed                ✓ │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  ┌─ AI Analysis (실패 시에만 표시) ────────────────┐ │
│  │ ⚠ Build failed at Step 5/8                      │ │
│  │ Cause: Missing dependency 'sharp'               │ │
│  │ Fix: Added to Dockerfile, retrying...           │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

- 실시간 스트리밍: 기존 SSE/NDJSON 인프라 재사용
- 타임스탬프 + 로그 라인
- 실패 시 AI 분석 결과 박스 (BuildRecovery 결과 활용)
- 자동 수정 시도 시 retry 상태 표시

---

## AI 어시스트 표시 방식 (채팅 없이)

채팅 제거 후 AI 결과를 표시하는 방법:

| 상황                | 표시 위치                    | 표시 방식                                |
| ------------------- | ---------------------------- | ---------------------------------------- |
| 빌드 실패 분석      | Deployment Detail 페이지     | "AI Analysis" 박스 — 원인 + 수정 방법    |
| 자동 수정 시도      | Deployment Detail 페이지     | "Auto-fix attempted" 상태 + retry 로그   |
| 런타임 크래시 감지  | 알림 센터 + Project Overview | 알림 배지 + 크래시 분석 요약             |
| Post-Deploy Insight | Project Overview             | 인사이트 카드 (기존 InsightCard 활용)    |
| Smart Defaults      | Deploy 시 자동 적용          | 로그에 "Applied smart default: ..." 표시 |

---

## 구현 순서

### Phase 1: 디자인 토큰 + 레이아웃 전환

1. `index.css` 디자인 토큰 교체 (Cyber-Industrial → 라이트 모드)
2. `tailwind.config.js` 업데이트
3. `AppLayout.tsx` — 채팅 관련 코드 전부 제거, 2컬럼 구조
4. `Header.tsx` — 채팅 토글 제거, 라이트 스타일
5. `Sidebar` — 라이트 스타일

### Phase 2: 기존 페이지 스타일 전환

6. `ProjectsGrid.tsx` — 라이트 모드 카드
7. `ProjectDetail.tsx` — 탭 구조 정리 + 라이트 스타일
8. `NewProjectFlow.tsx` — 라이트 스타일
9. `SettingsPage.tsx` — 라이트 스타일
10. `SetupScreen.tsx` — 라이트 스타일
11. 나머지 공유 컴포넌트 (Button, Input, Dialog 등)

### Phase 3: 신규 기능

12. Deployments 탭 — 배포 히스토리 리스트 (deploy_logs 데이터)
13. DeploymentDetail 페이지 — 빌드 로그 스트리밍
14. AI Analysis 박스 컴포넌트 — 실패 시 표시

### Phase 4: 정리

15. `web/src/components/chat/` 디렉토리 삭제
16. `use-chat.ts` 훅 삭제
17. 불필요한 import/참조 정리
18. 전체 빌드 검증

---

## 수락기준

### Phase 1

- [x] 앱 전체가 흰색/라이트 배경으로 표시됨
- [x] 채팅 FAB (우하단 파란 버튼)이 표시되지 않음
- [x] 채팅 slide-over가 동작하지 않음
- [x] 사이드바 + 메인 2컬럼 레이아웃 정상 동작
- [x] `npx vite build` 성공

### Phase 2

- [x] 모든 기존 페이지가 라이트 모드로 정상 표시
- [x] scanline, glow, grid-pattern 등 Cyber 스타일이 화면에 없음
- [x] 프로젝트 카드 hover 동작 정상 (translateY)
- [x] 상태 badge가 glow 없이 심플하게 표시됨
- [x] 입력 필드, 버튼 등 인터랙션 요소 정상 동작

### Phase 3

- [x] 프로젝트 상세에서 "Deployments" 탭 클릭 시 배포 히스토리 리스트 표시
- [x] 히스토리에 상태(성공/실패), 커밋 해시, 시간, trigger 표시
- [x] 배포 항목 클릭 시 DeploymentDetail 페이지로 이동
- [ ] 빌드 로그가 실시간 스트리밍됨 ← 기존 SSE 인프라 연결 필요 (도그푸딩에서 검증)
- [x] 실패한 배포에 AI 분석 결과 박스가 표시됨

### Phase 4

- [x] `web/src/components/chat/` 디렉토리가 존재하지 않음
- [x] `use-chat.ts` 파일이 존재하지 않음
- [x] `npx vite build` 성공
- [x] `lsp_diagnostics` 0 errors
- [x] Chat API 엔드포인트 4개 삭제 (POST /chat, /chat/stream, /question/reply, /question/dismiss)

---

## 데이터 소스 (백엔드 — 이미 존재)

| 데이터              | 소스                                              | 비고             |
| ------------------- | ------------------------------------------------- | ---------------- |
| 배포 히스토리       | `deploy_logs` 테이블                              | DB에 이미 기록됨 |
| 빌드 로그 스트리밍  | SSE/NDJSON (`/api/projects/:id/events`)           | 이미 구현됨      |
| AI 분석 결과        | `BuildRecovery.classify()`                        | 이미 구현됨      |
| 런타임 크래시 감지  | `docker.waitForHealthy()` + `deploy:crash` 이벤트 | 이미 구현됨      |
| Post-Deploy Insight | `post-deploy-insight.ts`                          | 이미 구현됨      |
| 자동 배포 webhook   | v0.0.2에서 구현                                   | UI 연결만 필요   |

> 백엔드 변경 최소화 달성. 프론트엔드 작업 + 백엔드 API 2개 추가 + Chat API 4개 삭제.
> `GET /api/projects/:id/deployments` + `GET /api/projects/:id/deployments/:deployId` 엔드포인트 추가 완료.
