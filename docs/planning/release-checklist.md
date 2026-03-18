# OpenLander — 정식 릴리즈 전 수동 도그푸딩 체크리스트

> **용도**: v1.0.0 릴리즈 직전 1회 수동 검증 (UI/API/MCP 실제 구현 기준)
> **작성일**: 2026-03-08
> **기준 소스**: `web/src/*`, `src/web/api/routes.ts`, `src/tools/defs/`, `src/cli/index.ts`

---

## 환경 준비

- [ ] `npm run build` 성공 확인
- [ ] `npm test` 전체 통과 확인
- [ ] Docker 데몬 실행 확인 (`docker ps` 응답)
- [ ] Traefik 실행 확인 (`docker ps`에서 Traefik 컨테이너 확인)
- [ ] OpenLander 실행 (`npm start`)
- [ ] 웹 UI 접근 확인 (`http://localhost:10114`)
- [ ] 첫 실행 시 `/projects` 진입 전에 `/setup`으로 리다이렉트되는지 확인 (SetupGuard)

---

## 시나리오 1: 셋업/온보딩 (`/setup`)

**사전조건**: 초기 설정 미완료 상태 (`/api/setup/status`에서 `ready: false`)

- [ ] 1단계 Language: `English` / `한국어` 선택 후 Continue
- [ ] 2단계 Welcome: Docker 상태 표시 확인, Traefik 미실행 시 `Traefik Proxy` 버튼으로 시작 가능
- [ ] 3단계 LLM: Provider 선택 후 저장 (`Google Gemini`, `OpenRouter`, `Anthropic`, `OpenAI`, `Ollama`)
- [ ] 4단계 GitHub(옵션): `Connect with GitHub`(Device Flow) 또는 PAT 입력 연결
- [ ] `Start Deploying` 클릭 시 셋업 완료 후 `/projects` 이동

**확인방법**: 새로고침 후 `/setup` 재진입 없이 `/projects` 접근 가능

---

## 시나리오 2: GitHub 연결/해제 (`/settings`)

**사전조건**: Settings 접근 가능

- [ ] `Settings > GitHub` 섹션에서 `Connect with GitHub` 클릭
- [ ] Device Flow 코드(`user code`) 표시, `Open GitHub`, `Copy Code`, `Cancel` 동작 확인
- [ ] PAT 폴백 입력(`ghp_...`)으로 `Connect` 동작 확인
- [ ] 연결 후 `Connected as <username>` 표시 확인
- [ ] `Disconnect` 클릭 시 연결 해제 확인

**확인방법**: `/api/setup/status`의 `github.ok` 값이 연결/해제에 따라 변경

---

## 시나리오 3: GitHub 연동 배포 (PRIMARY, `/projects/new`)

**사전조건**: GitHub 연결 완료

- [ ] `Projects`에서 `New Project` 클릭 후 `/projects/new` 진입
- [ ] `My Repos` 탭에서 레포 목록 확인 (`/api/repos`)
- [ ] `Search` 탭에서 레포 검색 동작 확인 (`/api/repos/search`)
- [ ] 레포 행의 `Deploy` 클릭
- [ ] 성공 시 해당 프로젝트 상세(`/projects/:id`)로 이동

**확인방법**: 프로젝트 상태가 `building -> running`으로 전환되고 URL 생성

---

## 시나리오 4: URL 직접 입력 배포 (SECONDARY, DeployDialog)

**사전조건**: 없음

- [ ] `DeployDialog` 컴포넌트가 `repo-url`, `branch`, `projectName` 입력 폼을 제공하는지 확인
- [ ] 현재 메인 레이아웃(`AppLayout + Sidebar`)에서 이 다이얼로그 진입 버튼이 노출되지 않음을 확인
- [ ] 레거시 `ProjectSidebar` 경로에서만 `DeployDialog`가 연결되어 있음을 확인

**확인방법**: 현행 UI 기준 사용자 여정에서는 비노출(보조/레거시 경로)임을 문서화

---

## 시나리오 5: Private Repo 배포 (SSH)

