# OpenLander — 정식 릴리즈 전 E2E 도그푸딩 체크리스트

> **용도**: 정식 릴리즈 전 1회 수동 실행. CI 자동화 대상 아님.
> **작성일**: 2026-03-08
> **전제조건**: Docker 데몬 실행 중, Traefik 컨테이너 실행 중, LLM API 키 설정 완료

---

## 환경 준비

- [ ] `npm run build` 성공 확인
- [ ] `npm test` 전체 통과 확인
- [ ] Docker 데몬 실행 중 (`docker ps` 응답)
- [ ] Traefik 컨테이너 실행 중 (`docker ps | grep traefik`)
- [ ] 웹 UI 접근 가능 (`http://localhost:10003`)
- [ ] LLM 프로바이더 설정 완료 (Settings 페이지에서 확인)

---

## 시나리오 1: Public Repo Deploy (Dockerfile)

**사전조건**: 없음 (새 프로젝트)

- [ ] 웹 UI에서 Deploy 클릭
- [ ] Public GitHub URL 입력 (예: `https://github.com/docker/welcome-to-docker`)
- [ ] 배포 시작 → 타임라인에 `clone → build → run → success` 이벤트 순서대로 표시
- [ ] 배포 완료 후 URL 생성됨 (sslip.io 도메인)
- [ ] 생성된 URL 접속 → 200 응답 확인
- [ ] Projects 목록에 `running` 상태로 표시
- [ ] Deployments 탭에 배포 기록 1건 표시

**확인방법**: 브라우저에서 URL 접속, Projects 목록 확인

---

## 시나리오 2: Private Repo Deploy (SSH Key)

**사전조건**: SSH 키 설정 완료 (Settings → GitHub SSH Key)

- [ ] 웹 UI에서 Deploy 클릭
- [ ] Private GitHub URL 입력 (SSH 형식: `git@github.com:user/private-repo.git`)
- [ ] 배포 시작 → clone 단계에서 SSH 키 사용 확인 (에러 없이 통과)
- [ ] 배포 완료 → URL 접속 가능
- [ ] 실패 시: 에러 메시지에 "Permission denied" 또는 "Authentication failed" 표시 (SSH 키 문제 식별 가능)

**확인방법**: 배포 성공 or 명확한 SSH 에러 메시지

---

## 시나리오 3: Private Repo Deploy (GitHub Token)

**사전조건**: GitHub OAuth 연결 완료 (Settings → GitHub)

- [ ] 웹 UI에서 Deploy 클릭
- [ ] Private GitHub URL 입력 (HTTPS 형식: `https://github.com/user/private-repo`)
- [ ] 배포 시작 → clone 단계에서 토큰 자동 주입 (에러 없이 통과)
- [ ] 배포 완료 → URL 접속 가능

**확인방법**: HTTPS URL + 토큰으로 private repo clone 성공

---

## 시나리오 4: Docker Compose Deploy

**사전조건**: Compose 파일이 포함된 레포 필요

- [ ] Compose 프로젝트 URL 입력하여 배포
- [ ] 타임라인에 `compose:start → compose:up` 이벤트 표시
- [ ] 자식 프로젝트들이 Projects 목록에 표시
- [ ] 각 서비스 컨테이너가 running 상태

**확인방법**: `docker ps`로 compose 서비스 컨테이너 확인, Projects 목록에서 자식 프로젝트 확인

---

## 시나리오 5: 빌드 실패 → AI 자동 복구

**사전조건**: 의도적으로 빌드 실패를 유발할 수 있는 레포 (또는 broken Dockerfile)

- [ ] 빌드 실패 발생
- [ ] 타임라인에 `deploy:failed` 이벤트 표시 + 빌드 로그 접이식 표시
- [ ] AI 자동 복구 시작 → "AI is working on it..." 표시
- [ ] AI가 에러 분석 → Dockerfile 수정 시도 (또는 환경변수 질문)
- [ ] 자동 복구 성공 시: 재배포 → running 상태
- [ ] 자동 복구 실패 시: 최대 3회 재시도 후 최종 실패 상태

