# Calm Operations Refresh — Design Specification

> **Status**: Active (v1.0.0-rc.9+)
> **Supersedes**: web-mvp-ui-ux.md의 "Cyber-Industrial Precision" 방향을 **Calm Operations** 방향으로 전환
> **Reference**: `docs/design/dokploy/` — Dokploy UI/UX 분석 자료

## 1. Design Direction

### Before → After

|                | Before (Cyber-Industrial)         | After (Calm Operations)                |
| -------------- | --------------------------------- | -------------------------------------- |
| **톤**         | 미래적 조종석, 데이터 밀도 높음   | 운영 도구, 평상시 차분 + 문제 시 경고  |
| **컬러**       | 사이언+그린+앰버 다채로움         | 뉴트럴 기본, 컬러는 시그널 전용        |
| **애니메이션** | Living Timeline 펄스, 글로우      | 최소 — 기능적 전환만                   |
| **카드**       | translateY 리프트 + 강한 그림자   | 보더 하이라이트만, shadow-sm           |
| **다크모드**   | #050505 거의 검정                 | #020617 (slate-950) 딥 네이비          |
| **사이드바**   | 프로젝트 목록 + 상태 dot + 그룹핑 | 네비게이션 전용 (Dokploy/Coolify 방식) |

### 원칙 3가지

1. **컬러는 시그널이다** — 평상시 뉴트럴, 문제 있을 때만 컬러. AI 기능만 로즈/인디고 유지.
2. **카드는 스캔 대상이다** — 이름 + 상태 + 시간만. 컨트롤 패널 아님.
3. **여백은 기능이다** — 정보를 그룹핑하고, 시각적 피로를 줄임.

### 경쟁사 참고

- **Dokploy**: 순수 모노크롬, 정보 극도로 적음, 여백 과감, 85rem max-width
- **Coolify**: 기능 풍부하지만 UI 투박, 저사양에서 느림
- **우리 포지션**: Dokploy의 절제 + Coolify의 기능성 + AI 차별화

---

## 2. Color System

### Light Mode

```
--bg-app:       #f1f5f9   (slate-100)
--bg-panel:     #ffffff   (crisp white)
--bg-subtle:    #f8fafc   (slate-50)
--bg-terminal:  #0f172a   (slate-900)
--color-accent: #6366f1   (indigo-500)
--color-ai:     #f43f5e   (rose-500)
--color-success:#10b981   (emerald-500)
--color-warning:#f59e0b   (amber-500)
--color-error:  #ef4444   (red-500)
```

### Dark Mode

```
--bg-app:       #020617   (slate-950 — deeper than before)
--bg-panel:     #0f172a   (slate-900)
--bg-subtle:    #1e293b   (slate-800)
--bg-terminal:  #000000   (pure black)
```

### 컬러 사용 규칙

| 용도         | 컬러                | 예시                                  |
| ------------ | ------------------- | ------------------------------------- |
| 상태: 정상   | emerald-500         | StatusDot, Badge variant="green"      |
| 상태: 빌딩   | amber-500           | StatusDot, Badge variant="yellow"     |
| 상태: 에러   | red-500             | StatusDot, Badge variant="red"        |
| 상태: 비활성 | muted-foreground/40 | StatusDot, Badge variant="neutral"    |
| AI 기능      | rose-500 + 인디고   | Agent 모드 토글, AI 복구 카드, 스파클 |
| 일반 UI      | 없음 (뉴트럴)       | 카드, 버튼, 네비게이션                |

---

## 3. Typography

| 용도        | 폰트                    | 클래스         |
| ----------- | ----------------------- | -------------- |
| 제목/헤더   | Inter Variable          | `font-display` |
| 본문/UI     | Inter Variable          | `font-body`    |
| 코드/데이터 | Geist Mono Variable     | `font-mono`    |
| 로그/터미널 | JetBrains Mono Variable | `font-log`     |

**변경점**: MVP에서 사용하던 Outfit/Manrope → Inter Variable 통일. 가독성과 일관성 우선.

---

## 4. Layout System

### Max-Width

**전체 통일**: `max-w-8xl` = `85rem` = **1360px** (Dokploy 동일)

| 페이지 유형     | max-width | 추가 제약          |
| --------------- | --------- | ------------------ |
| 대시보드/테이블 | 1360px    | —                  |
| 설정/폼         | 1360px    | 내부 폼은 max-w-xl |
| 로그인          | max-w-sm  | 별도 (센터링)      |
| 새 프로젝트     | max-w-xl  | 별도 (폼)          |

### 패딩 표준

```
페이지 래퍼: p-6 xl:p-8
카드 헤더:   p-6
카드 콘텐츠: p-6 pt-0
그리드 간격: gap-5
섹션 간격:   space-y-8
```

### 반응형 브레이크포인트

```
sm:  640px
md:  768px   (사이드바 접힘)
lg:  1024px  (사이드바 펼침)
xl:  1280px
2xl: 1536px
3xl: 1920px  (4열 그리드)
```

---

## 5. Sidebar

### 변경: 프로젝트 목록 제거

**Before**: Dashboard/Agent 토글 + 검색 + 프로젝트 목록(상태 dot, 레포 그룹핑, Compose 그룹) + 네비게이션
**After**: Dashboard/Agent 토글 + 검색 + 네비게이션 + 접기 토글

**이유**:

