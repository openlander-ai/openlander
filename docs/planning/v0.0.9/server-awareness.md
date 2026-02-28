# v0.0.9 — Server Awareness

> **상태**: 📋 기획 스펙 (미착수) | **이전 문서**: `v0.0.9-10-unified-spec.md` (통합 기획서, 아카이브)
>
> 이 문서는 `v0.0.9-10-unified-spec.md`의 v0.0.9 파트를 **대폭 축소하고 재정의**한 것이다.
> 기존 문서의 Import 프로세스, Import 컨테이너 관리, coexist Traefik 모드, 온보딩 대규모 개편은 제거됨.

---

## 개요

**한 줄 요약**: OpenLander가 서버의 전체 상태를 인식하여, 배포 시 충돌을 원천 방지한다.

**핵심 문제**: 현재 OpenLander는 **자기가 배포한 것만 안다**. 서버에 이미 돌고 있는 컨테이너, 사용 중인 포트, 리버스 프록시 상태를 모른다. 이 때문에:

- 이미 사용 중인 포트에 배포 시도 → 실패 → 재시도 루프
- 기존 Traefik/Nginx와 충돌
- MCP로 연동된 코딩 에이전트(Cursor, Claude Code)에게 정확한 서버 컨텍스트를 제공하지 못함 → 에이전트도 루프

**해결 방향**: 서버 전체를 스캔하고, 그 정보를 에이전트 시스템 프롬프트와 도구에 주입한다. **Import/관리 전환은 하지 않는다** — 감지(observe)와 정보 제공만.

---

## 현재 코드의 블라인드스팟 (AS-IS)

| 파일                      | 문제                                                                                     | 라인   |
| ------------------------- | ---------------------------------------------------------------------------------------- | ------ |
| `src/pipeline/port.ts`    | `db.getUsedPorts()`만 조회 — DB에 없는 포트(외부 컨테이너, 호스트 프로세스)는 모름       | L19    |
| `src/pipeline/docker.ts`  | `listManagedContainers()`가 `openlander.managed=true` 라벨 필터 — 외부 컨테이너 안 보임  | L228   |
| `src/pipeline/traefik.ts` | 80/8080 포트 하드코딩 — 기존 프록시가 이 포트를 쓰고 있으면 충돌                         | L92-93 |
| `src/agent/prompts.ts`    | `buildContextSnapshot()`이 자체 프로젝트만 조회 — 서버 전체 상태를 에이전트에 전달 안 함 | L50    |
| `src/db/schema.ts`        | `env_vars` 테이블에 global scope 없음 — 프로젝트별 격리만                                | L27-34 |

---

## 변경 범위

### 수정할 파일

| 파일                                    | 변경 내용                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `src/pipeline/docker.ts`                | `listAllContainers()` 함수 추가 (전체 컨테이너 스캔)                       |
| `src/pipeline/port.ts`                  | OS 레벨 포트 스캔 추가 (`ss` / `lsof` 기반)                                |
| `src/pipeline/traefik.ts`               | 리버스 프록시 감지 로직 추가 (managed/external 2모드)                      |
| `src/agent/prompts.ts`                  | `buildContextSnapshot()`에 서버 전체 컨텍스트 주입                         |
| `src/tools/registry.ts`                 | 3개 도구 추가 (`list_all_containers`, `scan_ports`, `get_container_stats`) |
| `src/tui/components/DashboardPanel.tsx` | Server 섹션 추가 (전체 컨테이너/포트/프록시 표시)                          |

### 새로 생성할 파일

없음. 기존 모듈에 함수를 추가하는 방식.

---

## 기능별 상세

### 9-1: 전체 컨테이너 스캔

**현재 상태 (AS-IS)**:
`docker.ts`의 `listManagedContainers()`는 `openlander.managed=true` 라벨이 있는 컨테이너만 반환.

**목표 상태 (TO-BE)**:
`listAllContainers()` 함수를 추가하여, 서버의 **모든 Docker 컨테이너**를 반환. OpenLander 관리 여부를 `managedByOpenLander` 필드로 구분.

**구현 방향**:

