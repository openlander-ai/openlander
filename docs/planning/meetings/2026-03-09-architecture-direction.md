# 아키텍처 방향 결정 회의 (2026-03-09)

> **참석**: PM (Project Owner) · TL (Tech Lead) · User (최종 의사결정권자)
> **결정**: DEC-035 (Quick Share Two-Track 유지), DEC-036 (Beyond Docker 방향 채택)

---

## 안건 1: Quick Share 라우팅 — Two-Track 유지 vs Traefik 통합

### 배경

이전 분석에서 트래픽 플로우 이원화를 확인:

| 경로            | 트래픽 플로우                                                        | Traefik 경유 |
| --------------- | -------------------------------------------------------------------- | ------------ |
| **Internal**    | `browser → sslip.io → Traefik:80 → container:PORT`                   | ✅           |
| **Production**  | `CF Tunnel → 127.0.0.1:80 → Traefik → container:PORT`                | ✅           |
| **Quick Share** | `cloudflared tunnel --url http://localhost:${PORT}` → container 직접 | ❌           |

"모든 길은 Traefik으로 통한다" 원칙을 채택했으나, TL이 재검토 제기.

### TL 분석 (호스트 헤더 변조 관점)

- Host 헤더 변조로 Traefik 경유 가능 — 기술적 장벽 없음
- 그러나 Quick Share의 본질은 **"나 혼자 빠르게 코드를 확인하기 위한 날것의 통로"**
- 보안/트래픽 통제가 필요한 경우(클라이언트 데모용)에만 통합 검토

### PM 의사결정 프레임워크 적용

| 질문                      | 답변                             |
| ------------------------- | -------------------------------- |
| 1. 정체성 강화?           | **No** — Quick Share는 편의 기능 |
| 2. 1인 메인테이너 2주 내? | Yes, 하지만 투입 대비 가치 낮음  |
| 3. 없이도 배포 가능?      | **Yes** — 이미 정상 작동         |
| 4. MCP에 도움?            | **No**                           |

### Scale to Zero와의 관계

- Scale to Zero = 유휴 컨테이너 자동 정지 → Production/Internal 트래픽 인터셉트 필요
- Quick Share = 사용자가 능동적으로 켜고 보고 끄는 기능 → 유휴 상태 불가
- **결론**: Scale to Zero는 Traefik 경유 트래픽(Production + Internal)만 인터셉트하면 됨
- Quick Share 경로는 Scale to Zero와 무관

### ✅ 결정: DEC-035 — Two-Track 유지

**수정된 원칙:**

> ~~"모든 길은 Traefik으로 통한다"~~
>
> → **"Production과 Internal의 모든 길은 Traefik으로 통한다. Quick Share는 예외 — 날것의 직통 터널."**

**근거:**

1. Quick Share ≠ 프로덕션. 개인 확인용 임시 통로.
2. Scale to Zero는 Quick Share와 무관 (활성 사용 중인 컨테이너를 정지할 이유 없음)
3. Traefik 장애 시에도 Quick Share 독립 동작 → 복원력(resilience)
4. 1인 메인테이너 리소스를 더 가치 있는 곳에 투자

---

## 안건 2: Docker 의존성 탈피 — "초경량 배포 에이전트" 방향

### User 비전

> **"난 애초에 도커로 한정지을 생각은 없었어."**

### 현재 제약 (architecture.md)

- Docker daemon 필수
- dockerode 라이브러리로 Docker API 호출
- 컨테이너 ↔ Traefik: Docker 라벨 기반 라우팅만 지원

### 경쟁 포지셔닝

> Coolify가 무거운 이유 중 하나가 **"무조건 도커여야만 한다"는 강박**. 단순한 HTML 페이지 하나 띄우는데
> Nginx Docker 이미지를 다운받고, 컨테이너를 빌드하고, 네트워크를 잡는 건 로컬 환경(Mac Mini, 라즈베리파이)에서
> 엄청난 리소스 낭비.
>
> OpenLander가 Docker 의존을 벗어나는 순간 → **"초경량 배포 에이전트"** 라는 독보적 카테고리.