- Dokploy, Coolify 모두 사이드바에 프로젝트 목록을 넣지 않음
- 프로젝트 수 증가 시 스크롤 지옥 → 가치 감소
- Cmd+K 검색으로 빠른 전환 이미 커버
- 프로젝트 목록 폴링 제거 → 성능 개선

### 네비게이션 항목

```
[Dashboard / Agent 토글]
[검색 (Cmd+K)]
──────────
Overview
Projects      → /projects
Services      → /services
Ops Center    → /ops
Deploy        → /projects/new
Settings      → /settings
──────────
[접기 토글 (lg에서만)]
```

### 접기 동작

- `lg` 이상: 펼침(260px) ↔ 접힘(64px) 수동 토글
- `md`: 항상 접힘(64px)
- 모바일: Sheet drawer
- 상태: `localStorage('openlander-sidebar-collapsed')` 저장

---

## 6. Component Patterns

### Card

```tsx
// 기본 카드
<Card className="rounded-xl border bg-card shadow-sm">

// 인터랙티브 카드 (클릭 가능)
<div className="rounded-lg border bg-bg-panel hover:bg-bg-subtle transition-all card-hover">
```

**card-hover 효과** (index.css):

- `box-shadow`: 미세한 그림자 증가 (shadow-sm 수준)
- `border-color`: 기본 보더 유지 (컬러 없음)
- translateY/리프트: **없음** (제거됨)

### Button

```tsx
// 기본: active:scale-[0.98] 눌림감
<Button variant="default">Action</Button>

// 호버 시 나타나는 액션
<div className="opacity-0 group-hover:opacity-100 transition-opacity">
  <Button variant="ghost" size="icon">...</Button>
</div>
```

### Status Display

```tsx
// 중앙 관리: status-config.ts
const status = getStatusDisplay(project.status);

// StatusDot: 정적 (기본 애니메이션 없음)
<StatusDot status={status.dotStatus} />

// Badge: 시멘틱 variant
<Badge variant={status.badgeVariant}>{label}</Badge>
```

### Empty State

```tsx
<PageEmptyState
  icon={Database}
  title={t('services.empty.title')}
  description={t('services.empty.description')}
  action={<Button>Create Service</Button>}
/>
```

### Loading State

```tsx
// 페이지: 레이아웃 매칭 스켈레톤
<Skeleton className="h-[140px] w-full rounded-lg" />

// 인라인: LoadingState 컴포넌트
<LoadingState label="Loading..." />
```

### Icon Colors

| 상태             | 클래스                                |
| ---------------- | ------------------------------------- |
| 기본             | `text-muted-foreground`               |
| 활성 (현재 경로) | `text-foreground`                     |
| 호버             | `hover:text-foreground`               |
| 상태 표시        | 시멘틱 컬러 (success, error, warning) |
| AI 관련          | `text-agent` (인디고)                 |

---

## 7. Animation Policy

### 허용

| 애니메이션    | 용도             | 클래스                                           |
| ------------- | ---------------- | ------------------------------------------------ |
| 사이드바 접기 | 레이아웃 전환    | `transition-[width] duration-200`                |
| 카드 hover    | 보더/그림자 전환 | `transition: box-shadow 0.2s, border-color 0.2s` |
| 타임라인 진입 | 배포 로그 항목   | `timeline-slide-in 0.4s`                         |
| 스피너        | 로딩 표시        | `animate-spin`                                   |
| 아코디언      | 콘텐츠 펼치기    | `accordion-down/up 0.2s`                         |

### 제거됨

| 이전                            | 이유              |
| ------------------------------- | ----------------- |
| `translateY(-2px)` 카드 리프트  | 과한 인터랙션     |
| 강한 그림자 (`shadow-xl` hover) | 시각적 노이즈     |
| `bounce-dot`                    | 장식적, 기능 없음 |

### AI 전용 (유지)

| 애니메이션        | 용도                     |
| ----------------- | ------------------------ |
| `ai-sparkle-glow` | AI 복구 카드, Agent 패널 |
| `pulse-ring`      | 실시간 활동 표시         |
| `shimmer`         | AI 처리 중 표시          |

---

## 8. i18n

- **모든** 사용자 대면 문자열은 `t()` 사용 필수
- `web/src/i18n/en.ts` + `web/src/i18n/ko.ts` 항상 동시 업데이트
- 키 네이밍: dot-notation, 페이지명 기반 (`login.signIn`, `projectDetail.redeploySuccess`)
- 브랜드명('OpenLander')은 i18n 안 함

---

## 9. 디자인 의사결정 로그

| 날짜       | 결정                                 | 이유                                       |
| ---------- | ------------------------------------ | ------------------------------------------ |
| 2026-04-21 | Project 명칭 유지 (Application 아님) | Vercel/Railway도 Project, MCP 도구명 불변  |
| 2026-04-21 | 템플릿 커스터마이징 v1.0.0 불포함    | Git 기반 배포가 핵심, 서비스 6개로 충분    |
| 2026-04-21 | 사이드바 프로젝트 목록 제거          | Dokploy/Coolify 모두 미사용, 성능 + 깔끔함 |
| 2026-04-21 | max-width 1360px 통일                | Dokploy 85rem 동일                         |
| 2026-04-21 | 다크모드 slate-950으로 깊어짐        | Dokploy 스타일 프로 도구 느낌              |
| 2026-04-21 | card-hover translateY 제거           | 절제 원칙                                  |
| 2026-04-21 | 버튼 active:scale-[0.98] 추가        | 미세한 눌림감                              |