```typescript
// src/pipeline/docker.ts에 추가
async function listAllContainers(): Promise<ContainerInfo[]> {
  const all = await docker.listContainers({ all: true });
  return all.map((c) => ({
    id: c.Id,
    name: c.Names[0].replace(/^\//, ''),
    image: c.Image,
    state: c.State, // running | exited | paused | ...
    status: c.Status, // "Up 2 days", "Exited (0) 3 hours ago"
    ports: c.Ports, // [{IP, PrivatePort, PublicPort, Type}]
    labels: c.Labels,
    managedByOpenLander: c.Labels['openlander.managed'] === 'true',
    composeProject: c.Labels['com.docker.compose.project'] || null,
    created: c.Created,
  }));
}
```

**수락기준**:

- [ ] `listAllContainers()`가 라벨 필터 없이 모든 컨테이너를 반환한다
- [ ] 반환값에 `managedByOpenLander: boolean` 필드가 포함된다
- [ ] 반환값에 `composeProject: string | null` 필드가 포함된다
- [ ] 기존 `listManagedContainers()`는 변경하지 않는다 (하위 호환)
- [ ] 테스트: mock Docker API로 managed + unmanaged 컨테이너 혼합 시나리오 검증

---

### 9-2: OS 레벨 포트 스캔

**현재 상태 (AS-IS)**:
`port.ts`의 `findAvailablePort()`가 DB만 조회. Docker 외부 프로세스(직접 실행한 Node 서버 등)가 쓰는 포트는 모름.

**목표 상태 (TO-BE)**:
OS의 실제 포트 사용 현황을 스캔하여, DB + Docker + 호스트 프로세스의 포트를 모두 파악.

**구현 방향**:

```typescript
// src/pipeline/port.ts에 추가
async function scanUsedPorts(): Promise<PortScanResult> {
  // 1. DB에서 OpenLander가 알고 있는 포트
  const dbPorts = await db.getUsedPorts();

  // 2. Docker 컨테이너의 PublicPort (listAllContainers 활용)
  const containers = await listAllContainers();
  const dockerPorts = containers.flatMap((c) =>
    c.ports.filter((p) => p.PublicPort).map((p) => p.PublicPort),
  );

  // 3. OS 레벨 (Linux: ss -tlnp, macOS: lsof -iTCP -sTCP:LISTEN)
  const osPorts = await scanOSPorts();

  return {
    db: dbPorts,
    docker: dockerPorts,
    os: osPorts,
    all: [...new Set([...dbPorts, ...dockerPorts, ...osPorts])],
    conflicts: findConflicts([...dbPorts, ...dockerPorts, ...osPorts]),
  };
}
```

**수락기준**:

- [ ] `scanUsedPorts()`가 DB, Docker, OS 3개 소스를 합산하여 사용 중인 포트 목록을 반환한다
- [ ] Linux에서 `ss -tlnp` 또는 macOS에서 `lsof -iTCP -sTCP:LISTEN` 을 사용한다
- [ ] `findAvailablePort()`가 `scanUsedPorts()`의 결과를 참조하도록 수정한다 (DB만 보지 않음)
- [ ] `conflicts` 필드: OpenLander 기본 포트(80, 443, 8080)와의 충돌 목록
- [ ] 테스트: 포트 충돌 시나리오 검증

---

### 9-3: 리버스 프록시 감지

**현재 상태 (AS-IS)**:
`traefik.ts`가 80/8080 포트를 하드코딩으로 사용. 기존 프록시 존재 여부를 확인하지 않음.

**목표 상태 (TO-BE)**:
서버에 이미 Traefik/Nginx 등이 있는지 감지하고, 2가지 모드로 대응.

**Traefik 모드 (2가지만)**:

| 모드             | 설명                               | 사용 시나리오         |
| ---------------- | ---------------------------------- | --------------------- |
| `managed` (기본) | OpenLander가 Traefik을 띄우고 관리 | 새 환경, Traefik 없음 |
| `external`       | 기존 Traefik 사용, 라벨만 추가     | 이미 Traefik 운영 중  |

> **`coexist` 모드는 제거했다.** 별도 포트로 2번째 Traefik을 띄우는 것은 복잡도 대비 실용성이 낮다.
> Nginx/Caddy/HAProxy 사용자는 수동으로 프록시 설정을 추가하거나, OpenLander의 managed Traefik을 별도 포트로 쓸 수 있다 (설정 가이드 문서 제공).

**구현 방향**:

```typescript
// src/pipeline/traefik.ts에 추가
interface ProxyDetection {
  type: 'traefik' | 'nginx' | 'caddy' | 'haproxy' | 'none';
  container?: string;
  ports: number[];
  version?: string;
  traefikDockerProvider?: boolean; // Traefik Docker provider 활성 여부
}

async function detectReverseProxy(): Promise<ProxyDetection> {
  const containers = await listAllContainers();
  // Traefik: image contains 'traefik'
  // Nginx: image contains 'nginx'
  // Caddy: image contains 'caddy'
  // HAProxy: image contains 'haproxy'
  // 포트 80/443/8080 사용 여부 확인
}
```

