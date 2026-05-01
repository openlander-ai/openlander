# OpenLander QA Findings

> `/launchpad` 스킬로 발견한 모든 사항을 여기에 기록합니다.

---

<!-- 발견 항목은 아래에 추가 -->

## 배포 테스트 라운드 1 (2026-04-03)

### [성공] 기본 HTML 배포 — test repo

- **날짜**: 2026-04-03
- **심각도**: n/a
- **상태**: pass
- **설명**: Dockerfile 없는 HTML repo를 자동 감지하여 Dockerfile 생성 후 배포 성공
- **소요 시간**: 53초
- **프로젝트**: test-html-basic

### [성공] 모노레포 배포 — mono-test (api/web/worker)

- **날짜**: 2026-04-03
- **심각도**: n/a
- **상태**: pass
- **설명**: 3개 Dockerfile(api, web, worker)이 있는 모노레포. 기본 배포 시 `api/Dockerfile` 자동 선택됨. `dockerfile_path` + `prefer_dockerfile` 조합으로 각 서비스 개별 배포 성공.
- **소요 시간**: api 4s, web 4s, worker 5s
- **프로젝트**: test-mono, test-mono-web, test-mono-worker

### [UX] 모노레포 자동 선택 기준 불명확

- **날짜**: 2026-04-03
- **심각도**: minor
- **상태**: open
- **설명**: 모노레포에서 Dockerfile이 여러 개일 때 첫 번째(api/Dockerfile)가 자동 선택됨. 사용자에게 선택지를 제시하거나, 선택 기준을 명시하면 좋겠음.
- **제안**: create_deploy_plan 응답에 "다른 Dockerfile도 있습니다. dockerfile_path로 선택하세요" 같은 가이드 추가

### [성공] 빌드 실패 감지 — build-fail-test

- **날짜**: 2026-04-03
- **심각도**: n/a
- **상태**: pass
- **설명**: Dockerfile에 `RUN nonexistent-command-xyz`가 포함된 repo. 빌드 실패를 정확히 감지하고, `auto_diagnosis`로 카테고리(test-failure)와 원인을 제공함. 빌드 로그 tail도 포함되어 디버깅에 유용.
- **소요 시간**: 16초 (실패까지)
- **프로젝트**: test-build-fail

### [성공] 환경변수 누락 감지 — fail-test

- **날짜**: 2026-04-03
- **심각도**: n/a
- **상태**: pass
- **설명**: `DATABASE_URL`이 필수인 앱. plan 단계에서 `needs_input` 상태로 차단하고, 환경변수 없이 execute 시도하면 거부됨. `update_deploy_plan`으로 값 제공 후 배포 성공.
- **소요 시간**: 3초 (빌드 후)
- **프로젝트**: test-fail

### [성공] Compose 실패 감지 — test-compose-fail

- **날짜**: 2026-04-03
- **심각도**: n/a
- **상태**: pass
- **설명**: 빈 Compose topology 감지하여 "at least one service is required" 에러 반환. 명확한 에러 메시지.
- **소요 시간**: 16초 (실패까지)
- **프로젝트**: test-compose-fail

### [성공] Private repo 배포 — git-test

- **날짜**: 2026-04-03
- **심각도**: n/a
- **상태**: pass
- **설명**: Private repo를 GitHub 토큰으로 자동 클론하여 배포 성공. 별도 인증 설정 없이 동작.
- **소요 시간**: 9초
- **프로젝트**: test-private-repo

### [버그] Java 프로젝트 auto-generate Dockerfile 실패 — nhn-test

- **날짜**: 2026-04-03
- **심각도**: major
- **상태**: open
- **설명**: Dockerfile 없는 Java(Gradle) 프로젝트에서 자동 Dockerfile 생성 실패. `auto_diagnosis`는 "source-error"로 분류했으나, 실제 원인은 auto-generate가 Java/Gradle 빌드를 제대로 처리하지 못한 것으로 추정.
- **재현 방법**: `github.com/lehdqlsl/nhn-test` 배포
- **제안**: Java/Gradle/Maven 프로젝트용 auto-generate 템플릿 추가 필요. 또는 빌드 실패 시 "Dockerfile을 직접 추가해주세요" 안내 강화.
- **프로젝트**: test-java
