# OpenLander 1.0.0 Web UI QA Plan

**작성일**: 2026-04-20
**대상 버전**: 1.0.0 (현재 1.0.0-rc.9, develop ↔ main 머지 완료)
**작성 방식**: 5개 에이전트 병렬 분석 결과 종합 (Web UI 인벤토리 / API·도메인 매핑 / 기존 E2E 커버리지 갭 / R1~R8 findings 종합 / 리스크 핫스팟)

---

## 0. Executive Summary

1.0.0 GA 직전 1주일 안에 **(a) ResourceLimits 신기능** + **(b) ProjectStateManager 신규 통합** + **(c) Docker abstraction 전면 리팩터** + **(d) Drizzle 마이그레이션 0003~0005** 가 동시에 들어갔다. 따라서 1.0 QA의 회귀 위험은 *신기능 단독*이 아니라 **신기능 × 기존 핵심 흐름의 교차점**(특히 recovery × state transition × 동시 deploy)에 집중되어 있다.

기존 자산:

- API E2E 27개 (passing) — 백엔드 시나리오 커버리지 양호
- UI E2E 11개 — ProjectDetail 탭/Agent 모드 일부만, **나머지 9개 페이지는 거의 미커버**
- 백엔드 단위 테스트 202개

**이 플랜의 산출 목표**: 웹 UI 클릭 동선 기반의 14개 차터를 우선순위로 실행해서 **(1) UI-only 회귀 ≥ 90% 검출**, **(2) R1~R8에서 발견된 미해결 9건의 UI 측면 검증**, **(3) 1.0 신기능 4종(ResourceLimits/PSM/Docker리팩/마이그레이션)의 사용자 가시 회귀 0건 확인**.

---

## 1. 목표 / 비목표

### 목표 (In Scope)

- 11개 React 페이지의 사용자 인터랙션 회귀 검출
- ProjectDetail 5탭 / ServiceDetail 5탭 / Settings 7탭의 폼·다이얼로그·실시간 스트림 동작
- 위험 액션 (Purge / Delete Service / Rollback / Blue-Green / Archive) UX·확인 게이트
- R1~R8에서 미해결로 분류된 9개 버그의 UI 재현 가능 여부
- 1.0 신기능 4종의 사용자 가시 측면 (limits 패널, recovery 표시, deploy 흐름, 마이그레이션 후 부팅)

### 비목표 (Out of Scope, 별도 트랙)

- API 단독 회귀 (이미 quality-gate suite가 커버) — 단, UI에서 API 응답을 잘못 표시하는 케이스는 포함
- 백엔드 단위 테스트 신규 작성
- 성능/부하 테스트 (별도 perf 트랙)
- MCP 클라이언트 동작 (사용자가 MCP는 OK라 명시함)
- 다국어 i18n 키 누락 자체 (해당 페이지에 키가 매핑되어 있는지만 sanity)

---

## 2. 산출물 / 디렉토리 구조

```
docs/launchpad/
  qa-webui-plan-2026-04-20.md           ← (이 문서)
  charters/
    01-newproject-flow.md                ← 차터 정의
    02-projectdetail-overview.md
    03-projectdetail-runtime-stream.md
    04-projectdetail-danger-actions.md
    05-projectdetail-rollback-bluegreen.md
    06-deployments-list-detail.md
    07-services-lifecycle.md
    08-opscenter-incidents.md
    09-settings-llm-system-mcp.md
    10-overview-dashboard.md
    11-projects-grid.md
    12-login-auth-redirect.md
    13-cross-cutting-integration.md
    14-regression-r1r8.md
  reports/
    {YYYY-MM-DD}/{charter-id}.md         ← QA 에이전트 산출물
    {YYYY-MM-DD}/_summary.md             ← 라운드 종합
```

QA 에이전트는 차터 1개를 입력으로 받아 `reports/{YYYY-MM-DD}/{NN}-{slug}.md`를 산출한다.

---

## 3. 차터 우선순위 매트릭스

리스크 가중치 = (사용자 영향) × (변경 빈도) × (과거 결함 밀도). 위에서부터 실행.