**`external` 모드 동작**:

1. 배포 시 컨테이너에 Traefik 라벨 추가 (기존과 동일)
2. 기존 Traefik의 Docker 네트워크에 컨테이너 연결
3. Traefik 컨테이너 자체는 띄우지 않음
4. OpenLander 설정에서 외부 Traefik 정보 저장

**수락기준**:

- [ ] `detectReverseProxy()`가 서버의 리버스 프록시를 감지하여 type/container/ports를 반환한다
- [ ] Traefik 감지 시 `external` 모드 전환이 가능하다 (config에 `traefik.mode` 저장)
- [ ] `external` 모드에서 OpenLander는 Traefik 컨테이너를 띄우지 않고, 기존 네트워크에 연결한다
- [ ] `managed` → `external` 전환 시 기존 OpenLander Traefik을 안전하게 중지한다
- [ ] Nginx/Caddy/HAProxy 감지 시 경고 메시지를 표시한다 (자동 연동은 안 함)
- [ ] 테스트: 프록시 감지 + 모드 전환 시나리오

---

### 9-4: 시스템 프롬프트 확장 (서버 컨텍스트 주입)

**현재 상태 (AS-IS)**:
`prompts.ts`의 `buildContextSnapshot()`이 OpenLander 프로젝트만 조회하여 에이전트에 전달.

**목표 상태 (TO-BE)**:
에이전트가 서버의 **전체 상태**를 알게 한다. 배포 시 충돌을 사전 방지.

**구현 방향**:

`buildContextSnapshot()`에 3가지 정보를 추가:

```typescript
// 현재: OpenLander 프로젝트만
const projects = await db.getAllProjects();

// 추가 1: 전체 컨테이너 (외부 포함)
const allContainers = await listAllContainers();
const externalContainers = allContainers.filter((c) => !c.managedByOpenLander);

// 추가 2: 사용 중인 포트 전체
const portScan = await scanUsedPorts();

// 추가 3: 리버스 프록시 상태
const proxy = await detectReverseProxy();
```

시스템 프롬프트에 주입되는 형태:

```
## Server Context
- Total containers: 14 (3 managed by OpenLander, 11 external)
- External containers: nginx(:80), grafana(:3001), postgres(:5432), ...
- Ports in use: 80, 443, 3000, 3001, 5432, 6379, 8080
- Available port range: 10001-10999 (OpenLander allocated)
- Reverse proxy: Traefik v2.10 (external mode, Docker provider enabled)

## Deployment Rules
- Do NOT use ports: 80, 443, 3000, 3001, 5432, 6379, 8080
- Use allocated ports from range 10001-10999
- Container names must not conflict with: nginx, grafana, postgres, redis, ...
```

**수락기준**:

- [ ] `buildContextSnapshot()`이 외부 컨테이너 목록, 사용 중인 포트, 프록시 상태를 포함한다
- [ ] 시스템 프롬프트에 "사용 금지 포트" 목록이 명시된다
- [ ] 시스템 프롬프트에 "충돌 방지용 컨테이너 이름" 목록이 명시된다
- [ ] 프롬프트 길이가 과도하지 않다 (외부 컨테이너 20개 이상이면 요약)
- [ ] 테스트: 컨텍스트 스냅샷에 서버 상태가 포함되는지 검증

---

### 9-5: 에이전트 도구 3개 추가

현재 23개 도구 → 26개로 확장.

#### `list_all_containers`

```typescript
{
  name: 'list_all_containers',
  description: 'List all Docker containers on the server, including those not managed by OpenLander',
  parameters: {
    state: { type: 'string', enum: ['all', 'running', 'stopped'], default: 'all' },
  },
  handler: async ({ state }) => {
    const containers = await listAllContainers();
    if (state !== 'all') {
      return containers.filter(c => state === 'running' ? c.state === 'running' : c.state !== 'running');
    }
    return containers;
  },
}
```

#### `scan_ports`

```typescript
{
  name: 'scan_ports',
  description: 'Scan all ports in use on the server (Docker + OS processes)',
  parameters: {},
  handler: async () => {
    return await scanUsedPorts();
  },
}
```

