# OpenLander 1.0.0 Web UI QA Plan — v2 (Lean)

**작성일**: 2026-04-20 (Updated 2026-04-21 — per-project lock + A1/SE5 정정)
**v1 폐기 사유**: 14차터 4라운드는 GA 직전 일정에 비현실적. 3모델 리뷰(critic + Codex + Gemini) 합의 반영하여 7차터 + MIG smoke로 압축.
**전제**: API 회귀는 `e2e/quality-gate/*` 27 spec(passing)이 커버. 본 v2는 **UI 사용자 동선** 검증에 집중.
**별도 트랙**: `qa-unit-test-track-2026-04-20.md` — UI 차터로 잡을 수 없는 영역(compose HostConfig, NDJSON ordering 등). **1.0 GA 차단 사유에 포함**.

**v2.1 코드 변경 반영 (2026-04-21)**:

- Per-project deploy lock 도입(commit `f8fb853`) — 다른 프로젝트는 동시 deploy 가능, 같은 프로젝트는 typed 409. C4 BUG-002 시나리오에 cross-project 병렬 시나리오 추가.
- A1 (로그인 후 원래 경로 복귀): 구현이 항상 `/projects` 로 보냄(`web/src/pages/LoginPage.tsx:19`). PASS 조건 정정.
- SE5 (비번 변경 후 세션 만료): 구현이 세션 안 죽임(`src/web/api/auth-routes.ts:188`). 1.0.x 백로그로 이동.
- 1.0 미지원 명시: 일반 사용자(admin 외) 권한 분리, 5+ 동시 deploy 부하, multi-process/cluster, RTL i18n.

---

## 0. v1 → v2 핵심 변경

| 변경                                                                                     | 사유                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 차터 14 → 7 + MIG                                                                        | Codex/Gemini 합의: 과쪼갬, setup/cleanup 비용 > 검증 가치                                                                                                                                                        |
| 시드 read-only 원칙 폐기                                                                 | Codex 통찰: reconcile loop(`src/app.ts:617`) + container-state-reconciler 30s(`container-state-reconciler.ts:43`) + PSM Docker overwrite(`project-state-manager.ts:204`) + OpsCenter 글로벌 데이터 → 격리 불가능 |
| MIG 별도 프로세스/dataDir로 분리                                                         | Codex: 같은 서버로 rc.7 boot 검증 불가. `src/db/index.ts:416`에서 DB open 시 즉시 마이그레이션                                                                                                                   |
| compose ResourceLimits / NDJSON ordering → 단위 트랙으로 이동                            | Codex: UI는 "설정값 저장"만 노출(`ResourceLimitsPanel.tsx:30`), HostConfig 검증 불가. NDJSON은 2초 snapshot flush(`ops-routes.ts:648`)라 UI 시퀀스 검증 flaky                                                    |
| PASS 기준 정량화                                                                         | Critic C1: 차터 단위(console.error 0 + 4xx/5xx 비예상 0 + 시나리오 100%) + BUG별 (예: BUG-002 50ms 더블클릭 10회)                                                                                                |
| 시나리오 ID 서술적 접미사                                                                | Gemini: `SE1` → `SE1_LLM_KEY_SAVE`                                                                                                                                                                               |
| 보안 시나리오 추가                                                                       | Critic C3: token in URL/log, CSRF on mutating, SSE auth, 401 후 sensitive 잔재                                                                                                                                   |
| 차터 출력에 Edge-case Discovery + Console/Network Error 모음 + Critical a11y micro-check | Gemini                                                                                                                                                                                                           |

---

## 1. 7차터 (각 차터 = 한 묶음의 사용자 동선)

### C1. NewProjectFlow_END_TO_END

- **동선**: 로그인 → /projects/new → 3탭(My Repos / Search / Docker Image) → env scan → 배포까지
- **회귀 후크**: BUG-001(한글 이름), BUG-007(포트 검증), G2(auto-detect), G4(image), G5(monorepo dockerfile path)
- **Zero-Tolerance**: ✅ (Golden Path 진입점)

### C2. ProjectDetail_TIMELINE_RUNTIME

- **동선**: ProjectDetail 진입 → Overview 탭(KPI/timeline) → Runtime/Console 탭(log stream) → tab 5개 전환
- **회귀 후크**: BUG-017(stats null), 실시간 timeline 렌더 smoke
- **Note**: NDJSON ordering 정확성은 unit 트랙으로

### C3. Recovery_ROLLBACK_BLUEGREEN

- **동선**: Rollback 다이얼로그 → 이전 image 복원 / Blue-Green 다이얼로그 → 신규 배포 / 자동 recovery 트리거 후 UI 표시
- **회귀 후크**: BUG-003(B-G 헬스체크), BUG-004(rollback + ENETUNREACH), BUG-016(B-G 잔여 컨테이너), R1(crash → recovery)
- **Zero-Tolerance**: ✅ (1.0 신기능 PSM 포함)

### C4. DangerActions_AND_SERVICES

