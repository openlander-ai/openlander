# OpenLander Web MVP — Product Specification

> **Version**: v0.1.0 (Web MVP)  
> **Status**: Tech Lead 리뷰 반영 완료 (v2)  
> **작성일**: 2026-03-04  
> **리뷰 반영일**: 2026-03-04  
> **관련 문서**: [`docs/design/web-mvp-ui-ux.md`](../../design/web-mvp-ui-ux.md), [`tech-lead-review.md`](./tech-lead-review.md)

---

## 1. 개요

### 한 줄 정의

**"브라우저에서 레포 연결해서 딸깍"** — Connect repo, click, done. Agent handles everything in background.

### 핵심 문제

1. **에이전틱 코딩 사용자가 배포에 진입하지 못함** — AI로 앱은 만들 수 있지만, Docker/리버스프록시/도메인 지식이 없어 배포를 못 함
2. **TUI가 타겟 오디언스에 부적합** — 터미널 친화적이지 않은 사용자(기획자, 디자이너, 비개발자)에게 TUI는 진입장벽
3. **기존 셀프호스팅 도구의 한계** — Coolify/Dokploy는 인프라 지식 전제, "풀서비스" 경험 없음

### 해결 방안

**Web-first 배포 에이전트**로 전환:

- **Agent Timeline**을 히어로 화면으로 — 에이전트의 "생각 과정"을 실시간 스트리밍으로 시각화
- **Intervention Pattern** — 에이전트가 자율 실행, 사용자 개입 필요 시 타임라인 내 인라인 폼 카드로 요청
- **Chat은 보조** — 슬라이드오버 패널로, 질문/오버라이드 전용
- **사이버-인더스트리얼 디자인** — Linear + Terminal + Sci-Fi HUD 감성, 다크 모드 기본

---

## 2. 변경 범위

### 2.1 신규 생성

| 경로                              | 설명                                      |
| --------------------------------- | ----------------------------------------- |
| `web/src/components/timeline/`    | Agent Timeline 컴포넌트 (히어로 화면)     |
| `web/src/components/project/`     | Projects Grid, ProjectDetail, ConfigPanel |
| `web/src/components/chat/`        | ChatPanel (슬라이드오버), ChatInput 개선  |
| `web/src/components/onboarding/`  | Onboarding Wizard (3단계)                 |
| `web/src/hooks/use-timeline.ts`   | NDJSON 타임라인 스트림 훅                 |
| `web/src/hooks/use-log-stream.ts` | 로그 스트리밍 + 가상화 훅                 |
| `web/src/lib/event-types.ts`      | Typed event definitions (프론트엔드용)    |

### 2.2 수정

| 경로                                      | 변경 내용                                       |
| ----------------------------------------- | ----------------------------------------------- |
| `web/tailwind.config.js`                  | Tailwind v3 유지 + 커스텀 디자인 토큰 확장      |
| `web/src/index.css`                       | CSS 변수 (--bg-app, --color-agent 등) 추가      |
| `web/package.json`                        | react-router-dom, @tanstack/virtual 등 추가     |
| `web/src/App.tsx`                         | React Router 도입 + 레이아웃 구조               |
| `web/src/components/layout/AppLayout.tsx` | Sidebar + Main + ChatPanel 구조                 |
| `web/src/lib/api.ts`                      | NDJSON 스트리밍 API 클라이언트 확장             |
| `src/web/server.ts`                       | Bun 호환 SPA 정적 파일 서빙                     |
| `src/web/api/routes.ts`                   | 빌드 스트림에 question_pending 이벤트 타입 추가 |

### 2.3 TUI Freeze

| 경로           | 조치                                                                      |
| -------------- | ------------------------------------------------------------------------- |
| `src/tui/`     | Git tag `tui-last`, 기능 동결                                             |
| `package.json` | TUI 빌드에서 제외 (별도 진입점 유지)                                      |
| `src/cli/`     | CLI-lite 명령어만 유지: `deploy`, `status`, `logs`, `open`, `projects ls` |

---

## 3. 기능별 상세

### 3.0 Phase 0 — Architecture (선행 필수)

> **Tech Lead 리뷰 반영**: Architecture 작업이 Phase 1 전에 완료되어야 프론트엔드 개발이 가능.

#### 3.0.1 SPA Serving from Hono Daemon

**AS-IS (현재)**

- `startDaemon()` Unix socket만 서빙
- 정적 파일 서빙 없음

**TO-BE (목표)**

- `GET /*` → `web/dist/index.html` 서빙
- `GET /assets/*` → 정적 파일 서빙
- `/api/*` 는 기존대로

**HOW (구현 방향)**

> ⚠️ **Tech Lead 리뷰 반영**: 프로젝트는 Bun 런타임 사용. `@hono/node-server/serve-static`은 Node.js 전용이므로 사용 불가.

```ts
// src/web/server.ts — Bun 호환 방식
import { Hono } from 'hono';
import { existsSync } from 'fs';
import { join } from 'path';

const WEB_DIST = join(import.meta.dir, '../../web/dist');

// API 라우트 먼저 마운트 (기존 유지)
app.route('/api', apiRoutes);

// 정적 파일 서빙 (Bun.file 사용)
app.get('/assets/*', async (c) => {
  const filePath = join(WEB_DIST, c.req.path);
  const file = Bun.file(filePath);
  if (await file.exists()) {
    return new Response(file);
  }
  return c.notFound();
});

// SPA fallback — 모든 비-API 요청을 index.html로
app.get('*', async (c) => {
  const indexPath = join(WEB_DIST, 'index.html');
  return new Response(Bun.file(indexPath), {
    headers: { 'Content-Type': 'text/html' },
  });
});
```