#### `get_container_stats`

```typescript
{
  name: 'get_container_stats',
  description: 'Get resource usage (CPU, memory, network) for a specific container',
  parameters: {
    container: { type: 'string', description: 'Container name or ID' },
  },
  handler: async ({ container }) => {
    const stats = await docker.getContainer(container).stats({ stream: false });
    return formatStats(stats);
  },
}
```

**수락기준**:

- [ ] 3개 도구가 `registry.ts`에 등록되고, MCP 서버에서도 노출된다
- [ ] `list_all_containers`가 managed/unmanaged 구분하여 반환한다
- [ ] `scan_ports`가 DB + Docker + OS 3개 소스를 합산한다
- [ ] `get_container_stats`가 CPU/메모리/네트워크 사용량을 반환한다
- [ ] 에러 처리: 존재하지 않는 컨테이너 조회 시 적절한 에러 메시지
- [ ] 테스트: 각 도구의 정상/에러 시나리오

---

### 9-6: Dashboard Server 섹션

**현재 상태 (AS-IS)**:
DashboardPanel에 System, Projects, Activity 섹션만 존재.

**목표 상태 (TO-BE)**:
Server 섹션을 추가하여, 서버 전체 상태를 한눈에 파악.

**배치**: System 섹션 바로 아래, Projects 섹션 위.

```
▸ System
  CPU 12% ████░░░░░░  MEM 4.2G/16G ██████░░░░

▸ Server                                        ← NEW
  Containers: 14 (3 managed, 11 external)
  Ports in use: 12
  Proxy: Traefik v2.10 (external)
  ● nginx       :80    8M
  ● grafana     :3001  96M
  ● postgres    :5432  64M
  ...

▸ Projects (3)
  ● frontend  :10001  128M
  ● api       :10002  256M
  ...
```

**수락기준**:

- [ ] DashboardPanel에 Server 섹션이 추가된다
- [ ] 외부 컨테이너가 없으면 섹션을 표시하지 않는다 (또는 "No external containers" 표시)
- [ ] 외부 컨테이너가 10개 초과 시 축약 표시 (상위 5개 + "...and N more")
- [ ] Proxy 상태가 한 줄로 요약된다 (type, version, mode)
- [ ] 3초 폴링으로 갱신 (기존 Projects 섹션과 동일한 주기)
- [ ] 테스트: Server 섹션 렌더링 (컨테이너 0개/5개/15개 시나리오)

---

### 9-7: Preflight Check (배포 전 사전 검증)

**이 기능이 v0.0.9의 킬러 피처다.**

배포(`deploy_project` 도구) 실행 전에 서버 상태를 확인하여, 실패할 것이 명확한 배포를 사전에 차단한다.

**현재 상태 (AS-IS)**:
`deploy_project` → 바로 빌드 시작 → 포트 충돌이면 빌드 후 실패 → 시간 낭비.

**목표 상태 (TO-BE)**:
`deploy_project` → **preflight check** → 문제 있으면 즉시 보고 → 문제 없으면 빌드 진행.

**체크 항목**:

```typescript
interface PreflightResult {
  pass: boolean;
  checks: {
    portAvailable: { pass: boolean; detail: string }; // 목표 포트가 비어있는지
    nameAvailable: { pass: boolean; detail: string }; // 컨테이너 이름 중복 없는지
    resourceOk: { pass: boolean; detail: string }; // 디스크/메모리 여유
    proxyReady: { pass: boolean; detail: string }; // Traefik 정상 동작 중
  };
  warnings: string[]; // 치명적이진 않지만 알려야 할 것
}
```

**사용자에게 보이는 UX**:

```
You: frontend 배포해줘

🔍 Preflight check...
  ✅ Port 10003 available
  ✅ Name "frontend" available
  ✅ Disk: 12GB free
  ✅ Traefik: running (external mode)
  ⚠️ Memory: 85% used (14.2G/16G) — 빌드 시 느려질 수 있음

All clear. Building...
```

```
You: api 배포해줘

🔍 Preflight check...
  ❌ Port 8080 — already in use by "traefik" (external)
  ❌ Name "api" — container already exists (external, running)
  ✅ Disk: 12GB free
  ✅ Traefik: running

❌ 배포할 수 없습니다:
  - Port 8080은 traefik이 사용 중입니다. 다른 포트를 사용하세요.
  - "api" 이름의 컨테이너가 이미 존재합니다. 다른 이름을 지정하세요.
```

