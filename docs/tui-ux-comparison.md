# OpenCode vs OpenLander — TUI UI/UX 상세 비교 분석

> **작성일**: 2026-02-26  
> **대상**: anomalyco/opencode TUI vs OpenLander TUI (안정화 후 스냅샷)  
> **목적**: OpenCode TUI의 UX 패턴을 벤치마크하여 OpenLander TUI 개선점 도출

---

## 1. 현재 상태 요약

### 공통 기반

- 둘 다 **@opentui/solid** (SolidJS 기반 터미널 렌더링 엔진) 사용
- 둘 다 **SolidJS 시그널** 기반 상태 관리
- 둘 다 **split-panel 레이아웃** (Chat + Dashboard/Sidebar)
- 둘 다 **slash command** 시스템 보유

### OpenLander TUI 현황 (11개 컴포넌트)

| 컴포넌트                 | 줄 수 | 역할                           |
| ------------------------ | ----- | ------------------------------ |
| `App.tsx`                | 207   | 최상위 앱 (모드, 패널, 키보드) |
| `Layout.tsx`             | 88    | Split-panel 레이아웃           |
| `ChatPanel.tsx`          | 478   | 채팅 (입력, 메시지, 스트리밍)  |
| `DashboardPanel.tsx`     | 403   | 시스템/프로젝트/활동 대시보드  |
| `ChatMessage.tsx`        | 267   | 메시지 렌더링 (15가지 타입)    |
| `AgentDisplay.tsx`       | 296   | 에이전트 액션 렌더링 (6종)     |
| `StatusBar.tsx`          | 107   | 하단 키바인드 + 상태 표시      |
| `HelpOverlay.tsx`        | 89    | 도움말 오버레이                |
| `SlashCommandPicker.tsx` | 69    | 명령어 자동완성                |
| `IMETextInput.tsx`       | 30    | CJK 텍스트 입력                |
| `Spinner.tsx`            | 21    | 로딩 애니메이션                |
| `ProgressBar.tsx`        | 58    | 진행률 바                      |

**총 TUI 코드**: ~2,300줄 (컴포넌트) + ~700줄 (훅/유틸/커맨드/테마)

---

## 2. 컴포넌트별 상세 비교

### 2.1 레이아웃 시스템

#### OpenCode

```
┌─────────────────────────────────────────────────┐
│ [Session List] │ [Message Display Area]          │
│                │                                 │
│ ┌────────────┐ │ ┌─────────────────────────────┐ │
│ │ Session 1  │ │ │ User message (pipe border)  │ │
│ │ Session 2  │ │ │ Agent response (stream)     │ │
│ │ Session 3  │ │ │ Tool call (collapsible)     │ │
│ └────────────┘ │ │ Code diff (syntax colored)  │ │
│                │ └─────────────────────────────┘ │
│                │                                 │
│                │ ┌─────────────────────────────┐ │
│                │ │ Prompt Input + Autocomplete │ │
│                │ └─────────────────────────────┘ │
├─────────────────────────────────────────────────┤
│ [StatusBar: Agent | Model | Keybinds | Tokens]  │
└─────────────────────────────────────────────────┘

특징:
- 세션 사이드바 (왼쪽) — 대화 목록, 세션 전환
- 메시지 영역 (오른쪽) — 자동 스크롤, 파트별 렌더링
- 프롬프트 입력 — 자동완성, @멘션, 파일 첨부
- 상태 바 — 에이전트명, 모델명, 토큰 사용량
- 오버레이 시스템 — 설정, 세션 목록, 모델 선택
- 키바인드 커스터마이징 가능
```

#### OpenLander

```
┌─────────────────────────────────────────────────┐
│ [Chat Panel]          │ [Dashboard Panel]        │
│                       │                          │
│ ┌───────────────────┐ ┃ ▸ System                 │
│ │ OpenLander ASCII  │ ┃   CPU 23% ◼◻◻           │
│ │ logo / messages   │ ┃   MEM 1.2/4.0GB         │
│ │                   │ ┃                          │
│ │ User msg (pipe)   │ ┃ ▸ Projects (3)           │
│ │ Agent response    │ ┃   ● my-app    :3000      │
│ │ ⚙ Bash            │ ┃   ◐ api-svc   :8080      │
│ │ ⚙ Edit file       │ ┃   ○ old-app              │
│ └───────────────────┘ ┃                          │
│                       ┃ ▸ Activity                │
│ ❯ _________________  ┃   14:30 user ✅ deployed  │
│                       ┃                          │
├─────────────────────────────────────────────────┤
│ Tab Chat│Dashboard  / Commands  ? Help  ^C Exit │
└─────────────────────────────────────────────────┘

특징:
- 채팅 (왼쪽) + 대시보드 (오른쪽) 2패널
- 반응형: 100열 미만일 때 단일 패널 (Tab 전환)
- 파이프 디바이더 (SplitBorder 패턴)
- 프로젝트 목록 + 시스템 리소스 + 활동 로그
- MCP 클라이언트 상태
- 30초 주기 폴링
```