| #   | 차터                                                                   | 페이지                            | 사용 레포                                                                    | 회귀 위험 | 신기능 노출                        | 과거 결함                 | Prio   |
| --- | ---------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------- | --------- | ---------------------------------- | ------------------------- | ------ |
| 13  | Cross-cutting integration (deploy×die, recovery×lock, mass concurrent) | Multi                             | test-runtime-crash + test-single-dockerfile + test-build-fail                | **HIGH**  | PSM, deploy-lock                   | BUG-002, BUG-004          | **P0** |
| 14  | Regression R1~R8 (미해결 9건의 UI 재현)                                | Multi                             | test-\* 전체                                                                 | **HIGH**  | —                                  | 9건                       | **P0** |
| 5   | ProjectDetail Rollback / Blue-Green                                    | ProjectDetail                     | test-single-dockerfile                                                       | **HIGH**  | Docker리팩, ResourceLimits         | BUG-003, BUG-004, BUG-016 | **P0** |
| 4   | ProjectDetail Danger Actions (Purge / Delete / Stop / Archive)         | ProjectDetail, ServiceDetail      | test-single-dockerfile + test-monorepo                                       | HIGH      | PSM 전이 규칙                      | BUG-009                   | **P0** |
| 1   | NewProjectFlow (git/image/docker tabs, env scan, 배포까지)             | NewProjectFlow                    | test-single-dockerfile, test-no-dockerfile, test-compose-multi, nginx:alpine | HIGH      | smart-defaults, env-scan           | BUG-001 (한글 이름)       | **P1** |
| 8   | OpsCenter incidents/circuit breaker/approval flows                     | OpsCenterV2                       | test-runtime-crash                                                           | HIGH      | OpsAgent, ResourceLimits OOM alert | BUG-013, BUG-014          | **P1** |
| 3   | ProjectDetail Runtime / Console 실시간 로그 스트림                     | ProjectDetail                     | test-single-dockerfile                                                       | MED-HIGH  | Docker리팩 stream 경로             | —                         | **P1** |
| 7   | Services 생명주기 (DB 생성·유저·연결·삭제)                             | ServicesPage, ServiceDetail       | test-env-required + 신규 PostgreSQL service                                  | HIGH      | service-adapters 6종 healthcheck   | BUG-009 (서비스 삭제)     | **P1** |
| 9   | Settings (LLM 등록·System resource·MCP·GitHub)                         | SettingsPage                      | — (설정만)                                                                   | MED       | ResourceLimitsPanel                | —                         | **P2** |
| 2   | ProjectDetail Overview (KPI·timeline 진입 후)                          | ProjectDetail                     | test-single-dockerfile                                                       | MED       | recovery:\* 이벤트 표시            | —                         | **P2** |
| 6   | DeploymentsList / DeploymentDetail                                     | DeploymentsList, DeploymentDetail | test-single-dockerfile (3회 이상 deploy)                                     | MED       | —                                  | —                         | **P2** |
| 10  | Overview 대시보드 (글로벌 KPI·activity stream·needs-attention)         | Overview                          | 기존 데이터 활용                                                             | MED       | activity stream backfill           | —                         | **P3** |
| 11  | ProjectsGrid (필터·아카이브·뷰 토글)                                   | ProjectsGrid                      | 기존 데이터 활용                                                             | LOW       | —                                  | —                         | **P3** |
| 12  | Login / Auth redirect (로그아웃, 401 후 리다이렉트, 비번 변경)         | LoginPage, SettingsPage(security) | —                                                                            | LOW       | —                                  | —                         | **P3** |

---

## 4. 페이지 × 시나리오 × 레포 매트릭스

