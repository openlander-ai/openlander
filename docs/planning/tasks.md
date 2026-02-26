# OpenLander v0.6 — 상세 개발 Task 목록

> **기준일**: 2025-02-26
> **범위**: v0.6 TUI UI/UX 고도화
> **입력 문서**: requirements.md, tui-spec.md, ui-ux-layout.md, ui-ux-build-compose.md
> **레퍼런스**: OpenCode TUI, Claude Code TUI

---

## 현황 요약

### 완료된 작업

- [x] OpenCode 다크 테마 적용 (`#0a0a0a` 배경, warm accent)
- [x] Flex 레이아웃 전환 (explicit height → flex)
- [x] 중앙 빈 상태 프롬프트 → 첫 메시지 후 하단 이동
- [x] 슬래시 커맨드 피커 오버레이 (↑↓, Mouse, Enter, Esc)
- [x] 슬래시 커맨드 9개: `/help`, `/model`, `/git`, `/repo`, `/tunnel`, `/env`, `/compact`, `/clear`, `/exit`
- [x] 모델 선택 오버레이 (`/model`)
- [x] Git 프로바이더 연동 오버레이 (`/connect`) + 토큰 검증
- [x] 레포 브라우저 오버레이 (`/repo`) + IPC 배포 트리거
- [x] KeyEvent.name 기반 키보드 핸들링 전면 수정
- [x] Tier 3 에이전트 프록시 커맨드 제거 (LLM 바이패스 원칙)
- [x] 73개 단위 테스트 (52 slash-command + 21 slash-picker)
- [x] 문서 재구조화 (`docs/planning/`, `docs/analysis/`)

### 최종 슬래시 커맨드 (9개)

> 설정 5개 (GUI 피커 오버레이) + TUI 시스템 4개. `/` 입력 시 9개 바로 표시.
> `/stop`, `/restart`, `/logs` → 채팅 자연어로 대체 (슬래시에서 제거).

| 명령어     | 동작                              | 상태                               |
| ---------- | --------------------------------- | ---------------------------------- |
| `/help`    | 오버레이 → 명령어 목록            | ✅                                 |
| `/model`   | 오버레이 → LLM 모델 선택          | ✅                                 |
| `/git`     | 오버레이 → Git 프로바이더 관리    | ✅ (기존 `/connect` 리네임)        |
| `/repo`    | 오버레이 → 레포 브라우저 → 배포   | ✅                                 |
| `/tunnel`  | 오버레이 → Cloudflare Tunnel 설정 | 🆕 Phase 1 골격                    |
| `/env`     | 오버레이 → 환경변수 관리          | 🆕 Phase 1 골격                    |
| `/compact` | 채팅 컨텍스트 요약                | ⚠️ action만 발행, 요약 로직 미구현 |
| `/clear`   | 채팅 클리어                       | ✅                                 |
| `/exit`    | 앱 종료                           | ✅                                 |

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
| XL     | 2일+. 다수 모듈, 아키텍처 변경 |

---

## Phase 1: 레이아웃 아키텍처 (기반)

> 모든 기능의 토대. 이것 없이는 나머지 Phase가 성립하지 않음.
> 참고: `ui-ux-layout.md` §레이아웃 구조, §3가지 모드, §패널 포커스 관리

### T-ARCH-01: 3-모드 상태 머신

- **우선순위**: 🔴 P0 | **난이도**: L
- **설명**: TUI 전체를 3가지 모드로 운영. 우측 패널이 모드에 따라 자동 전환.
- **모드 정의**:
  | 모드 | 진입 조건 | 우측 패널 내용 |
  |------|-----------|---------------|
  | **모니터링** (기본) | 앱 시작, 빌드 완료 3초 후, Esc | System + Projects + Activity + Alerts |
  | **배포** | 빌드 시작 시 자동 | 상단: System+Projects (축소) / 하단: Build 패널 |
  | **디버깅** | 프로젝트 Enter (Status 패널에서) | 상단: 프로젝트 Info / 하단: 실시간 로그 |