- **동선**: Stop/Archive/Unarchive/Purge(텍스트 매칭) / ServicesPage 생성-연결-삭제(BUG-009 회귀) / U2 더블클릭 redeploy / U4 볼륨 중복
- **회귀 후크**: BUG-002(deploy lock), BUG-008(volume 중복), BUG-009(서비스 삭제 경고)
- **Zero-Tolerance**: ✅ (데이터 손상/가용성)

### C5. OpsCenter_AND_ALERTS

- **동선**: OpsCenterV2 6탭 / SSE backfill+live / circuit breaker open-reset / approval flow / incident slideover / postmortem
- **회귀 후크**: BUG-013/014(alerts ↔ incidents ↔ MCP 일관성), O1/O2/O3
- **Zero-Tolerance**: ✅ (운영 가시성)

### C6. Settings_AUTH_SECURITY

- **동선**: 7 Settings 탭(System/Security/Proxy/GitHub/AI/Operations/MCP) + Login/logout + 비번 변경 후 세션 만료 + **보안 시나리오 4건**(token in URL, CSRF, SSE auth, 401 sensitive 잔재)
- **회귀 후크**: SE2(ResourceLimits 프로파일 변경 - 단, runContainer 경로만 검증 가능), 보안
- **Zero-Tolerance**: ✅ (자가호스팅 인터넷 노출)

### C7. Dashboard_AND_LIST_SMOKE

- **동선**: Overview 대시보드(KPI/activity/needs-attention) + ProjectsGrid(필터/아카이브/뷰 토글) + DeploymentsList/Detail
- **회귀 후크**: 글로벌 카운트 일관성, archive 표시
- **Zero-Tolerance**: ❌ (best effort)

### MIG. MigrationBoot_SMOKE (별도 프로세스)

- **동선**: 별도 `dataDir` + rc.7 DB 스냅샷으로 부팅 → 마이그레이션 0003/0004/0005 적용 → 첫 화면/프로젝트 목록 정상 → 컨테이너 reconcile 정상
- **사전 조건**: rc.7 시기 DB 스냅샷 파일 (사용자가 보유했거나 생성 필요)
- **Zero-Tolerance**: ✅ (업그레이드 사용자 데이터 손상 = 즉시 No-Go)

---

## 2. Zero-Tolerance 5 + Best-Effort 2

| Tier               | 차터                    | GA 게이트                    |
| ------------------ | ----------------------- | ---------------------------- |
| **Zero-Tolerance** | C1, C3, C4, C5, C6, MIG | 단 1개 critical 발견도 No-Go |
| **Best-Effort**    | C2, C7                  | major 이하는 1.0.x 백로그로  |

총 6 zero + 2 best = 7차터 + MIG.

---

## 3. PASS / FAIL 정량 기준

### 차터 단위 (모든 차터 공통)

- ✅ PASS: (1) 정의된 시나리오 100% 완료 (2) `console.error` 0건 (3) 비예상 4xx/5xx 0건 (4) Critical a11y micro-check 통과(모든 button에 텍스트 또는 aria-label)
- ❌ FAIL: 위 4개 중 1개라도 위반

### BUG별 정량 기준

| BUG         | 시나리오                                                                       | PASS 기준                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BUG-001     | NewProjectFlow에 `qa-test-한글` 입력                                           | UI에서 즉시 거부 + 에러 메시지 노출 + 서버 호출 0회                                                                                                               |
| BUG-002     | (a) 같은 프로젝트 redeploy 50ms 간격 10회 / (b) 다른 두 프로젝트 동시 redeploy | (a) 2회차 이후 모두 UI disabled 또는 typed 409 DEPLOY_LOCKED, 중복 컨테이너 0회 / (b) 두 프로젝트 모두 wall time 직렬 시간보다 짧게 진행됨(per-project lock 검증) |
| BUG-003     | BlueGreenDialog 후 30초 모니터링                                               | 헬스체크 timeout 30s 안에 기존 컨테이너 status='running' 유지                                                                                                     |
| BUG-004     | deploy 2회 → rollback                                                          | 60초 안에 status='running' + timeline에 ENETUNREACH/ECONNREFUSED 0회                                                                                              |
| BUG-007     | image deploy 폼 port=-1 입력                                                   | UI 즉시 거부 + 서버 호출 0회                                                                                                                                      |
| BUG-008     | Settings/Volumes 같은 mount path 2회 입력                                      | UI 즉시 거부 + 명확한 에러 메시지                                                                                                                                 |
| BUG-009     | ServiceDetail Delete 클릭                                                      | 사용 중인 프로젝트 목록 다이얼로그 표시 + 해당 프로젝트 env vars 정리 결과 노출                                                                                   |
| BUG-013/014 | container 강제 kill 후 70초                                                    | OpsCenter incident count = ProjectDetail Operations 표시 = (사용자 검증 영역인 MCP는 제외)                                                                        |
| BUG-017     | running 프로젝트 Overview 탭                                                   | CPU/메모리 카드에 0이 아닌 실제 값 표시                                                                                                                           |
| MIG         | rc.7 dataDir로 부팅                                                            | 30초 안에 첫 화면, 기존 프로젝트 모두 status reconcile, ai_usage_log CHECK 위반 0건                                                                               |

