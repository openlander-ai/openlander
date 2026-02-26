# OpenLander v0.6 — 상세 개발 Task 목록

> **기준일**: 2025-02-26
> **범위**: v0.6 TUI UI/UX 고도화 (requirements.md §v0.6 기반)
> **레퍼런스**: OpenCode TUI, Claude Code TUI

---

## 현황 요약

### 완료된 작업 (v0.6 이전 세션)

- [x] OpenCode 다크 테마 적용 (`#0a0a0a` 배경, warm accent)
- [x] Flex 레이아웃 전환 (explicit height → flex)
- [x] 중앙 빈 상태 프롬프트 → 첫 메시지 후 하단 이동
- [x] 슬래시 커맨드 피커 오버레이 (↑↓, Mouse, Enter, Esc)
- [x] Tier 1 슬래시 커맨드 8개: `/help`, `/model`, `/compact`, `/connect`, `/repo`, `/projects`, `/clear`, `/exit`
- [x] 모델 선택 오버레이 (`/model`)
- [x] Git 프로바이더 연동 오버레이 (`/connect`) + 토큰 검증
- [x] 레포 브라우저 오버레이 (`/repo`) + IPC 배포 트리거
- [x] KeyEvent.name 기반 키보드 핸들링 전면 수정
- [x] Tier 3 에이전트 프록시 커맨드 제거 (LLM 바이패스 원칙)
- [x] 73개 단위 테스트 (52 slash-command + 21 slash-picker)
- [x] 문서 재구조화 (`docs/planning/`, `docs/analysis/`)

---

## Task 분류

| 우선순위 | 의미                                       |
| -------- | ------------------------------------------ |
| 🔴 P0    | 기본 사용성에 필수. 이것 없으면 데모 불가  |
| 🟡 P1    | 품질 향상. 프로덕션 수준으로 올리려면 필요 |
| 🟢 P2    | Nice-to-have. 나중에 해도 됨               |

| 난이도 | 의미                           |
| ------ | ------------------------------ |
| S      | 1~2시간. 단일 파일 수정        |
| M      | 반나절. 2~3개 파일, 연동 필요  |
| L      | 1일+. 새 모듈 or 아키텍처 변경 |

---

## 카테고리 1: 슬래시 커맨드 확장

### T-CMD-01: Tier 2 직접 실행 커맨드 — `/logs`

- **우선순위**: 🔴 P0 | **난이도**: M
- **설명**: 프로젝트 컨테이너 로그를 TUI에서 조회. `/logs <project> [-n 100]`
- **구현**:
  1. `registry.ts`에 `logs` 커맨드 추가 → `{ action: 'logs', project, lines }`
  2. IPC `client.ts`의 `getLogs()` 연동
  3. 새 `LogsOverlay.tsx` — 스크롤 가능한 로그 뷰어, 실시간 follow 옵션
  4. `App.tsx`에서 `logs` action 라우팅
- **의존성**: IPC 클라이언트에 `getLogs()` 존재 여부 확인 필요
- **테스트**: 커맨드 파싱 + 오버레이 렌더링 단위테스트

### T-CMD-02: Tier 2 직접 실행 커맨드 — `/stop`, `/start`, `/restart`

- **우선순위**: 🔴 P0 | **난이도**: M
- **설명**: 프로젝트 컨테이너 제어. 인자로 프로젝트명 필수.
- **구현**:
  1. `registry.ts`에 `stop`, `start`, `restart` 추가 → `{ action: 'container-control', operation, project }`
  2. IPC 클라이언트 `stopProject()`, `startProject()`, `restartProject()` 연동
  3. 실행 결과를 채팅에 시스템 메시지로 피드백
  4. 프로젝트명 자동완성 (`getProjectCompletions()` 활용)
- **의존성**: T-CMD-01과 병렬 가능
- **테스트**: 커맨드 파싱 (프로젝트명 인자 필수 검증)

