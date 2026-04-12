# OpenLander 버그 리포트 Round 2 — 2026-04-03

> Round 1 이후 추가 QA (qa1 R6-R8, qa2 R5-R7, live 배포+운영)에서 발견된 항목.
> Round 1: `bug-report-2026-04-03.md` (Critical 6 + Major 9)

---

## 신규 Critical — 1개

### BUG-016: 블루-그린 실패 후 기존 컨테이너 망가짐

**심각도**: 🔴 Critical  
**난이도**: Medium  
**출처**: live 운영 테스트

**재현 방법**:

```
1. 정상 running 프로젝트에 deploy_blue_green 실행
2. 포트 충돌로 실패 (BUG-003)
3. 기존 컨테이너의 DB 연결이 끊어짐 (ENETUNREACH)
4. 서비스 재시작 전까지 복구 안 됨
```

**증상**:

- 블루-그린이 실패하면서 원래 정상이던 컨테이너의 네트워크가 망가짐
- DB 연결 에러 발생: `ENETUNREACH 172.22.0.27:5432`
- 블루-그린 실패 시 기존 컨테이너를 원래 상태로 롤백하지 않음

**영향**: BUG-003(포트 충돌)과 결합되면 블루-그린 시도 자체가 서비스 장애 유발

**수정 제안**: 블루-그린 실패 시 기존 컨테이너 네트워크 복원 + 헬스체크 재확인

---

## 신규 Major — 2개

### BUG-017: get_project_stats가 모든 메트릭 0 반환

**심각도**: 🟡 Major  
**난이도**: Medium  
**출처**: live 운영 테스트  
**재현율**: 100%

**재현 방법**:

```
get_project_stats(project_name: "live-service-app")
→ { cpu_percent: 0, memory_usage_mb: 0, memory_limit_mb: 0, restarts: 0, uptime_seconds: 0 }
```

**증상**: 컨테이너가 running이고 로그도 출력되는데 모든 메트릭이 0. Docker stats 수집 실패로 추정.

**영향**: 모니터링/알림이 무의미해짐. OpsAgent의 리소스 기반 판단도 불가.

### BUG-018: 외부 컨테이너 이름 충돌 시 배포 불가 + 해결 수단 없음

**심각도**: 🟡 Major  
**난이도**: Low  
**출처**: live 운영 테스트

**재현 방법**:

```
1. docker run --name ol-myapp ... (외부에서 수동 생성)
2. create_deploy_plan(name: "myapp") → execute_deploy_plan
3. 에러: "Container ol-myapp already exists (external, running)"
4. remove_project("myapp") → "Project not found" (OpenLander DB에 없으니까)
```

**증상**: OpenLander 네임스페이스(`ol-`)를 쓰는 외부 컨테이너가 있으면 배포 불가. 정리 수단도 없음.

**수정 제안**:

1. `execute_deploy_plan`에 `force` 옵션 — 외부 컨테이너 자동 제거
2. 또는 `cleanup_docker`에 "외부 ol-\* 컨테이너 정리" 기능 추가

---

## 신규 UX 이슈 — 6개 (live 운영에서 발견)

### UX-006: 서비스 매핑에 무관한 DB 전부 표시

- `create_deploy_plan` 시 PostgreSQL 서비스 5개가 전부 후보로 나옴
- 프로젝트와 관련 없는 서비스도 섞여서 혼란

### UX-007: list_env_vars 비밀번호 미마스킹

- `DATABASE_URL`에 비밀번호가 평문으로 노출
- 도구 description에는 "masked"라고 써있지만 실제로는 unmasked

### UX-008: 빌드 진행상황 스트리밍 없음

- `deploy(wait: false)` → `status: "building"`만 반환, 진행 단계 없음
- `deploy(wait: true)` → 완료까지 블로킹, 중간 상태 없음

### UX-009: 헬스체크 테스트 도구 없음

- 배포 후 앱이 정상인지 확인하려면 `get_logs`만 가능
- `test_endpoint` 같은 도구 필요

### UX-010: execute_deploy_plan에 force 옵션 없음

- 외부 컨테이너 충돌 시 수동 docker CLI로 정리해야 함
- MCP 도구만으로는 해결 불가

### UX-011: set_env_vars 후 자동 재배포 시 확인 없음

- 환경변수 하나 바꿔도 즉시 재배포 트리거
- 여러 변수를 순차적으로 바꾸면 매번 재배포 (한 번에 보내면 OK)

---

## 아이디어 — 6개

| #      | 아이디어                           | 설명                                            |
| ------ | ---------------------------------- | ----------------------------------------------- |
| IDEA-1 | `adopt_container`                  | 외부 Docker 컨테이너를 OpenLander 관리로 편입   |
| IDEA-2 | `test_endpoint`                    | 프로젝트 URL 헬스체크 (curl 대체)               |
| IDEA-3 | `clone_project`                    | 설정 복제 (staging/prod 동기화)                 |
| IDEA-4 | `exec_project_container`           | 프로젝트 컨테이너 내부 명령 실행                |
| IDEA-5 | 외부 ol-\* 컨테이너 자동 감지/정리 | cleanup_docker 확장                             |
| IDEA-6 | 프로젝트 의존성 그래프             | Operations Center용 서비스→프로젝트 관계 시각화 |

---

## 칭찬 (live 운영에서 확인)

| 항목                     | 평가                                          |
| ------------------------ | --------------------------------------------- |
| 배포 속도                | 8초(캐시), 10초(no_cache), 재배포 3초         |
| connectivity 사전검증    | `[connectivity] ✓ DNS OK, TCP OK` — 킬러 피처 |
| set_env_vars 자동 재배포 | 7초, 매끄러움                                 |
| expose_public            | Cloudflare 터널 즉시 생성                     |
| deploy plan 3단계 플로우 | create → validate → execute, 완전한 제어      |
| `_agent_guidance`        | 에이전트 DX 최고 — 다음 행동 안내             |
| 에러 메시지              | 롤백 불가 사유 등 명확한 설명                 |
| 배포 히스토리            | 4회 배포 전부 정확 추적                       |

---

## 전체 누적 (Round 1 + Round 2)

| 구분     | Round 1 | Round 2 | 합계   |
| -------- | ------- | ------- | ------ |
| Critical | 6       | 1       | **7**  |
| Major    | 9       | 2       | **11** |
| UX 이슈  | 5       | 6       | **11** |
| 아이디어 | 0       | 6       | **6**  |

### 수정 우선순위 (전체 통합)

**1차 — Low 난이도, 즉시 가능:**

1. 프로젝트명 검증 regex (BUG-001)
2. deploy lock acquire 호출 (BUG-002)
3. 블루-그린 rename 승격 (BUG-003)
4. dockerfile_path spread 순서 (BUG-005)
5. Redis BGSAVE 전처리 (BUG-006)
6. 포트 범위 검증 .max(65535) (BUG-007)
7. 볼륨 mount_path 중복 체크 (BUG-008)

**2차 — Medium, 설계 필요:** 8. 롤백 이미지 보존 (BUG-004) 9. 블루-그린 실패 시 네트워크 복원 (BUG-016) 10. get_project_stats Docker stats 수집 (BUG-017)

**3차 — 1.0.1+:**

- env vars 이원화 통합 (BUG-015)
- alerts MCP↔REST 불일치 (BUG-014)
- 빌드 cancel (BUG-012)
