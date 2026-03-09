# Quality Gate Skill — OpenLander 품질 검증 가이드

## When to Load This Skill

모든 구현 태스크 위임 시 `load_skills=["quality-gate"]`로 로드.

- 파이프라인/도구/DB 로직 구현
- UI/프론트엔드 컴포넌트 작업
- 테스트 작성

## 완료 판정 프로토콜

위임받은 태스크는 아래 **6단계를 전부** 통과해야 완료:

### Step 1: 수락기준 확인

- 프롬프트에 명시된 수락기준을 **하나씩** 체크
- 각 기준을 실제 코드에서 **라인 번호와 함께** 확인
- 하나라도 미충족이면 완료가 아님

### Step 2: lsp_diagnostics

- 변경한 파일 **전부** `lsp_diagnostics` 실행
- 에러 0이어야 함 (warning은 허용)
- 에러 있으면 고치고 다시 확인

### Step 3: bun run build

- `bun run build` 실행하여 타입 에러 없이 빌드 성공 확인
- exit code 0 필수

### Step 4: bun test

- `bun test` 전체 실행
- 0 failures 필수
- 기존 테스트가 깨졌으면 내가 깨뜨린 것 → 반드시 수정

### Step 5: 테스트 존재 확인

- 새 로직(hook, 유틸, 상태 관리)에 대응하는 테스트가 **존재**하는지 확인
- TUI 렌더링 자체는 테스트 어려우나, **상태 로직과 유틸리티 함수는 반드시 테스트**
- 테스트 없으면 작성

### Step 6: 결과 보고

완료 시 아래 형식으로 보고:

```
## 수락기준 검증
- [x] 기준1: 파일.tsx L42에서 확인
- [x] 기준2: 파일.tsx L78에서 확인
- [ ] 기준3: 미충족 — 이유: ...

## 검증 결과
- lsp_diagnostics: ✅ 에러 0 (파일1.tsx, 파일2.ts)
- bun run build: ✅ 성공
- bun test: ✅ N/N 통과
- 테스트 추가: ✅ test/파일.test.ts (M개 케이스)
```

## 금지 사항

- `as any`, `@ts-ignore`, `@ts-expect-error` — **절대 금지**
- 빈 catch 블록 `catch(e) {}` — 최소한 주석 필수
- 실패하는 테스트 삭제 — **절대 금지** (고쳐야 함)
- 기존 코드 스타일 무시 — `.js` 확장자 import, 기존 패턴 준수

## OpenLander 코드 컨벤션

- **Import**: `.js` 확장자 필수 (ESM)
- **타입**: strict mode — 타입 단언/무시 절대 금지
- **함수 추가**: 기존 모듈에 추가 우선, 새 파일은 정말 필요할 때만
- **함수 시그니처**: 기존 함수 변경 금지 → 새 함수 추가
- **테스트**: `test/[모듈명]/[파일명].test.ts` 경로

> 상세 패턴은 `codebase-guide` 스킬의 `references/codebase-patterns.md` 참조

## 참조 문서

| 문서                           | 용도                |
| ------------------------------ | ------------------- |
| `docs/planning/version-map.md` | 현재 버전/상태 파악 |
| `.opencode/instructions.md`    | 프로젝트 개발 규칙  |