| 시나리오                                               | 진입 페이지                         | 사용 레포                          | 기대 결과 (UI 측)                                                                | 회귀 후크             |
| ------------------------------------------------------ | ----------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------- | --------------------- |
| **G1**: Git Dockerfile 정상 배포                       | NewProjectFlow → ProjectDetail      | test-single-dockerfile             | 5탭 진입, timeline NDJSON 실시간, status='running', URL 클릭 가능                | event sequence        |
| **G2**: Git auto-detect 배포                           | NewProjectFlow                      | test-no-dockerfile                 | smart-defaults가 build cmd/port 제안, env-scan 다이얼로그                        | smart-defaults        |
| **G3**: Compose 배포 + ResourceLimits                  | NewProjectFlow → ProjectDetail      | test-compose-multi                 | 다중 서비스 카드, **HostConfig.Memory=0인지 검증 (TODO 영향)**                   | 핫스팟 #5             |
| **G4**: Docker image 직접 배포                         | NewProjectFlow (docker tab)         | nginx:alpine                       | clone 단계 skip, build 단계 skip, run 직행                                       | timeline 단축 흐름    |
| **G5**: Monorepo subpath 배포                          | NewProjectFlow                      | test-monorepo                      | dockerfile path 입력 후 redeploy → BUG-005 회귀 검증                             | BUG-005               |
| **F1**: Build 실패 → 에러 토스트 + 타임라인 error 노드 | NewProjectFlow → ProjectDetail      | test-build-fail (npm install 실패) | error 단계 강조, 로그 expandable                                                 | UI-gap #5             |
| **F2**: Build 실패 (다른 메커니즘)                     | 동일                                | build-fail-test (RUN 쉘 실패)      | 동일                                                                             | 변종                  |
| **R1**: 런타임 크래시 → recovery 자동 트리거 → UI 표시 | ProjectDetail (Operations 탭)       | test-runtime-crash                 | activity feed에 container:die → recovery:started → recovery:success 순서         | 핫스팟 #1, #10        |
| **R2**: 환경변수 누락 → 사용자 추가 → redeploy         | ProjectDetail (Settings → Env vars) | test-env-required, fail-test       | env 입력 폼 검증, save 후 즉시 redeploy 옵션                                     | UI-gap #6             |
| **R3**: Recovery 승인 게이트 (LLM이 rollback 제안)     | OpsCenterV2 (Approvals 탭)          | test-runtime-crash + LLM 등록됨    | approve/deny 버튼 → 즉시 status 전이                                             | 신규 PSM              |
| **D1**: Stop → ConfirmDialog → 컨테이너 중지           | ProjectDetail                       | test-single-dockerfile (running)   | 다이얼로그 텍스트 정확, status='stopped' 즉시 반영                               | BUG-009               |
| **D2**: Archive → Unarchive → 가시성 토글              | ProjectsGrid + ProjectDetail        | test-single-dockerfile             | 'Show Archived' 토글로 다시 보임                                                 | —                     |
| **D3**: Purge (텍스트 매칭 확인)                       | ProjectDetail                       | test-single-dockerfile (사본)      | 이름 정확히 입력 못 하면 confirm 버튼 disabled, purge 후 ProjectsGrid에서 사라짐 | irreversible          |
| **D4**: Delete Service (확인 없음 — 의심 버그)         | ServiceDetail                       | 신규 PostgreSQL                    | 클릭 즉시 삭제, 연결 프로젝트 경고 없음 → BUG-009 회귀                           | BUG-009, UI-gap #7    |
| **B1**: Rollback (배포 2회 후)                         | ProjectDetail                       | test-single-dockerfile             | RollbackDialog에 deployment 목록, 선택 후 이전 image 복원                        | BUG-004               |
| **B2**: Blue-Green deploy (선택 health check path)     | ProjectDetail                       | test-single-dockerfile             | BlueGreenDialog → 새 컨테이너, 기존 컨테이너 보존 확인, traffic 전환             | BUG-003, BUG-016      |
| **W1**: GitHub webhook 트리거 → auto redeploy          | (외부) → ProjectDetail              | test-single-dockerfile             | webhook secret/URL이 Settings에 노출, push 시뮬레이션 후 timeline 자동 시작      | UI-gap #11            |
| **S1**: Service 생성 (Postgres 템플릿) → 프로젝트 연결 | ServicesPage                        | (자체 생성)                        | env auto-inject 동작, ServiceDetail 5탭 모두 진입                                | service-adapters      |
| **S2**: Service health 실패 시 상태 표시               | ServiceDetail                       | (자체 생성)                        | health=unhealthy 카드 색, ops feed에 표시                                        | 핫스팟 #10            |
| **S3**: Service Delete → 연결 프로젝트 환경변수 정리   | ServiceDetail                       | S1 결과                            | 사용자에게 경고 표시 + 정리 결과 노출 (BUG-009 회귀)                             | BUG-009               |
| **O1**: Ops activity SSE backfill + live               | OpsCenterV2                         | 기존 활동                          | backfill-complete 센티넬 후 live 전환, j/k/Esc 단축키                            | useOpsCenterData      |
| **O2**: Circuit breaker open 후 reset                  | OpsCenterV2                         | test-runtime-crash 반복 실패       | circuit breaker 위젯에 open 표시, reset 후 closed                                | 핫스팟 #7             |
| **O3**: Incident slideover + postmortem 자동 생성      | OpsCenterV2                         | R1 결과                            | 5분 안정성 후 postmortem 카드 등장                                               | recovery:success path |
| **SE1**: LLM 등록 (Anthropic) → 테스트 호출            | SettingsPage (AI 탭)                | —                                  | provider/model 선택, key save, /setup/llm/test 성공                              | UI-gap #7             |
| **SE2**: System ResourceLimits 프로파일 변경           | SettingsPage (System 탭)            | —                                  | small/medium/large/custom 선택, 다음 deploy에 즉시 반영                          | 핫스팟 #5             |
| **SE3**: GitHub OAuth connect/disconnect/switch        | SettingsPage (GitHub 탭)            | —                                  | NewProjectFlow의 'My Repos' 탭 동작 변화                                         | —                     |
| **SE4**: MCP 서버 등록 + 토큰 발급                     | SettingsPage (MCP 탭)               | —                                  | 등록 후 MCP API에서 인증 가능                                                    | 사용자 검증 완료 영역 |
| **SE5**: 비밀번호 변경 후 재로그인                     | SettingsPage (Security)             | —                                  | 변경 후 기존 세션 만료 → /login 리다이렉트                                       | UI-gap #1             |
| **A1**: 미인증 상태 보호 라우트 접근                   | (모든 보호 라우트)                  | —                                  | 401 후 /login 리다이렉트, 로그인 후 원래 경로로 복귀                             | —                     |
| **U1**: Korean project name 입력 (BUG-001)             | NewProjectFlow                      | —                                  | UI에서 즉시 거부 + 에러 메시지 표시                                              | BUG-001               |
| **U2**: 빠른 더블 클릭 redeploy (BUG-002)              | ProjectDetail                       | test-single-dockerfile             | 두 번째 클릭 즉시 disabled or 명확한 거부 토스트                                 | BUG-002               |
| **U3**: Port 음수/범위 초과 (BUG-007)                  | NewProjectFlow (image tab)          | nginx:alpine                       | UI 검증 즉시, 서버 호출 전 차단                                                  | BUG-007               |
| **U4**: Volume mount path 중복 (BUG-008)               | ProjectDetail (Settings → Volumes)  | test-single-dockerfile             | 중복 경로 입력 시 명확한 에러                                                    | BUG-008               |
| **MIG**: rc.7 DB로 부팅 (마이그레이션 경로)            | (셋업)                              | 별도 DB 스냅샷                     | startup 성공 + 첫 화면 정상, ai_usage_log CHECK 실패 없음                        | 핫스팟 #3             |