**사전조건**: 서버에 SSH 키 존재 (`sshKeyPath` 유효)

- [ ] `repo_url`을 SSH 형식(`git@github.com:org/repo.git`)으로 배포 요청
- [ ] clone 단계에서 `GIT_SSH_COMMAND` 경로가 적용되어 인증 통과 확인
- [ ] HTTPS 인증 실패 시 SSH 재시도 로직 동작 확인

**확인방법**: 배포 성공 또는 인증 실패 시 SSH 관련 오류로 명확히 노출

---

## 시나리오 6: Private Repo 배포 (Token)

**사전조건**: GitHub 토큰 저장 완료 (`/setup` 또는 `/settings`)

- [ ] HTTPS GitHub URL로 배포 시 토큰 주입(`x-access-token`) clone 경로 동작 확인
- [ ] `/projects/new`에서 private repo 배포가 정상 완료되는지 확인

**확인방법**: private repo가 인증 오류 없이 `building -> running` 전환

---

## 시나리오 7: Docker Compose 배포

**사전조건**: compose 프로젝트 레포 준비

- [ ] 배포 타임라인에서 compose 이벤트(`compose:start`, `compose:up`)가 사람이 읽을 수 있는 문구로 표시되는지 확인
- [ ] 부모/자식 프로젝트 구조가 생성되고 서비스 수가 반영되는지 확인

**확인방법**: `Projects` 목록과 `docker ps`에서 compose 서비스 컨테이너 확인

---

## 시나리오 8: 빌드 실패 -> AI 자동 복구

**사전조건**: 실패를 재현 가능한 레포

- [ ] 실패 시 Timeline에 오류 항목과 상세 로그가 표시되는지 확인
- [ ] `Fix with AI`(또는 자동 분석) 경로에서 `debug-build` 호출 결과가 인사이트로 표시되는지 확인
- [ ] Dockerfile 수정/재시도 관련 상태 메시지가 순차적으로 표시되는지 확인

**확인방법**: 성공 시 최종 `running`, 실패 시 원인 메시지와 함께 `error`

---

## 시나리오 9: Redeploy

**사전조건**: 기존 배포 성공 프로젝트

- [ ] 프로젝트 헤더 `Redeploy` 버튼 클릭
- [ ] 즉시 상태가 `building`으로 바뀌고 타임라인 스트림 재연결되는지 확인

**확인방법**: `Deployments` 탭에 신규 배포 기록 추가

---

## 시나리오 10: Blue-Green

**사전조건**: `running` 프로젝트 (버튼은 running에서만 활성)

- [ ] `Blue-Green` 버튼 클릭
- [ ] 새 버전 배포/헬스체크 후 트래픽 전환까지 완료되는지 확인

**확인방법**: 서비스 중단 없이 URL 응답 유지 + 결과 상태 성공

---

## 시나리오 11: 롤백

**사전조건**: `previousImageTag`가 존재하는 프로젝트

- [ ] `Rollback` 버튼 클릭
- [ ] 상태가 `building`으로 전환 후 이전 이미지로 복귀되는지 확인

**확인방법**: 롤백 후 서비스 정상 응답 + 최신 배포 기록 생성

---

## 시나리오 12: Start/Stop

**사전조건**: 실행 중 프로젝트

- [ ] `Stop` 클릭 -> `stopped` 전환 확인
- [ ] `Start` 클릭 -> `running` 복귀 확인

**확인방법**: 상태 뱃지와 URL 접근 가능 여부로 검증

---

## 시나리오 13: 환경변수 관리 (Config > Env Vars)

**사전조건**: 프로젝트 상세 페이지 접근

- [ ] 상단 탭 구조가 `Timeline / Deployments / Logs / Config`인지 확인
- [ ] `Config` 하위 탭이 `Env Vars / Domains / Webhooks`인지 확인
- [ ] `Env Vars`에서 키/값 추가, 수정, 삭제 가능 확인
- [ ] `Paste .env`로 다중 파싱/병합 import 확인
- [ ] `Save` 시 `/api/projects/:id/env` 반영 확인

