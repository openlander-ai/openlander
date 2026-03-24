# OpenLander — 의사결정 히스토리

> 과거에 내린 결정과 그 이유. 새 세션에서 같은 실수를 반복하지 않기 위해.
> **반드시 결정 전에 이 문서를 검색하여 이미 논의된 주제인지 확인한다.**

---

## 형식

```
### DEC-NNN: [결정 제목]
**날짜**: YYYY-MM
**결정**: [채택한 방향]
**거부한 대안**: [거부한 방향]
**이유**: [왜 이렇게 결정했는지]
**재검토 조건**: [어떤 상황이 되면 다시 논의할지]
```

---

## v0.0.9 관련 결정

### DEC-001: Import 프로세스 제거

**날짜**: 2026-02  
**결정**: 외부 컨테이너를 DB에 등록하고 관리 전환하는 Import 기능을 v0.0.9에서 제거. 감지(observe)와 정보 표시만.  
**거부한 대안**: 기존 통합 기획서의 Import 프로세스 (DB 등록 → 모니터링 → 중지/재시작)  
**이유**:

- 외부 컨테이너를 "관리"하기 시작하면 사고 범위가 확대된다 (중지/재시작 시 문제 발생 가능성)
- 1인 메인테이너가 감당하기엔 복잡도가 너무 높다
- **핵심 가치는 "서버 상태를 아는 것"이지 "외부 컨테이너를 관리하는 것"이 아니다**
- 감지(observe)만으로도 포트 충돌 방지, 프롬프트 컨텍스트 주입 등 핵심 가치를 얻는다  
  **재검토 조건**: 사용자가 실제로 "외부 컨테이너 관리" 기능을 요청하는 피드백이 반복될 때

### DEC-002: coexist Traefik 모드 제거

**날짜**: 2026-02  
**결정**: Traefik 모드를 managed/external 2가지로 축소. coexist(별도 포트로 2번째 Traefik) 제거.  
**거부한 대안**: managed / external / coexist 3가지 모드  
**이유**:

- coexist 모드는 같은 서버에 Traefik 2개를 띄우는 것 → 혼란의 원인
- Nginx/Caddy 사용자는 어차피 수동 설정이 필요 (Traefik처럼 Docker 라벨 기반이 아님)
- 2개 모드만으로 대부분 시나리오 커버 가능  
  **재검토 조건**: Nginx/Caddy 사용자가 상당수이고 자동 연동 요구가 반복될 때

### DEC-003: 온보딩 대규모 개편 중지

**날짜**: 2026-02  
**결정**: 온보딩에 프록시 감지 정보만 추가. 환경 스캔 → Import 제안 플로우는 넣지 않음.  
**거부한 대안**: 기존 기획서의 온보딩 환경 스캔 (EnvironmentScan → Import 제안 → Traefik 모드 선택)  
**이유**:

- Import가 빠졌으니 Import 제안 자체가 불필요
- 온보딩은 최대한 가볍게. 빨리 사용할 수 있게.
- 프록시 감지는 Traefik 모드 결정에 필요하니 최소한으로 추가  
  **재검토 조건**: Import 기능이 추가되거나, 온보딩 이탈률이 높을 때

---

## v0.0.10 관련 결정

### DEC-004: Local Dev Mode 전면 제거

**날짜**: 2026-02  
**결정**: v0.0.10에서 Local Dev Mode를 완전히 제거. 환경변수/시크릿 관리만 남김.  
**거부한 대안**: 기존 기획서의 Local Dev Mode (의존성 인프라 자동 실행, .env 생성, 다른 팀 서비스 로컬 실행 등)  
**이유**:

- OpenLander의 핵심 정체성은 "배포 에이전트"이지 "로컬 개발 환경 도구"가 아니다
- docker-compose가 이미 이 역할을 잘 하고 있다. 대체할 이유가 약함.
- 스코프 폭발 — 시나리오 5개(통합 기획서 Part 3)를 구현하면 2-3주 이상 소요
- 사용자 피드백이 전혀 없는 상태에서 큰 기능을 넣는 건 위험  
  **재검토 조건**: 출시 후 사용자가 "로컬 개발 지원" 기능을 요청할 때. 또는 경쟁사가 이 기능으로 차별화할 때.

### DEC-005: User Overrides (3단계 스코프 → 2단계) 축소

**날짜**: 2026-02  
**결정**: 환경변수 스코프를 Global + Project 2단계로 축소. User Overrides 제거.  
**거부한 대안**: Global → Project → User 3단계 스코프  
**이유**:

- User Overrides는 Local Dev Mode에서 주로 사용 (개발자별 DEBUG=true 등)
- Local Dev Mode가 빠졌으니 User Overrides의 주요 사용처도 없어짐
- 2단계면 배포 시나리오에 충분  
  **재검토 조건**: Local Dev Mode 도입 시 함께 재검토

---

## 로드맵 관련 결정

### DEC-006: v0.0.8 AI SDK 마이그레이션 연기

**날짜**: 2026-02  
**결정**: v0.0.8 (Vercel AI SDK 마이그레이션)을 v0.0.9, v0.0.10 뒤로 연기.  
**거부한 대안**: 원래 순서대로 v0.0.8 → v0.0.9 → v0.0.10  
**이유**:

- AI SDK 마이그레이션은 **내부 품질 개선**이지 사용자에게 보이는 가치가 없다
- v0.0.9 Server Awareness가 제품 핵심 가치와 직결된다 → 먼저 해야 함
- 현재 5개 LLM 프로바이더가 문제 없이 동작 중 → 마이그레이션 긴급하지 않음  
  **재검토 조건**: LLM 프로바이더 추가/변경이 잦아져서 자체 추상화 유지보수가 부담될 때

### DEC-007: v0.0.9 이름 변경 (Migration & Discovery → Server Awareness)

**날짜**: 2026-02  
**결정**: v0.0.9 이름을 "기존 인프라 마이그레이션 & 디스커버리" → "Server Awareness"로 변경.  
**거부한 대안**: 기존 이름 유지  
**이유**:

- "Migration"은 Import 기능을 내포 → Import를 뺐으니 이름이 안 맞음
- "Server Awareness"가 핵심 가치를 정확히 표현 → "서버 상태를 아는 배포 에이전트"
- 마케팅/커뮤니케이션에서도 더 명확  
  **재검토 조건**: 해당 없음 (확정)

---

## 제품 방향 결정