**수락기준**

- [ ] `openlander start` 시 웹 UI 접속 가능 (`http://localhost:10003`)
- [ ] `/api/*` 라우트 정상 동작 (기존 API 회귀 없음)
- [ ] `/projects/123` 접속 후 새로고침 시 SPA 라우팅 유지 (404 아님)
- [ ] `/assets/index-xxx.js` 등 정적 파일 Content-Type 정확

---

#### 3.0.2 TUI Freeze

**수락기준**

- [ ] `git tag tui-last` 생성
- [ ] `package.json`에서 TUI 빌드 분리 (별도 엔트리포인트)
- [ ] 기본 `openlander` 명령이 웹 서버 + 브라우저 오픈 (TUI 실행 아님)
- [ ] `openlander --tui` 플래그로 기존 TUI 접근 가능 (호환성)

---

#### 3.0.3 React Router Setup

> **Tech Lead 리뷰 반영**: 현재 web/에 React Router 미설치. 라우팅은 모든 페이지의 전제 조건.

**AS-IS**

- `web/src/App.tsx`에 라우팅 없음, 단일 페이지
- `react-router-dom` 미설치

**TO-BE**

```tsx
// web/src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

<BrowserRouter>
  <Routes>
    <Route path="/setup" element={<SetupScreen />} />
    <Route element={<AppLayout />}>
      <Route path="/projects" element={<ProjectsGrid />} />
      <Route path="/projects/new" element={<NewProjectFlow />} />
      <Route path="/projects/:id" element={<ProjectDetail />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Route>
    <Route path="/" element={<Navigate to="/projects" />} />
  </Routes>
</BrowserRouter>;
```

**수락기준**

- [ ] `react-router-dom` v6+ 설치됨
- [ ] `/projects`, `/projects/new`, `/projects/:id`, `/settings`, `/setup` 라우트 동작
- [ ] `/` 접속 시 `/projects` 또는 `/setup`으로 리다이렉트 (LLM 설정 여부에 따라)
- [ ] `<AppLayout>` 이 중첩 라우트의 레이아웃 래퍼로 동작 (Outlet)
- [ ] 브라우저 뒤로가기/앞으로가기 정상 동작

---

### 3.1 Phase 1 — Core

#### 3.1.1 Theme Setup (Tailwind v3 + 디자인 토큰)

> **Tech Lead 리뷰 반영 (스펙 변경)**: Tailwind v4 → v3 유지. v4는 아직 초기 단계이고 API 변경 위험이 있음. v3.4.19에서 `extend` + CSS 변수로 동일한 디자인 토큰 구현. v4 마이그레이션은 Phase 3 이후 별도 검토.

**AS-IS (현재)**

- `web/tailwind.config.js` Tailwind v3.4.19, 기본 설정
- 색상/폰트 표준화 없음

**TO-BE (목표)**

- Tailwind v3 유지 + `tailwind.config.js`의 `extend`에 커스텀 색상/폰트 추가
- CSS 변수로 디자인 토큰 정의 (런타임 테마 변경 대비)
- "Cyber-Industrial Precision" 컬러 팔레트
- Outfit/Manrope/JetBrains Mono 폰트

**HOW (구현 방향)**

```css
/* web/src/index.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --bg-app: #050505;
    --bg-panel: #0a0a0a;
    --bg-subtle: #171717;
    --color-agent: #06b6d4;
    --color-success: #22c55e;
    --color-warning: #f59e0b;
    --color-error: #ef4444;
    --text-primary: #fafafa;
    --text-secondary: #a1a1aa;
    --text-muted: #52525b;
  }
}
```

```js
// web/tailwind.config.js (extend)
module.exports = {
  theme: {
    extend: {
      colors: {
        'bg-app': 'var(--bg-app)',
        'bg-panel': 'var(--bg-panel)',
        'bg-subtle': 'var(--bg-subtle)',
        agent: 'var(--color-agent)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        error: 'var(--color-error)',
      },
      fontFamily: {
        display: ['Outfit', 'sans-serif'],
        body: ['Manrope', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
};
```

**수락기준**

- [ ] `npm run build` 시 Tailwind CSS 변수가 빌드됨 (에러 없음)
- [ ] 모든 신규 컴포넌트가 `bg-bg-app`, `text-agent` 등 토큰 클래스 사용 (하드코딩 색상 없음)
- [ ] Outfit(헤더)/Manrope(본문)/JetBrains Mono(코드) 3종 폰트 적용됨
- [ ] 다크 모드가 기본, 라이트 모드 토글 없음 (v0.1.0 범위外)
- [ ] 기존 shadcn/ui 컴포넌트가 깨지지 않음

---

#### 3.1.2 Layout Refactor (Sidebar + Main + Collapsible Chat)

**AS-IS**

- `AppLayout.tsx` 기본 구조만 존재
- Chat이 메인, 사이드바 없음

**TO-BE**

```
┌─────────┬───────────────────────────┬──────────────┐
│ Sidebar │ Main Content              │ Chat Panel   │
│ (240px) │ (Timeline/Logs/Config)    │ (0~400px)    │
│         │                           │ [토글]       │
├─────────┴───────────────────────────┴──────────────┤
│ Status Bar (System Stats)                           │
└─────────────────────────────────────────────────────┘
```

**HOW**

- Sidebar: 프로젝트 리스트 + Settings 링크 + System Stats 미니차트
- Main: React Router `<Outlet />` — 라우트별 컨텐츠 렌더링
- Chat: Sheet 컴포넌트로 우측 슬라이드오버, `Cmd+.` 단축키로 토글

