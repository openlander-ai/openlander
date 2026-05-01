# v0.0.9 Server Awareness — 도그푸딩 체크리스트

> **기간**: 1주 (시작일 기입: **\_\_**)
> **테스터**: User (프로젝트 오너)
> **버전**: v0.0.9 구현 완료 상태 (빌드 ✅, 648/648 테스트 ✅)
>
> 버그 발견 시: 채팅으로 보고. PM이 `docs/planning/v0.0.9/bugs.md` + GitHub Issue로 정리.

---

## 환경 준비

테스트 전에 아래 환경을 갖춘다.

- [ ] OpenLander가 설치되고 `bun run build` 성공하는 상태
- [ ] Docker daemon 실행 중
- [ ] 서버에 OpenLander **외** 컨테이너 최소 3개 실행 (예: nginx, postgres, redis 등)
- [ ] 포트 80을 사용하는 외부 서비스 1개 이상 (프록시 감지 테스트용)
- [ ] 포트 8080을 사용하는 서비스 1개 이상 (포트 충돌 테스트용)
- [ ] OpenLander로 배포한 프로젝트 최소 1개 있는 상태

---

## 테스트 항목

### A. 전체 컨테이너 스캔 (9-1)

#### A-1: 외부 컨테이너가 보이는지

- **사전조건**: OpenLander 외 컨테이너 3개+ 실행 중
- **절차**:
  1. OpenLander TUI 실행
  2. Dashboard에서 **Server** 섹션 확인
- **기대결과**: 외부 컨테이너가 `managed`와 구분되어 표시됨
- **확인방법**: `docker ps` 출력과 Server 섹션의 컨테이너 목록 대조

#### A-2: MCP로 전체 컨테이너 조회

- **사전조건**: MCP 클라이언트 (Claude Code / Cursor) 연결
- **절차**:
  1. MCP 도구 `list_all_containers` 호출 (state: "all")
  2. 반환값 확인
- **기대결과**: 모든 컨테이너가 반환됨. `managedByOpenLander` 필드로 구분 가능.
- **확인방법**: 반환 목록에서 외부 컨테이너의 `managedByOpenLander: false` 확인

#### A-3: 컨테이너 상태별 필터링

- **사전조건**: running + stopped 컨테이너 혼재
- **절차**:
  1. `list_all_containers` state="running" 호출
  2. `list_all_containers` state="stopped" 호출
- **기대결과**: 각각 해당 상태의 컨테이너만 반환됨
- **확인방법**: `docker ps` / `docker ps -a` 결과와 대조

---

### B. OS 레벨 포트 스캔 (9-2)

#### B-1: 포트 스캔 결과 확인

- **사전조건**: 다양한 포트를 사용하는 서비스 실행 중
- **절차**:
  1. MCP 도구 `scan_ports` 호출
- **기대결과**: `db`, `docker`, `os` 3개 소스별 포트 + `all` 합산 + `conflicts` 반환
- **확인방법**: `ss -tln` (Linux) 또는 `lsof -iTCP -sTCP:LISTEN` (macOS) 결과와 `os` 필드 대조

#### B-2: 포트 충돌 감지

- **사전조건**: 포트 80, 8080이 사용 중
- **절차**:
  1. `scan_ports` 호출
  2. `conflicts` 필드 확인
- **기대결과**: `conflicts`에 80, 8080이 포함됨 (OpenLander 기본 포트와 충돌)
- **확인방법**: `conflicts` 배열에 해당 포트 번호 존재

#### B-3: Docker 없이 포트 스캔

- **사전조건**: Docker daemon을 일시 중지 (`sudo systemctl stop docker`)
- **절차**:
  1. `scan_ports` 호출
- **기대결과**: `docker` 필드가 빈 배열 `[]`, `db`와 `os`는 정상 반환. 에러 없음.
- **확인방법**: 반환값 확인 후 Docker 다시 시작 (`sudo systemctl start docker`)
- **⚠️ 주의**: 테스트 후 반드시 Docker 재시작

---

### C. 리버스 프록시 감지 (9-3)

#### C-1: Traefik 감지

- **사전조건**: Traefik 컨테이너 실행 중 (OpenLander 관리 또는 외부)
- **절차**:
  1. OpenLander TUI의 Server 섹션에서 Proxy 상태 확인
- **기대결과**: `Proxy: Traefik vX.X (managed 또는 external)` 표시
- **확인방법**: 실제 Traefik 컨테이너 상태와 대조

#### C-2: Nginx/Caddy/HAProxy 감지

- **사전조건**: nginx 컨테이너가 포트 80에서 실행 중
- **절차**:
  1. Server 섹션 또는 에이전트에게 "서버 상태 알려줘" 요청
- **기대결과**: Nginx가 감지됨. "Nginx detected — 자동 연동은 지원하지 않습니다" 류의 경고
- **확인방법**: 프록시 타입이 `nginx`로 정확히 식별되는지