---

## 5. 차터 템플릿

각 차터 파일은 다음 8개 섹션 고정:

```markdown
# Charter NN: {제목}

## 1. Mission

한 줄 — QA 에이전트가 이 차터에서 이루어야 할 단일 목표.

## 2. 사전 조건 (시드 상태)

- 베이스 URL, 로그인 계정, 필요한 LLM 등록 여부
- 미리 만들어 두어야 할 프로젝트/서비스 (이 플랜의 §6 시드 상태 참조)

## 3. 탐색 시나리오 (서수 1, 2, 3 …)

각 시나리오: 진입 경로 → 액션 → 기대 UI 응답 → 검증 포인트 (스크린샷/네트워크/콘솔).
시나리오 ID는 §4 매트릭스의 G1/F1/R1 등 코드 사용.

## 4. 회귀 후크

이 차터에서 반드시 재검증해야 하는 §7 R1~R8 미해결 버그 ID 명시.
예: "U1(BUG-001), D4(BUG-009)"

## 5. 출력 형식

- 발견 사항: severity (🔴/🟡/ℹ️) + 한 줄 요약 + 재현 절차 + file:line 또는 네트워크/스크린샷 경로
- "정상 동작 확인": 시나리오 ID 리스트 (예 G1/F1)
- "스킵된 시나리오": 사유

## 6. 환경 정리 (cleanup)

차터 종료 시 purge 해야 할 프로젝트/서비스 목록.

## 7. 차터 종료 조건

모든 시나리오 PASS 또는 명확한 BUG 리포트 생성 시 종료. 모호한 결과는 다음 라운드로.

## 8. 참고 (file:line)

원본 코드 위치, 관련 과거 findings 링크.
```

---

## 6. 시드 상태 (사전 준비)

