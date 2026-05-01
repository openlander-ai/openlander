# Phase 1: 레이아웃 아키텍처 — 상세 개발 계획

> **버전**: v0.0.7 Phase 1 | **상태**: ✅ 9스텝 전부 완료 | **버전 맵**: [`version-map.md`](version-map.md)

> **상태**: ✅ Phase 1 완료 (2025-02-26)
> 9개 스텝 전부 구현 완료. 커밋: `04b2a99`, `6cb39e5`
>
> **범위**: T-ARCH-01 ~ T-ARCH-05 (3-모드 상태 머신, 적응형 우측 패널, 포커스 관리, 상태바, 반응형)
> **입력**: v0.0.7-ui-ux-layout.md, 현재 App.tsx/Layout.tsx/DashboardPanel.tsx/StatusBar.tsx
> **결과물**: 모든 후속 Phase가 플러그인할 수 있는 모드 기반 레이아웃

---

## 1. 현재 상태 (AS-IS)

### 파일 구조

```
src/tui/
├── App.tsx              ← 앱 진입점. 오버레이 상태 (showHelp, showModel 등) 개별 signal
├── components/
│   ├── Layout.tsx       ← 2-panel 레이아웃 (left/right/statusBar/overlay). 반응형 있음.
│   ├── ChatPanel.tsx    ← 좌측 채팅. 슬래시 피커 포함.
│   ├── DashboardPanel.tsx ← 우측. SystemSection/ProjectsSection/ActivitySection/McpClientsSection
│   ├── StatusPanel.tsx  ← 모드별 우측 패널 분기
│   ├── BuildPanel.tsx   ← 배포 모드 패널 골격
│   ├── ProjectInfo.tsx  ← 디버깅 모드 상단 패널 골격
│   ├── LogViewer.tsx    ← 디버깅 모드 하단 패널 골격
│   ├── StatusBar.tsx    ← 하단. keybind 힌트 + project count + CPU
│   ├── GitOverlay.tsx
│   ├── ModelOverlay.tsx
│   ├── RepoOverlay.tsx
│   ├── TunnelOverlay.tsx
│   ├── EnvOverlay.tsx
│   ├── HelpOverlay.tsx
│   ├── SlashCommandPicker.tsx
│   ├── Prompt.tsx
│   └── ...
├── commands/
│   └── registry.ts      ← 9개 커맨드 (help, model, git, repo, tunnel, env, compact, clear, exit)
├── state/
│   ├── mode.ts
│   └── focus.ts
├── hooks/
│   └── useDaemon.ts
├── context/
│   └── exit.ts
└── theme.ts
```

### 상태 관리

- **오버레이**: `showHelp`, `showModelSelector`, `showGit`, `showRepo`, `showTunnel`, `showEnv` — 개별 boolean signal
- **모드 관리**: `state/mode.ts` — `monitoring | deploying | debugging`
- **패널 포커스**: `state/focus.ts` — `chat | status` (Tab 토글)
- **대시보드 데이터**: DashboardPanel 내부에서 직접 IPC 폴링 (5초 간격, 30초→5초)
- **상태바 데이터**: DashboardPanel → `onStatsUpdate` 콜백 → App → StatusBar props

### 핵심 발견

- `DashboardPanel`에 이미 SystemSection, ProjectsSection, ActivitySection이 **export** 되어있다.
- `Layout.tsx`는 이미 반응형 (100 컬럼 기준 split/single).
- `DashboardPanel` 내부에서 프로젝트 ↑↓ 선택, selectedIndex 관리 있음.
- 30초 폴링은 너무 느림 → Phase 1에서 조정 필요.

---

## 2. 목표 상태 (TO-BE)

### 3-모드 시스템

```
모니터링 (기본)
  │
  ├─ 빌드 시작 ──────────→ 배포 모드 (자동)
  │                            │
  │                            └─ 빌드 완료 3초 후 → 모니터링 (자동)
  │
  └─ 프로젝트 Enter ──────→ 디버깅 모드
                               │
                               └─ Esc → 모니터링
```