### T-CMD-03: Tier 2 직접 실행 커맨드 — `/status`

- **우선순위**: 🟡 P1 | **난이도**: S
- **설명**: 전체 또는 특정 프로젝트 상태 요약. `/status [project]`
- **구현**:
  1. `registry.ts`에 `status` 추가
  2. 인자 없으면 전체 프로젝트 목록 + 상태, 있으면 해당 프로젝트 상세
  3. 채팅에 시스템 메시지로 출력 (테이블 형식)
- **의존성**: IPC `getProjects()` / `getProject()`

### T-CMD-04: Tier 2 직접 실행 커맨드 — `/env`

- **우선순위**: 🟡 P1 | **난이도**: M
- **설명**: 환경변수 조회/설정. `/env <project>`, `/env <project> KEY=VALUE`
- **구현**:
  1. `registry.ts`에 `env` 추가
  2. 인자 파싱: 프로젝트명만 → 목록 (마스킹), KEY=VALUE → 설정
  3. IPC `getEnv()`, `setEnv()` 연동
  4. `--redeploy` 플래그 지원
- **의존성**: 없음

### T-CMD-05: Tier 2 직접 실행 커맨드 — `/remove`

- **우선순위**: 🟡 P1 | **난이도**: M
- **설명**: 프로젝트 삭제 (확인 필요). `/remove <project>`
- **구현**:
  1. `registry.ts`에 `remove` 추가
  2. 확인 프롬프트 표시 ("정말 삭제하시겠습니까? [y/N]")
  3. IPC `removeProject()` 연동
  4. 결과 채팅 피드백
- **의존성**: 확인 프롬프트 UI 패턴 (인라인 or 오버레이)

### T-CMD-06: `/deploy` TUI 통합

- **우선순위**: 🔴 P0 | **난이도**: L
- **설명**: `/deploy <repo-url>` → IPC 배포 파이프라인 실행 + 실시간 빌드 로그 스트리밍
- **구현**:
  1. `registry.ts`에 `deploy` 추가 → `{ action: 'deploy', repoUrl, name, env }`
  2. `--name`, `--env` 플래그 파싱
  3. 배포 시작 시 `streamBuildProgress()` 연동
  4. 빌드 로그 실시간 표시 (ChatPanel 내 또는 별도 Build 패널)
  5. 완료/실패 시 시스템 메시지 + URL 표시
- **의존성**: `streamBuildProgress()` (이미 IPC client에 존재)
- **참고**: `/repo`에서 선택 → deploy와 동일한 흐름이어야 함

---

## 카테고리 2: 채팅 영역 개선

### T-CHAT-01: 마크다운 렌더링

- **우선순위**: 🟡 P1 | **난이도**: L
- **설명**: 에이전트 응답의 마크다운 (헤더, 볼드, 코드블록, 리스트)을 TUI에서 렌더링
- **구현**:
  1. `marked-terminal` 또는 TUI 호환 마크다운 파서 조사
  2. `ChatMessage.tsx`에서 에이전트 메시지를 파싱 → 스타일드 텍스트로 변환
  3. 코드블록: 배경색 구분 (`backgroundElement`)
  4. 인라인 코드: 백틱 감지 → accent 색상
- **리스크**: @opentui/solid 렌더링 제약 확인 필요
- **의존성**: 없음

### T-CHAT-02: 코드블록 신택스 하이라이팅

- **우선순위**: 🟢 P2 | **난이도**: L
- **설명**: 코드 블록에 언어별 신택스 하이라이팅 적용
- **구현**:
  1. TUI 호환 하이라이터 조사 (cli-highlight, chalk 기반)
  2. T-CHAT-01의 코드블록 파이프라인에 통합
  3. 지원 언어: JS/TS, Python, JSON, YAML, Bash, Dockerfile
- **의존성**: T-CHAT-01

### T-CHAT-03: 멀티라인 입력