QA 에이전트 실행 전 **사용자 직접 셋업**:

1. ✅ 온보딩 + 어드민 비번 (이미 완료)
2. ✅ LLM 등록 (이미 완료)
3. ⏳ 다음 시드 프로젝트 3개 deploy (UI로 직접):
   - `qa-seed-ok` ← test-single-dockerfile (정상 running 상태)
   - `qa-seed-fail` ← test-build-fail (status='error', 빌드 실패 history)
   - `qa-seed-crash` ← test-runtime-crash (배포 후 강제 kill하여 recovery cycle 1회 발생시킴)
4. ⏳ 시드 서비스 1개:
   - `qa-seed-pg` ← PostgreSQL 17 (ServicesPage에서 생성)

이 4개는 차터들이 read-only로 참조. **차터는 자기만의 프로젝트를 새로 만들고 자기가 cleanup**.

---

## 7. R1~R8 미해결 버그 회귀 체크리스트 (UI 측면)

| BUG ID                                          | UI 회귀 시나리오                                                   | 차터 매핑         |
| ----------------------------------------------- | ------------------------------------------------------------------ | ----------------- |
| **BUG-001** 한글/특수문자 프로젝트명            | NewProjectFlow에서 즉시 거부, 에러 토스트                          | C01 (U1)          |
| **BUG-002** 동시 deploy lock                    | 같은 프로젝트 redeploy 더블클릭, 두 번째 차단                      | C04, C13 (U2)     |
| **BUG-003** 블루-그린 헬스체크 실패             | BlueGreenDialog 후 기존 컨테이너 살아있음, 실패 메시지 명확        | C05 (B2)          |
| **BUG-004** Rollback 미작동 + ENETUNREACH       | Rollback 후 timeline에 ENETUNREACH 없음, 의존 service 재연결       | C05 (B1)          |
| **BUG-007** REST API 포트 검증                  | Image deploy 폼 port=-1 거부                                       | C01 (U3)          |
| **BUG-008** Volume 중복 mount path              | Settings → Volumes 중복 입력 시 거부                               | C04 (U4)          |
| **BUG-009** 서비스 삭제 시 연결 프로젝트 미경고 | ServiceDetail Delete 클릭 시 사용 중인 프로젝트 경고               | C04, C07 (D4, S3) |
| **BUG-013/014** alerts ↔ incidents ↔ MCP 불일치 | OpsCenterV2 incident count = ProjectDetail Operations 탭 표시 일치 | C08 (O1, O3)      |
| **BUG-017** get_project_stats null              | Overview 탭 CPU/메모리 카드가 0이 아닌 실제 값                     | C02               |

---

## 8. 통합 시나리오 (cross-cutting, C13)

리스크 핫스팟 D1~D6 중 UI에서 관찰 가능한 4개:

- **CC1 (D1)**: redeploy 진행 중 컨테이너 강제 kill → status='recovering' → 사용자가 즉시 stop 클릭. 기대: 충돌 없이 status='stopped' 도달, activity feed 일관.
- **CC2 (D2)**: 5개 프로젝트 동시 redeploy (탭 5개 동시 클릭). 기대: 큐잉 표시 또는 직렬화, UI에서 모든 프로젝트 결과적으로 running.
- **CC3 (D5)**: 도메인 매핑된 프로젝트 → archive. 기대: 도메인 즉시 비활성, 외부 트래픽 404.
- **CC4 (D6)**: Settings에서 ResourceLimits 'small'(512MB) 설정 → 메모리 누수 컨테이너 배포. 기대: OOM alert가 OpsCenter에 표시 + recovery loop 5회 후 circuit breaker open.

(D3 마이그레이션은 별도 MIG 차터 / D4 PSM bypass는 코드 검증 영역)

---

## 9. 실행 모델

### 9.1 차터당 실행

- 입력: 차터 마크다운 1장 + 베이스 URL + 어드민 토큰
- 도구: Playwright MCP (브라우저 자동화) + curl/네트워크 콘솔
- 산출: `reports/{date}/{NN}-{slug}.md`
- 1차터 예상 시간: 10~30분 (시나리오 수에 비례)

### 9.2 라운드 운영