### TL 제안: 3가지 비(非) 도커 배포 방식

#### Mode 1: 📂 Zero-Container 정적 호스팅

| 항목     | 내용                                                               |
| -------- | ------------------------------------------------------------------ |
| Use Case | React/Vue/HTML 빌드 결과물 (`dist/`, `out/`, `build/`)             |
| 구현     | 폴더 복사 + Traefik File Provider 라우팅 (또는 내장 static server) |
| UX 예시  | `openlander deploy --static ./dist` → Docker 없이 즉시 URL         |
| 장점     | 빌드 시간 0초, RAM 점유 0MB. GitHub Pages/Vercel의 로컬 버전       |
| 공수     | **2-3일**                                                          |

#### Mode 2: ⚡ Native Process 호스팅 (PM2 스타일)

| 항목     | 내용                                                                     |
| -------- | ------------------------------------------------------------------------ |
| Use Case | Node.js, Python, Go, Bun 서버                                            |
| 구현     | OS 프로세스 직접 실행 + Traefik File Provider 라우팅                     |
| UX 예시  | `openlander run server.ts` → 백그라운드 프로세스 + URL 즉시              |
| 장점     | Docker Desktop 오버헤드 제거. 특히 Mac(Apple Silicon) 발열/RAM 낭비 해결 |
| 공수     | **1-2주**                                                                |

#### Mode 3: 🧠 Local Serverless / WASM

| 항목     | 내용                                                                                |
| -------- | ----------------------------------------------------------------------------------- |
| Use Case | Webhook 핸들러, Cron, 단일 파일 함수                                                |
| 구현     | 단일 파일 → 엔드포인트 자동 생성 (`/api/hook`)                                      |
| UX 예시  | 파일 하나 던지면 자동으로 HTTP 엔드포인트 생성                                      |
| 장점     | "코드 조각 배포" — Coolify는 "애플리케이션 배포", OpenLander는 "코드 조각까지 커버" |
| 공수     | **2-3주**                                                                           |

### 기술 핵심: Traefik File Provider

**현재** — Docker Provider만 사용:

```typescript
// traefik.ts L96-101
Cmd: [
  '--providers.docker=true',
  '--providers.docker.exposedbydefault=false',
  `--providers.docker.network=${TRAEFIK_NETWORK}`,
  '--entrypoints.web.address=:80',
];
```

**추가 필요** — File Provider:

```typescript
// Phase 0에서 추가
'--providers.file.directory=/etc/traefik/dynamic/',
'--providers.file.watch=true',
```

**원리**: OpenLander가 YAML 파일을 `/etc/traefik/dynamic/`에 써주면, Traefik이 실시간 감지 → 라우팅 자동 설정.
Docker 컨테이너가 아니어도 `localhost:PORT`로 트래픽 전달 가능.

```yaml
# 예시: /etc/traefik/dynamic/my-static-site.yaml
http:
  routers:
    my-static-site:
      rule: 'Host(`my-site.192.168.0.10.sslip.io`)'
      service: my-static-site
      entryPoints:
        - web
  services:
    my-static-site:
      loadBalancer:
        servers:
          - url: 'http://127.0.0.1:3001'
```

### AI Smart Routing (auto-detect.ts 확장)

```
현재:
  auto-detect.ts → 프레임워크 감지 → Dockerfile 생성 → Docker 빌드 → Container → Traefik (Docker Provider)

Beyond Docker:
  auto-detect.ts → 프로젝트 유형 감지 → 배포 전략 결정
    ├── Dockerfile 발견?         → DockerStrategy  (현재 파이프라인)
    ├── index.html만?            → StaticStrategy  (신규)
    ├── package.json + server?   → NativeStrategy  (신규)
    └── docker-compose.yml?      → ComposeStrategy (현재 파이프라인)
```