### DEC-008: 1차 타겟을 DevOps로 재정의

**날짜**: 2026-02  
**결정**: 1차 타겟을 "배포 모르는 초보자" → "배포 볼륨에 압도당하는 DevOps/백엔드 엔지니어"로 전환.  
**거부한 대안**: "누구나 배포할 수 있게" 포지셔닝 (README의 원래 방향)  
**이유**:

- "초보자도 배포"는 사이드 베네핏이지 핵심 가치가 아니다
- DevOps 엔지니어가 느끼는 고통이 더 크고 구체적 (배포 요청 폭증, 에이전트 충돌)
- MCP 통합의 진정한 가치는 DevOps가 체감 (코딩 에이전트가 서버에서 루프 도는 문제)
- DevOps가 도입하면 팀원(초보자)도 자연스럽게 사용 → 양방향 성장  
  **재검토 조건**: 출시 후 실제 사용자 분포를 보고 조정

### DEC-009: 제품 정체성 확정

**날짜**: 2026-02  
**결정**: "서버 상태를 아는 배포 에이전트" (The deployment agent that knows the server state)  
**거부한 대안**:

- "채팅으로 배포하는 AI" → 너무 generic
- "Self-hosted Vercel alternative" → Vercel과 직접 비교되면 불리
- "AI DevOps assistant" → 범위가 너무 넓음  
  **이유**:
- "서버 상태를 아는"이 핵심 차별점 (다른 배포 도구는 이것이 없음)
- 코딩 에이전트의 핵심 문제(서버 상태 모름)를 직접 해결하는 표현
- 간결하고 기억하기 쉬움  
  **재검토 조건**: 해당 없음 (확정)

---

## 기술 결정

### DEC-010: 기존 unified spec 아카이브 (삭제 안 함)

**날짜**: 2026-02  
**결정**: `v0.0.9-10-unified-spec.md`를 삭제하지 않고 `docs/planning/archive/`로 이동하여 아카이브로 유지.  
**이유**:

- 새 스펙 문서(v0.0.9/server-awareness.md, v0.0.10/env-secrets.md)에서 "제거된 항목" 참조
- Local Dev Mode 등 보류된 기능의 상세 기획이 남아있어 추후 재활용 가능
- 의사결정 맥락 보존  
  **재검토 조건**: 해당 없음

---

### DEC-011: v0.0.11 Agent Proactivity 신설 + 우선순위 제안

**날짜**: 2026-02  
**결정**: v0.0.11을 "에이전트 능동성"으로 신설. v0.0.10(환경변수)보다 먼저 진행을 **권장** (최종 결정은 User).  
**거부한 대안**:

- v0.0.10에 함께 넣기 — 도메인이 완전히 다름 (env 관리 vs 에이전트 행동). 버전 혼재 방지.
- v0.0.10 후에 진행 — 가능하지만, 제품 정체성 강화가 늦어짐  
  **이유**:

- User가 "별거 안 만드는 것 같다"는 위축감을 발화점으로 식별한 갭. 핸심은 "이건 AI다" 순간의 부재.
- v0.0.9의 서버 인식 기반(listAllContainers, scanUsedPorts 등)이 이미 구축됨 → 데이터 소스 준비 완료
- 경쟁사(Coolify/Dokploy)에는 AI가 전혀 없음 → 능동적 AI는 추격 불가능한 차별점
- Post-Deploy Insight(11-1) 하나만으로도 체감 효과 큼  
  **재검토 조건**: v0.0.9 도그푸딩 결과 환경변수 관리가 더 시급한 문제로 드러날 때

### DEC-012: TUI 팝업 온보딩 → CLI 온보딩으로 전환

**날짜**: 2026-02  
**결정**: 기존 TUI 팝업 마법사 형식 온보딩을 CLI 스타일(@inquirer/prompts)로 전환. Docker → LLM(BYOK) → Git(OAuth/SSH/Skip) 3단계.  
**거부한 대안**:

- TUI 팝업 유지 + 버그 수정 — OpenTUI 렌더링 문제가 근본적이라 수정 비용 높음
- 풀스크린 TUI 마법사 — OpenTUI 환경에서 레이아웃 안정성 보장 어려움  
  **이유**:

- 도그푸딩 중 온보딩이 아예 작동하지 않음 (Enter/Esc 미응답, 렌더링 깨짐)
- 온보딩은 1회성 설정 — 화려한 TUI가 필요 없음
- CLI 스타일이 더 안정적이고, 테스트 용이하고, Docker CLI 온보딩(`src/cli/onboard.ts`)과 일관성 유지
- 온보딩 완료 후 TUI 진입 — TUI는 일상 사용에만 집중  
  **재검토 조건**: OpenTUI가 성숙하여 팝업/모달 렌더링이 안정적일 때

### DEC-013: Provider OAuth를 v0.0.12로 별도 버전 분리

**날짜**: 2026-02  
**결정**: LLM 프로바이더 OAuth 인증(OpenAI/Anthropic/OpenRouter/Google)을 v0.0.12로 별도 버전 신설. v0.0.9 온보딩은 BYOK(API 키 수동 입력)만.  
**거부한 대안**:

- v0.0.9 온보딩에 함께 구현 — 스코프 폭발, 온보딩 배포 지연
- OAuth 없이 진행 — 사용자 UX가 떨어지지만, BYOK만으로도 기능적으로 충분  
  **이유**:

- 도그푸딩 차단 방지: v0.0.9 온보딩이 먼저 안정적으로 동작해야 함
- Provider OAuth는 각 프로바이더별 별도 연동 필요 (Client ID, 엔드포인트, 토큰 플로우가 모두 다름)
- BYOK가 베이스라인으로 존재하는 상태에서 OAuth를 덧붙이는 구조가 더 깨끗함
- 각 프로바이더 OAuth 구현을 점진적으로 추가 가능 (OpenAI 먼저 → 나머지)  
  **재검토 조건**: BYOK만으로 온보딩 이탈률이 높을 때 — OAuth를 v0.0.9에 통합 검토

### DEC-014: v0.0.11 90% 완료 시점에서 클로즈

**날짜**: 2026-03
**결정**: v0.0.11 Agent Proactivity를 90% 완료 상태로 클로즈. 미체크 3건(외부 컨테이너 추가/제거 감지, 프로젝트별 Timeline 이상징후, 통합 테스트)은 nice-to-have/stretch로 이관.
**거부한 대안**: 3건 모두 완료 후 클로즈
**이유**:

