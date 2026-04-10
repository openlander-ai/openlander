# Open Questions

## ai-settings-architecture-fix - 2026-04-09

- [ ] `auto-recovery.ts` 도구명 → `ConfigurableRecoveryStep` 매핑에서, `create_deploy_plan`/`execute_deploy_plan`을 `apply_fixes`로 매핑하는 것이 적절한지 — 이 도구들은 수정 적용뿐 아니라 일반 배포에도 사용될 수 있음. 복구 컨텍스트에서만 매핑을 적용해야 하는지 확인 필요.

- [ ] "전체 자동" 마스터 토글을 글로벌 설정에 둘지, 프로젝트별 설정에 둘지 — 현재 API는 프로젝트별 override만 지원. 글로벌 "전체 자동"은 `ops.recovery.automation`의 4개 단계를 모두 `auto`로 설정하는 것인지, 별도 플래그인지 결정 필요.

- [ ] `ai.autoRecovery.enabled = false`이고 `ops.recovery.enabled = true`인 경우의 예상 동작 — AI 에이전트 없이 ops-recovery(recipe 기반)만 동작하는 것이 의도인지, 아니면 양쪽 모두 꺼져야 하는지 사용자 관점에서 확인 필요.

- [ ] 핫 리로드/재시작 구분 표시를 프론트엔드 하드코딩으로 할지 백엔드 `requiresRestart` 필드로 할지 — 하드코딩이 빠르지만 기능 추가 시 양쪽 수정 필요. 백엔드 필드가 정확하지만 추가 작업량 발생.

- [ ] `codingPlan`의 "Coming Soon" 처리에서, 토글 자체를 비활성화(disabled)할지 아니면 토글은 가능하되 배지만 표시할지 — 토글을 비활성화하면 config에 저장된 값과 불일치 발생 가능성 있음.