- **구현**:
  1. `src/tui/state/mode.ts` — 모드 상태 관리 (signal/store)
  2. 모드 enum: `monitoring | deploying | debugging`
  3. 모드 전환 트리거 함수: `enterDeployMode(projectId)`, `enterDebugMode(projectId)`, `returnToMonitoring()`
  4. 배포 모드: 빌드 시작 시 자동 진입, 완료 3초 후 자동 복귀
  5. 디버깅 모드: Esc로 모니터링 복귀
  6. 모드 전환 시 채팅에 시스템 메시지 (`[📋 Build panel opened]` 등)
- **의존성**: 없음 (기반 작업)

### T-ARCH-02: 적응형 우측 패널 (Status Panel)

- **우선순위**: 🔴 P0 | **난이도**: L
- **설명**: 기존 `DashboardPanel.tsx`를 모드별로 다른 내용을 표시하는 적응형 패널로 교체
- **구현**:
  1. 새 `StatusPanel.tsx` — 모드 signal을 구독하여 렌더링 분기
  2. 모니터링: `<MonitoringView>` (System + Projects + Activity + Alerts)
  3. 배포: 상단 `<MonitoringView compact>` + 하단 `<BuildPanel>`
  4. 디버깅: 상단 `<ProjectInfo>` + 하단 `<LogViewer>`
  5. 기존 `DashboardPanel.tsx` → `StatusPanel.tsx`로 점진적 교체
- **의존성**: T-ARCH-01

### T-ARCH-03: 포커스 관리 시스템

- **우선순위**: 🔴 P0 | **난이도**: M
- **설명**: Tab으로 Chat ↔ Status 패널 간 포커스 전환. 포커스에 따라 키보드 동작 변경.
- **구현**:
  1. `src/tui/state/focus.ts` — 포커스 상태 (`chat | status`)
  2. Tab 키: 포커스 전환
  3. Chat 포커스: 텍스트 입력, `/` 슬래시, ↑↓ 채팅 스크롤
  4. Status 포커스: ↑↓ 프로젝트 선택, Enter 디버깅 모드 진입
  5. 아무 문자 입력 시 → Chat 포커스로 자동 복귀
  6. 포커스 시각적 표시: 활성 패널 borderActive, 비활성 borderDim
- **의존성**: T-ARCH-01

### T-ARCH-04: 컨텍스트 상태바

- **우선순위**: 🔴 P0 | **난이도**: M
- **설명**: 하단 1줄 상태바. 모드에 따라 내용이 동적으로 변경.
- **구현**:
  1. `StatusBar.tsx` 리팩토링 — 모드 signal 구독
  2. 모니터링: `4 projects │ CPU 12% MEM 4.2G │ Tab:패널 ?:도움말`
  3. 배포: `BUILD frontend 67% │ CPU 89% MEM 8.1G │ Ctrl+C:취소`
  4. 디버깅: `frontend ● :3000 │ CPU 2% MEM 128M │ Esc:돌아가기 r:재배포 s:중지`
- **의존성**: T-ARCH-01

### T-ARCH-05: 반응형 레이아웃

- **우선순위**: 🟡 P1 | **난이도**: M
- **설명**: 터미널 너비에 따라 패널 배치 변경.
- **구현**:
  1. ≥120 컬럼: 60:40 분할
  2. 80~119: 65:35, Status 라벨 축약 (`Memory` → `MEM`)
  3. <80: Status 숨김, 상태바에 핵심 수치만. Tab으로 Status 전체화면 토글.
  4. 도메인 URL 말줄임표 처리
- **의존성**: T-ARCH-02

---

## Phase 2: 모니터링 모드 (기본 뷰)

> 유저가 대부분의 시간을 보내는 화면. Status 패널의 4개 섹션.
> 참고: `ui-ux-layout.md` §모드 1: 모니터링

### T-MON-01: System 섹션

- **우선순위**: 🔴 P0 | **난이도**: M
- **설명**: CPU, MEM, DSK 사용률 + 프로그레스 바
- **구현**:
  1. `<SystemSection>` 컴포넌트
  2. CPU: 사용률 + 바 차트 (`ProgressBar.tsx` 재활용)
  3. MEM: used/total (GB) + 바 차트
  4. DSK: 퍼센트 + 바 차트 (Docker 이미지로 디스크 금방 차므로 필수)
  5. 80% 초과 시 error 색상
  6. IPC `getSystemStats()` 폴링 (5초)