사용자가 "이건 도커야, 이건 HTML이야" 지정할 필요 없음. **AI가 프로젝트를 스캔하고 최적 방식을 결정.**

### PM 의사결정 프레임워크 적용

| 질문               | Static             | Native Process           | Serverless        |
| ------------------ | ------------------ | ------------------------ | ----------------- |
| 1. 정체성 강화?    | ★★★ 배포 범위 확장 | ★★★★ Mac 핵심 페인포인트 | ★★ 쿨하지만 niche |
| 2. 2주 내 구현?    | ✅ 2-3일           | ⚠️ 1-2주 (경계)          | ❌ 2-3주          |
| 3. 없이 배포 가능? | Yes                | Yes                      | Yes               |
| 4. MCP 도움?       | ★★                 | ★★★★ AI 최적 방식 선택   | ★★                |

### TL 아키텍처 영향 분석

**필요한 추상화:**

1. `DeployStrategy` 인터페이스 — 배포 방식 공통 인터페이스
2. `ProcessManager` — Native Process 라이프사이클 (시작/정지/재시작/로그)
3. `StaticServer` — 정적 파일 서빙 (내장 또는 Traefik 직접 서빙)
4. `TraefikDynamicConfig` — File Provider 기반 동적 라우팅 설정 생성

**DB 스키마 변경:**

- `deploy_type: 'docker' | 'static' | 'native'` 컬럼 필요

**TL 우려:**

- `DeployPipeline` 클래스(1053줄)가 Docker에 강결합 → 전략 패턴으로 분리 필요
- 프로세스 모니터링이 Docker health check와 다름 → `monitor/` 확장 필요
- 프로세스 크래시 시 자동 재시작 로직 (PM2의 핵심 기능) 구현 필요

### ✅ 결정: DEC-036 — Beyond Docker 방향 채택

**채택**: Docker 의존을 선택적으로 만들고, 비(非) 도커 배포를 점진적으로 추가.

**로드맵:**

| Phase       | 내용                         | 공수  | 전제 조건        |
| ----------- | ---------------------------- | ----- | ---------------- |
| **Phase 0** | Traefik File Provider 활성화 | 0.5일 | 없음 (즉시 가능) |
| **Phase 1** | Zero-Container 정적 호스팅   | 2-3일 | Phase 0 완료     |
| **Phase 2** | Native Process 호스팅        | 1-2주 | Phase 1 완료     |
| **Phase 3** | Local Serverless             | 보류  | 출시 후 재평가   |

**정체성:**

- 기존: "실패를 스스로 고치는 셀프호스트 배포 플랫폼" → **변경 없음**
- 추가 포지셔닝: "Docker 강박 없는 초경량 배포" → Coolify와 완전히 다른 카테고리

---

## 의사결정 요약

| ID          | 결정                       | 근거                                                                   |
| ----------- | -------------------------- | ---------------------------------------------------------------------- |
| **DEC-035** | Quick Share Two-Track 유지 | Scale to Zero와 무관, 직통 터널의 단순함이 장점, Traefik 독립성 확보   |
| **DEC-036** | Beyond Docker 점진적 도입  | Coolify 차별화, Mac 사용자 핵심 가치, AI Smart Routing 확장 자연스러움 |

---

## Action Items

- [ ] **Phase 0**: Traefik File Provider 활성화 (`traefik.ts` Cmd 배열에 file provider 추가)
- [ ] **Phase 1 스펙**: 정적 호스팅 상세 스펙 작성 (auto-detect 확장, UI, DB 스키마)
- [ ] `architecture.md` 업데이트 — "Docker 의존" 제약을 "Docker 선택적" 으로 변경
- [ ] `decision-log.md` 업데이트 — DEC-035, DEC-036 추가
- [ ] `version-map.md` 검토 — Beyond Docker 로드맵 반영 여부 결정