- **우선순위**: 🟢 P2 | **난이도**: M
- **설명**: Shift+Enter로 줄바꿈, Enter로 전송
- **구현**:
  1. `Prompt.tsx`에서 Shift+Enter 감지 → 줄바꿈 삽입
  2. textarea 높이 자동 조절 (최대 5줄)
  3. 멀티라인 상태에서 Enter 동작 유지
- **리스크**: @opentui/core textarea의 멀티라인 지원 범위 확인
- **의존성**: 없음

---

## 카테고리 3: 대시보드 고도화

### T-DASH-01: 프로젝트 카드 UI

- **우선순위**: 🔴 P0 | **난이도**: M
- **설명**: 대시보드 프로젝트 목록을 카드 형태로 표시 (상태 뱃지, 포트, URL, 메모리)
- **구현**:
  1. `DashboardPanel.tsx` 내 프로젝트 섹션 리팩토링
  2. 각 프로젝트: 상태 아이콘 (●/◐/○/✖) + 이름 + 포트 + 메모리 + URL
  3. 빌드 중인 프로젝트는 프로그레스 바 표시
  4. IPC `getProjects()` 폴링 (3초)
- **의존성**: IPC 엔드포인트 동작 확인

### T-DASH-02: 시스템 리소스 표시

- **우선순위**: 🟡 P1 | **난이도**: M
- **설명**: CPU, 메모리, 디스크 사용량을 미니 바 차트로 표시
- **구현**:
  1. 대시보드 상단에 System 섹션 추가
  2. CPU/MEM/Disk 바 차트 (ProgressBar 컴포넌트 재활용)
  3. 80% 초과 시 error 색상
  4. IPC `getSystemStats()` 폴링 (2초)
- **의존성**: `ProgressBar.tsx` 이미 존재

### T-DASH-03: 활동 로그 실시간 표시

- **우선순위**: 🟡 P1 | **난이도**: M
- **설명**: 최근 배포/빌드/에러 이벤트를 대시보드에 실시간 표시
- **구현**:
  1. 대시보드 Activity 섹션 추가
  2. IPC `/api/activity?follow=true` NDJSON 스트리밍 연동
  3. 최대 10개 표시, 최신순 정렬
  4. 상태별 색상 (success=green, building=warning, error=red)
- **의존성**: IPC 활동 로그 스트리밍 API

### T-DASH-04: 프로젝트 검색/필터

- **우선순위**: 🟢 P2 | **난이도**: S
- **설명**: 프로젝트 목록에서 이름 검색
- **구현**:
  1. 대시보드 포커스 시 `/` 입력으로 검색 모드 진입
  2. 프로젝트명 필터링 (로컬, 서버 요청 불필요)
- **의존성**: T-DASH-01

---

## 카테고리 4: 레이아웃 & 테마

### T-LAYOUT-01: 반응형 레이아웃

- **우선순위**: 🟡 P1 | **난이도**: M
- **설명**: 터미널 너비에 따라 패널 배치 변경
- **구현**:
  1. 터미널 너비 감지 (process.stdout.columns 또는 @opentui 이벤트)
  2. ≥100: 좌우 분할 (55:45)
  3. <100: 단일 패널 모드 + Tab으로 Chat ↔ Dashboard 전환
  4. 하단 상태바에 요약 표시 (단일 패널 모드)
- **의존성**: `Layout.tsx` 수정

### T-LAYOUT-02: 보더/구분선 스타일 정리

- **우선순위**: 🟢 P2 | **난이도**: S
- **설명**: OpenCode 스타일 구분선. 깔끔한 단일선, dim 색상.
- **구현**:
  1. 모든 `<box>` 보더를 theme.border 색상으로 통일
  2. 활성 패널은 theme.borderActive 적용
  3. 포커스 없는 패널은 borderDim 처리
- **의존성**: 없음

---

## 카테고리 5: 키보드 & 네비게이션

### T-KEY-01: Ctrl+L 화면 클리어