- **의존성**: T-ARCH-02

### T-MON-02: Projects 섹션

- **우선순위**: 🔴 P0 | **난이도**: M
- **설명**: 프로젝트 목록. 상태 아이콘, 포트, 메모리, URL.
- **구현**:
  1. `<ProjectsSection>` 컴포넌트
  2. 상태 아이콘: `●` running (green), `◐` building (yellow), `○` stopped (gray), `✖` error (red)
  3. 각 행: 아이콘 + 이름(최대 12자) + 포트 + 메모리
  4. 도메인 URL은 프로젝트명 아래에 표시
  5. 빌드 중: 프로그레스 바 인라인 표시
  6. Status 포커스 시 ↑↓로 선택, Enter로 디버깅 모드 진입
  7. IPC `listProjects()` 폴링 (3초)
- **의존성**: T-ARCH-02, T-ARCH-03

### T-MON-03: Activity 섹션

- **우선순위**: 🟡 P1 | **난이도**: M
- **설명**: 최근 배포/변경 이력 실시간 표시
- **구현**:
  1. `<ActivitySection>` 컴포넌트
  2. 최대 5건 표시 (최신순)
  3. 형식: `14:32 dongbin ✅ frontend`
  4. 상태별 색상 (success=green, building=yellow, error=red)
  5. IPC `/api/activity?follow=true` NDJSON 스트리밍 또는 `eventBus` 구독
- **의존성**: T-ARCH-02

### T-MON-04: Alerts 섹션

- **우선순위**: 🟡 P1 | **난이도**: L
- **설명**: 능동적 문제 감지 + 해결 제안. 이슈 없으면 섹션 자체 숨김.
- **감지 항목**:
  | Alert | 조건 | 제안 |
  |-------|------|------|
  | 디스크 부족 | DSK > 80% | `/cleanup` 실행 권장 |
  | 미사용 프로젝트 | 2주 이상 요청 없음 | 중지 시 확보 가능 메모리 표시 |
  | 컨테이너 재시작 반복 | 24시간 내 3회 이상 | `/logs <project>` 확인 권장 |
  | 빌드 이미지 누적 | dangling 이미지 3개+ | 정리 시 확보 가능 용량 표시 |
- **구현**:
  1. `<AlertsSection>` 컴포넌트 — 조건부 렌더링 (이슈 있을 때만)
  2. 최대 3건, 심각도 순 정렬. 초과 시 `+N more — /alerts`
  3. 데몬 측 주기적 체크 (30초 폴링)
  4. `/alerts` 명령어 추가 (전체 목록)
  5. `/cleanup` 명령어 추가 (docker image prune 제안)
  6. dismiss 기능 (동일 Alert 반복 방지)
- **의존성**: T-ARCH-02, 데몬 측 Alert 감지 로직 필요

---

## Phase 3: 배포 모드

> 빌드 시작 시 자동 전환. 파이프라인 시각화 + 빌드 로그.
> 참고: `ui-ux-layout.md` §모드 2: 배포, `ui-ux-build-compose.md` §Part 1

### T-DEPLOY-01: `/deploy` 커맨드

- **우선순위**: 🔴 P0 | **난이도**: M
- **설명**: `/deploy <repo-url> [--name <name>] [--env KEY=VALUE]`
- **구현**:
  1. `registry.ts`에 `deploy` 추가 → `{ action: 'deploy', repoUrl, name, env }`
  2. `--name`, `--env` 플래그 파싱 (복수 env 지원)
  3. 실행 시 IPC `deploy(repoUrl, options)` 호출
  4. `/repo`에서 선택 → deploy와 동일 흐름으로 통합
- **의존성**: 없음
- **테스트**: 커맨드 파싱 단위테스트 (URL, --name, --env 조합)

### T-DEPLOY-02: Build 패널