#### C-3: external 모드 전환

- **사전조건**: 외부 Traefik이 이미 실행 중
- **절차**:
  1. 에이전트에게 "기존 Traefik을 사용하도록 전환해줘" 요청 (또는 config에서 직접 `traefik.mode: external` 설정)
- **기대결과**: OpenLander의 Traefik이 중지되고, 이후 배포 시 외부 Traefik 네트워크에 연결
- **확인방법**: `docker ps`에서 OpenLander Traefik 컨테이너가 없는지 확인

---

### D. 시스템 프롬프트 서버 컨텍스트 (9-4)

#### D-1: 에이전트가 서버 상태를 아는지

- **사전조건**: 외부 컨테이너 + 사용 중인 포트 존재
- **절차**:
  1. 에이전트에게 "이 서버에서 뭐가 돌고 있어?" 질문
- **기대결과**: 에이전트가 외부 컨테이너, 사용 중인 포트, 프록시 상태를 답변
- **확인방법**: `docker ps` + `ss -tln` 결과와 에이전트 답변 대조

#### D-2: 에이전트가 충돌을 사전 회피하는지

- **사전조건**: 포트 3000이 사용 중
- **절차**:
  1. 에이전트에게 "포트 3000으로 배포해줘" 요청
- **기대결과**: 에이전트가 "포트 3000은 이미 사용 중" 안내하고 다른 포트 제안
- **확인방법**: 에이전트가 충돌 포트를 피해 배포하는지

#### D-3: 컨테이너 20개 초과 시 요약

- **사전조건**: 외부 컨테이너 20개 이상 (테스트용으로 더미 컨테이너 생성)
  ```bash
  for i in $(seq 1 25); do docker run -d --name test-container-$i alpine sleep 3600; done
  ```
- **절차**:
  1. 에이전트에게 "서버 상태 알려줘" 요청
- **기대결과**: 개별 나열이 아닌 타입별 개수 요약으로 표시 (예: `"alpine: 25개"`)
- **확인방법**: 시스템 프롬프트가 폭발적으로 길어지지 않는지
- **⚠️ 정리**: 테스트 후 `for i in $(seq 1 25); do docker rm -f test-container-$i; done`

---

### E. 에이전트 도구 (9-5)

#### E-1: get_container_stats 도구

- **사전조건**: 실행 중인 컨테이너 1개 이상
- **절차**:
  1. MCP 도구 `get_container_stats` 호출 (container: "실행중인 컨테이너 이름")
- **기대결과**: CPU, 메모리, 네트워크 사용량 반환
- **확인방법**: `docker stats --no-stream` 결과와 대략적으로 일치

#### E-2: 존재하지 않는 컨테이너 조회

- **사전조건**: 없음
- **절차**:
  1. `get_container_stats` 호출 (container: "nonexistent-container-xyz")
- **기대결과**: 에러가 아닌 적절한 메시지 ("컨테이너를 찾을 수 없습니다" 등)
- **확인방법**: 에러 메시지가 사용자 친화적인지

---

### F. Dashboard Server 섹션 (9-6)

#### F-1: Server 섹션 표시

- **사전조건**: 외부 컨테이너 3개+ 실행
- **절차**:
  1. OpenLander TUI 실행
  2. Dashboard에서 Server 섹션 확인
- **기대결과**: System 섹션 아래에 Server 섹션 표시. 컨테이너 수, 포트 수, 프록시 상태 요약.
- **확인방법**: 육안 확인. 정보가 정확한지 `docker ps`와 대조.

#### F-2: 외부 컨테이너 없을 때

- **사전조건**: OpenLander 관리 컨테이너만 있고 외부 컨테이너 0개
- **절차**:
  1. Dashboard 확인
- **기대결과**: Server 섹션이 비어있거나 "No external containers" 표시
- **확인방법**: 섹션이 깨지지 않고 깔끔하게 처리되는지

#### F-3: 컨테이너 10개 초과 시 축약

- **사전조건**: 외부 컨테이너 12개+
- **절차**:
  1. Dashboard 확인
- **기대결과**: 상위 5개만 표시 + "...and N more" 축약
- **확인방법**: 목록이 과도하게 길어지지 않는지

#### F-4: 폴링 갱신

- **사전조건**: TUI 실행 중
- **절차**:
  1. 별도 터미널에서 `docker run -d --name test-poll alpine sleep 3600`
  2. 3-5초 후 Dashboard 확인
- **기대결과**: 새 컨테이너가 Server 섹션에 자동 반영
- **확인방법**: 수동 새로고침 없이 나타나는지
- **⚠️ 정리**: `docker rm -f test-poll`

---

### G. Preflight Check — 킬러 피처 (9-7)

#### G-1: 정상 배포 (모든 체크 통과)

- **사전조건**: 충돌 없는 깨끗한 환경
- **절차**:
  1. 에이전트에게 새 프로젝트 배포 요청
