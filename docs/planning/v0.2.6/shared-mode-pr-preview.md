# v0.2.6 — Shared Mode & PR Preview

## 개요

- 한 줄 요약: Quick Share Traefik 통합 + 접근 코드(Shared 모드) + PR별 프리뷰 URL
- 핵심 문제: 데모를 외부(투자자/클라이언트)에 안전하게 공유할 수 없음 + PR 코드 리뷰 시 실행 확인 불가
- 선행 조건: v1.0.0 AI Co-pilot ✅

## Phase 1: Traefik File Provider 활성화 (0.5일)

### 1-1: Traefik Cmd에 File Provider 추가

- AS-IS: Docker Provider만 사용
- TO-BE: Docker + File Provider 동시 사용
- HOW: traefik.ts Cmd 배열에 2줄 추가 + /etc/traefik/dynamic/ 디렉토리 생성 + Docker volume 바인드
- 수락기준:
  - [ ] traefik.ts에 '--providers.file.directory=/etc/traefik/dynamic/' 추가
  - [ ] traefik.ts에 '--providers.file.watch=true' 추가
  - [ ] Traefik 컨테이너에 /etc/traefik/dynamic/ 볼륨 마운트
  - [ ] 디렉토리에 YAML 넣으면 Traefik이 자동 감지하여 라우팅 생성 확인

## Phase 2: Quick Share Traefik 통합 + Shared 모드 (2.5~3일)

### 2-1: Quick Share Traefik 경유 전환

- AS-IS: cloudflared → localhost:${PORT} (컨테이너 직접)
- TO-BE: cloudflared → localhost:80 (Traefik) → File Provider 동적 라우터 → @docker 서비스
- HOW:
  1. tunnel.ts: spawn 인자를 localhost:80으로 변경
  2. TryCloudflare URL 획득 후 YAML 파일 생성 (atomic write: tmp → rename)
  3. YAML 내용: router rule = Host(trycloudflare-hostname), service = ol-{name}@docker
  4. stop() 시 YAML 삭제
- 수락기준:
  - [ ] Quick Share 활성화 시 /etc/traefik/dynamic/qs-{project}.yaml 생성
  - [ ] YAML에 Host rule이 TryCloudflare hostname으로 설정
  - [ ] YAML에 service가 ol-{name}@docker로 Docker Provider 서비스 참조
  - [ ] Quick Share 비활성화 시 YAML 삭제
  - [ ] Traefik이 1~2초 내 라우팅 반영/해제 확인
  - [ ] 기존 Internal 라우팅(sslip.io) 영향 없음 확인

### 2-2: Shared 모드 (접근 코드)

- AS-IS: visibility = 'internal' | 'quick-share' | 'production'
- TO-BE: visibility에 'shared' 추가. shared = quick-share + BasicAuth
- HOW:
  1. DB: projects 테이블에 access_code TEXT 컬럼 추가
  2. API: POST /projects/:id/share { accessCode: string } → shared 모드 활성화
  3. YAML에 BasicAuth 미들웨어 추가 (bcrypt 해시)
  4. API: DELETE /projects/:id/share → shared 해제 (quick-share로 복귀 또는 internal)
- UI/UX (디자이너 필수):
  - Share 버튼 + 접근 코드 입력 모달
  - 공유 링크 + 접근 코드 복사 버튼
  - Shared 상태 뱃지 (ProjectCard, ProjectDetail)
- 수락기준:
  - [ ] shared 모드 활성화 시 BasicAuth YAML 미들웨어 포함
  - [ ] 접근 코드 없이 TryCloudflare URL 접근 시 401
  - [ ] 접근 코드 입력 시 정상 접근
  - [ ] DB에 access_code 암호화 저장 (기존 crypto.ts 재사용)
  - [ ] UI에서 공유 링크 + 접근 코드 원클릭 복사

### 2-3: DEC-035 Single-Track 반영

- tunnel.ts 변경이 2-1에서 처리됨
- 기존 직접 연결 코드 제거
- 테스트 업데이트

## Phase 3: PR 프리뷰 (2~3일)

### 3-1: Webhook PR 이벤트 파싱

- AS-IS: webhook/index.ts가 push 이벤트만 처리
- TO-BE: pull_request 이벤트 (opened, synchronize, closed) 처리
- HOW:
  1. webhook/index.ts에 PR 이벤트 핸들러 추가
  2. PR opened/synchronize → 프리뷰 배포 트리거
  3. PR closed → 프리뷰 정리(cleanup)
- 수락기준:
  - [ ] GitHub/GitLab PR webhook 수신 및 파싱
  - [ ] PR 이벤트 타입별 분기 처리

### 3-2: DB 스키마 확장

- AS-IS: projects.name UNIQUE 제약 → PR별 프리뷰 프로젝트 이름 충돌
- TO-BE: name + source_type(main/preview) 복합 유니크 또는 프리뷰 네이밍 규칙
- HOW: 프리뷰 프로젝트 이름을 `{name}-pr-{number}`로 자동 생성
- 수락기준:
  - [ ] 같은 레포의 PR 여러 개가 동시에 프리뷰 가능
  - [ ] 프리뷰 프로젝트는 is_preview=true 플래그로 구분

### 3-3: 프리뷰 배포 파이프라인