**수락기준**

- [ ] 사이드바가 프로젝트 목록 표시, 클릭 시 `/projects/:id` 이동
- [ ] 메인 영역이 React Router `<Outlet />`으로 라우트별 컨텐츠 렌더링
- [ ] 채팅 패널이 기본 숨김, "Ask Agent" 버튼 또는 `Cmd+.`로 열림
- [ ] 반응형: 1280px 미만 시 사이드바 아이콘만 표시

---

#### 3.1.3 Projects List Page

**AS-IS**

- `ProjectSidebar.tsx` 간단한 목록만
- 상태 표시/빈 상태 없음

**TO-BE**

- 반응형 그리드 (2~4열)
- 프로젝트 카드: 상태 Dot + 이름 + URL + 마지막 배포 시간 + 브랜치
- 빈 상태: "Deploy your first app" CTA 버튼 (대시 보더 카드 + `+` 아이콘)
- 호버 시 "Redeploy", "Settings" 버튼 표시

> **Tech Lead 리뷰 반영 (명확화)**: 빈 상태의 "드래그앤드롭"을 제거. CTA 버튼 클릭 → `/projects/new` 이동으로 단순화.

**수락기준**

- [ ] `/projects` 에서 프로젝트 그리드 표시
- [ ] 각 카드가 상태(Dot 색상: 초록=Live, 빨강=Failed, 주황=Deploying, 회색=Stopped) + 이름 + URL + 마지막 배포 시간 표시
- [ ] 프로젝트 0개 시 "Deploy your first app" CTA 버튼 표시, 클릭 시 `/projects/new` 이동
- [ ] 카드 클릭 시 `/projects/:id` 이동
- [ ] 호버 시 "Redeploy", "Settings" 버튼 표시

---

#### 3.1.4 New Project Flow

**AS-IS**

- `DeployDialog.tsx` 간단한 모달만 존재
- 레포 검색/선택 UI 없음

**TO-BE**

1. `/projects/new` 접속 또는 "+ New Project" 클릭
2. **Step 1**: 레포 선택 (검색 + "My Repos" / "Starred" / "Search" 탭)
3. **Step 2**: 브랜치/이름 설정 (선택)
4. **Step 3**: "Deploy" 클릭 → 즉시 `/projects/:id` 리다이렉트, 타임라인 시작

**HOW**

- `GET /api/repos` + `GET /api/repos/search` 사용 (org 레포 포함)
- 레포 선택 → `POST /api/projects/deploy` 호출
- 응답에서 `projectId` 추출 → `navigate(`/projects/${projectId}`)` 리다이렉트

**수락기준**

- [ ] `/projects/new` 에서 GitHub 레포 리스트 표시 (페이지네이션)
- [ ] Org 레포도 표시됨
- [ ] 검색어 입력 시 `/api/repos/search` 호출, 결과 표시
- [ ] "Deploy" 클릭 시 `POST /api/projects/deploy` 호출
- [ ] 배포 시작 후 `/projects/:id` 리다이렉트
- [ ] 리다이렉트 후 타임라인이 첫 이벤트 ("Starting deployment...") 표시

---

#### 3.1.5 Agent Timeline Component (THE HERO)

> **Tech Lead 리뷰 반영 (스펙 변경)**: 현재 백엔드는 `status`, `complete`, `error` 3종 이벤트만 발행. `Decision`, `Action` 같은 세분화된 타입은 존재하지 않음. Phase 1에서는 **기존 이벤트를 프론트엔드에서 매핑**하고, Phase 2에서 백엔드 이벤트를 확장.

**AS-IS**

- 타임라인 컴포넌트 없음

**TO-BE**

```
┌─────────────────────────────────────────────────────────────┐
│ ⏳ Status   "Starting deployment..."                0%     │
├─────────────────────────────────────────────────────────────┤
│ ⏳ Status   "Cloning repository (abc1234)"          25%    │
├─────────────────────────────────────────────────────────────┤
│ ⏳ Status   "Docker image built (38s)"              60%    │
│             [View Build Log] 클릭 시 인라인 확장            │
├─────────────────────────────────────────────────────────────┤
│ ⏳ Status   "Starting container on port 3000"       90%    │
├─────────────────────────────────────────────────────────────┤
│ ✅ Complete "Deploy complete in 45s — http://..."   100%   │
│             🔗 http://my-app.local:10003                    │
└─────────────────────────────────────────────────────────────┘
```

**Phase 1 아이템 타입 (기존 백엔드 이벤트 기반)**

| 백엔드 이벤트 타입 | 타임라인 표시                    | 아이콘 | 색상                      |
| ------------------ | -------------------------------- | ------ | ------------------------- |
| `status`           | 진행 단계 표시 + 프로그레스 바   | ⏳     | `--color-agent` (cyan)    |
| `complete`         | 성공 + URL 링크                  | ✅     | `--color-success` (green) |
| `error`            | 실패 메시지 + "Fix with AI" 버튼 | ❌     | `--color-error` (red)     |

**프로그레스 매핑 (프론트엔드 로직)**

| 백엔드 메시지 패턴    | 프로그레스 % |
| --------------------- | ------------ |
| "Starting deployment" | 0%           |
| "Cloning repository"  | 25%          |
| "Docker image built"  | 60%          |
| "Starting container"  | 90%          |
| `complete` 타입       | 100%         |