**확인방법**: 저장 후 재진입 시 값 유지, 필요 시 재배포 필요 플래그 확인

---

## 시나리오 14: 도메인 & 공개 (Config > Domains)

**사전조건**: 프로젝트 실행 중(내부 URL/포트 존재)

- [ ] Internal URL 섹션 표시 확인
- [ ] LAN/직접접속 URL(`http://<ip>:<port>`) 목록 표시 확인
- [ ] `Expose to Internet` 클릭 시 TryCloudflare public URL 발급 확인
- [ ] `Remove` 클릭 시 public URL 해제 확인
- [ ] Custom Domains에서 도메인 추가/삭제 동작 확인

**확인방법**: `/api/projects/:id/expose`, `/api/projects/:id/unexpose`, `/api/projects/:id/domains*` 동작 확인

---

## 시나리오 15: Webhook 자동 재배포 (Config > Webhooks)

**사전조건**: 배포 가능한 프로젝트 + Git provider 설정

- [ ] `Webhooks` 탭에서 source(`github/gitlab/bitbucket`) + branch filter로 추가
- [ ] 생성된 `webhookUrl`/`secret` 복사 기능 확인
- [ ] 외부 SCM에서 push 이벤트 전송 시 재배포가 시작되는지 확인

**확인방법**: `/api/webhooks/:projectId/:source` 호출 후 프로젝트 상태/배포 이력 변화 확인

---

## 시나리오 16: 공유 서비스 (`/services`)

**사전조건**: 없음

- [ ] 템플릿 기반 생성(Postgres 등) 동작 확인
- [ ] 커스텀 이미지 생성 시 `name + image + port`가 필수인지 확인
- [ ] 서비스 `Start / Stop / Remove` 동작 확인
- [ ] 연결정보(credential/env) 펼침/복사 UI 동작 확인

**확인방법**: `/api/services*` 응답 + `docker ps` 상태 일치

---

## 시나리오 17: 로그 & 배포 히스토리

**사전조건**: 배포 이력이 있는 프로젝트

- [ ] `Deployments` 탭에서 배포 목록(트리거/커밋/시간/소요) 확인
- [ ] 항목 클릭 시 `/projects/:id/deployments/:deployId` 상세 페이지 진입
- [ ] `Logs` 탭에서 라이브 로그 스트림 표시 확인
- [ ] Timeline 메시지가 raw 이벤트명이 아닌 사람이 읽는 문구인지 확인

**확인방법**: 배포 상세 build log + 로그 스트림 갱신 확인

---

## 시나리오 18: 알림 (벨 아이콘)

**사전조건**: 알림 발생 상태(예: 리소스 경고/컨테이너 이벤트)

- [ ] 헤더 우측 `Bell` 아이콘에서 unread 배지 표시 확인
- [ ] 드롭다운 목록에서 알림 메시지/유형/시간 표시 확인
- [ ] 알림 `X` dismiss 클릭 시 목록에서 제거되는지 확인

**확인방법**: `/api/alerts`, `/api/alerts/:id/dismiss` 반영 확인

---

## 시나리오 19: 커맨드 팔레트 (Cmd/Ctrl + K)

**사전조건**: AppLayout 진입 상태

- [ ] `Cmd+K`(macOS) 또는 `Ctrl+K`(Linux/Windows)로 팔레트 열림 확인
- [ ] 검색/화살표 이동/Enter 실행 동작 확인
- [ ] Settings 이동 커맨드 동작 확인
- [ ] 프로젝트 이동/재배포/중지 커맨드 노출 확인

**확인방법**: 단축키와 선택 실행이 실제 라우팅/액션으로 반영

---

## 시나리오 20: MCP 서버 (`openlander mcp`)

**사전조건**: `openlander` 초기 설정 완료

