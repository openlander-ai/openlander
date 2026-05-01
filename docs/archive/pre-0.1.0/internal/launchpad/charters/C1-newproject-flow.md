# Charter C1: NewProjectFlow_END_TO_END

**Tier**: Zero-Tolerance
**예상 소요**: 30분

## 1. Pre-condition

- 베이스 URL: http://localhost:10114
- 어드민 로그인 완료 + LLM 등록됨
- GitHub OAuth 연결됨 (옵션, 'My Repos' 탭 사용 시)
- 임시 프로젝트 prefix: `qa-c1-*`

## 2. Scenarios

### C1S1_HANGUL_NAME_REJECT (BUG-001 회귀)

NewProjectFlow → name 필드에 `qa-c1-한글` 입력 → Deploy 버튼 클릭.
**PASS**: UI에서 즉시 거부 + 에러 메시지 노출 + Network 탭에 `/projects/deploy` 호출 0회.
**FAIL**: 서버 호출 발생 또는 거부 메시지 없음.

### C1S2_PORT_RANGE_REJECT (BUG-007 회귀)

Docker Image 탭 → image: `nginx:alpine`, port: `-1` → Deploy.
재시도: port `0`, `99999`.
**PASS**: 세 케이스 모두 UI에서 즉시 거부 + 서버 호출 0회.

### C1S3_GIT_DOCKERFILE_DEPLOY (Golden Path)

Search 탭 → `openlander-ai/test-single-dockerfile` 검색 → 선택 → name `qa-c1-ok` → Deploy.
**PASS**: 90초 안에 ProjectDetail 진입 + status='running' + URL 카드 표시 + Health badge='healthy'.

### C1S4_AUTODETECT_DEPLOY

Search 탭 → `openlander-ai/test-no-dockerfile` → name `qa-c1-auto` → env-scan 다이얼로그가 뜨면 Skip → Deploy.
**PASS**: smart-defaults가 빌드 명령 제안 표시 + 120초 안에 status='running'.

### C1S5_IMAGE_DEPLOY

Docker Image 탭 → `nginx:alpine`, port `8080`, name `qa-c1-img` → Deploy.
**PASS**: clone/build 단계 skip하고 run 직행 + 30초 안에 status='running'.

### C1S6_BUILD_FAIL_UX (UI-gap #5)

Search 탭 → `openlander-ai/test-build-fail` → name `qa-c1-fail` → Deploy.
**PASS**: 60초 안에 status='error' + ProjectDetail timeline에 build 단계가 빨간색 + 에러 메시지 expandable.
**FAIL**: 무한 building 상태 또는 에러 사유 텍스트 노출 안됨.

### C1S7_MONOREPO_DOCKERFILE_PATH (BUG-005 회귀)

Search 탭 → `openlander-ai/test-monorepo` → name `qa-c1-mono` → Configure에서 dockerfile path 설정 → Deploy → 후 Settings에서 dockerfile path 다른 경로로 변경 → Redeploy.
**PASS**: 두 번째 deploy에서 새 dockerfile path가 빌드 로그에 반영.

## 3. Output

차터별 표준 출력 + 추가:

- 각 시나리오의 final-state screenshot (1장)
- C1S1/C1S2 거부 메시지 텍스트 정확히 캡처
- Edge-case Discovery: env-scan 다이얼로그 동작, 진행률 바 등 노출 시 기록

## 4. Cleanup

```bash
# UI: Purge 4개 프로젝트 (qa-c1-ok, qa-c1-auto, qa-c1-img, qa-c1-fail, qa-c1-mono)
# 검증
docker ps -a --filter name=qa-c1- | wc -l   # 1 (헤더만)
```

## 5. Refs

- `web/src/pages/NewProjectFlow.tsx`
- `web/src/components/deploy/ConfigureDeployStep.tsx`
- BUG-001/005/007 in `qa-webui-plan-v2-2026-04-20.md` §3