- **우선순위**: 🔴 P0 | **난이도**: L
- **설명**: 배포 시작 시 Status 패널 하단에 자동 등장. 파이프라인 + 빌드 로그.
- **구현**:
  1. `<BuildPanel>` 컴포넌트
  2. 파이프라인 1줄 시각화: `Clone ✅ → Build ◐ → Run ○ → Expose ○`
  3. 단계별 상태: ✅ 완료, ◐ 진행 중, ○ 대기, ❌ 실패
  4. 하단: 빌드 로그 실시간 스트리밍 (IPC `streamBuildProgress()`)
  5. 빌드 완료 시: 전체 소요시간 표시
  6. 빌드 실패 시: 에러 메시지 + Tier 분류 (T-DEPLOY-04 연동)
  7. 배포 모드 진입 시 `[📋 Build panel opened]` 시스템 메시지
  8. 완료 3초 후 자동 모니터링 복귀 (또는 Enter 즉시 닫기)
- **의존성**: T-ARCH-01, T-ARCH-02

### T-DEPLOY-03: 스마트 자동 스크롤

- **우선순위**: 🔴 P0 | **난이도**: M
- **설명**: 빌드 로그 및 런타임 로그에서 자동 스크롤. 수동 스크롤 시 일시 정지.
- **구현**:
  1. 공통 `<ScrollableLog>` 컴포넌트 (Build 패널, 디버깅 모드 공용)
  2. 기본: 자동 스크롤 (최신 로그 따라감)
  3. ↑↓ 입력 시: 자동 스크롤 일시 중지 (수동 모드)
  4. `End` 또는 `f` 키: 자동 스크롤 재개
  5. 상태 표시: `[AUTO-SCROLL]` 또는 `[PAUSED — press f to follow]`
- **의존성**: 없음 (공용 컴포넌트)

### T-DEPLOY-04: Build Failure 3-Tier 처리

- **우선순위**: 🟡 P1 | **난이도**: XL
- **설명**: 빌드 실패 시 원인 분류 → Tier별 대응.
- **Tier 정의**:
  | Tier | 범위 | 대응 | 예시 |
  |------|------|------|------|
  | **1: 자동 수정** | 인프라 | 유저에게 안 물어봄 | 포트 충돌 → 빈 포트 할당, 캐시 깨짐 → `--no-cache`, 디스크 부족 → prune, 네트워크 실패 → 2회 재시도 |
  | **2: 제안 후 수정** | 빌드 설정 | diff 표시 → y/n 승인 | 베이스 이미지 교체, .dockerignore 추가, 환경변수 누락 |
  | **3: 알려만 줌** | 유저 소스코드 | 에러 로그만 표시 | TS 컴파일 에러, 테스트 실패, import 오류 |
- **구현**:
  1. 빌드 로그 실패 시점(Docker step)으로 Tier 자동 분류
  2. Tier 1: 데몬 내 하드코딩 (LLM 불필요), 자동 재시도 최대 2회, 채팅에 1줄 알림
  3. Tier 2: LLM에 빌드 에러 + Dockerfile 전달 → diff 생성 → 채팅에 diff 표시 → y/n 인라인 프롬프트
  4. Tier 3: 핵심 에러 추출 표시 + "소스 코드 수정이 필요합니다. 수정 후 `/deploy`로 다시 시도해주세요."
  5. 전체 로그는 디버깅 모드에서 확인 가능하도록 안내
- **핵심 원칙**: "누가 만든 파일이냐"로 범위 결정. 유저 코드는 절대 수정 안 함.
- **의존성**: T-DEPLOY-02, 데몬 측 Tier 분류 로직

### T-DEPLOY-05: 복수 빌드 전환

- **우선순위**: 🟢 P2 | **난이도**: M
- **설명**: 동시 빌드 진행 시 ←→로 빌드 간 전환
- **구현**:
  1. 빌드 세션 목록 관리
  2. Build 패널 상단에 활성 빌드 표시 (1/3)
  3. ←→ 키로 빌드 전환
- **의존성**: T-DEPLOY-02

---

## Phase 4: 디버깅 모드

> 특정 프로젝트 상세 + 실시간 로그.
> 참고: `ui-ux-layout.md` §모드 3: 디버깅