- AS-IS: preview.ts (263줄) — 내부 URL만 생성, TryCloudflare 미연결
- TO-BE: preview.ts 확장 — Traefik File Provider로 프리뷰 URL 생성 + 선택적 외부 공유
- HOW:
  1. preview.ts의 기존 deploy() 활용 (git clone, docker build, docker run)
  2. File Provider YAML로 프리뷰 전용 라우팅 생성
  3. TTL 기반 자동 정리 (기존 로직 재사용)
  4. PR closed webhook → cleanup
- UI/UX (디자이너 필수):
  - PR 프리뷰 목록 (ProjectDetail 또는 별도 탭)
  - 프리뷰 URL 복사 버튼
  - TTL 잔여 시간 표시
  - PR 상태 뱃지 (open/merged/closed)
- 수락기준:
  - [ ] PR open → 프리뷰 자동 배포
  - [ ] PR 코드 업데이트(synchronize) → 프리뷰 자동 재배포
  - [ ] PR close → 프리뷰 자동 정리
  - [ ] 프리뷰 URL이 Traefik File Provider로 라우팅
  - [ ] TTL 만료 시 자동 정리

## 구현 순서

Phase 1 → Phase 2 → Phase 3 (순차, 각 Phase가 다음의 전제조건)

## 테스트 계획

### 단위 테스트

- Traefik YAML 생성/삭제 함수
- BasicAuth 해시 생성
- PR webhook 이벤트 파싱
- 프리뷰 프로젝트 네이밍

### 통합 테스트

- Quick Share → Traefik 경유 → 접근 확인
- Shared 모드 → BasicAuth 401/200
- PR webhook → 프리뷰 배포 → cleanup

### 도그푸딩 체크리스트

- [ ] 프로젝트 배포 → Quick Share → TryCloudflare URL로 접근 가능
- [ ] Shared 모드 → 접근 코드 없이 접근 불가
- [ ] 접근 코드 입력 → 정상 접근
- [ ] PR 생성 → 프리뷰 URL 자동 생성
- [ ] PR 머지 → 프리뷰 자동 정리

## i18n

- 신규 UI 텍스트: short labels는 영어 하드코딩, long sentences만 t()
- 번역 키 추가: shared, accessCode, preview, prPreview 등

## TL 리뷰 (2026-03-09)

### 구현 가능성 점검

- Phase 1: 구현 가능. `src/pipeline/traefik.ts`에서 Cmd/Bind/디렉토리 생성만으로 수용 가능.
- Phase 2: 구현 가능하나 파일 생성/삭제 타이밍과 실패 복구 정책을 더 구체화해야 안정적.
- Phase 3: 구현 가능. 다만 webhook 멱등성, PR 재동기화 시 재배포 경계조건 명시 필요.

### 누락/모호 항목 (필수 보완)

1. Traefik 볼륨 마운트 상세 부족
   - 현재 문서는 `/etc/traefik/dynamic/`만 언급하고 호스트 경로/권한/소유권 기준이 없음.
   - 제안: `~/.openlander/traefik/dynamic:/etc/traefik/dynamic/:rw`를 스펙에 고정하고, 시작 시 `mkdir -p` 보장 명시.

2. atomic write 구현 규칙 미정
   - `tmp → rename`만 있고 같은 디렉토리 내 rename, fsync 필요 여부, 파일명 규칙이 빠져 있음.
   - 제안: `writeFile(tmp, 0o600) -> rename(tmp, target)`를 같은 디렉토리에서 수행하고, 실패 시 tmp cleanup 규칙 명시.

3. bcrypt 라이브러리 선택 미정
   - BasicAuth 해시 생성에 어떤 패키지를 쓸지 미정이라 구현 편차 위험.
   - 제안: Node 환경 호환성/빌드 안정성 기준으로 `bcryptjs` 또는 `bcrypt` 중 하나를 명시(권장: 네이티브 빌드 의존성 없는 `bcryptjs`).

4. PR 프리뷰 YAML 생성/삭제 타이밍 불명확
   - opened/synchronize/closed 이벤트에서 "언제 생성, 언제 삭제, 재생성 시 기존 파일 처리"가 모호.
   - 제안: `opened|synchronize = upsert`, `closed = delete`, deploy 실패 시 파일 롤백(삭제) 규칙을 수락기준에 추가.

### 추가 위험 요소

- Traefik 파일 충돌: project/preview 파일명이 겹치면 라우팅 오염 가능 (`qs-{project}.yaml`, `pr-{project}-{number}.yaml` 네이밍 규칙 고정 필요).
- 고아 라우트: 앱/터널 종료 이벤트 누락 시 YAML 잔존 가능(주기적 GC 또는 startup reconcile 필요).
- 보안: access code 평문 저장 금지 기준은 있으나 전송/로그 마스킹 기준 미정(요청/응답/로그 레벨별 마스킹 규칙 필요).

### 수락기준 개선 제안

- Phase 1에 "호스트 동적 디렉토리 자동 생성" 체크박스 추가.
- Phase 2에 "YAML atomic write 실패 시 부분 파일 없음" 체크박스 추가.
- Phase 2에 "BasicAuth hash 생성 라이브러리/라운드 수 고정" 체크박스 추가.
- Phase 3에 "PR synchronize 재배포 시 기존 라우팅 원자적 교체" 체크박스 추가.
