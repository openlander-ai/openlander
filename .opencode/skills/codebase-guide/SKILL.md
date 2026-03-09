# Codebase Guide — OpenLander 코드베이스 지식

## When to Load This Skill

백엔드/파이프라인/인프라 로직 구현 시 로드. 특히:

- 파이프라인 함수 추가/수정 (`src/pipeline/`)
- 도구 추가 (`src/tools/registry.ts`)
- DB 스키마/쿼리 변경 (`src/db/`)
- 테스트 작성 (`test/`)
- 기존 코드 패턴을 따라야 하는 모든 작업

**함께 로드**: `quality-gate` (필수)

---

## 코드 컨벤션 (MANDATORY)

### 언어 & 모듈

- TypeScript strict mode, ESM (`.js` 확장자 import)
- `as any`, `@ts-ignore`, `@ts-expect-error` → **절대 금지**
- 빈 catch `catch(e) {}` → **금지** (주석이라도)
- 기존 함수 시그니처 변경 금지 → 새 함수 추가

### 파일 배치

```
새 파이프라인 함수 → src/pipeline/[관련 파일].ts에 추가
새 도구           → src/tools/registry.ts의 tools 배열에 추가
새 상태           → src/tui/state/
새 테스트         → test/[모듈명]/[파일명].test.ts
```

### 도구 추가 시

- `src/tools/registry.ts`의 `tools` 배열에 추가
- `name`(snake_case), `description`, `parameters`, `execute`, `inputSchema` 전부 필요
- `targets` 필드로 TUI/MCP/Bot/API 노출 범위 지정
- MCP 서버에 자동 노출 (별도 작업 불필요)

### 함수 추가 시

- **기존 모듈에 추가 우선** — 새 파일은 정말 필요할 때만
- export 함수는 JSDoc 주석 필수
- 기존 함수 패턴 복사 → 필터/반환 타입 수정 → 기존 함수는 건드리지 않음

---

## 핵심 아키텍처 참조

### 배포 파이프라인

```
git.ts → auto-detect → docker.ts (build) → port.ts → docker.ts (run) → traefik.ts → health.ts
```

**원칙**: LLM은 대화/해석만. 배포 실행은 100% 결정론적 파이프라인.

### 4채널 구조

| 채널          | 위치                | 비고                   |
| ------------- | ------------------- | ---------------------- |
| Web Dashboard | `src/web/`          | React 19 + Vite        |
| MCP           | `src/mcp/server.ts` | 30개 도구 노출         |
| Bot           | `src/channels/`     | Slack/Discord/Telegram |
| REST API      | `src/web/`          | HTTP API               |

**새 기능 추가 시**: 4채널 중 어디에 영향을 주는지 확인.

---

## 위임 프롬프트 구조

하위 에이전트에게 위임할 때 **반드시** 포함:

```
1. TASK: 정확히 무엇을 하는가 (한 문장)
2. FILES: 수정할 파일 경로 (정확히)
3. ACCEPTANCE: 수락기준 (스펙에서 복사)
4. PATTERN: 기존 코드에서 참고할 패턴/파일
5. DO NOT: 하지 말 것
6. VERIFY: 완료 후 확인할 것 (build, test, diagnostics)
```

---

## Reference 파일

| 파일                              | 내용                                                |
| --------------------------------- | --------------------------------------------------- |
| `references/codebase-patterns.md` | 파이프라인/도구/TUI/테스트/DB 패턴 상세 + 코드 예시 |
| `references/workflow.md`          | 태스크 분해, 구현 루프, Phase 검증, 트러블슈팅 절차 |

---

## 금지 사항

- 스펙에 없는 기능 추가 (제안은 가능, 직접 구현 금지)
- 기존 함수 시그니처 변경 (하위 호환 깨짐)
- DB 스키마 변경 (스펙에 명시되지 않은 한)
- 테스트 삭제 (실패하면 고쳐야 함)
- `quality-gate` 스킬 없이 위임
