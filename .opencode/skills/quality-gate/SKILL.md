# Quality Gate Skill — OpenLander 품질 검증 가이드

## When to Load This Skill

모든 구현 태스크 위임 시 `load_skills=["quality-gate"]`로 로드. 특히:

- TUI 컴포넌트 추가/수정
- Hook, IPC, 상태 관리 변경
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
- 기존 코드 스타일 무시 — theme.ts 색상, .js 확장자, SolidJS 패턴 준수

## OpenLander 코드 컨벤션

- **색상**: `theme.ts`에서 import. 하드코딩 금지. hex 형식만.
- **Import**: `.js` 확장자 필수 (ESM)
- **상태 관리**: module-level SolidJS signals (`src/tui/state/`)
- **키보드**: `useKeyboard`에서 `overlayActive()` + `focus()` 가드 필수
- **컴포넌트**: `<box>`, `<text>`, `<textarea>`, `<input>`, `<span>` 만 유효
- **Spinner**: `<text>` 안에서 `<Spinner />` 사용 (orphan text 방지)

## 참조 문서

| 문서                                             | 용도                           |
| ------------------------------------------------ | ------------------------------ |
| `docs/planning/ui-ux-layout.md`                  | UI/UX 스펙 (스펙 라인 참조 시) |
| `docs/planning/implementation-tasks.md`          | 태스크 목록 + 수락기준         |
| `.opencode/skills/opentui/SKILL.md`              | OpenTUI 개발 가이드            |
| `.opencode/skills/opentui/references/gotchas.md` | 주요 함정                      |