### 우측 패널 분기

| 모드     | 우측 패널 내용                                                           |
| -------- | ------------------------------------------------------------------------ |
| 모니터링 | System + Projects + Activity + Alerts (기존 DashboardPanel과 거의 동일)  |
| 배포     | 상단: System+Projects (축소) / 하단: BuildPanel (파이프라인 + 빌드 로그) |
| 디버깅   | 상단: ProjectInfo / 하단: LogViewer (실시간 스트리밍)                    |

### 상태바 분기

| 모드     | 좌측 (힌트)                        | 우측 (수치)                             |
| -------- | ---------------------------------- | --------------------------------------- |
| 모니터링 | `Tab:패널 /:명령 ?:도움말 ^C:종료` | `4 projects │ CPU 12% MEM 4.2G`         |
| 배포     | `^C:취소 Enter:닫기`               | `BUILD frontend 67% │ CPU 89% MEM 8.1G` |
| 디버깅   | `Esc:돌아가기 r:재배포 s:중지`     | `frontend ● :3000 │ CPU 2% MEM 128M`    |

---

## 3. 파일 구조 변경

### 새 파일

```
src/tui/
├── state/
│   ├── mode.ts          ← 🆕 모드 상태 관리 (createSignal + transition 함수)
│   └── focus.ts         ← 🆕 포커스 상태 관리 (chat | status)
├── components/
│   ├── StatusPanel.tsx   ← 🆕 모드별 분기하는 우측 패널 래퍼
│   ├── BuildPanel.tsx    ← 🆕 배포 모드 하단 (파이프라인 + 빌드 로그) — Phase 3에서 내용 구현, Phase 1은 골격만
│   ├── ProjectInfo.tsx   ← 🆕 디버깅 모드 상단 (프로젝트 상세) — Phase 4에서 내용 구현, Phase 1은 골격만
│   └── LogViewer.tsx     ← 🆕 디버깅 모드 하단 (로그 스트리밍) — Phase 4에서 내용 구현, Phase 1은 골격만
```

### 수정 파일

```
App.tsx            ← 모드 signal 추가, StatusPanel로 교체, 상태바 props 변경
Layout.tsx         ← 변경 없음 (이미 충분히 유연)
StatusBar.tsx      ← 모드별 분기 렌더링 추가
DashboardPanel.tsx ← 모니터링 모드 전용으로 역할 축소. export된 섹션 컴포넌트 유지.
registry.ts        ← 슬래시 명령 9개로 업데이트
```

### 삭제/리네임

```
ConnectOverlay.tsx → GitOverlay.tsx (리네임 + 확장)
```

---

## 4. 상태 관리 설계

### `src/tui/state/mode.ts`

```typescript
import { createSignal } from 'solid-js';

export type TuiMode = 'monitoring' | 'deploying' | 'debugging';

export interface DeployingState {
  projectId: string;
  projectName: string;
}

export interface DebuggingState {
  projectId: string;
  projectName: string;
}

// --- Signals ---
const [mode, setMode] = createSignal<TuiMode>('monitoring');
const [deployingState, setDeployingState] = createSignal<DeployingState | null>(null);
const [debuggingState, setDebuggingState] = createSignal<DebuggingState | null>(null);

// --- Transition Functions ---
export function enterDeployMode(projectId: string, projectName: string): void {
  setDeployingState({ projectId, projectName });
  setMode('deploying');
}

export function enterDebugMode(projectId: string, projectName: string): void {
  setDebuggingState({ projectId, projectName });
  setMode('debugging');
}

export function returnToMonitoring(): void {
  setMode('monitoring');
  setDeployingState(null);
  setDebuggingState(null);
}

// Auto-return timer for deploy mode
let deployReturnTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleDeployReturn(delaySec = 3): void {
  if (deployReturnTimer) clearTimeout(deployReturnTimer);
  deployReturnTimer = setTimeout(() => {
    if (mode() === 'deploying') returnToMonitoring();
    deployReturnTimer = null;
  }, delaySec * 1000);
}

export function cancelDeployReturn(): void {
  if (deployReturnTimer) {
    clearTimeout(deployReturnTimer);
    deployReturnTimer = null;
  }
}

export { mode, deployingState, debuggingState };
```

