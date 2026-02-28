# OpenLander — Bug Tracker

> **용도**: 테스트 중 발견된 버그를 구조화하여 추적. AI 에이전트가 매 세션 참조.
> **동기화**: 각 버그는 GitHub Issues에도 등록됨 (Label: `bug` + 버전 태그).
> **SSOT**: GitHub Issues가 원본. 이 파일은 빠른 참조용 미러.

---

## 상태 범례

| 상태           | 의미                                 |
| -------------- | ------------------------------------ |
| 🔴 Open        | 발견됨, 미착수                       |
| 🟡 In Progress | 수정 중                              |
| ✅ Fixed       | 수정 완료 + 테스트 통과              |
| ⬜ Won't Fix   | 의도된 동작이거나 우선순위 낮아 보류 |

---

## 활성 버그

| ID  | 버전 | 관련 태스크 | 설명        | 상태 | GitHub Issue | 발견일 |
| --- | ---- | ----------- | ----------- | ---- | ------------ | ------ |
| —   | —    | —           | (버그 없음) | —    | —            | —      |

---

## 해결된 버그

| ID      | 버전   | 관련 태스크 | 설명                                        | 수정일     | GitHub Issue |
| ------- | ------ | ----------- | ------------------------------------------- | ---------- | ------------ |
| BUG-000 | v0.0.7 | TASK-16     | ChatPanel 스크롤 안 됨 → `<scrollbox>` 교체 | 2026-02-27 | —            |
| BUG-000 | v0.0.7 | TASK-16     | DashboardPanel System "Loading..." 멈춤     | 2026-02-27 | —            |
| BUG-000 | v0.0.7 | TASK-16     | DashboardPanel MCP Clients 섹션 제거        | 2026-02-27 | —            |
| BUG-000 | v0.0.7 | TASK-16     | DashboardPanel ProjectsSection 렌더링 버그  | 2026-02-27 | —            |

> 위 4건은 bugs.md 도입 전 발견/수정된 항목 (소급 기록). GitHub Issue 미등록.

---

## 워크플로우

### 사용자가 버그 보고 시 (AI 에이전트 프로토콜)

```
1. version-map.md에서 관련 버전/스펙 찾기
2. 이 파일(bugs.md) "활성 버그" 테이블에 항목 추가
   - ID: BUG-NNN (순번)
   - 관련 태스크: 가장 근접한 TASK-XX 또는 스펙 라인
3. GitHub Issue 생성:
   gh issue create \
     --title "BUG-NNN: [설명]" \
     --label "bug,[버전]" \
     --body "관련 태스크: TASK-XX\n스펙: [문서명] L[라인]\n\n[재현 방법]\n[기대 동작]\n[실제 동작]"
4. 해당 태스크 문서의 관련 항목 상태에 🐛 표시 (있다면)
5. 수정 완료 후:
   - bun run build + bun test 통과 확인
   - bugs.md: "활성 버그" → "해결된 버그"로 이동, 상태 ✅
   - GitHub Issue close: gh issue close [번호]
   - 태스크 문서 🐛 → ✅ 복원
```

### 버그 ID 규칙

- `BUG-001` ~ `BUG-999`
- 순번은 전체에서 유니크 (버전 무관)
- 한 번 부여된 ID는 재사용하지 않음