> Phase 2에서 백엔드에 `decision`, `action` 이벤트 타입을 추가하여 🧠/🛠️ 아이콘으로 세분화할 수 있음. Phase 1은 기존 이벤트로 충분.

**HOW**

- `GET /api/projects/:id/build/stream` NDJSON 연결 (기존 엔드포인트)
- `TimelineItem` 컴포넌트: `status` / `complete` / `error` 3종 분기
- 자동 스크롤 + "Follow" 토글

**수락기준**

- [ ] `/projects/:id` 기본 탭이 Timeline
- [ ] NDJSON 스트림 연결 후 이벤트 수신 시 실시간 아이템 추가
- [ ] `status` 이벤트 → 타임라인 아이템으로 표시 (프로그레스 바 포함)
- [ ] `complete` 이벤트 → 성공 아이템 + 클릭 가능한 URL 표시
- [ ] `error` 이벤트 → 에러 아이템 + "Fix with AI" 버튼 (클릭 시 채팅 패널 열림)
- [ ] 메시지 패턴으로 프로그레스 % 추정 (위 매핑 테이블 기준)
- [ ] 자동 스크롤 ON 시 새 아이템 등장 시 하단으로 스크롤

---

#### 3.1.6 Build Progress Streaming into Timeline

> **Tech Lead 리뷰 반영 (명확화)**: 현재 백엔드는 SSE가 아닌 **NDJSON** (`application/x-ndjson`) 사용. SSE로 전환하지 않고 기존 NDJSON 유지. 프론트엔드에서 타입 래핑.

**AS-IS**

- `GET /api/projects/:id/build/stream` → NDJSON `{type, message, projectId, timestamp}`
- `GET /api/builds/:id/progress` → NDJSON `{percent, step}`
- `GET /api/activity?follow=true` → NDJSON activity events

**TO-BE**

- 기존 NDJSON 엔드포인트 그대로 사용
- 프론트엔드에서 `TimelineEvent` 타입으로 래핑
- 빌드 로그 인라인 확장 가능 (별도 `GET /api/projects/:id/logs` 호출)

**HOW**

```ts
// web/src/lib/event-types.ts
// 프론트엔드 전용 타입 — 백엔드 NDJSON 이벤트를 래핑

/** 백엔드 빌드 스트림 원본 타입 */
export interface BuildStreamEvent {
  type: 'status' | 'complete' | 'error';
  message: string;
  projectId: string;
  timestamp: string;
}

/** 프론트엔드 타임라인 표시용 타입 */
export interface TimelineItem {
  id: string;
  type: 'progress' | 'success' | 'error';
  timestamp: string;
  title: string;
  detail?: string;
  percent: number; // 0-100, 메시지 패턴으로 추정
  url?: string; // complete 시 배포 URL
}

/** BuildStreamEvent → TimelineItem 변환 함수 */
export function toTimelineItem(event: BuildStreamEvent): TimelineItem;
```

**수락기준**

- [ ] `GET /api/projects/:id/build/stream` NDJSON 연결 시 `ReadableStream` 파싱
- [ ] 각 NDJSON 라인이 `BuildStreamEvent`로 파싱됨
- [ ] `toTimelineItem()` 함수가 `status` → `progress`, `complete` → `success`, `error` → `error`로 매핑
- [ ] 프로그레스 % 가 메시지 패턴 매칭으로 할당됨
- [ ] NDJSON 연결 끊김 시 3초 후 자동 재연결 시도 (최대 5회)

---

### 3.2 Phase 2 — Essential

#### 3.2.1 Agent Intervention Pattern (Inline Form Cards)

> **Tech Lead 리뷰 반영 (추가)**: `POST /api/question/reply`는 존재하지만 TUI QuestionDock 전용. 웹에서 "질문 대기" 상태를 감지하려면 **빌드 스트림에 `question_pending` 이벤트를 추가**하는 백엔드 변경이 필요.

**AS-IS**

- `POST /api/question/reply` 존재 (TUI QuestionDock에서만 사용)
- 빌드 스트림에 "질문 대기" 이벤트 없음
- 웹에서 에이전트의 질문을 수신할 방법 없음

**TO-BE**

- 빌드 스트림에 `question_pending` NDJSON 이벤트 추가 (백엔드 변경)
- 타임라인 내 `InputRequest` 카드 표시
- 폼 필드: 텍스트 입력, 드롭다운, 체크박스 지원
- 제출 후 타임라인 계속 진행

**HOW**

```ts
// 백엔드 변경: src/web/api/routes.ts 빌드 스트림에 추가
write({
  type: 'question_pending',
  message: 'I need a DATABASE_URL to start the app.',
  questionId: 'q-123',
  inputType: 'text', // 'text' | 'select' | 'confirm'
  options: null, // select인 경우 옵션 배열
  projectId: project.id,
});
```

```tsx
// 프론트엔드: Timeline 내 InputRequest 카드
<InputRequestCard questionId={event.questionId}>
  <p>{event.message}</p>
  <Input type="text" placeholder="postgresql://..." />
  <Button onClick={() => submitAnswer(event.questionId, value)}>Submit</Button>
  <Button variant="ghost" onClick={() => skipQuestion(event.questionId)}>
    Skip for now
  </Button>
</InputRequestCard>
```

**수락기준**

- [ ] 백엔드: 빌드 스트림에 `type: 'question_pending'` 이벤트 발행 (QuestionBridge 연동)
- [ ] 프론트엔드: `question_pending` 이벤트 수신 시 타임라인에 InputRequest 카드 표시
- [ ] InputRequest 카드에 질문 텍스트 + 입력 필드 표시
- [ ] 폼 제출 시 `POST /api/question/reply` 호출 (questionId + answer)
- [ ] 응답 후 타임라인 자동 재개 (다음 이벤트 수신)
- [ ] "Skip" 클릭 시 빈 값으로 reply 전송

