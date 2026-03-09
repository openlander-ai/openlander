# OpenLander — Project Instructions

> 이 파일은 매 세션 자동 로드됨. 모든 작업에 적용되는 필수 규칙.

## 0. 위임 라우팅 (MANDATORY)

각 category는 해당 도메인 최적 모델로 라우팅된다.

### 제품 관점

- 기획 시: "유저에게 마법의 순간이 있는가? 제품 정체성과 충돌하지 않는가?"
- 기술적 검증: "기존 패턴과 일관성 있는가? 사이드 이펙트는 없는가?"
- 제품 컨텍스트: `docs/planning/context/` 참조

### Category + Skill 조합

| 작업 유형                | category           | load_skills                        |
| ------------------------ | ------------------ | ---------------------------------- |
| UI/UX, 프론트엔드        | visual-engineering | ["quality-gate"]                   |
| 백엔드, 파이프라인, 로직 | deep               | ["codebase-guide", "quality-gate"] |
| 단순 수정, 타입 수정     | quick              | ["quality-gate"]                   |
| 5줄 이내 trivial         | 직접               | —                                  |

## 1. 작업 시작 전 (MANDATORY)

- `docs/planning/version-map.md`를 읽고 현재 버전/진행 상태 파악
- `docs/planning/v0.0.9/bugs.md`의 "활성 버그" 테이블 확인 — 미해결 버그 있으면 우선 처리
- 작업할 TASK-XX의 **수락기준 전부** 읽고 시작
- 스펙 문서(버전별 `docs/planning/v0.0.X/*.md`)의 해당 라인 참조

## 2. 구현 중

- `lsp_diagnostics` 수시 확인 (변경 파일)
- `as any`, `@ts-ignore`, `@ts-expect-error` 금지
- 빈 catch 블록 `catch(e) {}` 금지 (최소한 주석이라도)
- 기존 코드 스타일 따르기: theme.ts 색상, .js 확장자 import, SolidJS 패턴

## 3. 구현 후 검증 (하나라도 빠지면 미완료)

```
□ lsp_diagnostics: 변경 파일 전부 에러 0
□ bun run build: 성공 (exit code 0)
□ bun test: 전체 통과 (0 failures)
□ 스펙 크로스체크: 해당 스펙 문서 라인을 실제로 다시 읽고 구현 코드와 1:1 대조
□ 테스트 존재: 새 기능/로직에 대응하는 테스트 코드가 있는지 확인
□ 수락기준 전부 충족: TASK-XX의 체크박스를 하나씩 실제 코드로 검증
```

## 4. 완료 처리 (즉시, 배치 금지)

- 해당 태스크 문서에서 TASK 체크박스 업데이트
- 상태를 `완료`로 변경
- **다음 TASK로 넘어가기 전에** 반드시 파일 업데이트

## 5. 태스크 위임 시

- `load_skills=["quality-gate"]` **필수** (백엔드 작업이면 `codebase-guide`도 함께)
- 프롬프트에 해당 TASK의 **수락기준 전문**을 포함
- 위임 결과 받으면 수락기준 1:1 검증 후 승인/반려

## 6. 빼먹기 방지 체크리스트

구현 완료 후 스스로에게 묻기:

```
1. 스펙에서 이 기능이 영향주는 모든 모드(monitoring/deploying/debugging)를 다 처리했나?
2. StatusBar에 반영할 것은 없나?
3. compact 모드(배포 중 상단)에서의 동작도 확인했나?
4. 키보드 단축키가 overlayActive() 가드를 통과하나?
5. 포커스 상태(chat/status)에 따른 분기가 맞나?
```

## 7. TUI 작업 시

- TUI는 SolidJS + OpenTUI 기반. `src/tui/` 하위.
- 유효 요소: `<box>`, `<text>`, `<textarea>`, `<input>`, `<span>` 만 사용
- `useKeyboard`는 try-catch 필수 (오버레이 컴포넌트 제외)
- 색상은 `theme.ts`에서 import, hex 형식만

## 8. 커밋 규칙

- 유저가 명시적으로 요청할 때만 커밋
- `.env`, credentials 등 시크릿 파일 커밋 금지
- pre-commit hook 실패 시 amend 하지 말고 새 커밋

## 9. 버그 워크플로우 (MANDATORY)

사용자가 버그를 보고하면 ("안 돼", "이상해", "깨져" 등):

```
1. version-map.md에서 관련 버전/스펙 찾기
2. bugs.md "활성 버그" 테이블에 항목 추가 (BUG-NNN, 관련 태스크 ID 매핑)
3. GitHub Issue 생성:
   gh issue create --title "BUG-NNN: [설명]" --label "bug,[버전]" \
     --body "관련: TASK-XX | 스펙: [doc] L[line]\n\n재현: ...\n기대: ...\n실제: ..."
4. 버그 수정 완료 후:
   - bun run build + bun test 통과 확인
   - bugs.md: 활성 → 해결됨으로 이동, 상태 ✅
   - gh issue close [번호]
```

**버그 ID 규칙**: BUG-001 ~ BUG-999 (전체 순번, 버전 무관, 재사용 금지)
**GitHub Labels**: `bug` + 버전 태그(`v0.0.6`~`v0.0.10`) + `priority:high`/`priority:low`

## 10. 문서 체계 참조

```
docs/planning/
├── version-map.md              # SSOT — 전체 버전/스펙/상태 매핑
├── dev-lifecycle.md             # 11단계 개발 라이프사이클
├── requirements.md              # 전체 요구사항 (v0.0.1~v0.0.8)
│
├── context/                    # 제품 컨텍스트 (아키텍처, 경쟁 분석, 의사결정 로그)
│   ├── product-context.md
│   ├── architecture.md
│   ├── competitive.md
│   └── decision-log.md
│
├── v0.0.6/                      # ✅ 완료
│   ├── tasks.md
│   ├── tui-spec.md
│   └── ui-ux-build-compose.md
│
├── v0.0.7/                      # ✅ 완료
│   ├── implementation-tasks.md
│   ├── phase1-plan.md
│   └── ui-ux-layout.md
│
├── v0.0.8/                      # 📋 미착수
│   └── vercel-ai-sdk-migration.md
│
├── v0.0.9/                      # 🧪 도그푸딩 중
│   ├── server-awareness.md      # 스펙
│   ├── dogfooding.md            # 테스트 체크리스트
│   └── bugs.md                  # 버그 트래커
│
├── v0.0.10/                     # 📋 기획 완료
│   └── env-secrets.md
│
└── archive/                     # ⚠ 아카이브
    └── v0.0.9-10-unified-spec.md
```
