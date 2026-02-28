# 개발 워크플로우 상세

> Tech Lead가 PM의 지시를 받고 구현을 완료할 때까지의 전체 흐름.

---

## 전체 흐름

```
PM 지시 수신
  ↓
[1] 컨텍스트 로드 (5분)
  ├─ version-map.md 읽기 (현재 상태)
  ├─ 해당 스펙 문서 전문 읽기
  ├─ bugs.md 확인 (활성 버그 있으면 우선)
  └─ instructions.md 확인 (개발 규칙)
  ↓
[2] 현재 코드 파악 (10분)
  ├─ 스펙에서 언급된 파일들 읽기
  ├─ 기존 패턴 파악 (유사 기능이 어떻게 구현되어 있는지)
  └─ 테스트 구조 확인 (기존 테스트가 어디에, 어떤 형태로)
  ↓
[3] 태스크 분해 → todo 생성
  ├─ 스펙의 기능(X-1, X-2, ...)을 atomic 태스크로
  ├─ 의존성 순서 결정
  ├─ 병렬 가능 태스크 식별
  └─ todo 도구로 등록 (즉시)
  ↓
[4] 구현 루프 (태스크당)
  ├─ todo 상태: in_progress
  ├─ 구현 (직접 또는 위임)
  ├─ lsp_diagnostics 확인
  ├─ todo 상태: completed
  └─ 다음 태스크로
  ↓
[5] Phase 검증
  ├─ bun run build
  ├─ bun test
  ├─ 수락기준 1:1 대조
  └─ 보고 작성
  ↓
[6] PM 보고
```

---

## [1] 컨텍스트 로드 상세

### 반드시 읽는 순서

```typescript
// 1. 전체 상태 파악
read('docs/planning/version-map.md');

// 2. 활성 버그 확인
read('docs/planning/v0.0.9/bugs.md');
// → 활성 버그 있으면: 스펙 작업 전에 버그부터 수정

// 3. 해당 버전 스펙
read('docs/planning/v0.0.9/server-awareness.md'); // 또는 해당 스펙

// 4. 개발 규칙
read('.opencode/instructions.md');
```

### PM 지시에서 추출할 것

PM이 "Phase 1부터 시작해"라고 하면:

- 어떤 Phase인지 (스펙 문서의 구현 순서 섹션 참조)
- 해당 Phase의 기능 번호 (예: 9-1, 9-2, 9-3)
- 제약 사항 ("기존 함수 수정하지 말 것" 등)
- 완료 기준 ("build + test 통과")

---

## [2] 현재 코드 파악 상세

### 스펙에서 파일을 찾는 방법

스펙 문서에는 보통 "변경 범위" 섹션이 있다:

```markdown
## 변경 범위

### 수정할 파일

| 파일                   | 변경 내용                     |
| ---------------------- | ----------------------------- |
| src/pipeline/docker.ts | listAllContainers() 함수 추가 |
```

이 파일들을 **전부** 읽는다. 부분이 아니라 전체.

### 기존 패턴 파악 요령

새 함수를 추가할 때, 같은 파일의 **기존 함수**를 먼저 본다:

```
"listAllContainers() 추가" → listManagedContainers() 코드를 먼저 읽기
"scanUsedPorts() 추가" → findAvailablePort() 코드를 먼저 읽기
"detectReverseProxy() 추가" → traefik.ts의 기존 함수들 먼저 읽기
```

기존 패턴을 따라야 할 것:

- 에러 처리 방식 (try-catch? Result 타입?)
- 로깅 (어떤 로거 사용? 레벨?)
- 반환 타입 (인터페이스 정의 위치?)
- async/await 패턴

---

## [3] 태스크 분해 규칙

### 좋은 태스크 vs 나쁜 태스크

```
❌ "서버 인식 기능 구현"
  → 너무 큰. 어디서 끝나는지 모름.

✅ "docker.ts에 listAllContainers() 함수 추가"
  → 파일 명확, 함수 명확, 완료 기준 명확.

❌ "테스트 작성"
  → 뭘 테스트? 어디에?

✅ "test/pipeline/docker.test.ts에 listAllContainers() 테스트 3케이스 추가"
  → 파일, 함수, 케이스 수 명확.
```

### 태스크 그룹핑

```
Phase 1:
  TASK-1: docker.ts에 listAllContainers() 추가
  TASK-2: docker.test.ts에 listAllContainers() 테스트
  TASK-3: port.ts에 scanUsedPorts() 추가
  TASK-4: port.test.ts에 scanUsedPorts() 테스트
  TASK-5: traefik.ts에 detectReverseProxy() 추가
  TASK-6: traefik.test.ts에 detectReverseProxy() 테스트
  → Phase 1 검증: build + test
```

---

## [4] 구현 시 체크

### 매 파일 수정 후

```
lsp_diagnostics → 에러 0 확인
```

### 매 태스크 완료 후

```
todo 상태 → completed (즉시, 배치 금지)
```

### 위임 시

```typescript
task(
  (category = 'quick'), // 또는 적절한 카테고리
  (load_skills = ['quality-gate']), // 필수
  // TUI 작업이면: load_skills=["quality-gate", "opentui"]
  (prompt = `
    1. TASK: DashboardPanel.tsx에 Server 섹션 추가
    2. FILES: src/tui/components/DashboardPanel.tsx
    3. ACCEPTANCE:
       - [ ] Server 섹션이 System 아래, Projects 위에 표시된다
       - [ ] 외부 컨테이너 없으면 "No external containers" 표시
       - [ ] 10개 초과 시 상위 5개 + "...and N more"
    4. PATTERN: 기존 ProjectsSection 컴포넌트 패턴 참고
    5. DO NOT: System 섹션이나 Projects 섹션 수정하지 말 것
    6. VERIFY: lsp_diagnostics 에러 0, bun run build 성공
  `),
);
```

---

## [5] Phase 검증 상세

### 빌드

```bash
bun run build
# exit code 0 필수
# 타입 에러 있으면 수정 후 재빌드
```

### 테스트

```bash
bun test
# 0 failures 필수
# 기존 테스트가 깨졌으면 → 내가 깨뜨린 거 확인 → 수정
# 신규 테스트 수 기록 (보고용)
```

### 수락기준 대조

스펙 문서의 수락기준을 **하나씩** 열고, 실제 코드 라인과 매칭:

```
스펙: "listAllContainers()가 라벨 필터 없이 모든 컨테이너를 반환한다"
  → docker.ts L235: docker.listContainers({ all: true }) — 필터 없음 ✓

스펙: "반환값에 managedByOpenLander: boolean 필드가 포함된다"
  → docker.ts L240: managedByOpenLander: c.Labels['openlander.managed'] === 'true' ✓
```

---

## 트러블슈팅

### 스펙이 모호할 때

PM에게 질문한다. 추측하지 않는다.

```
"스펙 9-2에서 OS 포트 스캔 시 sudo 권한이 필요할 수 있습니다.
 sudo 없이도 동작하는 방법(ss -tln)으로 가도 되는지 확인합니다."
```

### 기존 테스트가 깨질 때

1. 내 변경이 원인인지 확인 (git stash → bun test → 원래 깨져있었는지)
2. 내 변경이 원인이면 → 수정 (테스트 삭제 금지)
3. 원래 깨져있었으면 → PM에게 보고 (bugs.md에 추가)

### 빌드 실패 시

1. lsp_diagnostics로 에러 위치 확인
2. 타입 에러가 대부분 → 타입 수정
3. 3번 연속 실패하면 → 멈추고 원인 분석 (shotgun 금지)