---

#### 3.2.2 Log Viewer

**AS-IS**

- `GET /api/projects/:id/logs` 정적 로그만
- `?follow=true` NDJSON 스트리밍 존재

**TO-BE**

- 가상화 리스트 (대량 로그 처리)
- "Follow" 토글 (자동 스크롤)
- 검색 + 정규식 지원
- 로그 레벨 색상 코딩 (INFO=Blue, WARN=Yellow, ERROR=Red)

**HOW**

- `@tanstack/react-virtual` 사용 (가상 스크롤)
- `GET /api/projects/:id/logs?follow=true` NDJSON 스트리밍 연결
- 검색은 클라이언트 사이드 필터링

**수락기준**

- [ ] `/projects/:id` "Logs" 탭에서 로그 뷰어 표시
- [ ] `?follow=true` 시 실시간 NDJSON 스트리밍 로그 표시
- [ ] "Follow" 토글 ON 시 자동 스크롤
- [ ] 검색바에서 텍스트/정규식 검색 가능
- [ ] 로그 레벨별 색상 구분 (JetBrains Mono 폰트)
- [ ] 10,000줄 이상 로그에서도 스크롤 버벅임 없음 (가상화)

---

#### 3.2.3 Project Configuration

**AS-IS**

- `GET/POST /api/projects/:id/env` 존재
- 도메인 관리 API 존재

**TO-BE**

- "Configuration" 탭
- **Env Vars**: 키-값 테이블, 마스킹, "Paste .env" 일괄 import
- **Domains**: Internal URL, Public URL 토글, 커스텀 도메인 입력

**HOW**

```tsx
// Configuration 탭
<Tabs defaultValue="env">
  <TabsList>
    <TabsTrigger value="env">Environment Variables</TabsTrigger>
    <TabsTrigger value="domains">Domains</TabsTrigger>
  </TabsList>
  <TabsContent value="env">
    <EnvVarsTable projectId={project.id} />
  </TabsContent>
  <TabsContent value="domains">
    <DomainsPanel projectId={project.id} />
  </TabsContent>
</Tabs>
```

> "Paste .env" 파싱은 **클라이언트 사이드**에서 수행. `KEY=VALUE` 라인 파싱 후 `POST /api/projects/:id/env` 호출.

**수락기준**

- [ ] "Configuration" 탭에서 환경변수 테이블 표시
- [ ] 값이 `••••` 로 마스킹, 아이콘 클릭 시 reveal
- [ ] "Paste .env" 버튼 클릭 → textarea 모달 → 붙여넣기 → 파싱 → 일괄 설정
- [ ] "Domains" 탭에서 Internal/Public URL 표시
- [ ] "Expose to Internet" 토글로 Cloudflare Tunnel 제어

---

#### 3.2.4 Onboarding Flow

**AS-IS**

- `SetupScreen.tsx` 간단한 컴포넌트만
- `/api/setup` 라우트 존재

**TO-BE**

3단계 위자드:

1. **Welcome**: "I am OpenLander. I control this server."
2. **Brain**: LLM Provider 선택 + API Key 입력
3. **Access**: GitHub OAuth 또는 SSH Key

**HOW**

- 중앙 정렬 카드, 그리드 배경
- API Key 검증 시 "Connect" 버튼 녹색 펄스
- 완료 시 `/projects` 리다이렉트
- **중단 복구**: 브라우저 닫아도 마지막 완료 단계를 `localStorage`에 저장, 재방문 시 이어서 진행

**수락기준**

- [ ] LLM 미설정 시 `/setup` 리다이렉트 (`GET /api/setup/status` 확인)
- [ ] Step 1: 환영 메시지 + "Get Started" 버튼
- [ ] Step 2: Provider 선택 (Gemini/Claude/OpenAI/OpenRouter/Ollama) + Key 입력
- [ ] Step 2: API Key 검증 실패 시 에러 메시지 표시 (빨간색)
- [ ] Step 3: GitHub OAuth 버튼 또는 "Skip" 옵션
- [ ] 완료 시 `/projects` 리다이렉트
- [ ] 중단 후 재방문 시 마지막 완료 단계부터 이어서 진행

---

### 3.3 Phase 3 — Polish

#### 3.3.1 Chat Panel (Slide-over)

**AS-IS**

- `ChatPanel.tsx` 존재, 기본 채팅만

**TO-BE**

- 우측 Sheet 슬라이드오버
- 컨텍스트 인식: 현재 프로젝트/선택된 에러 참조
- "Fix Issue" 버튼에서 자동으로 프롬프트 채움

**HOW**

- 컨텍스트는 URL params (`/projects/:id`)에서 projectId 추출
- "Fix Issue" 클릭 시 `initialPrompt` prop으로 에러 메시지 전달

**수락기준**

- [ ] `Cmd+.` 또는 "Ask Agent" 버튼으로 채팅 패널 열림
- [ ] 현재 URL의 projectId가 채팅 세션에 자동 포함
- [ ] "Fix Issue" 클릭 시 에러 컨텍스트가 프롬프트에 삽입됨

---

#### 3.3.2 Settings Page

**AS-IS**

- `/settings` 라우트 없음

**TO-BE**

- LLM Model 선택/변경
- GitHub 계정 관리 (연결/해제)
- System Stats (CPU/RAM/Disk 차트)