- **우선순위**: 🟡 P1 | **난이도**: S
- **설명**: 채팅 히스토리를 시각적으로 클리어 (데이터는 유지)
- **구현**:
  1. `ChatPanel.tsx` onKeyDown에서 ctrl+l 감지
  2. 채팅 표시 상태만 초기화 (히스토리는 보존)
- **의존성**: 없음

### T-KEY-02: Ctrl+C 실행 취소 / 더블 탭 종료

- **우선순위**: 🔴 P0 | **난이도**: M
- **설명**: Ctrl+C → 실행 중인 작업 취소. 2초 내 재입력 → 종료.
- **구현**:
  1. 글로벌 키보드 핸들러에서 ctrl+c 감지
  2. 활성 작업(배포, 스트리밍) 있으면 → 취소 IPC 호출
  3. 활성 작업 없으면 → "Ctrl+C를 한번 더 누르면 종료" 상태바 표시
  4. 2초 타이머 내 재입력 시 process.exit()
- **의존성**: 없음

### T-KEY-03: Vim-style 네비게이션 (j/k)

- **우선순위**: 🟢 P2 | **난이도**: S
- **설명**: 채팅 입력 중이 아닐 때 j/k로 스크롤
- **구현**:
  1. 포커스가 textarea 아닌 곳일 때 j=down, k=up 매핑
  2. 오버레이에서도 동작
- **의존성**: 없음

---

## 카테고리 6: 에이전트 상호작용

### T-AGENT-01: 배포 파이프라인 진행률 시각화

- **우선순위**: 🔴 P0 | **난이도**: L
- **설명**: git clone → docker build → docker run → traefik → URL 단계별 프로그레스
- **구현**:
  1. IPC `streamBuildProgress()` 이벤트 구조 확인
  2. 채팅 내 인라인 진행률 표시: 단계명 + 프로그레스 바 + 시간
  3. 각 단계 완료 시 ✅ 마킹, 실패 시 ❌ + 에러 메시지
  4. Docker build 단계에서 빌드 로그 실시간 스트리밍
- **의존성**: T-CMD-06과 통합

### T-AGENT-02: 명확화 질문 선택지 UI

- **우선순위**: 🟢 P2 | **난이도**: M
- **설명**: 에이전트가 "이 중 어느 것을 원하시나요?" 질문 시 선택지를 인라인 버튼으로 표시
- **구현**:
  1. 에이전트 응답에서 선택지 패턴 감지 (JSON 또는 마크다운 리스트)
  2. 인라인 선택 UI: 번호 키(1/2/3) 또는 ↑↓+Enter
  3. 선택 결과를 자동으로 채팅에 전송
- **의존성**: 에이전트 응답 구조 확인

---

## 카테고리 7: Compact/Summarize 고도화

### T-COMPACT-01: `/compact` 요약 프롬프트 설계 + IPC 연동

- **우선순위**: 🔴 P0 | **난이도**: L
- **설명**: 채팅 컨텍스트를 LLM으로 요약하여 새 세션 시작
- **구현**:
  1. OpenCode compact 구현 참고 (이미 탐색 완료)
  2. 요약 프롬프트 설계: 배포 상태, 진행 중인 작업, 핵심 결정사항 보존
  3. IPC를 통해 데몬에 요약 요청 → 응답 수신
  4. 요약 결과를 시스템 메시지로 표시 + 새 세션 ID 시작
  5. 이전 히스토리는 SQLite에 보관 (채팅 히스토리 무한 증가 방지)
- **프롬프트 방향**:
  - "배포 에이전트 관점에서 요약" (일반 대화 요약이 아님)
  - 보존 항목: 활성 프로젝트 상태, 사용자 선호 설정, 미해결 에러
  - 제거 항목: 이미 완료된 배포 로그 상세, 반복 질문
- **의존성**: 데몬 측 요약 API 필요

---

## 카테고리 8: 인프라 & 품질

### T-INFRA-01: i18n 기반 구축