- 핵심 3개 Phase(Post-Deploy Insight, Smart Defaults, Anomaly Nudge) 모두 구현 완료
- 남은 3건은 핵심 UX에 영향이 거의 없는 부가 기능
- 도그푸딩/안정화가 더 시급 — 새 기능보다 기존 기능의 품질이 우선
- 1인 메인테이너 리소스 제약 — 완벽주의보다 실용적 클로즈가 나음
  **재검토 조건**: 사용자가 해당 기능을 명시적으로 요청할 때

### DEC-015: 도그푸딩/안정화 우선순위 (새 기능 구현보다 우선)

**날짜**: 2026-03
**결정**: v0.0.11 이후 새 기능 구현(v0.0.10/v0.0.12 등)보다 도그푸딩 & 안정화를 우선한다.
**거부한 대안**: 바로 v0.0.10(Env & Secrets) 또는 v0.0.12(Provider OAuth) 진행
**이유**:

- v0.0.9 + v0.1.0 + v0.0.11 — 3개 버전이 연속 출시됐지만 실사용 검증이 부족
- 도그푸딩 첫 사이클에서 이미 blocking 버그 2건 발견 (WEB_DIST 경로, React #310 크래시)
- 기존 스펙(v0.0.10, v0.0.12)은 TUI 시대 기획 — Web 전환 후 재작성 필요
- 제품 품질이 신뢰 가능한 수준에 도달해야 다음 기능이 의미가 있음
  **재검토 조건**: 도그푸딩에서 critical/blocking 버그가 없고, 핵심 플로우가 안정적일 때

---

### DEC-016: 도그푸딩 완료 선언 — 다음 버전 진행 가능

**날짜**: 2026-03
**결정**: DEC-015(도그푸딩 우선) 재검토 조건 충족. 도그푸딩 완료 선언, 다음 버전 진행 가능.
**근거**:

- E2E 배포 파이프라인 전체 검증 완료 (Chat→Agent→Clone→Build→Container→URL 접속)
- blocking 버그 3건 해결 (BUG-001, 002, 011)
- major 버그 3건 해결 (BUG-010, 012, 013)
- minor 버그 5건 해결 (BUG-003~007)
- 미해결 2건은 minor (BUG-008 미재현, BUG-009 결정대기) — 다음 버전 이관 가능
- traefik/whoami 실제 배포 성공 확인 (Traefik 라우팅 + 직접 포트 접속 모두 정상)
  **재검토 조건**: 새 버전 개발 중 regression 발견 시 도그푸딩 재개

### DEC-017: Web 온보딩 채택, CLI 온보딩 스펙 보류

**날짜**: 2026-03
**결정**: Web Setup Screen(`/setup`)을 공식 온보딩으로 채택. CLI 온보딩 스펙(`v0.0.9/onboarding-refactor.md`)은 보류.
**거부한 대안**: CLI `@inquirer/prompts` 기반 온보딩 구현 (onboarding-refactor.md)
**이유**:

- User가 CLI를 쓰지 않을 것으로 판단 ("cli는 안쓸거같은데..")
- Web Setup Screen이 이미 ~90% 구현됨 (SetupScreen.tsx 586줄, setup-routes.ts 284줄)
- LLM 설정 시 hot-reload 지원 (서버 재시작 불필요) — CLI에는 없는 장점
- Docker 설치 가이드, GitHub 토큰 검증 등 CLI 스펙의 모든 기능이 Web에 이미 있음
- 부족했던 부분(자동 리디렉트)은 SetupGuard 컴포넌트로 해결 (~20줄)
  **재검토 조건**: CLI-only 사용자가 실제로 필요해질 때 (npm global 설치 후 브라우저 없는 환경)

### DEC-018: v0.0.10 Web UI 적용 (TUI /env 오버레이 → Web Settings Global Secrets)

**날짜**: 2026-03
**결정**: v0.0.10 스펙의 10-4(TUI /env 오버레이 확장)를 Web Settings 페이지 Global Secrets 섹션으로 대체 구현.
**거부한 대안**: TUI /env 오버레이에 Global Secrets 탭 추가 (원래 스펙)
**이유**:

- DEC-017에서 CLI/TUI를 쓰지 않기로 결정, v0.1.0에서 Web으로 pivot 완료
- Web Settings 페이지가 이미 AI Model/GitHub/System Stats 섹션 보유 — Global Secrets 추가가 자연스러움
- TUI는 `tui-last` 태그로 freeze 상태 (v0.1.0 결정)
- .env.example 감지(`checkEnvRequirements()`)는 함수만 구현, 파이프라인 통합은 향후 진행 — QuestionBridge 통합 또는 Post-Deploy Insight 경고로 제공 가능
  **재검토 조건**: TUI 부활 또는 .env.example 감지의 파이프라인 통합이 필요해질 때

### DEC-019: TUI 시대 문서 전체 아카이브

**날짜**: 2026-03
**결정**: v0.0.6(파일 3개), v0.0.7(파일 3개), analysis(파일 2개), onboarding-refactor.md, requirements.md → `docs/planning/archive/`로 이동.
**거부한 대안**: 개별 수정 (문서별 TUI→Web 참조 교체) — 19건+ TUI 참조, 공수 대비 가치 낮음
**이유**:

- TUI freeze (태그 `tui-last`, v0.1.0 결정) 후 TUI 관련 스펙은 역사적 참조 외 활용 가치 없음
- requirements.md는 TUI가 메인 인터페이스로 전제된 문서 — 19건의 TUI 참조 개별 수정 비효율
- version-map.md가 이미 SSOT 역할을 하고 있어 requirements.md 삭제해도 정보 손실 없음
- README.md 현행화 완료 (TUI→Web UI, 로드맵 전체 업데이트)
  **아카이브 파일 목록**: archive/v0.0.6/(3), archive/v0.0.7/(3), archive/analysis/(2), archive/onboarding-refactor.md, archive/requirements.md
  **재검토 조건**: TUI 부활 또는 아카이브 문서 삭제 검토 시

### DEC-020: v0.0.12 Provider OAuth를 Web 기준으로 전면 재작성

**날짜**: 2026-03
**결정**: v0.0.12 스펙을 CLI 기준에서 Web 기준으로 전면 재작성. 온보딩(SetupScreen) + Settings 통합. 토큰 저장을 파일에서 DB 암호화로 변경.
**거부한 대안**: CLI 기준 스펙 유지 후 구현 시점에 Web 적응 — 스펙과 구현의 괴리가 커질 위험
**이유**:

- DEC-017(Web 온보딩 채택), DEC-018(Web Settings 적용) 이후 CLI 기반 스펙은 전제가 무효
- 임시 HTTP 서버 스폰 → Hono 라우트로 대체 (기존 서버 활용, 아키텍처 간소화)
- `auth-tokens.json` 파일 → DB `provider_auth` 테이블 (v0.0.10 `global_secrets`와 동일 암호화 패턴 재사용)
- 웹은 OAuth의 자연스러운 환경 — 팝업 플로우가 CLI보다 깔끔
- SSH/원격 fallback 불필요 (웹 = 브라우저 항상 존재)
- 구현 순서 변경: OpenRouter를 OpenAI보다 먼저 (callback_url 동적 → redirect URI 이슈 없음 → 인프라 검증에 적합)
  **재검토 조건**: 해당 없음 (확정)

### DEC-021: v0.0.8 AI SDK 마이그레이션 착수

**날짜**: 2026-03  
**결정**: v0.0.8 (Vercel AI SDK 마이그레이션) 구현 착수. 정식 릴리즈 전 마지막 마일스톤.  
**선행 결정**: DEC-006 (v0.0.8 연기) — 연기 해제  
**이유**:

- v0.0.1~v0.0.12까지 모든 사용자향 기능 완료. v0.0.8만 미착수.
- 5개 프로바이더 파일 (~990줄)을 AI SDK 패키지로 대체하면 유지보수 부담 대폭 감소
- Zod 스키마 변환으로 31개 도구의 타입 안전성 + 런타임 검증 확보
- AI SDK `streamText()`로 토큰 레벨 스트리밍 획득 (현재 없음)
- 새 프로바이더 추가 시 패키지 설치 + 레지스트리 한 줄 → 현재는 ~200줄 보일러플레이트  
  **재검토 조건**: 해당 없음 (실행 단계 진입)

### DEC-022: Web 배포를 에이전트 경유로 변경

**날짜**: 2026-03  
**결정**: Web UI의 "Deploy" 클릭 시 파이프라인 직접 호출(`POST /api/deploy/start` → `pipeline.startDeploy()`)을 폐지하고, 에이전트를 경유하도록 변경.  
**거부한 대안**: 파이프라인 직접 호출 유지 (현재 구현) — "Fix with AI" 버튼으로 사후 대응  
**이유**:

- 아키텍처 정의(requirements.md, product-context.md)에서 모든 채널이 에이전트를 경유하도록 설계됨. Web만 예외를 둘 근거 없음.
- Web MVP 한줄정의 자체가 "Agent handles everything in background" — 에이전트 경유가 원래 의도.
- 에이전트 미경유로 인해 `debug_build_error`, Smart Defaults, `ask_user_question` 등 핵심 기능이 Web 배포에서 동작하지 않는 상태.
- 핵심 원칙("LLM은 대화/해석/설명만, 실행은 deterministic")과 충돌 없음 — 에이전트가 배포를 "결정"하는 게 아니라 사용자 클릭으로 시작된 배포를 "수행"하는 것.
- 기존 `chatStream` 인프라 재사용 가능 — 새 엔드포인트 불필요, 구현 공수 제한적.

**원칙 보완 필요**: `agent-proactivity.md`의 "에이전트는 제안만 한다"는 자율 실행(에이전트가 스스로 배포 시작) 금지 원칙이지, 사용자가 시작한 배포를 에이전트가 수행하는 것까지 금지하는 것이 아님. 스펙에서 명확화 필요.  
**관련 결정**: DEC-001 (Import 제거 — 감지만), v0.1.0 Web MVP 스펙  
**재검토 조건**: 에이전트 경유로 인한 LLM 비용/지연이 사용자 경험을 심각히 저하할 때 (e.g. 무료 티어 사용자 rate limit 충돌)

### DEC-023: 제품 방향 전환 — 대시보드 퍼스트, AI 어시스트

**날짜**: 2026-03  
**결정**: 제품 정체성을 "서버 상태를 아는 배포 에이전트" (chat-first) → "실패를 스스로 고치는 셀프호스트 배포 플랫폼" (dashboard-first, AI-assist)으로 전환.  
**거부한 대안**: 채팅 인터페이스 유지 + 대시보드 보조  
**이유**:

- 채팅이 메인 인터페이스인 구조는 배포 상태 확인, 히스토리 조회 등 반복 작업에 비효율적
- Vercel처럼 대시보드가 메인이고 AI는 실패 시 자동 분석/수정으로 개입하는 구조가 사용자 경험에 적합
- 경쟁 포지셔닝: "Coolify의 Docker 기반 + Vercel의 깔끔한 UX + AI 자동 수정"
- 채팅 제거로 프론트엔드 복잡도 대폭 감소 — 1인 메인테이너에게 유리
- AI 차별점은 유지: 빌드 실패 분석, 런타임 크래시 감지/자동 수정, Smart Defaults
- MCP 통합은 그대로 유효 (코딩 에이전트 연동)

**DEC-009 UPDATE**: 제품 정체성 "서버 상태를 아는 배포 에이전트" → "실패를 스스로 고치는 셀프호스트 배포 플랫폼"으로 변경. 서버 인식은 여전히 핵심 역량이지만 사용자에게 노출되는 방식이 채팅→대시보드로 전환.  
**DEC-022 UPDATE**: 에이전트 경유 배포 방식 유지하되, 채팅 UI 없이 백그라운드 동작. Deploy 클릭 → 에이전트 백그라운드 실행 → 빌드 로그 스트리밍 → 실패 시 AI 분석 결과를 배포 상세 페이지에 표시.  
**DEC-023 UPDATE (2026-03-09)**: 제품 정체성을 "실패를 스스로 고치는 셀프호스트 배포 플랫폼"에서 **"AI와 함께 배포하는 셀프호스트 플랫폼"**으로 재정의한다.  
현재 위치는 "쉽고 빠르게 배포 + AI 자동 복구", 목표는 "쿨리파이만큼 완벽한 오픈소스"로 명확화한다. AI는 에러 순간에만 등장하는 보조가 아니라, 배포 라이프사이클 전체에 자연스럽게 공존한다.  
타겟은 MVP/데모 사용자가 빠르게 시작하고, 서비스가 성장하면 운영까지 이어지는 연속 사용자 여정으로 재정의한다. MCP 통합은 코딩 에이전트와 직접 연결되는 핵심 차별점으로 유지한다.  
**재검토 조건**: 사용자가 채팅 인터페이스를 명시적으로 요청할 때. 또는 AI 어시스트 방식이 충분히 가치를 전달하지 못할 때.

### DEC-024: UI/UX — 라이트 모드 + 클린 디자인

**날짜**: 2026-03  
**결정**: 현재 다크 only "Cyber-Industrial" 디자인을 폐기하고, 라이트 모드 only + Vercel-inspired 클린 디자인으로 전환.  
**거부한 대안**:

- 다크 모드 개선 (Cyber 감성 제거만) — 라이트로 전환이 더 Vercel-like
- 라이트+다크 토글 — 1인 메인테이너 공수 2배, MVP에서 불필요  
  **이유**:

- 현재 디자인(`--bg-app: #050505`, glow, scanline)이 "해커 터미널" 감성 → 프로페셔널 배포 플랫폼과 괴리
- 라이트 모드가 Vercel의 기본이며 대시보드 가독성에 유리
- 하나의 테마만 관리 → 1인 메인테이너 유지보수 최소화

**제거**: scanline, grid-pattern, glow effects, progress-stripes, Cyber-Industrial 전체  
**유지**: card-hover, timeline-slide-in, 서체(Outfit/Manrope/JetBrains Mono)  
**재검토 조건**: 사용자 피드백으로 다크 모드 요청이 반복될 때

### DEC-025: Dashboard MVP 스코프

**날짜**: 2026-03  
**결정**: Dashboard 리디자인 MVP 스코프 확정.  
**포함**:

1. 프로젝트 생성: Git URL 직접 입력 (기존 방식 유지)
2. 자동 배포: git push → auto deploy (백엔드 v0.0.2에서 구현 완료, UI 연결)
3. 레이아웃: 2컬럼 (사이드바 + 메인), 채팅 전면 제거
4. 프로젝트 상세: Overview + Deployments(히스토리) + Domains + Environment + Settings 탭
5. 배포 상세: 빌드 로그 스트리밍 + AI 분석 결과 표시
6. 에이전트: 백그라운드 동작, UI에 채팅으로 노출 안 됨. 실패 시에만 AI 분석 표시.

**제외 (MVP 이후)**:

1. GitHub 연동 repo 목록 선택 — Git URL이 GitHub/GitLab/Bitbucket/Gitea 전부 커버. 벤더 비종속 유지.
2. PR별 프리뷰 배포 — 스코프 폭발. 1인 메인테이너 2주 안에 구현 불가.
3. 다크 모드 — DEC-024에서 라이트 only 결정.

**재검토 조건**: MVP 출시 후 사용자 피드백에 따라 우선순위 재평가

### DEC-026: 자동 복구 (Auto-Recovery) 도입 — Fix with AI 버튼 제거

**날짜**: 2026-03  
**결정**: 배포 실패 시 사용자가 "Fix with AI" 버튼을 누르는 방식을 폐지. `deploy:failed`/`compose:failed` 이벤트 발생 시 AI 에이전트가 **자동으로** 에러 분석 → 사용자 질문 → 환경변수 설정 → 재배포를 수행.  
**거부한 대안**: Fix with AI 버튼 유지 (manual trigger) — 코딩 에이전트처럼 자동으로 루프 도는 방식이 제품 정체성(DEC-023)에 더 부합.  
**이유**:

- DEC-023의 "실패를 스스로 고치는 플랫폼"이 실제로 동작하려면 사용자 개입 최소화가 필수
- 코딩 에이전트(Cursor, Claude Code)는 이미 이 패턴: 에러 → 자동 분석 → 수정 → 재시도. 배포도 동일해야 일관성 있음
- Fix with AI 버튼은 "사용자가 에러를 읽고 버튼을 누르는" 단계를 요구 — 비개발자 타겟에 장벽
- 안전장치 충분: 최대 3회 재시도, 동일 에러 반복 감지, 인프라 에러(Docker daemon 등) 스킵
- E2E 검증 완료: summary-god monorepo compose — 11개 env 누락 → 자동 복구 → 질문 → 응답 → 재배포 → running

**DEC-022 UPDATE**: 에이전트 경유 배포가 성공을 넘어 실패 복구까지 확장됨. 사용자 클릭 → 에이전트 배포 → 실패 시 에이전트 자동 복구.  
**재검토 조건**: LLM 비용이 문제될 때 (무료 티어 rate limit 충돌), 또는 자동 복구가 오히려 상황을 악화시키는 케이스 발견 시

### DEC-027: 질문 UX 변경 — 선택지 제거, 자유 텍스트 입력으로 통일

**날짜**: 2026-03  
**결정**: 에이전트 `ask_user_question`의 options를 항상 `[]` (빈 배열)로 강제. "Enter secrets" / "Cancel deployment" 같은 선택지 제거.  
**거부한 대안**: 선택지 버튼 ("Enter secrets", "Cancel") 유지  
**이유**:

- env 값을 입력해야 하는 상황에서 "Enter secrets" 버튼은 의미 불명 — 눌러서 달라지는 게 없음
- 선택지가 있으면 사용자가 "Cancel"을 눌러 복구 흐름 자체를 차단할 수 있음
- KEY=VALUE 자유 텍스트 입력이 가장 직관적 — 사용자가 .env 파일 내용을 그대로 붙여넣을 수 있음
- 모든 누락 env 변수를 하나의 질문으로 합침 — 여러 질문 순차 전송 방지

**재검토 조건**: 사용자가 선택지 기반 UX를 원할 때 (e.g. 프리셋 env 목록에서 체크박스 선택)

### DEC-028: v0.2.5 스코프 축소 — 공유 서비스만 구현, 나머지 스킵

**날짜**: 2026-03
**결정**: v0.2.5 전체 스코프(프리뷰 배포 UI, DB 프로비저닝 UI, DB 백업)를 스킵하고, 공유 서비스(단일 Docker 이미지 실행) 기능만 구현. 그 후 품질 게이트(Q-1/Q-2/Q-3) → 정식 릴리즈.
**거부한 대안**: v0.2.5 전체 구현 (3개 Phase 모두)
**이유**:

- 1인 메인테이너 — 정식 릴리즈까지 거리를 줄여야 함
- 프리뷰 배포는 현재 사용률 낮음, DB 백업은 S3 의존성 추가 필요
- 공유 서비스는 실제 사용 가치 높음 — MySQL, Redis 등 여러 프로젝트가 공유하는 인프라

**재검토 조건**: 정식 릴리즈 후 사용자 피드백에서 프리뷰 배포/DB 백업 요청 반복 시

### DEC-029: 공유 서비스 — 범용 Docker 이미지 러너 (템플릿은 편의기능)

**날짜**: 2026-03
**결정**: 공유 서비스를 4개 DB 타입 고정이 아닌, 아무 Docker 이미지나 실행할 수 있는 범용 시스템으로 구현. 템플릿(PostgreSQL/MySQL/Redis/MongoDB)은 편의기능(원클릭 자동 채움)으로 유지.
**거부한 대안**: 4개 DB 타입만 지원하는 고정 시스템
**이유**:

- PM: "그거는 예시고, litellm, opik 등 수 많은 도커 이미지를 가져다 쓸 수 있어야 한다"
- 구현이 오히려 더 단순해짐 — type enum 제약 없이 image + port + env vars 받으면 됨
- 경쟁 차별점 — Coolify/Dokploy는 이미 DB 템플릿 제공. 범용이 더 가치 있음

**재검토 조건**: 없음 (범용이 고정보다 항상 우월)

### DEC-030: 공유 서비스 — 단일 이미지만 (Compose 미지원)

**날짜**: 2026-03
**결정**: 공유 서비스는 단일 Docker 이미지 실행만 지원. docker-compose 지원은 안 넣음.
**거부한 대안**: docker-compose 기반 서비스 스택 지원
**이유**:

- 90% 이상의 실사용 케이스가 단일 이미지로 커버됨 (litellm, opik, n8n, minio, DB류 모두)
- compose가 필요한 케이스는 서비스 여러 개 따로 띄우고 env var로 연결하면 됨 (프로덕션 정석)
- OpenLander에 이미 ComposePipeline 있음 — 정말 compose가 필요하면 프로젝트 기반으로 가능
- compose 라이프사이클 관리(부분 실패, 업데이트, 볼륨 매핑)가 복잡도 폭발 요인

**재검토 조건**: 사용자 피드백에서 "compose 지원 필요" 반복 시

---

### DEC-031: 품질 게이트 Q-1 수동 체크리스트로 확정 (2026-03-08)

**결정**: E2E 시나리오 테스트(Q-1)를 CI 자동화 대신 수동 도그푸딩 체크리스트(markdown)로 구현.
**배경**: Docker 데몬, 네트워크, LLM API 등 외부 의존성이 많아 CI 자동화 시 flaky 비용이 높음.
**대안**: CI smoke test 자동화 (12~24시간 공수, flaky 위험)
**판단 근거**: 1인 프로젝트에서 수동 체크리스트(릴리즈 전 1회) + Q-2/Q-3 자동 테스트 조합이 비용 대비 효율 최적
**재검토 조건**: CI 파이프라인 도입 시, 또는 도그푸딩에서 동일 버그 반복 발견 시

### DEC-032: Q-2 이벤트 검증 스코프 — UI 필수 이벤트 + allow-list (2026-03-08)

**결정**: EventBus 배선 검증을 "전체 EventType" 대신 "routes.ts가 subscribe하는 이벤트"로 한정.
**배경**: container:health, tunnel:start/stop, env:set/delete는 타입에 정의되어 있지만 emit 소스가 없음 (미래/계획 이벤트).
**구현**: allow-list 기반 — 알려진 미연결 이벤트는 허용, 새 이벤트가 emit 없이 subscribe되면 테스트 실패
**재검토 조건**: allow-list의 이벤트를 실제로 구현할 때 제거

### DEC-033: v1.0.0 AI 기능 전체 재설계 — "조용한 부조종사" 경험

**날짜**: 2026-03
**결정**: 기존 v1.0.0 릴리즈를 단순 품질 게이트 + npm publish에서, AI 통합 경험(7개 기능 + 1개 UX 개편)을 포함한 "AI Co-pilot" 릴리즈로 확대.
**거부한 대안**: 기존 4개 AI 기능만 추가 후 릴리즈 — AI 존재감이 여전히 에러 시에만 국한
**이유**:

- PM: "AI가 곁들인 느낌이 강하다. 에러날때만 튀어나오는 느낌. 과하지도 않고 별로지도 않고 적당히 조화"
- 현재 AI 존재감: ProjectDetail 타임라인에서만 강함, 나머지 화면(대시보드, 서비스, 설정) 전부 부재
- 경쟁사(Coolify/Dokploy/CapRover) AI 전무 → "조용한 부조종사"로 추격 불가능한 차별점 구축
- 기존 4개 기능(장애리포트/롤백제안/env감지/포스트모템) + 시크릿 스캔(PM 아이디어) + 성공 인사이트 + 인라인 AI = 7+1 패키지
- 공수: ~7일 (디자이너 병렬). 1인 메인테이너 감당 가능.

**스펙 문서**: `docs/planning/release/v1.0.0-ai-copilot.md`
**재검토 조건**: 공수가 2주 이상 넘어갈 때 Tier 2(F-F, F-G) 스코프 축소 검토

### DEC-034: 빌드 실패 시 AI 인라인 표시 — 안 B 채택

**날짜**: 2026-03
**결정**: 빌드 실패 시 AI 분석을 별도 패널/서랍이 아닌, 빌드 로그와 같은 스트림 안에서 인라인으로 표시.
**거부한 대안**:

- 안 A (분할 뷰): 빌드 로그 좌/AI 분석 우 — 동시 보기 장점이나 모바일 깨짐, 구현 복잡
- 안 C (하단 서랍): VSCode 터미널 스타일 — 화면 분할 관리 필요, 과한 느낌

**이유**:

- PM: "안 B 좋다" (직접 선택)
- 가장 자연스러움 — 빌드 로그 흐름의 연장으로 AI가 등장
- 모바일 호환 — 단일 컬럼이므로 레이아웃 깨지지 않음
- 구현 간단 — 기존 타임라인 스트림에 AI 이벤트 인라인 렌더링
- 비례적 반응 원칙에 부합 — 같은 공간에서 에러 크기에 따라 AI 응답 크기도 자연스럽게 조절

**재검토 조건**: 사용자가 "AI 분석을 따로 보고 싶다"는 피드백 반복 시 안 A 재검토

### DEC-035: Quick Share Two-Track 유지 (Traefik 통합 안 함)

**날짜**: 2026-03
**결정**: Quick Share(TryCloudflare)는 Traefik을 경유하지 않고 컨테이너에 직접 연결하는 현재 구조(Two-Track)를 유지한다.
**거부한 대안**: Quick Share도 Traefik:80을 경유하도록 통합 ("모든 길은 Traefik으로 통한다" 원칙 전면 적용)
**이유**:

- Quick Share는 "나 혼자 빠르게 코드를 확인하기 위한 날것의 통로" — 프로덕션 경로와 동일할 필요 없음
- Scale to Zero와 무관: Quick Share 중인 컨테이너는 활성 사용 중이므로 유휴 정지 대상이 아님
- Traefik 장애 시에도 Quick Share 독립 동작 → 복원력(resilience) 확보
- Host 헤더 변조로 기술적 통합은 가능하나, 단순한 것의 단순함이 곧 장점
- 1인 메인테이너 리소스를 더 가치 있는 곳에 투자

**원칙 수정**: "모든 길은 Traefik으로 통한다" → "Production과 Internal의 모든 길은 Traefik으로 통한다. Quick Share는 예외 — 날것의 직통 터널."
**관련 코드**: `tunnel.ts` L33 (`http://localhost:${port}`), `cloudflare.ts` L180 (`http://127.0.0.1:80`)
**재검토 조건**: Quick Share 링크를 클라이언트 데모용으로 보내야 하는 use case가 실제로 발생할 때

**DEC-035 UPDATE (2026-03-09)**: 기존 Two-Track 결정을 철회하고, Quick Share를 포함한 **Single-Track(Traefik 통합)** 으로 변경한다.

**변경 이유**:

- TL 기술 검증 완료: Traefik File Provider 기반 동적 라우터 추가 방식으로 구현 가능
- 예상 공수: 2.5~3일
- Shared 모드(접근 코드) 구현을 위해 Quick Share도 Traefik 체인 안으로 들어와야 BasicAuth를 자연스럽게 적용 가능

**통합 플로우**:

`cloudflared` → `localhost:80` (Traefik) → File Provider YAML(trycloudflare 호스트 라우팅) → `ol-{name}@docker` 서비스 참조

**수정된 원칙**: **"모든 길은 Traefik으로 통한다"** (예외 없음)

**영향 범위**:

- `tunnel.ts`: Quick Share 터널 타겟을 `localhost:${PORT}`에서 `localhost:80`으로 전환
- File Provider YAML 생성/삭제 라이프사이클 추가 (Quick Share on/off 연동)
- Shared 모드 접근 코드(BasicAuth) 설계가 Quick Share 경로에 동일하게 적용됨

**회의 근거 문서**: `docs/planning/meetings/2026-03-09-architecture-direction.md` (TL 기술 검증 반영)
**재검토 조건**: File Provider 동적 라우팅의 운영 안정성 이슈(지연/누락)가 반복될 때

### DEC-036: Beyond Docker — 비(非) 도커 배포 방식 점진적 도입 (보류)

**날짜**: 2026-03
**결정**: Docker 의존을 선택적으로 만들고, 비(非) 도커 배포를 점진적으로 추가한다. Phase 0(Traefik File Provider) → Phase 1(정적 호스팅) → Phase 2(Native Process) → Phase 3(Serverless, 보류).
**거부한 대안**: Docker-only 유지 (현재 구조)
**이유**:

- User: "난 애초에 도커로 한정지을 생각은 없었어"
- Coolify가 무거운 이유 중 하나가 "무조건 도커여야만 한다"는 강박 — OpenLander가 이 제약을 벗으면 독보적 카테고리
- 정적 사이트(HTML/React dist)에 Nginx Docker 이미지를 쓰는 것은 로컬 환경에서 리소스 낭비
- Mac(Apple Silicon)에서 Docker Desktop 오버헤드(CPU/RAM/발열) 제거 → Native Process의 핵심 가치
- AI Smart Routing: auto-detect.ts 확장으로 Dockerfile → Docker, index.html → Static, server.js → Native 자동 선택
- Traefik File Provider로 Docker 외 프로세스/정적 파일도 라우팅 가능 — 아키텍처 자연스러운 확장

**Phase 로드맵**:

- Phase 0: Traefik File Provider 활성화 (0.5일)
- Phase 1: Zero-Container 정적 호스팅 (2-3일)
- Phase 2: Native Process 호스팅, PM2 스타일 (1-2주)
- Phase 3: Local Serverless / WASM (보류 — 출시 후 재평가)

**아키텍처 영향**: DeployStrategy 인터페이스 도입, ProcessManager 신규, DB에 deploy_type 컬럼 추가 필요
**정체성**: "실패를 스스로 고치는 셀프호스트 배포 플랫폼" — 변경 없음. 추가 포지셔닝: "Docker 강박 없는 초경량 배포"
**회의록**: `docs/planning/meetings/2026-03-09-architecture-direction.md`
**재검토 조건**: Phase 1 완료 후 사용자 피드백으로 Phase 2 진행 여부 판단. Phase 3은 출시 후 재평가.

**DEC-036 UPDATE (2026-03-21)**: v1.0.0 로드맵에서 제외. Docker-only 유지로 결정. 출시 후 재평가.

---

### DEC-037: MCP-first 전환 — 웹은 모니터링 대시보드

**날짜**: 2026-03
**결정**: 제품 정체성을 "AI와 함께 배포하는 플랫폼"에서 **"MCP-first 셀프호스트 배포 플랫폼"**으로 전환. 웹은 모니터링/관리 전용 대시보드로 재정의.
**거부한 대안**: 웹 AI 어시스턴트 UI 유지 (기존 v1.0.0 계획)
**이유**:

- User: "MCP 테스트하면서 느낀 점 — 결국 MCP만 쓸 것 같다"
- 코딩 에이전트(Claude Code, Cursor 등)가 이미 더 나은 AI 경험 제공
- 웹에서 AI 어시스턴트 수준으로 만드는 것은 불가능 — 리소스 낭비
- MCP 연동이 훨씬 만족스러움 — 에이전트가 직접 배포 제어
- 웹 AI UI 제거로 프론트엔드 복잡도 대폭 감소 (1인 메인테이너 유리)
- Auto-recovery는 백엔드에서 조용히 유지 (킬러 피처)

**영향 범위**:

- v1.0.0 AI Co-pilot UI (7개 카드) 전체 취소
- RecoveryReportCard, PostmortemCard, SecretScanCard 제거
- TimelineFeed의 AI 이벤트 렌더링 제거
- AI analysis inline 표시 제거
- Agent assistant 관련 컴포넌트 제거

**재검토 조건**: 사용자가 웹 AI 어시스턴트를 명시적으로 요청할 때

---

### DEC-038: AI 어시스턴트 웹 UI 제거 — 백엔드 auto-recovery 유지

**날짜**: 2026-03
**결정**: 웹 프론트엔드의 AI 어시스턴트 UI를 전부 제거. 백엔드 auto-recovery 기능은 유지하되, 웹에서는 조용히 동작하고 MCP로만 결과 확인.
**거부한 대안**: AI UI 유지 + 개선
**이유**:

- DEC-037의 MCP-first 전환에 따른 자연스러운 결과
- 웹은 배포 상태 모니터링, 도메인/환경변수 관리 등 운영 기능에 집중
- AI 분석 결과는 필요시 MCP 도구로 조회 가능
- 프론트엔드 코드 간소화 → 유지보수 비용 감소

**구체적 제거 대상**:

- `web/src/components/timeline/RecoveryReportCard.tsx`
- `web/src/components/timeline/PostmortemCard.tsx`
- `web/src/components/timeline/SecretScanCard.tsx`
- TimelineFeed의 AI 이벤트 렌더링 로직
- TimelineItem의 AI 인사이트 카드 타입

**재검토 조건**: 사용자가 웹에서 AI 분석 결과를 직접 보고 싶다는 피드백 반복 시

---

### DEC-039: Beyond Docker 로드맵 제외 — Docker-only 유지

**날짜**: 2026-03
**결정**: DEC-036(Beyond Docker)을 v1.0.0 로드맵에서 제외. Docker-only 유지로 결정.
**거부한 대안**: Phase 1(정적 호스팅) 구현 후 v1.0.0 릴리즈
**이유**:

- 1인 메인테이너 리소스 제약 — v1.0.0까지 거리를 최소화해야 함
- Docker는 이미 충분히 성숙한 표준 — 대부분 사용자가 Docker 환경 보유
- 정적 호스팅/Native Process는 출시 후 사용자 피드백으로 우선순위 재평가
- 현재 MCP-first 전환(DEC-037)이 더 시급한 전략적 변화

**재검토 조건**: v1.0.0 출시 후 사용자 피드백에서 "Docker 없이 배포하고 싶다"는 요청 반복 시

---

### DEC-040: v1.0.0 품질 게이트 — AI Co-pilot UI 미포함

**날짜**: 2026-03
**결정**: v1.0.0 릴리즈 기준을 "품질 게이트 통과"로 확정. AI Co-pilot UI(7개 카드)는 미포함.
**거부한 대안**: AI Co-pilot UI 완성 후 릴리즈
**이유**:

- DEC-037(MCP-first 전환)에 따라 AI UI는 더 이상 필요 없음
- v1.0.0은 "안정적인 MCP-first 배포 플랫폼"으로 정의
- 품질 게이트: 핵심 배포 플로우 E2E 검증, 60+ MCP 도구 안정성, 웹 모니터링 기능 완성
- 출시 후 사용자 피드백 기반 다음 버전 계획

**품질 게이트 기준**:

- Q-1: E2E 배포 시나리오 (Git → Build → Run → URL) 수동 검증
- Q-2: 60+ MCP 도구 응답 검증 (verify/action_required/recovery_hint)
- Q-3: 웹 모니터링 기능 (프로젝트/배포/도메인/환경변수/서비스 관리)
- 테스트 커버리지: 60% 이상

**재검토 조건**: 없음 (확정)

### DEC-041: 웹 UI 챗봇 도입 — 버튼은 AI 단축키, API key 옵셔널

**날짜**: 2026-03
**결정**: 웹 UI에 챗봇을 도입하고, 기존 액션 버튼(Deploy, Map Domain 등)을 챗봇 명령어 입력으로 전환한다. API key는 옵셔널.
**거부한 대안**:

- 안 A: 대시보드만 (모니터링 전용) — MCP 없이는 아무 액션도 못 함, 진입 장벽 높음
- 안 B: 버튼 + 챗봇 병렬 (두 경로 공존) — 버튼은 후속 작업 안 챙기고, 챗봇은 챙기는 불일치 발생
- 안 C: 풀 UI (Coolify 스타일 폼 기반) — MCP 차별점 희석, 개발 비용 큼

**이유**:

- 버튼과 AI의 동작이 근본적으로 다름: 버튼은 단일 API 호출, AI는 후속 작업까지 자동 처리 (예: 도메인 연결 → 환경변수 업데이트 → 프론트/백엔드 재배포)
- 두 경로가 공존하면 버튼으로 했을 때 "왜 재배포 안 됨?" 문제 반복 → 제품 신뢰도 하락
- 버튼 → 챗봇 명령어 입력 방식으로 통일하면: 진입 장벽 낮음 (버튼 있음) + 모든 액션이 AI 파이프라인 경유 (일관된 경험)
- API key 없으면 버튼이 기존처럼 직접 실행 → 키 없는 유저도 정상 사용 가능 → 자연스러운 업셀 경로

**DEC-037 UPDATE**: MCP-first 유지하되, 웹 챗봇이 MCP 파이프라인의 두 번째 진입점이 됨. "웹은 모니터링 전용"에서 "웹은 대시보드 + 챗봇"으로 확장.
**DEC-038 UPDATE**: AI 어시스턴트 웹 UI 제거 결정을 부분 철회. 기존 인라인 AI 카드(7개)는 제거 유지하되, 챗봇은 별도 인터페이스로 신규 도입.

**재검토 조건**: 챗봇 UX 퀄리티가 MCP 도구 퀄리티에 미치지 못하면 빼는 것도 고려.

---

## 결정 추가 가이드

새 결정을 내릴 때:

1. 이 문서에서 관련 기존 결정이 있는지 **먼저 검색**
2. 기존 결정과 충돌하면 → 왜 상황이 변했는지 명시하고 기존 결정을 UPDATE
3. 새 결정이면 → DEC-NNN으로 추가
4. **재검토 조건**은 반드시 포함 — "영구 결정"은 없다