**수락기준**

- [ ] `/settings` 에서 현재 LLM Provider + Model 표시
- [ ] Provider/Model 변경 가능
- [ ] GitHub 계정 연결 상태 표시

---

#### 3.3.3 Command Palette (Cmd+K)

**AS-IS**

- 없음

**TO-BE**

- 전역 네비게이션 + 액션
- 검색: "Go to project my-app", "Deploy", "Stop", "Redeploy", "Settings"

**수락기준**

- [ ] `Cmd+K` 로 커맨드 팔레트 열림
- [ ] 프로젝트 이름 검색 → 해당 프로젝트 이동
- [ ] "Deploy", "Stop" 액션 실행

---

#### 3.3.4 Motion & Micro-interactions

**TO-BE**

- Timeline 아이템: `y: 20 → 0, opacity: 0 → 1` 슬라이드 인
- 에이전트 메시지: 캐릭터별 타이핑 효과 (빠름)
- 성공 시: Status Badge에서 녹색 글로우
- 카드 호버: `scale: 1.01`, border brighten

**수락기준**

- [ ] Timeline 아이템 등장 시 슬라이드 애니메이션
- [ ] 성공 상태 Badge에서 subtle 글로우 효과
- [ ] 프로젝트 카드 호버 시 미세 확대

---

#### 3.3.5 Responsive (Tablet/Mobile Read-only)

**TO-BE**

- Tablet: 사이드바 아이콘만, 채팅 모달
- Mobile: 읽기 전용, 프로젝트 상태 + 타임라인 표시, 배포 액션은 비활성 (토스트로 "데스크톱에서 배포하세요" 안내)

**수락기준**

- [ ] 768px~1280px: 사이드바 아이콘 모드
- [ ] 768px 미만: 모바일 레이아웃, 배포 버튼 비활성 + 토스트 안내

---

### 3.4 Architecture Tasks (Phase 2-3 병행)

#### 3.4.1 SSE/NDJSON Event Type 확장 (Phase 2)

> **Tech Lead 리뷰 반영 (명확화)**: 기존 NDJSON 유지. Phase 2에서 백엔드 이벤트 타입 확장.

**AS-IS**

- 빌드 스트림: `status`, `complete`, `error` 3종만
- Intervention 이벤트 없음

**TO-BE**

- 기존 3종 유지 + `question_pending`, `decision`, `action` 추가
- `decision`: 에이전트 판단 (🧠 "Detected Next.js")
- `action`: 실행 액션 (🛠️ "Generating Dockerfile")
- `question_pending`: 사용자 입력 요청

**수락기준**

- [ ] 빌드 스트림에 `decision`, `action`, `question_pending` 타입 추가
- [ ] 기존 `status`, `complete`, `error` 하위 호환 유지
- [ ] 프론트엔드 타임라인에 6종 아이템 타입 모두 표시

---

#### 3.4.2 CLI-lite Commands (Phase 2 이후)

**AS-IS**

- `openlander` → TUI 실행
- `openlander onboard` → 온보딩

**TO-BE**

- `openlander` → Daemon + 브라우저 오픈
- `openlander deploy <repo>` → 배포 후 URL 출력
- `openlander status` → 프로젝트 상태 테이블
- `openlander logs <project>` → 로그 스트림
- `openlander open <project>` → 브라우저에서 URL 오픈
- `openlander projects ls` → 프로젝트 목록

**수락기준**

- [ ] `openlander` 실행 시 데몬 시작 + 기본 브라우저 오픈
- [ ] `openlander deploy github.com/user/repo` → 배포 후 URL 출력
- [ ] `openlander status` → 테이블 형태 상태 출력
- [ ] `openlander logs my-app` → 실시간 로그 스트림

---

## 4. 구현 순서

> **Tech Lead 리뷰 반영 (스펙 변경)**: Architecture 선행 필수. 전체 공수 현실적으로 재추정.

### 4.0 Phase 0 — Architecture (1주, 선행 필수)

| 순서 | 태스크                               | 기간  | 비고      |
| ---- | ------------------------------------ | ----- | --------- |
| 0-1  | TUI Freeze (git tag + 빌드 분리)     | 0.5일 | 첫 날     |
| 0-2  | SPA Serving (Bun + Hono 정적 파일)   | 1일   | 0-1 이후  |
| 0-3  | React Router Setup + 빈 라우트 구조  | 1일   | 0-2 이후  |
| 0-4  | `npm run dev` + `npm run build` 검증 | 0.5일 | 전체 검증 |

### 4.1 Phase 1 — Core (2.5~3주)

**Week 1**

| 순서 | 태스크                                  | 기간 | 의존         |
| ---- | --------------------------------------- | ---- | ------------ |
| 1-1  | Theme Setup (Tailwind v3 + 디자인 토큰) | 1일  | Phase 0 완료 |
| 1-2  | Layout Refactor (Sidebar + Main + Chat) | 2일  | 1-1          |
| 1-3  | Projects List Page                      | 2일  | 1-2          |

**Week 2**

| 순서 | 태스크                            | 기간 | 의존 |
| ---- | --------------------------------- | ---- | ---- |
| 1-4  | New Project Flow                  | 2일  | 1-2  |
| 1-5  | Agent Timeline Component (히어로) | 3일  | 1-2  |

**Week 3**

| 순서 | 태스크                              | 기간 | 의존 |
| ---- | ----------------------------------- | ---- | ---- |
| 1-6  | Build Progress Streaming → Timeline | 2일  | 1-5  |
| —    | Phase 1 검증 + 버그 수정            | 1일  | 전체 |