### 📌 레이아웃 차이점 및 개선 방향

| 항목               | OpenCode                         | OpenLander                      | 개선안                                                                  |
| ------------------ | -------------------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| **세션 관리**      | 세션 사이드바 (목록, 전환, 분기) | 없음 (단일 세션)                | ⚠️ 배포는 보통 세션 1개면 충분. 프로젝트 = 세션 개념. 현재 구조 유지 OK |
| **오버레이**       | 다중 오버레이 (설정, 모델, 세션) | HelpOverlay 1개                 | ✅ 프로젝트 상세, 설정 변경 등 오버레이 추가 고려                       |
| **반응형**         | 좌우 비율 동적 조절              | 55:45 고정비율, 100열 미만 단일 | ✅ 현재 충분. 단 좁은 터미널에서 Dashboard가 잘리는 문제 체크           |
| **Content Height** | 패딩/마진 세밀 제어              | `rows - 1` 단순 계산            | ✅ 현재 간결하고 좋음                                                   |

---

### 2.2 메시지 렌더링

#### OpenCode: Part-based 렌더링 (8가지 파트 타입)

```
Message
├── TextPart       — 일반 텍스트 (마크다운 렌더링)
├── ReasoningPart  — 모델 추론 과정 (접기/펼치기)
├── FilePart       — 파일 첨부 (미리보기)
├── ToolPart       — 도구 호출 (상태 머신 + 접기/펼치기)
├── AgentPart      — 서브에이전트 호출
├── SubtaskPart    — 위임 작업
├── CompactionPart — 요약된 히스토리
└── SnapshotPart   — VCS 스냅샷

특징:
- 파트별 독립 렌더러
- ToolPart: pending → running → completed/error 상태별 다른 UI
- 접기/펼치기 (Collapsible)
- Diff 렌더링: 구문 강조 + 줄 번호
- 코드 블록: 언어별 구문 강조
- 이미지 인라인 표시
```

#### OpenLander: 타입 기반 렌더링 (15가지 타입)

```
DisplayMessage.type
├── text            — 일반 텍스트
├── tool_start      — 도구 시작 (스피너)
├── tool_result     — 도구 결과 (✓/✗)
├── url             — URL 링크 (밑줄)
├── warning         — 경고 (△)
├── error           — 에러 (빨간 파이프)
├── progress        — 진행률 바
├── command         — bash 명령 (출력 포함)
├── file_edit       — 파일 편집 (diff)
├── thinking        — 생각중 (스피너)
├── todo            — 작업 목록 (✓/○/⠋)
├── build_result    — 빌드 결과 (성공/실패)
└── orchestration   — 오케스트레이션 단계

특징:
- AgentDisplay 전용 6종: command, file_edit, thinking, todo, build_result, orchestration
- 배포 도메인 특화 표시 (빌드 결과, 오케스트레이션)
- SplitBorder 패턴으로 시각적 구분
- 출력 줄수 제한 (MAX_OUTPUT_LINES = 10)
```

### 📌 메시지 렌더링 개선 방향