### 차터 출력 형식 (8섹션 → 5섹션 lean)

```markdown
# Charter {ID}: {제목}

## 1. Pre-condition

- 베이스 URL, 계정, 필요한 시드 상태 (있으면)

## 2. Scenarios (실행 순서)

{시나리오 ID}\_{NAME}: 진입 → 액션 → 기대 → 검증 (selector or network or screenshot)

## 3. Output (산출물)

- 시나리오 결과: PASS / FAIL / SKIP + 사유
- Findings: severity (🔴/🟡/ℹ️) + 한 줄 + 재현 + 증거 경로
- **Edge-case Discovery**: 시나리오 외 발견사항 (자유 형식, 사람이 다음 라운드에 차터로 만들 후보)
- **Auto-collected**: console.error 모음 + 4xx/5xx 네트워크 모음 + a11y micro-check 결과
- **Final state screenshot only**: 각 시나리오 종료 시점 1장 (intermediate 금지)

## 4. Cleanup

이 차터가 만든 임시 프로젝트/서비스 purge 목록 (qa-c{N}-\* prefix 강제)

## 5. Refs

file:line + 관련 BUG ID + 과거 findings 링크
```

---

## 4. 시드 / 격리 (read-only 원칙 폐기)

**원칙 변경**: reconcile loop + PSM 덮어쓰기 + 글로벌 OpsCenter 데이터 때문에 "시드는 안 건드리고 다른 차터는 안전" 가정이 성립 안 함.

**대신**:

- **사용자 1회 셋업**: 온보딩 + LLM 등록 (이미 완료) + 빈 상태에서 시작
- **차터별 완전 격리**: 각 차터가 자기 만의 임시 프로젝트/서비스 만들고 cleanup. prefix 강제 (`qa-c1-*`, `qa-c2-*` …)
- **순차 실행**: OpsCenter는 글로벌 데이터라 동시 차터는 서로 incident/activity 오염. **모든 차터 순차 실행** (병렬 폐기)
- **각 차터 끝에 dangling cleanup**: `docker ps -a --filter name=qa-` 검사

---

## 5. 실행 순서 / 시간 추정

| 순서 | 차터                             | Tier | 추정 |
| ---- | -------------------------------- | ---- | ---- |
| 1    | MIG (별도 프로세스로 먼저)       | ZT   | 30분 |
| 2    | C1 NewProjectFlow                | ZT   | 30분 |
| 3    | C3 Recovery/Rollback/B-G         | ZT   | 60분 |
| 4    | C4 DangerActions/Services        | ZT   | 45분 |
| 5    | C6 Settings/Auth/Security        | ZT   | 45분 |
| 6    | C5 OpsCenter/Alerts              | ZT   | 60분 |
| 7    | C2 ProjectDetail Timeline (best) | BE   | 30분 |
| 8    | C7 Dashboard/List smoke (best)   | BE   | 30분 |

**ZT 합계: ~4.5시간** / **풀 합계: ~5.5시간** — 1일 안에 완주 가능.

ZT 6개만 PASS → **Minimal Go**. BE 2개 통과 시 **Full Go**.

---

## 6. Go / No-Go 게이트

### Go (1.0.0 GA 진행)

- ZT 6개 차터 PASS (위 정량 기준)
- BUG-001/002/003/004/007/008/009 모두 정량 기준 PASS
- MIG smoke PASS
- (별도 트랙) 단위 테스트 트랙 P0 통과 — `qa-unit-test-track-2026-04-20.md` 참조

### No-Go (즉시 차단)

- 데이터 손상 (Purge가 다른 프로젝트 영향 / MIG 후 데이터 손실)
- 보안 회귀 (미인증 보호 라우트 진입 / token URL 노출 / CSRF 우회)
- recovery 무한 루프로 LLM 비용 폭증
- compose ResourceLimits silent failure (단위 트랙에서 검증)

---

## 7. 사용자가 지금 할 일

1. **rc.7 DB 스냅샷 확보** (있으면) — MIG 차터에 사용. 없으면 MIG는 "신규 빈 DB 부팅" smoke로 축소
2. **시드 프로젝트 불필요** — v2부터 각 차터가 자기 데이터 만듦. 본인은 그냥 빈 상태로 두면 됨
3. **알림**: 준비 끝나면 알려주세요. 제가 7차터 마크다운 + 단위 트랙 문서 작성하고 MIG → C1 순서로 실행 시작

---

## 8. 부록: v1 자료 활용

- v1(`qa-webui-plan-2026-04-20.md`)의 §4 매트릭스(31 시나리오 ID), §7 BUG 매핑은 차터 작성 시 reference로 재활용
- 5개 분석 에이전트 raw 출력은 상위 컨텍스트에 보존되어 있어 차터 시나리오 작성 시 참조 가능
- v1은 archive (다음 라운드에서 i18n/a11y/성능 트랙 추가할 때 backbone으로 다시 사용)