### `src/tui/state/focus.ts`

```typescript
import { createSignal } from 'solid-js';

export type PanelFocus = 'chat' | 'status';

const [focus, setFocus] = createSignal<PanelFocus>('chat');

export function toggleFocus(): void {
  setFocus((prev) => (prev === 'chat' ? 'status' : 'chat'));
}

export function focusChat(): void {
  setFocus('chat');
}

export function focusStatus(): void {
  setFocus('status');
}

export { focus };
```

---

## 5. 컴포넌트 트리

```
<App>
  ├── <Layout>
  │   ├── left: <ChatPanel focus={focus() === 'chat'} />
  │   │
  │   ├── right: <StatusPanel mode={mode()} focus={focus() === 'status'}>
  │   │            ├── mode=monitoring → <DashboardPanel />  (기존 코드 재활용)
  │   │            ├── mode=deploying  → <DashboardPanel compact /> + <BuildPanel />
  │   │            └── mode=debugging  → <ProjectInfo /> + <LogViewer />
  │   │
  │   ├── statusBar: <StatusBar mode={mode()} focus={focus()} ... />
  │   │
  │   └── overlay: <HelpOverlay> | <ModelOverlay> | <GitOverlay> | <RepoOverlay> | ...
  │
  └── <CtrlCWarning />
```

### StatusPanel 컴포넌트 (새 파일)

```typescript
// src/tui/components/StatusPanel.tsx
interface StatusPanelProps {
  client: OpenLanderClient | null;
  height: number;
  focus: boolean;
  mode: TuiMode;
  deployingState: DeployingState | null;
  debuggingState: DebuggingState | null;
  onStatsUpdate: (data: StatsData) => void;
  onProjectSelect: (projectId: string, projectName: string) => void;
}

export function StatusPanel(props: StatusPanelProps): JSX.Element {
  return (
    <Switch>
      <Match when={props.mode === 'monitoring'}>
        <DashboardPanel
          client={props.client}
          height={props.height}
          focus={props.focus}
          onStatsUpdate={props.onStatsUpdate}
          onProjectSelect={props.onProjectSelect}
        />
      </Match>
      <Match when={props.mode === 'deploying'}>
        <box flexDirection="column" height={props.height}>
          <DashboardPanel client={props.client} height={Math.floor(props.height * 0.4)} focus={false} compact={true} />
          <BuildPanel projectId={props.deployingState!.projectId} client={props.client} height={Math.floor(props.height * 0.6)} />
        </box>
      </Match>
      <Match when={props.mode === 'debugging'}>
        <box flexDirection="column" height={props.height}>
          <ProjectInfo projectId={props.debuggingState!.projectId} client={props.client} height={Math.floor(props.height * 0.35)} />
          <LogViewer projectId={props.debuggingState!.projectId} client={props.client} height={Math.floor(props.height * 0.65)} />
        </box>
      </Match>
    </Switch>
  );
}
```

---

## 6. 데이터 흐름

```
IPC Client (daemon)
    │
    ├── getSystemStats() ──→ DashboardPanel.SystemSection
    ├── listProjects()   ──→ DashboardPanel.ProjectsSection
    ├── getActivity()    ──→ DashboardPanel.ActivitySection
    ├── getProjectStats()──→ DashboardPanel (per-project CPU/MEM)
    │
    ├── streamBuildProgress() ──→ BuildPanel (Phase 3)
    ├── streamLogs()          ──→ LogViewer (Phase 4)
    ├── getProject()          ──→ ProjectInfo (Phase 4)
    │
    └── onStatsUpdate callback ──→ App ──→ StatusBar
```