| 항목                | 상태                                     | 개선안                                                              |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| **접기/펼치기**     | ❌ 없음                                  | ✅ 긴 빌드 로그, 명령 출력에 필수. `[Enter]로 펼치기` 키바인드 추가 |
| **마크다운 렌더링** | ❌ 순수 텍스트                           | 🟡 코드 블록 (\`\`\`) 감지하여 박스 렌더링 정도면 충분              |
| **Diff 구문 강조**  | ✅ 기본 (`+`=초록, `-`=빨강)             | ✅ 현재 충분                                                        |
| **출력 트렁케이션** | ✅ MAX_OUTPUT_LINES                      | ✅ 좋음. `...N more lines` 표시도 있음                              |
| **도구 상태 머신**  | 🟡 부분적 (running/success/error)        | ✅ pending 상태 추가하면 완전한 상태 머신                           |
| **배포 특화 표시**  | ✅ build_result, orchestration, progress | ✅ OpenLander 고유 강점 — 유지                                      |

---

### 2.3 테마 시스템

#### OpenCode

```typescript
// 테마 프리셋 (6+종): dark, light, catppuccin, dracula, gruvbox, etc.
// 커스텀 테마: opencode.json → theme 섹션
// 에이전트별 컬러 코딩 (build=파랑, plan=보라 등)
// CSS-like 속성 매핑 (primary, secondary, accent, etc.)

// 설정 예시:
{
  "theme": "catppuccin-mocha",
  "tui": {
    "theme": {
      "primary": "#cba6f7"
    }
  }
}
```

#### OpenLander

```typescript
// theme.ts — 단일 다크 테마 (고정)
export const theme = {
  primary: '#fab283', // 오렌지 — 에이전트 색상
  secondary: '#5c9cf5', // 파랑 — 사용자 색상
  accent: '#c4a7e7', // 보라 — 하이라이트
  text: '#e0e0e0',
  textMuted: '#808080',
  textDim: '#555555',
  background: '#0a0a0a',
  backgroundPanel: '#151515',
  backgroundElement: '#252525',
  backgroundMenu: '#1a1a1a',
  border: '#333333',
  borderActive: '#555555',
  borderSubtle: '#222222',
  success: '#a6e3a1',
  warning: '#f9e2af',
  error: '#f38ba8',
  info: '#5c9cf5',
  diffAdded: '#a6e3a1',
  diffRemoved: '#f38ba8',
  // ... 상태별 컬러, 리소스 임계값 컬러
};
```

### 📌 테마 개선 방향

| 항목            | 상태         | 개선안                                                   | 우선순위 |
| --------------- | ------------ | -------------------------------------------------------- | -------- |
| **테마 프리셋** | ❌ 고정 다크 | 🟡 catppuccin, dracula 프리셋 추가. 설정파일에서 선택    | 중간     |
| **커스텀 테마** | ❌           | 🟡 openlander.json에서 컬러 오버라이드                   | 낮음     |
| **라이트 테마** | ❌           | 🟡 밝은 터미널 사용자를 위해                             | 낮음     |
| **컬러 팔레트** | ✅ 잘 정리됨 | ✅ Catppuccin-inspired 팔레트 (Mocha 계열). 현재 좋음    |
| **상태별 컬러** | ✅           | ✅ running=초록, building=노랑, stopped=회색, error=빨강 |
| **SplitBorder** | ✅           | ✅ OpenCode 패턴 이미 차용. 파이프 디바이더 훌륭         |

---

### 2.4 입력 시스템

#### OpenCode

```
- 자동완성: 모델명, 에이전트명 (@), 파일 경로, 슬래시 명령
- @멘션: @general, @plan 등 서브에이전트 호출
- 파일 첨부: 드래그 or 경로 입력
- 멀티라인: Shift+Enter
- 히스토리: ↑↓ 이전 입력 탐색
- IME: CJK 입력 지원
- Vim 모드: 선택적 vi 키바인딩
```

#### OpenLander

```typescript
// IMETextInput.tsx — @opentui/solid <input> 래퍼
// 기능:
- 단일 라인 입력
- onChange/onSubmit 콜백
- placeholder 지원
- showCursor 제어

// ChatPanel.tsx에서 관리:
- 히스토리 네비게이션 (↑↓, MAX_HISTORY = 100)
- 슬래시 명령 자동완성 (/ 입력 시)
- Tab 완성
- Ctrl+L 채팅 클리어

// ime.ts — CJK 지원:
- IME_FLUSH_DELAY_MS = 50
- isIMEInput() — CJK/이모지 감지
- getDisplayWidth() — 전각문자 폭 계산
```

### 📌 입력 시스템 개선 방향

| 항목            | 상태                    | 개선안                                                  | 우선순위 |
| --------------- | ----------------------- | ------------------------------------------------------- | -------- |
| **슬래시 명령** | ✅ 22개 명령, 자동완성  | ✅ 배포 도메인에 충분                                   |
| **히스토리**    | ✅ ↑↓ + 100개 캐시      | ✅                                                      |
| **CJK/IME**     | ✅ 잘 구현됨            | ✅ 한/중/일 지원. 글로벌 대응 OK                        |
| **@멘션**       | ❌                      | 🟡 @프로젝트명 으로 특정 프로젝트 참조 (v0.6+)          |
| **파일 첨부**   | ❌                      | ❌ 배포 에이전트에 불필요                               |
| **멀티라인**    | ❌                      | 🟡 Shift+Enter로 멀티라인. Dockerfile 직접 입력 시 유용 |
| **Tab 완성**    | ✅ 슬래시 명령 Tab 완성 | 🟡 프로젝트명 Tab 완성 추가                             |

---

### 2.5 키바인드 시스템

#### OpenCode

```typescript
// 커스터마이징 가능한 키바인드 시스템
// opencode.json:
{
  "keybinds": {
    "leader": "ctrl+k",
    "agent_next": "tab",
    "agent_prev": "shift+tab",
    "agent_list": "<leader>a",
    "session_new": "<leader>n",
    "session_list": "<leader>s",
    "model_list": "<leader>m",
    "theme_list": "<leader>t",
    "interrupt": "escape"
  }
}

// Leader key 패턴: <leader> + 단일키 = 복합 키바인드
// 예: Ctrl+K → A = 에이전트 목록
```

#### OpenLander

```typescript
// App.tsx — 하드코딩된 키바인드
// Tab: 패널 전환
// ?: 도움말
// q: 종료 (대시보드 패널 포커스 시)
// Ctrl+C: 두 번 눌러 종료
// Ctrl+L: 채팅 클리어 (ChatPanel에서)
// ↑↓: 히스토리/프로젝트 네비게이션
// /: 슬래시 명령 모드
// Esc: 오버레이 닫기
```

### 📌 키바인드 개선 방향

| 항목              | 상태               | 개선안                                          | 우선순위 |
| ----------------- | ------------------ | ----------------------------------------------- | -------- |
| **커스터마이징**  | ❌ 하드코딩        | 🟡 설정 파일에서 키바인드 변경 가능하게 (v0.6+) |
| **Leader key**    | ❌                 | 🟡 Ctrl+K 리더키 → 복합 액션 (v0.6+)            |
| **현재 키바인드** | ✅ 직관적          | ✅ Tab, ?, Ctrl+C 등 표준적                     |
| **Ctrl+C 더블탭** | ✅                 | ✅ 실수 방지 좋은 패턴                          |
| **HelpOverlay**   | ✅ 9개 단축키 표시 | ✅                                              |

---

### 2.6 상태 관리

#### OpenCode

```
- SolidJS Store + createStore (복잡한 중첩 상태)
- SDK → SSE 이벤트 → Store 업데이트 → 자동 UI 갱신
- Local State: TUI 전용 상태 (패널 포커스, 스크롤 위치 등)
- Server State: 세션/메시지/도구 상태 (SDK 통해 서버와 동기화)
```

#### OpenLander

```typescript
// App.tsx — 최상위 시그널
const [mode, setMode] = createSignal<'setup' | 'dashboard'>('dashboard');
const [showHelp, setShowHelp] = createSignal(false);
const [activePanel, setActivePanel] = createSignal<'left' | 'right'>('left');
const [ctrlCCount, setCtrlCCount] = createSignal(0);

// ChatPanel.tsx — 채팅 시그널
const [messages, setMessages] = createSignal<DisplayMessage[]>([]);
const [isStreaming, setIsStreaming] = createSignal(false);
const [inputValue, setInputValue] = createSignal('');
const [chatHistory, setChatHistory] = createSignal<ChatHistoryEntry[]>([]);

// DashboardPanel.tsx — 대시보드 시그널
const [systemStats, setSystemStats] = createSignal<SystemStats | null>(null);
const [projects, setProjects] = createSignal<Project[]>([]);
const [activity, setActivity] = createSignal<ActivityEvent[]>([]);

// useDaemon.ts — 데몬 연결 시그널
const [status, setStatus] = createSignal<DaemonStatus>('connecting');
const [health, setHealth] = createSignal<HealthResponse | null>(null);

// 콜백 패턴: DashboardPanel → onStatsUpdate → App → StatusBar
```

### 📌 상태 관리 개선 방향

| 항목                  | 상태                         | 개선안                                                    | 우선순위 |
| --------------------- | ---------------------------- | --------------------------------------------------------- | -------- |
| **시그널 구조**       | ✅ 각 컴포넌트 독립 시그널   | ✅ 현재 규모에 적합                                       |
| **Prop drilling**     | 🟡 onStatsUpdate 콜백 체인   | 🟡 createStore로 글로벌 상태 추출 (컴포넌트 5개+ 공유 시) |
| **displayKey 최적화** | ✅ 변경 감지 후에만 setState | ✅ 불필요한 리렌더 방지. 좋은 패턴                        |
| **IPC polling**       | ✅ 30초 주기                 | 🟡 SSE 전환 시 실시간 업데이트 (장기)                     |

---

### 2.7 온보딩 플로우

#### OpenCode

```
- 첫 실행 시 자동 감지: 프로바이더 설정 없으면 안내
- opencode.ai/zen 안내 (무료 모델)
- 대화형 설정: 모델 선택, API 키 입력
```

#### OpenLander

```
src/tui/onboarding/
├── index.tsx        — 온보딩 메인 (단계별)
├── Welcome.tsx      — 환영 화면
├── DockerCheck.tsx   — Docker 설치 확인/자동설치
├── TraefikSetup.tsx  — Traefik 프록시 셋업
├── LlmSetup.tsx      — LLM API 키 설정
├── GitSetup.tsx      — Git SSH 키 설정
├── PatchNotes.tsx    — 패치 노트
├── Ready.tsx         — 설정 완료
└── version.ts        — 버전 관리
```

### 📌 온보딩 평가

> **OpenLander 온보딩이 더 우수함.**
>
> 배포 에이전트 특성상 Docker, Traefik, Git, LLM 모두 필요 → 단계별 위저드가 필수.
> OpenCode는 LLM 설정만 필요해서 단순한 것.
> **현재 구조 유지. 변경 불필요.**

---

### 2.8 자동 스크롤

#### OpenCode

```
- 스마트 자동 스크롤: 사용자가 위로 스크롤하면 비활성화
- 새 메시지 도착 시 "New messages ↓" 인디케이터
- 하단 고정 (tail -f 스타일)
- 자동 스크롤 재활성화: 하단까지 스크롤 시
```

#### OpenLander

```typescript
// ChatPanel.tsx
const [, setScrollOffset] = createSignal(0);
createEffect(() => {
  const totalLines = calculateMessageLines(messages());
  const maxOffset = Math.max(0, totalLines - messageAreaHeight());
  setScrollOffset(maxOffset);
});

// → 항상 하단으로 스크롤 (사용자 스크롤 위치 무시)
```

### 📌 자동 스크롤 개선 방향

| 항목                   | 상태               | 개선안                                                  | 우선순위 |
| ---------------------- | ------------------ | ------------------------------------------------------- | -------- |
| **스마트 스크롤**      | ❌ 항상 하단       | ✅ 사용자가 위로 스크롤하면 고정, 하단 도달 시 재활성화 | 높음     |
| **"New messages ↓"**   | ❌                 | ✅ 위로 스크롤 중 새 메시지 도착 시 표시                | 높음     |
| **빌드 로그 스트리밍** | 현재 메시지로 표시 | 🟡 전용 로그 뷰어 (접기/펼치기 + 스크롤)                | 중간     |

---

### 2.9 슬래시 명령 시스템

#### OpenCode

```
/commands    — 명령어 목록
/model       — 모델 변경
/session     — 세션 관리
/theme       — 테마 변경
/config      — 설정 변경
/share       — 대화 공유
/compact     — 컨텍스트 압축
/clear       — 클리어
```

#### OpenLander

```typescript
// 22개 명령:
/help      — 도움말
/deploy    — 배포
/logs      — 로그
/stop      — 정지
/start     — 시작
/restart   — 재시작
/remove    — 제거
/status    — 상태
/projects  — 프로젝트 목록
/redeploy  — 재배포
/public    — 퍼블릭 설정
/expose    — Quick Share (TryCloudflare)
/unexpose  — 외부 접근 해제
/domain    — 도메인 매핑
/domains   — 도메인 목록
/env       — 환경변수
/system    — 시스템 정보
/cleanup   — 정리
/config    — 설정
/git       — Git 인증
/ssh       — SSH 키
/clear     — 클리어
/exit      — 종료
```

### 📌 슬래시 명령 평가

> **OpenLander가 도메인 특화 명령이 더 풍부함 (22개 vs ~8개).**
> 이는 배포 도메인 특성상 당연한 결과.
>
> 개선 포인트:
>
> - `/model` — 런타임 모델 변경 (OpenCode에서 차용)
> - `/compact` — 컨텍스트 압축 (긴 배포 대화 시 유용)
> - 프로젝트명 자동완성 (`/logs my-a` → Tab → `/logs my-app`)

---

### 2.10 없는 것 (OpenCode에는 있고 OpenLander에는 없는 TUI 기능)

| 기능                    | OpenCode                  | OpenLander        | 필요성                                         |
| ----------------------- | ------------------------- | ----------------- | ---------------------------------------------- |
| **세션 사이드바**       | 대화 목록, 전환, 분기     | 없음              | 🟡 낮음 — 배포 세션 1개면 충분                 |
| **에이전트 전환 (Tab)** | Tab으로 build↔plan 전환   | Tab으로 패널 전환 | 🟡 중간 — deploy↔diagnose↔monitor 전환 (v0.6+) |
| **모델 선택 오버레이**  | `<leader>m`으로 모델 변경 | 없음              | ✅ 높음 — `/model` 명령으로 추가               |
| **토큰 사용량 표시**    | StatusBar에 토큰 수 표시  | 없음              | 🟡 중간 — 비용 인식에 유용                     |
| **접기/펼치기**         | 도구 결과 접기/펼치기     | 없음              | ✅ 높음 — 빌드 로그 필수                       |
| **마크다운 렌더링**     | 코드 블록, 헤더, 리스트   | 순수 텍스트       | 🟡 중간                                        |
| **i18n**                | UI 문자열 다국어          | 없음              | 🟡 중간 (글로벌 시)                            |
| **테마 프리셋**         | 6+종                      | 다크 1종          | 🟡 낮음                                        |
| **커스텀 키바인드**     | 설정 가능                 | 하드코딩          | 🟡 낮음                                        |
| **자동 스크롤 스마트**  | 위치 기억 + 재활성화      | 항상 하단         | ✅ 높음                                        |

---

## 3. OpenLander TUI 고유 강점 (유지해야 할 것)

OpenCode에 **없는** OpenLander만의 TUI 기능:

| 기능                    | 설명                                             |
| ----------------------- | ------------------------------------------------ |
| **실시간 대시보드**     | CPU/MEM/Disk 모니터링, 프로젝트 상태 한눈에      |
| **프로젝트 목록**       | 상태 아이콘(●◐○✖), 포트, 메모리, URL 실시간 표시 |
| **활동 로그**           | 배포/에러/성공 이벤트 타임라인                   |
| **MCP 상태**            | MCP 서버 연결 상태 표시                          |
| **빌드 결과 표시**      | 성공/실패 + 소요시간 + 출력 전용 컴포넌트        |
| **오케스트레이션 표시** | 배포 단계 시각화 (1. Clone → 2. Build → 3. Run)  |
| **리소스 임계값 컬러**  | CPU 60%↑ 노랑, 80%↑ 빨강 자동 변경               |
| **miniBar 위젯**        | `◼◼◻` 3자 미니 리소스 바                         |
| **온보딩 위저드**       | Docker/Traefik/LLM/Git 단계별 설정               |
| **Ctrl+C 이중 확인**    | 실수 방지 (2초 내 두 번 눌러 종료)               |
| **displayKey 최적화**   | 폴링 결과 변경 시에만 리렌더                     |
| **CJK 전폭 문자 계산**  | getDisplayWidth() — 한중일 문자 2열 계산         |

---

## 4. 우선순위별 개선 로드맵

### 🔴 즉시 적용 (다음 스프린트)

| #   | 개선                   | 구현 방법                                       | 예상 공수 |
| --- | ---------------------- | ----------------------------------------------- | --------- |
| 1   | **스마트 자동 스크롤** | 사용자 스크롤 위치 추적 + 하단 도달 시 재활성화 | 2-3시간   |
| 2   | **접기/펼치기**        | 빌드 로그, 명령 출력에 `[Enter]` 토글           | 3-4시간   |
| 3   | **"New messages ↓"**   | 자동 스크롤 비활성 중 새 메시지 알림            | 1-2시간   |

### 🟡 중기 적용 (v0.5-v0.6)

| #   | 개선                    | 구현 방법                                        | 예상 공수 |
| --- | ----------------------- | ------------------------------------------------ | --------- |
| 4   | **`/model` 명령**       | 프로바이더/모델 변경 슬래시 명령 + 선택 오버레이 | 4-5시간   |
| 5   | **토큰 사용량**         | StatusBar에 누적 토큰 수 / 예상 비용 표시        | 2-3시간   |
| 6   | **프로젝트명 Tab 완성** | `/logs my-a` → Tab → `/logs my-app`              | 2-3시간   |
| 7   | **코드 블록 렌더링**    | \`\`\` 감지 → 박스 + 배경색                      | 3-4시간   |
| 8   | **멀티라인 입력**       | Shift+Enter 줄바꿈                               | 2-3시간   |
| 9   | **i18n 기반 구축**      | UI 문자열 키 분리 → `t('key')` 패턴              | 1일       |

### 🟢 장기 적용 (v0.7+)

| #   | 개선                | 구현 방법                        | 예상 공수 |
| --- | ------------------- | -------------------------------- | --------- |
| 10  | **에이전트 전환**   | deploy↔diagnose↔monitor Tab 전환 | 1일       |
| 11  | **테마 프리셋**     | catppuccin, dracula, nord 등     | 0.5일     |
| 12  | **커스텀 키바인드** | openlander.json에서 키 변경      | 1일       |
| 13  | **Leader key**      | Ctrl+K → 복합 액션               | 0.5일     |
| 14  | **설정 오버레이**   | 인앱에서 설정 변경               | 1일       |

---

## 5. 코드 품질 평가

### OpenLander TUI 현재 코드 품질

| 항목                  | 평가    | 비고                                           |
| --------------------- | ------- | ---------------------------------------------- |
| **컴포넌트 분리**     | ✅ 우수 | AgentDisplay 6종 분리, SectionHeader 추출 등   |
| **타입 안전성**       | ✅ 우수 | DisplayMessage 완전한 타입 정의                |
| **유틸 분리**         | ✅ 우수 | dashboard-utils.ts 순수 함수 분리, 테스트 용이 |
| **테마 일관성**       | ✅ 우수 | 모든 컴포넌트가 theme 객체 참조                |
| **SplitBorder 패턴**  | ✅ 우수 | 일관된 파이프 보더 스타일                      |
| **에러 핸들링**       | ✅ 우수 | try-catch + 에러 로그 파일 + 대체 렌더링       |
| **IME/CJK**           | ✅ 우수 | 한중일 입력 완벽 지원                          |
| **반응형**            | ✅ 양호 | 100열 기준 split↔single 전환                   |
| **커맨드 레지스트리** | ✅ 우수 | 플래그 파싱, 따옴표 토크나이저                 |
| **Ctrl+C 안전성**     | ✅ 우수 | 이중 확인 + 타이머                             |

### 개선이 필요한 코드 구조

| 항목                    | 현재                    | 개선안                                            |
| ----------------------- | ----------------------- | ------------------------------------------------- |
| **ChatPanel 크기**      | 478줄 (과대)            | 메시지 표시 로직을 별도 훅으로 추출               |
| **DashboardPanel 크기** | 403줄 (과대)            | fetchAll 로직을 useProjects/useSystem 훅으로 분리 |
| **handleStreamEvent**   | ChatPanel에 인라인      | useChat 훅 활용 (이미 존재하지만 미사용)          |
| **키바인드 산재**       | App.tsx + ChatPanel.tsx | 중앙 키바인드 레지스트리                          |

---

## 6. 결론

### 핵심 인사이트

> OpenLander TUI는 **배포 도메인에 최적화된 우수한 TUI**입니다.
> OpenCode와 동일한 기술 기반(@opentui/solid, SolidJS)을 쓰면서도
> 대시보드, 프로젝트 모니터링, 빌드 결과 표시 등 **고유 컴포넌트**가 강점.
>
> 부족한 부분은 대부분 **편의 기능** (스마트 스크롤, 접기/펼치기, 토큰 표시)이며,
> 핵심 구조와 디자인 패턴은 이미 잘 갖춰져 있습니다.

### 최우선 3가지

1. **스마트 자동 스크롤** — 빌드 로그 스트리밍 중 사용성 대폭 개선
2. **접기/펼치기** — 긴 출력이 채팅을 가리는 문제 해결
3. **`/model` 런타임 변경** — 대화 중 모델 전환 (비용 제어)