**확인방법**: 타임라인에서 AI 분석/복구 과정 확인

---

## 시나리오 6: Redeploy (재배포)

**사전조건**: 시나리오 1에서 배포한 프로젝트 존재

- [ ] 기존 프로젝트의 Redeploy 버튼 클릭
- [ ] 재배포 시작 → 타임라인 이벤트 표시
- [ ] 재배포 완료 → 기존 URL 유지, running 상태
- [ ] Deployments 탭에 배포 기록 2건 표시

**확인방법**: URL 접속 + Deployments 탭 기록 확인

---

## 시나리오 7: Blue-Green 무중단 배포

**사전조건**: running 상태의 프로젝트 존재

- [ ] Blue-Green 버튼 클릭 (running 상태에서만 활성)
- [ ] 새 컨테이너 빌드 → 헬스체크 통과 → Traefik 라벨 전환
- [ ] 배포 중 기존 URL 접속 유지 (다운타임 없음)
- [ ] 완료 후 이전 컨테이너 자동 정리

**확인방법**: 배포 중 URL 접속 테스트, `docker ps`로 컨테이너 전환 확인

---

## 시나리오 8: 롤백

**사전조건**: 2회 이상 배포한 프로젝트 존재

- [ ] Rollback 버튼 클릭
- [ ] 이전 이미지로 즉시 전환
- [ ] URL 접속 → 이전 버전 동작 확인

**확인방법**: 배포 버전 변경 확인

---

## 시나리오 9: Start/Stop

**사전조건**: running 상태의 프로젝트 존재

- [ ] Stop 버튼 → 프로젝트 stopped 상태
- [ ] URL 접속 불가 확인
- [ ] Start 버튼 → 프로젝트 running 상태 복귀
- [ ] URL 접속 다시 가능

**확인방법**: 프로젝트 상태 전환 + URL 접속 확인

---

## 시나리오 10: Webhook 자동 재배포

**사전조건**: 시나리오 1의 프로젝트에 Webhook 설정 완료

- [ ] Config 탭 → Webhooks 패널 → Webhook URL 복사
- [ ] GitHub 레포 Settings → Webhooks에 URL 등록 (또는 curl로 직접 호출)
- [ ] git push 이벤트 발생 → 자동 재배포 시작
- [ ] 재배포 완료 → 최신 코드 반영

**확인방법**: Webhook 트리거 후 자동 재배포 확인

---

## 시나리오 11: 공유 서비스 (Shared Services)

**사전조건**: 없음

- [ ] Services 페이지 접속
- [ ] 템플릿 퀵스타트 (PostgreSQL) → 서비스 생성 → running 상태
- [ ] 연결 정보 (host, port, credentials) 표시 확인
- [ ] 커스텀 이미지 폼 → 임의 Docker 이미지 입력 → 서비스 생성
- [ ] Stop → Start → Remove 동작 확인

**확인방법**: Services 페이지에서 상태 확인, `docker ps`로 컨테이너 확인

---

## 시나리오 12: 도메인 매핑

**사전조건**: running 상태의 프로젝트 존재

- [ ] Config 탭 → Domains 패널 → 커스텀 도메인 추가
- [ ] 도메인 목록에 표시
- [ ] 도메인 삭제 → 목록에서 제거

**확인방법**: Domains 패널 UI 확인 (실제 DNS 설정은 별도)

---

## 정리

- [ ] 테스트용 프로젝트 전부 삭제 (Remove)
- [ ] 테스트용 공유 서비스 삭제
- [ ] `docker ps`로 잔여 컨테이너 없음 확인
- [ ] 이 체크리스트에 날짜 + 결과 기록

**테스트 실행일**: \_**\_-**-\*\*
**테스트 결과**: PASS / FAIL (실패 항목 기록)
**테스터**: **\*\***\_\_**\*\*\*\***