### 폴링 주기 변경

| 데이터        | 현재        | 변경                                      |
| ------------- | ----------- | ----------------------------------------- |
| System stats  | 30초        | **5초**                                   |
| Projects      | 30초        | **3초**                                   |
| Activity      | 30초 (폴링) | **실시간** (streamActivity) 또는 5초 폴링 |
| Project stats | 30초        | **5초** (running 프로젝트만)              |

---

## 7. 키보드 흐름 변경

### App.tsx 글로벌 핸들러 변경점

```
현재:
  Tab → activePanel 토글
  ? → showHelp
  q (right panel) → exit
  Ctrl+C → exit
  Esc → 오버레이 닫기

변경:
  Tab → focus 토글 (chat ↔ status)
  ? → showHelp
  q (status focus) → exit
  Ctrl+C → 배포 취소 or exit 워닝
  Esc → 모드별 분기:
    - 오버레이 열림 → 오버레이 닫기
    - 디버깅 모드 → returnToMonitoring()
    - 배포 모드 → returnToMonitoring() (빌드 취소는 Ctrl+C)
    - 모니터링 → 무시
```

### DashboardPanel 키보드 변경점

```
현재:
  ↑↓ → 프로젝트 선택 (focus일 때)

추가:
  Enter → 선택된 프로젝트로 enterDebugMode() 호출
         → App에 onProjectSelect 콜백으로 전달
```

---

## 8. 마이그레이션 단계 (구현 순서)

### Step 1: state 모듈 생성 (T-ARCH-01)

1. `src/tui/state/mode.ts` 생성
2. `src/tui/state/focus.ts` 생성
3. 타입 + signal + transition 함수만. UI 연결 아직 안 함.
4. **검증**: `tsc --noEmit` 통과

### Step 2: StatusPanel 골격 생성 (T-ARCH-02)

1. `src/tui/components/StatusPanel.tsx` 생성
2. monitoring 모드: 기존 `<DashboardPanel>` 그대로 렌더링
3. deploying 모드: placeholder `<text>Build panel (Phase 3)</text>`
4. debugging 모드: placeholder `<text>Debug panel (Phase 4)</text>`
5. **검증**: monitoring 모드에서 기존과 동일하게 보이는지 확인

### Step 3: App.tsx 연결 (T-ARCH-01 + T-ARCH-02 + T-ARCH-03)

1. `activePanel` → `focus` (state/focus.ts) 로 교체
2. `<DashboardPanel>` → `<StatusPanel>` 로 교체
3. mode signal 구독. Esc 키보드 핸들링 모드 분기.
4. `onProjectSelect` 콜백 추가: DashboardPanel에서 Enter → enterDebugMode
5. deploy 진행 시 enterDeployMode 호출 (기존 handleRepoSelect 수정)
6. **검증**: Tab 포커스 전환, 프로젝트 Enter → 디버깅 placeholder, Esc → 모니터링 복귀

### Step 4: StatusBar 모드 분기 (T-ARCH-04)

1. StatusBar props에 `mode`, `debugProject` 추가
2. Switch/Match로 모드별 keybind 힌트 + 수치 표시
3. 배포 모드: `BUILD {name} {percent}%` + `Ctrl+C:취소`
4. 디버깅 모드: `{name} ● :{port}` + `Esc:돌아가기 r:재배포 s:중지`
5. **검증**: 3가지 모드에서 상태바가 올바르게 변경되는지

### Step 5: DashboardPanel에 onProjectSelect + compact 지원 (T-ARCH-02)

1. `onProjectSelect(projectId, projectName)` prop 추가
2. Enter 키 핸들러에서 selectedIndex 프로젝트로 콜백 호출
3. `compact` prop 추가 — true이면 SystemSection + ProjectsSection만 표시 (Activity, MCP 숨김)
4. **검증**: Status 패널에서 프로젝트 Enter → 디버깅 모드 진입 → Esc 복귀

### Step 6: 슬래시 명령 레지스트리 업데이트