**병렬 가능**

- 1-3 + 1-4 는 1-2 완료 후 병렬
- 1-5 + 1-6 은 순차 (1-5가 1-6 의존)

### 4.2 Phase 2 — Essential (2주)

| 순서 | 태스크                               | 기간 | 의존    |
| ---- | ------------------------------------ | ---- | ------- |
| 2-1  | Agent Intervention (백엔드 + 프론트) | 3일  | Phase 1 |
| 2-2  | Log Viewer                           | 2일  | Phase 1 |
| 2-3  | Project Configuration                | 2일  | Phase 1 |
| 2-4  | Onboarding Flow                      | 2일  | Phase 1 |
| 2-5  | SSE Event Type 확장                  | 1일  | 2-1     |

**병렬 가능**: 2-1, 2-2, 2-3 은 서로 독립, 병렬 가능

### 4.3 Phase 3 — Polish (1.5주)

| 순서 | 태스크                      | 기간  |
| ---- | --------------------------- | ----- |
| 3-1  | Chat Panel 개선             | 1일   |
| 3-2  | Settings Page               | 1일   |
| 3-3  | Command Palette             | 1일   |
| 3-4  | Motion & Micro-interactions | 1.5일 |
| 3-5  | Responsive                  | 1일   |
| 3-6  | CLI-lite Commands           | 2일   |

### 총 공수

| Phase                  | 기간    | 누적    |
| ---------------------- | ------- | ------- |
| Phase 0 (Architecture) | 1주     | 1주     |
| Phase 1 (Core)         | 2.5~3주 | 3.5~4주 |
| Phase 2 (Essential)    | 2주     | 5.5~6주 |
| Phase 3 (Polish)       | 1.5주   | 7~7.5주 |

> Phase 1 완료 시점에 **출시 가능한 MVP** (프로젝트 생성 + 배포 + 타임라인 모니터링)

---

## 5. 테스트 계획 (Dogfooding Checklist)

### 5.0 Phase 0 완료 후

- [ ] `openlander start` 실행 → 브라우저에서 `http://localhost:10003` 접속
- [ ] 빈 페이지지만 React 앱 렌더링 확인
- [ ] `/api/stats` 등 기존 API 엔드포인트 정상 응답
- [ ] `/projects/123` 접속 후 새로고침 → 404가 아닌 SPA 페이지 표시

### 5.1 Phase 1 완료 후

**기본 흐름**

- [ ] 프로젝트 0개 상태에서 빈 상태 CTA 표시
- [ ] "+ New Project" 클릭 → GitHub 레포 목록 로드
- [ ] 레포 선택 → 즉시 `/projects/:id` 리다이렉트
- [ ] Timeline에 "Starting deployment...", "Cloning...", "Building...", "Deploy complete" 순서로 표시
- [ ] 완료 시 URL 클릭 → 새 탭에서 앱 접속

**에러 시나리오**

- [ ] 존재하지 않는 레포 → 에러 메시지
- [ ] 빌드 실패 → Timeline에 Error 카드 + "Fix with AI" 버튼
- [ ] "Fix with AI" 클릭 → Chat Panel 열림, 에러 컨텍스트 포함
- [ ] NDJSON 연결 끊김 → 자동 재연결 (3초 후)

### 5.2 Phase 2 완료 후

**Intervention**

- [ ] `.env` 없는 프로젝트 배포 → "I need DATABASE_URL" 폼 카드 표시
- [ ] 값 입력 후 제출 → Timeline 계속 진행

**Logs**

- [ ] "Logs" 탭 클릭 → 로그 뷰어 표시
- [ ] "Follow" 토글 ON → 새 로그 자동 스크롤
- [ ] 검색어 입력 → 필터링된 로그만 표시

**Config**

- [ ] "Configuration" 탭에서 환경변수 테이블 표시
- [ ] "Paste .env" → 일괄 import
- [ ] "Expose to Internet" 토글 → Cloudflare Tunnel 시작/중지

**Onboarding**

- [ ] LLM 미설정 상태에서 `/projects` 접속 → `/setup` 리다이렉트
- [ ] 3단계 완료 → `/projects` 리다이렉트

### 5.3 Phase 3 완료 후

**Command Palette**

- [ ] `Cmd+K` → 커맨드 팔레트 열림
- [ ] "my-app" 검색 → "Go to my-app" 액션

**Responsive**

- [ ] 1024px 브라우저 → 사이드바 아이콘만
- [ ] 375px 브라우저 → 모바일 레이아웃, 배포 버튼 비활성

---

## 6. 의사결정 기록

### 6.1 TUI → Web Pivot (2026-03-04)

**결정**: TUI-first에서 Web-first로 전환

**근거**

1. 타겟 오디언스(에이전틱 코딩 사용자)가 터미널 친화적이지 않음
2. 백엔드가 이미 headless (40+ API, SSE, NDJSON)
3. 웹 프론트엔드가 이미 부분 존재 (`web/` 디렉토리)
4. TUI 개발/유지보수 비용 대비 웹이 효율적

**영향**

- TUI 기능 동결 (tag `tui-last`)
- CLI-lite만 유지 (deploy, status, logs, open, projects ls)

### 6.2 Agent Timeline을 히어로 화면으로

**결정**: 채팅이 아닌 타임라인을 메인 인터랙션으로

**근거**

1. 사용자가 "무슨 일이 일어나는지" 시각적으로 파악 필요
2. Intervention Pattern으로 채팅 없이도 상호작용 가능
3. "repo 연결해서 딸깍" 비전에 부합 — 클릭 한 번으로 끝