**수락기준**:

- [ ] `deploy_project` 파이프라인 시작 전에 `preflightCheck()` 함수가 실행된다
- [ ] 포트 충돌, 이름 충돌, 리소스 부족, 프록시 상태를 검사한다
- [ ] 하나라도 `pass: false`이면 빌드를 시작하지 않고 에러를 반환한다
- [ ] warnings는 빌드를 차단하지 않지만 사용자에게 표시한다
- [ ] 테스트: 포트 충돌 / 이름 충돌 / 리소스 부족 / 정상 통과 4가지 시나리오
- [ ] MCP 도구(`deploy_project`)에서도 preflight 결과가 반환된다

---

## 구현 순서 (의존성 기반)

```
Phase 1 (기반): 9-1 전체 컨테이너 스캔 → 9-2 포트 스캔 → 9-3 프록시 감지
   ↓ (9-1, 9-2, 9-3이 모두 완료되어야 아래 가능)
Phase 2 (활용): 9-4 시스템 프롬프트 확장 + 9-5 도구 추가 (병렬 가능)
   ↓
Phase 3 (UI):  9-6 Dashboard Server 섹션
   ↓
Phase 4 (킬러): 9-7 Preflight Check
```

Phase 1은 순차적 (9-1이 9-2에 사용됨, 9-1+9-2가 9-3에 사용됨).
Phase 2의 9-4와 9-5는 병렬 가능.
Phase 3은 Phase 1 결과만 필요.
Phase 4는 Phase 1+2 결과 필요.

---

## 테스트 계획

### 단위 테스트

| 함수                   | 테스트 파일                       | 핵심 시나리오                               |
| ---------------------- | --------------------------------- | ------------------------------------------- |
| `listAllContainers()`  | `test/pipeline/docker.test.ts`    | managed + unmanaged 혼합, Compose 그룹 인식 |
| `scanUsedPorts()`      | `test/pipeline/port.test.ts`      | DB + Docker + OS 합산, 충돌 감지            |
| `detectReverseProxy()` | `test/pipeline/traefik.test.ts`   | Traefik/Nginx/none 감지, 모드 전환          |
| `preflightCheck()`     | `test/pipeline/preflight.test.ts` | pass/fail 4가지 조합                        |
| 3개 도구               | `test/tools/server-tools.test.ts` | 정상 응답, 에러 처리                        |

### 통합 테스트 시나리오

1. **서버에 외부 컨테이너 5개 + OpenLander 프로젝트 2개** → Dashboard에 7개 표시, 구분 정확
2. **포트 8080 사용 중 + 배포 시도** → preflight에서 차단, 대안 포트 제시
3. **외부 Traefik 존재 + external 모드 전환** → OpenLander Traefik 중지, 라벨만 추가
4. **MCP 클라이언트에서 `list_all_containers` 호출** → 전체 컨테이너 반환

---

## 제거된 항목 (기존 v0.0.9-10-unified-spec.md 대비)

| 제거된 기능                                  | 이유                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| Import 프로세스 (DB 등록 + 관리 전환)        | 위험도 높음. 외부 컨테이너를 "관리"하기 시작하면 사고 범위 확대. 감지만으로 충분. |
| Import된 컨테이너 모니터링/중지/재시작       | Import 제거에 따라 불필요                                                         |
| `coexist` Traefik 모드                       | 복잡도 대비 실용성 낮음. managed와 external 2개면 충분.                           |
| 온보딩 대규모 개편 (환경 스캔 → Import 제안) | Import 제거 + 스코프 축소. 온보딩에는 프록시 감지 정보만 추가.                    |
| Dashboard "Discovered" 섹션의 Import 버튼    | Import 제거에 따라 불필요. 관찰(표시)만.                                          |
| `projects` 테이블 `source` 컬럼 확장         | Import 관련. 현재는 불필요.                                                       |

---

## 미래 고려사항 (이 버전에서 구현하지 않음)

- **Runtime Crash Analysis**: 배포 후 컨테이너 크래시 감지 + AI 분석 → v0.0.9 이후 별도 기능
- **MCP `get_server_context` 통합 도구**: 단일 호출로 서버 전체 스냅샷 반환 → IDE 에이전트용. 9-5의 3개 도구로 기능은 커버되지만, 단일 호출 편의성은 추후 추가 가능.
- **컨테이너 그룹핑**: Compose 그룹을 접을 수 있는 UI → Dashboard 고도화 시