1. `registry.ts` 9개로 업데이트:
   - 유지: help, model, repo, compact, clear, exit
   - connect → git (이름 변경)
   - 삭제: projects (toggle-sidebar action 제거)
   - 추가: tunnel, env
   - action type 추가: `| { action: 'modal'; modal: 'help' | 'model' | 'git' | 'repo' | 'tunnel' | 'env' }`
2. App.tsx에서 `connect` 참조를 `git`으로 변경
3. ConnectOverlay.tsx → GitOverlay.tsx 리네임 (내용은 Phase 8에서 확장)
4. tunnel, env 오버레이는 placeholder 생성 (`<text>Coming soon</text>`)
5. **검증**: 슬래시 피커에서 9개 표시, 각 실행 시 올바른 오버레이/action

### Step 7: 반응형 브레이크포인트 (T-ARCH-05)

1. Layout.tsx 브레이크포인트 변경:
   - ≥120: 60:40
   - 80~119: 65:35
   - <80: single panel + Tab 토글
2. 현재 100 기준 → 80/120 2단계로 변경
3. **검증**: 터미널 리사이즈 시 레이아웃 전환

### Step 8: 폴링 주기 조정

1. DashboardPanel의 `setInterval` 30초 → 5초
2. 필요 시 displayKey 비교 최적화 (변경 없으면 리렌더 스킵 — 이미 구현됨)
3. **검증**: System 수치가 5초마다 갱신

### Step 9: 테스트 + 정리

1. 기존 52개 slash-command 테스트 업데이트 (connect → git, projects 삭제, tunnel/env 추가)
2. 기존 21개 slash-picker 테스트 업데이트
3. `lsp_diagnostics` 전 파일 확인
4. `tsc --noEmit` + ESLint 통과

---

## 9. Phase 1 완료 조건

- [ ] 3-모드 전환 동작: 모니터링 ↔ 배포(placeholder) ↔ 디버깅(placeholder)
- [ ] Tab으로 Chat ↔ Status 포커스 전환
- [ ] Status 패널에서 프로젝트 Enter → 디버깅 모드 진입
- [ ] Esc → 모니터링 복귀
- [ ] 상태바가 모드별로 다른 내용 표시
- [ ] 슬래시 명령 9개 (help, model, git, repo, tunnel, env, compact, clear, exit)
- [ ] 반응형: 120+, 80-119, <80 브레이크포인트
- [ ] 폴링 5초
- [ ] tsc + ESLint 통과
- [ ] 테스트 통과 (업데이트된 slash command tests)

---

## 10. Phase 1이 열어주는 것

Phase 1 완료 후, 후속 Phase는 **플러그인**만 하면 됨:

| Phase             | 플러그인 위치                                       |
| ----------------- | --------------------------------------------------- |
| Phase 3 (배포)    | `BuildPanel.tsx` 내용 구현 + `enterDeployMode` 호출 |
| Phase 4 (디버깅)  | `ProjectInfo.tsx` + `LogViewer.tsx` 내용 구현       |
| Phase 6 (Compose) | DashboardPanel의 ProjectsSection에 접이식 그룹 추가 |
| Phase 7 (채팅)    | ChatPanel 내부만 변경, 레이아웃 무관                |

---

## 참고: 기존 IPC 메서드 목록 (Phase 1에서 사용)

```typescript
// 이미 OpenLanderClient에 존재
client.getSystemStats(); // → SystemStats
client.ping(); // → HealthResponse (dockerContainers, uptime)
client.listProjects(); // → { count, projects }
client.getActivity(limit); // → ActivityEvent[]
client.getProjectStats(id); // → ProjectStats (cpu, memory, network)
client.deploy(url, opts); // → DeployResponse
client.streamBuildProgress(id); // → AsyncGenerator<BuildProgressEvent>
client.streamLogs(id); // → AsyncGenerator<LogEntry>
client.stopProject(id); // → { status }
client.startProject(id); // → { status }
```