- **우선순위**: 🟡 P1 | **난이도**: L
- **설명**: 다국어 지원 기반. 모든 UI 문자열을 i18n 키로 치환.
- **구현**:
  1. i18n 라이브러리 선택 (i18next 또는 경량 대안)
  2. `src/tui/i18n/` 디렉토리 생성
  3. `en.json`, `ko.json` 번역 파일
  4. 모든 하드코딩된 문자열을 `t('key')` 호출로 교체
  5. 언어 설정: config에서 읽기 또는 시스템 로케일 감지
- **의존성**: 없음. 다만 모든 컴포넌트 터치 필요하므로 다른 작업 전에 결정

### T-INFRA-02: Vercel AI SDK 마이그레이션 조사

- **우선순위**: 🟢 P2 | **난이도**: L (조사만)
- **설명**: 현재 에이전트 구현을 Vercel AI SDK로 마이그레이션 가능성 조사
- **구현**:
  1. 현재 에이전트 코드 구조 분석
  2. Vercel AI SDK의 tool calling, streaming 패턴 매핑
  3. 마이그레이션 계획 문서 작성 (`docs/planning/ai-sdk-migration.md`)
- **의존성**: 없음. 조사 단계.

### T-INFRA-03: 다중 Git 프로바이더 아키텍처

- **우선순위**: 🟡 P1 | **난이도**: L
- **설명**: GitHub 외에 GitLab, Bitbucket, Gitea 연동. `/connect`에서 선택.
- **구현**:
  1. Git 프로바이더 인터페이스 설계 (`src/git/provider.ts`)
  2. GitHub 구현 (현재 코드 리팩토링)
  3. GitLab 구현
  4. `/connect` 오버레이에서 프로바이더 선택 UI
  5. 프로바이더별 레포 목록 API 통합
- **의존성**: `/connect` 오버레이 이미 존재

---

## 실행 순서 (권장)

### Phase A: 핵심 사용성 (P0)

> 이것들이 끝나면 데모 가능한 수준

```
T-CMD-06  /deploy TUI 통합
T-CMD-01  /logs
T-CMD-02  /stop, /start, /restart
T-KEY-02  Ctrl+C 실행 취소
T-DASH-01 프로젝트 카드 UI
T-AGENT-01 배포 진행률 시각화
T-COMPACT-01 /compact 요약 프롬프트
```

### Phase B: 품질 향상 (P1)

> 프로덕션 수준으로 올리기

```
T-CMD-03  /status
T-CMD-04  /env
T-CMD-05  /remove
T-CHAT-01 마크다운 렌더링
T-DASH-02 시스템 리소스
T-DASH-03 활동 로그
T-LAYOUT-01 반응형 레이아웃
T-KEY-01  Ctrl+L 클리어
T-INFRA-01 i18n 기반
T-INFRA-03 다중 Git 프로바이더
```

### Phase C: 폴리시 (P2)

> 완성도 높이기

```
T-CHAT-02 신택스 하이라이팅
T-CHAT-03 멀티라인 입력
T-DASH-04 프로젝트 검색
T-LAYOUT-02 보더 스타일
T-KEY-03  Vim 네비게이션
T-AGENT-02 명확화 질문 UI
T-INFRA-02 Vercel AI SDK 조사
```

---

## 참고사항

- **슬래시 명령 원칙**: LLM을 거치지 않고 직접 실행. 결과는 채팅에 시스템 메시지로 표시.
- **테마**: OpenCode 다크 테마 유지. 추후 브랜딩 커스터마이징 예정.
- **키보드**: 모든 핸들러는 `KeyEvent.name` 사용 (OpenTUI 표준).
- **테스트**: 각 커맨드/오버레이 추가 시 단위 테스트 필수.
- **기존 IPC 함수**: `deploy()`, `streamBuildProgress()`, `getLogs()`, `getProjects()` 등 — 구현 전 실제 API 시그니처 확인 필요.