- **Round 0** (오늘): 시드 상태 셋업 + Charter 1개(C13 cross-cutting) 파일럿
- **Round 1**: P0 차터 4개 (C13, C14, C05, C04) 순차 실행
- **Round 2**: P1 차터 4개 (C01, C08, C03, C07) 병렬 (독립적)
- **Round 3**: P2 차터 3개 (C09, C02, C06)
- **Round 4**: P3 차터 3개 (C10, C11, C12) + MIG 차터

P0~P1 종료 시 **중간 종합** 리포트 → critic 패스 → 1.0 GA Go/No-Go 결정.

### 9.3 병렬 vs 순차 결정

- 같은 시드 프로젝트(`qa-seed-ok` 등) 사용하는 차터는 **순차** (상태 오염 방지)
- 자기 만의 임시 프로젝트만 만드는 차터는 **병렬 가능**

---

## 10. 합격 기준 (1.0 GA Go/No-Go)

### Must (Go 조건)

- P0 4개 차터 PASS — 미해결 Critical 회귀 없음
- BUG-002 / BUG-003 / BUG-004 의 UI 측면 재현 불가
- CC1 / CC2 통과
- MIG (rc.7 DB → rc.9 부팅) 성공

### Should (가능하면)

- P1 4개 차터 PASS
- BUG-009 (서비스 삭제 경고) UI 가드 추가
- CC3 / CC4 통과

### Nice

- P2/P3 차터 모든 시나리오 PASS
- UI-gap #5 (실시간 timeline 진행률 바) 등 UX 개선 백로그화

### 명시적 No-Go

- 데이터 손상 (Purge가 다른 프로젝트 영향)
- 보안 회귀 (미인증 상태로 보호 라우트 진입)
- recovery loop가 무한 LLM 호출 → 비용 폭증

---

## 11. 주요 리스크 / 주의사항

- **DB 오염**: 시드 프로젝트와 차터의 임시 프로젝트가 섞이지 않게 prefix 강제 (`qa-seed-*` vs `qa-c{NN}-*`)
- **컨테이너 잔존**: 차터 cleanup 누락 시 Docker 리소스 고갈 → 매 라운드 끝에 `docker ps -a --filter name=qa-` grep 후 dangling 정리
- **LLM 비용**: 자동 recovery cycle이 의도치 않게 반복되면 토큰 소비 큼. ResourceLimits + recovery max를 설정값 보호 후 시작
- **Playwright MCP 세션**: 어드민 토큰 만료 시 401 → 차터 도중 실패. 만료 임박 시 토큰 갱신 단계 차터 시작 시 포함
- **Drizzle 마이그레이션 검증**: rc.7 DB는 본인 데이터일 수 있음. **별도 임시 dataDir로 격리**하여 검증
- **시드 상태 변경 금지**: 차터가 시드 프로젝트의 status를 바꾸면 다음 차터가 깨짐. read-only 원칙 강제

---

## 12. 다음 액션 (이 플랜 승인 후)

1. **사용자 작업** (10~20분):
   - 시드 프로젝트 3개 deploy (`qa-seed-ok`, `qa-seed-fail`, `qa-seed-crash`)
   - 시드 서비스 1개 (`qa-seed-pg`)
2. **에이전트 작업** (제가):
   - 14개 차터 마크다운 파일 일괄 작성 (위 §5 템플릿)
   - C13 (cross-cutting) 차터 파일럿 1회 실행 → 결과 검토
3. **반복**: P0 → P1 → P2 → P3 라운드별 실행 + 중간 종합

## 13. 부록: 분석 근거 출처

이 플랜은 다음 5개 분석 결과의 종합:

- **A1 Web UI 인벤토리**: 11페이지 / 27 다이얼로그 / 40+ danger 액션 / 3개 NDJSON 스트림 / 5/10/30s 폴링
- **A2 API·도메인 매핑**: 100+ HTTP 라우트, 6개 핵심 도메인 흐름 (deploy/recovery/blue-green/rollback/ops/service)
- **A3 E2E 커버리지 갭**: 27 API + 11 UI 테스트, UI 측 15개 갭 영역 식별
- **A4 R1~R8 findings 종합**: 6 resolved / 9 unresolved / 3 high regression risk
- **A5 리스크 핫스팟**: 30일 1428 commits, 핫스팟 4개 도메인, 블로커 후보 Top 10, cross-module 시나리오 6개

세부 근거는 본 분석 raw 데이터(에이전트 응답)에 file:line/commit 해시로 기록되어 있음. 차터 작성 시 참조.