- **기대결과**: preflight 결과가 모두 ✅. 바로 빌드 진행.
- **확인방법**: 배포 과정에서 "Preflight check" 메시지 확인

#### G-2: 포트 충돌로 배포 차단 ⭐

- **사전조건**: 배포하려는 포트가 이미 사용 중
- **절차**:
  1. 포트 8080을 사용하는 서비스 실행
  2. 에이전트에게 포트 8080으로 배포 요청 (또는 OpenLander가 8080을 할당하려는 상황 유도)
- **기대결과**: `❌ Port 8080 — already in use by "XXX"` 메시지와 함께 빌드 시작하지 않음
- **확인방법**: 빌드가 시작되지 않고, 포트 충돌 메시지가 명확한지

#### G-3: 컨테이너 이름 충돌로 배포 차단 ⭐

- **사전조건**: "my-app"이라는 이름의 외부 컨테이너 실행 중
- **절차**:
  1. `docker run -d --name my-app alpine sleep 3600`
  2. 에이전트에게 "my-app" 이름으로 배포 요청
- **기대결과**: `❌ Name "my-app" — container already exists` 메시지. 빌드 차단.
- **확인방법**: 빌드가 시작되지 않는지 확인
- **⚠️ 정리**: `docker rm -f my-app`

#### G-4: 리소스 경고 (차단 아닌 경고)

- **사전조건**: 메모리 90%+ 사용 상태 (또는 디스크 여유 1GB 미만)
- **절차**:
  1. 배포 요청
- **기대결과**: `⚠️ Memory: XX% used` 경고 표시되지만, 빌드는 진행됨
- **확인방법**: 경고가 표시되고, 배포가 차단되지는 않는지
- **참고**: 리소스 상황을 인위적으로 만들기 어려우면 스킵 가능

#### G-5: Traefik 상태 체크

- **사전조건**: Traefik이 정상 실행 중
- **절차**:
  1. 배포 요청
- **기대결과**: preflight에서 `✅ Traefik: running` 확인
- **확인방법**: preflight 결과 확인

#### G-6: 연속 배포 시 preflight 반복 실행

- **사전조건**: 프로젝트 2개 연속 배포
- **절차**:
  1. 프로젝트 A 배포
  2. 바로 프로젝트 B 배포
- **기대결과**: 각 배포마다 독립적으로 preflight 실행. A가 차지한 포트/이름을 B가 인식.
- **확인방법**: 두 번째 배포에서 첫 번째 배포의 결과가 반영되는지

---

### H. Web API (9-6 보조)

#### H-1: /api/server/status 엔드포인트

- **사전조건**: OpenLander 실행 중
- **절차**:
  1. `curl http://localhost:<port>/api/server/status`
- **기대결과**: JSON으로 컨테이너 목록, 포트, 프록시 상태 반환
- **확인방법**: 응답이 유효한 JSON이고 내용이 정확한지

---

## 종합 시나리오 (End-to-End)

### S-1: "서버 상태를 아는 배포" 풀 시나리오 ⭐⭐

이 시나리오가 v0.0.9의 핵심 가치를 검증한다.

1. 서버에 외부 컨테이너 5개 이상 실행 (nginx:80, postgres:5432, redis:6379 등)
2. OpenLander TUI 실행 → Dashboard Server 섹션에서 외부 서비스 확인
3. 에이전트에게 "이 서버 상태 알려줘" → 외부 컨테이너 + 포트 + 프록시 정보 답변
4. 에이전트에게 새 프로젝트 배포 요청 → preflight 통과 → 정상 배포
5. 이미 사용 중인 포트로 배포 시도 → preflight 차단 → 명확한 에러 메시지
6. MCP 클라이언트에서 `list_all_containers`, `scan_ports` 호출 → 전체 정보 반환

**성공 기준**: 에이전트가 서버 상태를 정확히 알고, 충돌을 사전에 방지하며, 불필요한 재시도 루프 없이 한 번에 성공적으로 배포한다.

---

## 버그 보고 방법

발견한 버그는 아래 형식으로 채팅에 보고:

```
[버그] 제목
환경: (어디서 발생했는지)
재현: (어떻게 하면 다시 발생하는지)
기대: (어떻게 되어야 하는지)
실제: (실제로 어떻게 되었는지)
심각도: blocking / major / minor
```

PM이 `docs/planning/v0.0.9/bugs.md`에 BUG-NNN으로 등록하고, GitHub Issue를 생성한다.

---

## 도그푸딩 종료 조건

- [ ] blocking 버그 0개
- [ ] major 버그 0개
- [ ] minor 버그는 User 판단 ("다음 버전에 해도 됨")
- [ ] 종합 시나리오 S-1 통과
- [ ] User가 "OK" 선언

종료 후 → dev-lifecycle [11] PM 최종 검수로 이동.