- [ ] CLI에서 `openlander mcp` 실행 가능 확인
- [ ] MCP 클라이언트에서 서버 연결 후 핵심 도구 호출 확인
- [ ] 최소 검증 도구: `list_projects`, `deploy_project`, `get_deploy_status`, `get_logs`, `set_env_vars`, `get_system_stats`, `scan_ports`, `list_all_containers`
- [ ] GitHub 연동 도구(`list_github_repos`, `search_github_repos`) 호출 확인

**확인방법**: 각 도구가 스키마 오류 없이 정상 응답

---

## 시나리오 21: AI 인라인 분석 (빌드 실패 시)

**사전조건**: 빌드 실패를 재현 가능한 레포

- [ ] 빌드 실패 후 AI 분석이 같은 타임라인 흐름에서 이어지는지 확인 (별도 그룹 아님)
- [ ] "── 🤖 AI 분석 ──" 구분선으로 빌드 로그와 AI 분석 경계 표시 확인
- [ ] AI 분석이 실시간으로 스트리밍되는지 확인 (thinking → tool_call → message)
- [ ] 수동 트리거 없이 자동으로 시작되는지 확인

**확인방법**: 빌드 실패 → 같은 타임라인에서 AI 분석 인라인 표시

---

## 시나리오 22: 시크릿 스캔 (Secret Scan)

**사전조건**: 하드코딩된 API 키가 있는 프로젝트 레포

- [ ] clone 후 시크릿 패턴 감지 알림이 타임라인에 표시되는지 확인
- [ ] 감지 패턴: API 키 접두사(sk-, AKIA, ghp*, github_pat* 등), DB URL, 고엔트로피 문자열
- [ ] .env, node_modules, .git 디렉토리가 스캔에서 제외되는지 확인
- [ ] agent가 "환경변수로 이관하세요" 안내를 제공하는지 확인

**확인방법**: `secret:detected` 이벤트 발생 + 타임라인 표시

---

## 시나리오 23: 포스트모템 자동 생성 (Postmortem)

**사전조건**: AI 자동 복구가 완료된 프로젝트 (recovery:success 발생)

- [ ] 복구 완료 후 PostmortemCard가 Activity 타임라인 상단에 표시되는지 확인
- [ ] 카드 클릭 시 마크다운 포스트모템 펼침/접기 동작 확인
- [ ] 포스트모템 내용: 타임라인 → 근본 원인 → 수정 내용 → 예방 조치 구조 확인
- [ ] `/api/projects/:id/postmortem/latest` API 응답 확인

**확인방법**: recovery:success 발생 후 PostmortemCard 렌더링 + API 응답 정상

---

## 시나리오 24: 롤백 자동 제안 (Rollback Watcher)

**사전조건**: 배포 후 헬스체크가 실패하는 프로젝트

- [ ] 배포 성공 후 60초간 헬스 감시가 활성화되는지 확인
- [ ] 연속 3회 healthcheck 실패 시 `rollback:suggested` 이벤트 발생 확인
- [ ] 정상 배포 시 (헬스체크 통과) 아무 행동 없음 확인

**확인방법**: 로그에서 rollback:suggested 이벤트 확인 또는 타임라인에 롤백 제안 표시

---

## 시나리오 25: 환경변수 변경 감지 (Env Detection)

**사전조건**: .env.example에 새 키가 추가된 프로젝트 (리디플로이)

- [ ] 리디플로이 시 .env.example 스캔으로 새 키 감지 확인
- [ ] agent가 "새 환경변수 N개 발견" 알림 제공 확인
- [ ] 새 키가 없으면 아무 행동 없음 확인

**확인방법**: env:new-keys-detected 이벤트 발생 + agent 알림

---

## 정리

- [ ] 테스트용 프로젝트 전부 삭제
- [ ] 테스트용 공유 서비스 전부 삭제
- [ ] `docker ps` 확인: OpenLander 테스트 컨테이너가 남지 않았는지 확인
- [ ] `docker ps` 확인: **Traefik 컨테이너는 남아 있어야 함**
- [ ] 테스트 일자/결과/이슈 기록

**테스트 실행일**: YYYY-MM-DD
**테스트 결과**: PASS / FAIL
**테스터**: 이름