### T-DEBUG-01: 디버깅 모드 진입

- **우선순위**: 🔴 P0 | **난이도**: M
- **설명**: Status 패널에서 프로젝트 Enter → 디버깅 모드 진입. 채팅에서 "로그 보여줘" → LLM이 디버깅 모드 진입 트리거.
- **구현**:
  1. Status 패널 프로젝트 목록에서 Enter → `enterDebugMode(projectId)` 호출
  2. 채팅 자연어 "로그 보여줘", "frontend 로그 보여줘" → LLM이 디버깅 모드 진입 트리거
  3. Compose 프로젝트: 서비스 목록 표시 → 선택 → 해당 서비스 디버깅
  4. 초기 표시 줄 수: 기본 50줄
- **의존성**: T-ARCH-01, T-ARCH-03
- **테스트**: 프로젝트 Enter → 디버깅 모드 진입 확인

### T-DEBUG-02: 프로젝트 Info + 실시간 로그 뷰

- **우선순위**: 🔴 P0 | **난이도**: L
- **설명**: 디버깅 모드의 우측 패널. 상단 Info, 하단 Live Logs.
- **구현**:
  1. `<ProjectInfo>` — Status, Port, Domain, Image, Uptime, CPU, MEM, Last deploy
  2. `<LogViewer>` — `<ScrollableLog>` 재활용, IPC `docker logs -f` 스트리밍
  3. Status 패널에서 프로젝트 Enter → 동일 뷰 진입
  4. Chat에서 `/logs` → 동일 뷰 진입 (Chat 포커스 유지)
- **의존성**: T-ARCH-02, T-DEPLOY-03 (ScrollableLog)

### T-DEBUG-03: 디버깅 단축키

- **우선순위**: 🟡 P1 | **난이도**: S
- **설명**: 디버깅 모드 전용 단축키
- **구현**:
  1. `Esc`: 모니터링 복귀
  2. `r`: 해당 프로젝트 재배포 (IPC `redeploy()`)
  3. `s`: 중지 (IPC `stopProject()`)
  4. `d`: 도메인 설정 프롬프트
- **의존성**: T-DEBUG-02

---

## Phase 5: 컨테이너 제어 (자연어 채팅)

> 기본 운영 명령어. **모두 채팅 자연어로 실행** (슬래시 명령 아님).
> LLM이 의도를 파악하여 IPC 함수 호출. 결과는 채팅에 시스템 메시지로 표시.

### T-CMD-01: 자연어 컨테이너 제어 (stop, start, restart)

- **우선순위**: 🔴 P0 | **난이도**: M
- **설명**: "frontend 중지해줘", "backend 재시작해줘" 등 자연어로 컨테이너 제어.
- **구현**:
  1. LLM 에이전트가 의도 파악 → IPC `stopProject()`, `startProject()`, `restartProject()` 호출
  2. 프로젝트명 모호하면 LLM이 확인 질문
  3. 결과 채팅 피드백: `✅ frontend stopped` / `❌ frontend not found`
  4. Compose 프로젝트: "litellm 중지해줘" → `docker compose down`, "litellm의 db만 재시작" → 서비스 단위
- **테스트**: LLM 에이전트 tool call 검증

### T-CMD-02: 자연어 상태 확인

- **우선순위**: 🟡 P1 | **난이도**: S
- **설명**: "프로젝트 상태 보여줘", "frontend 상세 보여줘" 등 자연어.
- **구현**:
  1. 전체: 프로젝트 목록 테이블 (이름, 상태, 포트, URL) 채팅에 출력
  2. 상세: 프로젝트 Info (디버깅 모드와 동일 데이터, 채팅에 텍스트로)
- **의존성**: IPC `listProjects()` / `getProjectStats()`

### T-CMD-03: `/env` 오버레이 구현

- **우선순위**: 🟡 P1 | **난이도**: M
- **설명**: `/env` 슬래시 명령 → 환경변수 관리 오버레이. env-spec.md 참조.
- **구현**:
  1. 오버레이에서 현재 프로젝트 환경변수 목록 표시
  2. 마스킹 표시 (KEY, SECRET, TOKEN, PASSWORD 포함 시 `sk-...****`)
  3. 추가/수정/삭제 인라인 UI
  4. 변경 후 재배포 제안