### 6.3 Phase 분할

**결정**: 3 Phase + Phase 0(Architecture 선행)로 분할

**근거**

1. 1인 메인테이너 — 한 번에 모두 구현 불가능
2. Phase 1만으로도 출시 가능한 MVP
3. Architecture가 선행되지 않으면 Phase 1 작업 불가 (SPA 서빙, 라우팅)

### 6.4 Tailwind v3 유지 (Tech Lead 리뷰 반영, 2026-03-04)

**결정**: Tailwind v4 대신 v3.4.19 유지, CSS 변수로 디자인 토큰 구현

**근거**

1. v4는 아직 초기 단계, API 변경 위험 높음
2. v3에서 `extend` + CSS 변수로 동일한 디자인 토큰 구현 가능
3. 기존 shadcn/ui 컴포넌트와의 호환성 보장
4. v4 마이그레이션은 안정화 후 별도 작업으로

### 6.5 기존 백엔드 이벤트 활용 (Tech Lead 리뷰 반영, 2026-03-04)

**결정**: Phase 1에서는 기존 `status`/`complete`/`error` 이벤트를 프론트엔드에서 매핑. Phase 2에서 `decision`/`action`/`question_pending` 백엔드 추가.

**근거**

1. 기존 백엔드에 `Decision`, `Action` 이벤트 타입이 없음
2. Phase 1 MVP에는 진행 상태만 보여줘도 충분
3. 백엔드 변경 없이 프론트엔드만으로 Phase 1 출시 가능
4. Phase 2에서 이벤트 타입 확장 시 타임라인 자동 풍부해짐

### 6.6 Architecture 선행 (Tech Lead 리뷰 반영, 2026-03-04)

**결정**: Phase 0 (Architecture)를 Phase 1 전에 반드시 완료

**근거**

1. SPA 서빙이 없으면 웹 프론트엔드 개발/테스트 불가
2. React Router가 없으면 모든 페이지 라우팅 불가
3. TUI Freeze가 선행되어야 `openlander` 명령어 동작 변경 가능

---

## 7. 리스크 & 대응

| 리스크                        | 확률 | 영향 | 대응                                                  |
| ----------------------------- | ---- | ---- | ----------------------------------------------------- |
| Bun 정적 파일 서빙 호환성     | 중간 | 높음 | Phase 0에서 사전 검증. 실패 시 Vite preview 서버 병행 |
| NDJSON 스트림 브라우저 호환성 | 낮음 | 높음 | fetch + ReadableStream은 모든 모던 브라우저 지원      |
| TUI 사용자 반발               | 낮음 | 낮음 | `--tui` 플래그로 접근 유지, CLI-lite 대체             |
| 웹 번들 크기                  | 중간 | 낮음 | Code splitting, lazy loading                          |
| Phase 1 기간 초과             | 중간 | 중간 | 핵심(Timeline)만 먼저 완성, 나머지 Phase 2로 이월     |
| NDJSON 재연결 실패            | 낮음 | 중간 | 지수 백오프 + 최대 5회 재시도 + UI에 "연결 끊김" 표시 |

---

## 8. 엣지케이스 & 에러 처리 전략

> **Tech Lead 리뷰 반영 (추가)**

### 8.1 NDJSON 스트림 재연결

- 연결 끊김 감지 시 3초 후 자동 재연결 (지수 백오프: 3s → 6s → 12s → 24s → 48s)
- 최대 5회 재시도, 초과 시 "연결이 끊겼습니다. 새로고침해주세요." 배너 표시
- 재연결 시 마지막 수신 이벤트 ID 기반 이벤트 재수신 (서버 지원 필요 시 Phase 2)

### 8.2 다중 탭 / 동시 배포

- 같은 프로젝트를 여러 탭에서 열어도 각 탭이 독립 NDJSON 연결
- 한 탭에서 배포 시작 시 다른 탭은 다음 폴링(`GET /api/projects/:id`)에서 상태 갱신
- 같은 프로젝트에 대한 동시 배포 요청은 백엔드에서 거부 (기존 로직)

### 8.3 빌드 중 페이지 이동

- `/projects/:id`에서 다른 페이지로 이동 시 NDJSON 연결 `AbortController.abort()` 호출
- 다시 돌아오면 `GET /api/projects/:id` 로 현재 상태 조회 + 진행 중이면 스트림 재연결
- 이미 완료된 배포는 타임라인 히스토리로 표시 (DB에서 로드)

### 8.4 에러 처리 전략

- **API 에러 (4xx/5xx)**: Toast 알림 (sonner 또는 shadcn/ui Toast)
- **스트리밍 에러**: 타임라인 내 에러 아이템으로 표시
- **네트워크 에러**: 화면 상단 배너 "연결 끊김"
- **React 렌더링 에러**: ErrorBoundary (기존 `web/src/App.tsx`에 이미 존재)

### 8.5 타임라인 성능 (대량 이벤트)

- Phase 1: 일반적으로 10-30개 이벤트 → DOM 직접 렌더링 충분
- 이벤트 100개 초과 시 오래된 이벤트를 "접기" (collapsed) 처리
- Phase 2에서 필요 시 `@tanstack/react-virtual` 적용

---

## 9. 참조

- [UI/UX Design Spec](../../design/web-mvp-ui-ux.md)
- [Tech Lead Review](./tech-lead-review.md)
- [Version Map](../version-map.md)
- [Requirements](../requirements.md)
- [API Routes](../../../src/web/api/routes.ts)
- [Event Bus](../../../src/events/index.ts)