- **의존성**: env-spec.md Part 2

### T-CMD-04: 자연어 프로젝트 삭제

- **우선순위**: 🟡 P1 | **난이도**: M
- **설명**: "frontend 삭제해줘" → LLM이 확인 후 삭제.
- **구현**:
  1. LLM이 확인 질문: "정말 삭제하시겠습니까?"
  2. 확인 시 IPC `removeProject()` → 컨테이너 + 이미지 삭제
  3. 결과 피드백

### T-CMD-05: 자연어 재배포

- **우선순위**: 🟡 P1 | **난이도**: M
- **설명**: "frontend 재배포해줘" → git pull → 재빌드 → 재배포.
- **구현**:
  1. LLM이 IPC `redeploy(project)` 호출
  2. 배포 모드 자동 진입 (T-ARCH-01)
  3. 빌드 파이프라인 + 로그 표시 (T-DEPLOY-02 재활용)
- **의존성**: T-DEPLOY-02

---

## Phase 6: Compose 모드

> docker-compose.yml 감지 시 멀티 서비스 처리.
> 참고: `ui-ux-build-compose.md` §Part 2

### T-COMPOSE-01: Compose 파일 감지 + 실행

- **우선순위**: 🟡 P1 | **난이도**: L
- **설명**: 레포에 docker-compose.yml 있으면 자동으로 Compose 모드.
- **구현**:
  1. 클론 후 감지: `docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, `compose.yaml`
  2. 감지 시 `docker compose up -d --build` 실행
  3. 감지 분기: compose 있음 → Compose 모드 / Dockerfile만 → Single 모드 / 둘 다 없음 → Auto-Detect (T-COMPOSE-05)
- **의존성**: T-DEPLOY-01

### T-COMPOSE-02: 포트 충돌 → override 자동 생성

- **우선순위**: 🟡 P1 | **난이도**: M
- **설명**: 원본 compose 파일은 절대 수정 안 함. override로 호스트 포트만 리맵.
- **구현**:
  1. 포트 충돌 감지
  2. `docker-compose.override.yml` 자동 생성 (호스트 포트만 변경)
  3. `.gitignore`에 `docker-compose.override.yml` 자동 추가
  4. 채팅 알림: `⚠ Port 4000 in use → remapped to 4001 (override)`
- **원칙**: Tier 1 자동 수정. 내부 포트(컨테이너 간)는 건드리지 않음.
- **의존성**: T-COMPOSE-01

### T-COMPOSE-03: 환경변수 주입 (.env.example 파싱)

- **우선순위**: 🟡 P1 | **난이도**: M
- **설명**: `.env.example` 파싱 → 기본값 있는 건 자동, 없는 건 유저에게 입력 요청
- **구현**:
  1. `.env.example` 또는 `.env.sample` 감지 + 파싱
  2. 기본값 있는 변수: 자동 설정
  3. 기본값 없는 변수 (API 키 등): 채팅에서 입력 요청
  4. 내부 서비스 URL (DB, Redis): compose 네트워크 기반 자동 추론
  5. 생성된 `.env`는 프로젝트 디렉토리에 저장, `.gitignore`에 추가
- **의존성**: T-COMPOSE-01

### T-COMPOSE-04: 대시보드 서비스 그룹 표시

- **우선순위**: 🟡 P1 | **난이도**: M
- **설명**: Compose 프로젝트는 접이식 그룹으로 표시
- **구현**:
  1. `▼ litellm (compose, 3 services)` — 펼친 상태: 개별 서비스
  2. `▶ opik (compose, 5 services)` — 접힌 상태: 한 줄
  3. Enter로 펼침/접음 토글
  4. 외부 도메인 있는 서비스만 URL 표시
  5. 내부 전용 서비스(db, redis): 포트 대신 `—`
- **의존성**: T-MON-02

### T-COMPOSE-05: Auto-Detect (Dockerfile/Compose 없는 레포)

- **우선순위**: 🟢 P2 | **난이도**: XL
- **설명**: 프로젝트 구조를 LLM이 분석하여 Dockerfile 또는 compose 파일 생성
- **구현**:
  1. 데몬이 컨텍스트 수집: 디렉토리 트리, package.json/requirements.txt, 설정 파일
  2. LLM에 전달 → 단일/멀티 서비스 판단
  3. 판단 불가 시 채팅으로 유저에게 질문
  4. 생성된 파일은 Tier 2 범위 (빌드 실패 시 LLM이 수정안 제시)
- **의존성**: T-COMPOSE-01, T-DEPLOY-04

---

## Phase 7: 채팅 & 키보드 & 폴리시

> 핵심 기능 완료 후 UX 품질 향상.

### T-KEY-01: Ctrl+C 실행 취소 / 더블 탭 종료

- **우선순위**: 🔴 P0 | **난이도**: M
- **구현**:
  1. Ctrl+C → 활성 작업(배포, 스트리밍) 취소 IPC 호출
  2. 활성 작업 없으면 → "Ctrl+C를 한번 더 누르면 종료" 상태바 표시
  3. 2초 내 재입력 → process.exit()

### T-KEY-02: Ctrl+L 화면 클리어

- **우선순위**: 🟡 P1 | **난이도**: S
- **구현**: 채팅 표시 상태만 초기화 (히스토리는 보존)

### T-KEY-03: Vim-style 네비게이션 (j/k)

- **우선순위**: 🟢 P2 | **난이도**: S
- **구현**: textarea 아닌 곳에서 j=down, k=up

### T-CHAT-01: 마크다운 렌더링

- **우선순위**: 🟡 P1 | **난이도**: L
- **구현**:
  1. TUI 호환 마크다운 파서 조사 (marked-terminal 등)
  2. 헤더, 볼드, 코드블록, 리스트 렌더링
  3. 인라인 코드: accent 색상
  4. 코드블록: backgroundElement 배경
- **리스크**: @opentui/solid 렌더링 제약 확인 필요

### T-CHAT-02: 코드블록 신택스 하이라이팅

- **우선순위**: 🟢 P2 | **난이도**: L
- **의존성**: T-CHAT-01

### T-CHAT-03: 멀티라인 입력

- **우선순위**: 🟢 P2 | **난이도**: M
- **구현**: Shift+Enter 줄바꿈, textarea 높이 자동 조절 (최대 5줄)

### T-COMPACT-01: `/compact` 실제 구현

- **우선순위**: 🟡 P1 | **난이도**: L
- **구현**:
  1. 요약 프롬프트 설계 — "배포 에이전트 관점에서 요약" (일반 대화 요약 아님)
  2. 보존: 활성 프로젝트 상태, 사용자 선호, 미해결 에러
  3. 제거: 완료된 배포 로그 상세, 반복 질문
  4. IPC 요약 API → 결과 시스템 메시지 + 새 세션 시작
  5. 이전 히스토리 SQLite 보관

### T-STYLE-01: 보더/구분선 통일

- **우선순위**: 🟢 P2 | **난이도**: S
- **구현**: theme.border / theme.borderActive 일관 적용

### T-AGENT-01: 명확화 질문 선택지 UI

- **우선순위**: 🟢 P2 | **난이도**: M
- **구현**: 에이전트 선택지 감지 → 번호 키(1/2/3) 또는 ↑↓+Enter

---

## Phase 8: 인프라 & 장기

### T-INFRA-01: i18n 기반 구축

- **우선순위**: 🟡 P1 | **난이도**: L
- **구현**:
  1. i18n 라이브러리 선택 (i18next 또는 경량 대안)
  2. `en.json`, `ko.json` 번역 파일
  3. 모든 하드코딩 문자열 → `t('key')` 교체
  4. 시스템 로케일 감지 또는 config 설정
- **참고**: 모든 컴포넌트 터치 필요. 다른 Phase와 충돌 최소화를 위해 Phase 1~6 이후 권장.

### T-INFRA-02: 다중 Git 프로바이더

- **우선순위**: 🟡 P1 | **난이도**: L
- **구현**:
  1. Git 프로바이더 인터페이스 (`src/git/provider.ts`)
  2. GitHub 구현 (현재 코드 리팩토링)
  3. GitLab 구현
  4. `/connect` 오버레이에서 프로바이더 선택 UI

### T-INFRA-03: Vercel AI SDK 마이그레이션 조사

- **우선순위**: 🟢 P2 | **난이도**: L (조사만)
- **구현**: 현재 에이전트 코드 분석 → Vercel AI SDK 매핑 → 마이그레이션 계획 문서

---

## 실행 순서 (권장)

### Phase 1 → 2: 기반 + 모니터링 (데모 최소 조건)

```
T-ARCH-01  3-모드 상태 머신
T-ARCH-02  적응형 우측 패널
T-ARCH-03  포커스 관리
T-ARCH-04  컨텍스트 상태바
T-MON-01   System 섹션
T-MON-02   Projects 섹션
```

### Phase 3: 배포 (핵심 가치)

```
T-DEPLOY-01  /deploy 커맨드
T-DEPLOY-02  Build 패널 + 파이프라인
T-DEPLOY-03  스마트 자동 스크롤
T-KEY-01     Ctrl+C 취소
```

### Phase 4 + 5: 디버깅 + 컨테이너 제어 (자연어)

```
T-DEBUG-01   디버깅 모드 진입 (Status 패널 Enter + 자연어)
T-DEBUG-02   Info + 로그 뷰
T-CMD-01     자연어 컨테이너 제어 (stop, start, restart)
T-CMD-05     자연어 재배포
```

### Phase 6: Compose

```
T-COMPOSE-01  감지 + 실행
T-COMPOSE-02  포트 충돌 override
T-COMPOSE-03  환경변수 주입
T-COMPOSE-04  서비스 그룹 표시
```

### Phase 7 + 8: 품질 + 장기

```
T-MON-03     Activity 섹션
T-MON-04     Alerts 섹션
T-DEPLOY-04  Build Failure 3-Tier
T-CHAT-01    마크다운 렌더링
T-COMPACT-01 /compact 실제 구현
T-INFRA-01   i18n
T-INFRA-02   다중 Git 프로바이더
... (나머지 P2 항목)
```

---

## 참고사항

- **슬래시 명령 원칙**: LLM을 거치지 않고 직접 실행. 9개 유지 (help, model, git, repo, tunnel, env, compact, clear, exit). 컨테이너 제어(/stop, /restart)와 디버깅(/logs)은 채팅 자연어로 대체.
- **빌드 실패 원칙**: "누가 만든 파일이냐"로 대응 범위 결정. 유저 코드는 절대 수정 안 함.
- **Compose 원칙**: 원본 docker-compose.yml 절대 수정 안 함. override 파일만 사용.
- **테마**: OpenCode 다크 테마 유지. 추후 브랜딩 커스터마이징 예정.
- **키보드**: 모든 핸들러는 `KeyEvent.name` 사용 (OpenTUI 표준).
- **테스트**: 각 커맨드/오버레이 추가 시 단위 테스트 필수.
- **기존 IPC 함수**: `deploy()`, `streamBuildProgress()`, `listProjects()`, `eventBus` 등 — 구현 전 실제 API 시그니처 확인 필요.

---

## 총 Task 수

| Phase                     | Task 수 | P0     | P1     | P2    |
| ------------------------- | ------- | ------ | ------ | ----- |
| 1. 레이아웃 아키텍처      | 5       | 4      | 1      | 0     |
| 2. 모니터링 모드          | 4       | 2      | 2      | 0     |
| 3. 배포 모드              | 5       | 3      | 1      | 1     |
| 4. 디버깅 모드            | 3       | 2      | 1      | 0     |
| 5. 컨테이너 제어 (자연어) | 5       | 1      | 4      | 0     |
| 6. Compose 모드           | 5       | 0      | 4      | 1     |
| 7. 채팅 & 폴리시          | 9       | 1      | 3      | 5     |
| 8. 인프라 & 장기          | 3       | 0      | 2      | 1     |
| **합계**                  | **39**  | **13** | **18** | **8** |
