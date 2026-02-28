# 코드베이스 패턴 & 컨벤션

> 기존 코드의 패턴을 요약. 새 코드는 이 패턴을 따라야 한다.
> `.opencode/instructions.md`를 보완하는 실전 레퍼런스.

---

## 프로젝트 구조 컨벤션

### 파일 배치

```
새 파이프라인 함수 → src/pipeline/[관련 파일].ts에 추가
새 도구 → src/tools/registry.ts의 tools 배열에 추가
새 TUI 컴포넌트 → src/tui/components/
새 상태 → src/tui/state/
새 테스트 → test/[모듈명]/[파일명].test.ts
```

### Import 규칙

```typescript
// ESM — .js 확장자 필수
import { listManagedContainers } from './docker.js';
import { getSystemStats } from '../monitor/stats.js';
import type { ProjectRow } from '../db/index.js';

// SolidJS
import { createSignal, createEffect, Show, For } from 'solid-js';

// OpenTUI
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';

// 프로젝트 상태
import { theme } from '../theme.js';
import { focus } from '../state/focus.js';
import { overlayActive } from '../state/overlay.js';
```

---

## Pipeline 패턴

### 함수 추가 패턴 (docker.ts 예시)

```typescript
// 기존: label 필터가 있는 함수
export async function listManagedContainers(): Promise<ContainerInfo[]> {
  const containers = await docker.listContainers({
    filters: { label: ['openlander.managed=true'] },
  });
  return containers.map(formatContainer);
}

// 새로 추가할 때: 같은 파일, 같은 패턴, 다른 필터
export async function listAllContainers(): Promise<AllContainerInfo[]> {
  const containers = await docker.listContainers({ all: true });
  return containers.map((c) => ({
    ...formatContainer(c),
    managedByOpenLander: c.Labels['openlander.managed'] === 'true',
    composeProject: c.Labels['com.docker.compose.project'] || null,
  }));
}
```

**패턴**: 기존 함수를 복사 → 필터/반환 타입 수정 → 기존 함수는 건드리지 않음.

### 에러 처리 패턴

```typescript
// pipeline 모듈의 일반적인 에러 처리
import { log } from '../lib/logger.js';

export async function someFunction(): Promise<Result> {
  try {
    const result = await docker.someOperation();
    return result;
  } catch (error) {
    log.error('Operation failed:', error);
    throw error; // 또는 적절한 에러 변환
  }
}
```

### 타입 정의 패턴

```typescript
// 인터페이스는 같은 파일 상단 또는 types.ts에 정의
// pipeline/types.ts에 공유 타입이 있음

interface PortScanResult {
  db: number[];
  docker: number[];
  os: number[];
  all: number[];
  conflicts: number[];
}
```

---

## Tools (registry.ts) 패턴

### 도구 추가 템플릿

```typescript
{
  name: 'my_tool_name',  // snake_case
  description: 'One-line description of what this tool does',
  targets: ['tui', 'mcp', 'api'],  // 노출 채널
  inputSchema: myToolSchema,  // zod 또는 JSON schema
  parameters: {
    param_name: {
      type: 'string',
      description: 'What this parameter is for',
      required: true,
    },
  },
  async execute(args: Record<string, unknown>, context: ToolContext) {
    const paramName = args.param_name as string;
    // ... 구현
    return { result: 'success', data: ... };
  },
},
```

### Schema 정의

```typescript
// 파일 상단에 zod-like schema 정의
const myToolSchema = {
  param_name: {
    type: 'string' as const,
    description: 'Description',
    required: true,
  },
};
```

---

## TUI 컴포넌트 패턴

> 상세: `.opencode/skills/opentui/SKILL.md`

### 섹션 추가 패턴 (DashboardPanel 예시)

```tsx
// 기존 섹션 패턴을 따름
function ServerSection() {
  const [data, setData] = createSignal<ServerData | null>(null);

  // 폴링 (기존 패턴: 3초)
  const interval = setInterval(async () => {
    const result = await fetchServerData();
    setData(result);
  }, 3000);

  onCleanup(() => clearInterval(interval));

  return (
    <box flexDirection="column">
      <text bold fg={theme.primary}>
        ▸ Server
      </text>
      <Show when={data()} fallback={<text dim>Loading...</text>}>
        {/* 컨텐츠 */}
      </Show>
    </box>
  );
}
```

---

## 테스트 패턴

### 파일 구조

```
test/
├── pipeline/
│   ├── docker.test.ts
│   ├── port.test.ts
│   └── traefik.test.ts
├── tools/
│   └── registry.test.ts
├── db/
│   └── queries.test.ts
└── ...
```

### 테스트 작성 패턴

```typescript
import { describe, it, expect, beforeEach, mock } from 'bun:test';

describe('listAllContainers', () => {
  it('returns all containers without label filter', async () => {
    // Arrange: mock dockerode
    // Act: call function
    // Assert: verify no filter applied, all containers returned
  });

  it('marks managed containers correctly', async () => {
    // managed + unmanaged 혼합 시나리오
  });

  it('identifies compose groups', async () => {
    // com.docker.compose.project 라벨 인식
  });
});
```

### Mock 패턴

```typescript
// dockerode mock
const mockDocker = {
  listContainers: mock(() => Promise.resolve([
    { Id: '123', Names: ['/test'], Labels: { 'openlander.managed': 'true' }, ... },
    { Id: '456', Names: ['/external'], Labels: {}, ... },
  ])),
};
```

---

## DB 패턴

### 쿼리 추가

```typescript
// src/db/queries.ts (또는 해당 파일)
// Drizzle ORM 사용

export function getUsedPorts(db: Database): number[] {
  const projects = db.select().from(schema.projects).all();
  return projects.map((p) => p.port).filter(Boolean);
}
```

### 스키마 변경 시 (v0.0.10 등)

```typescript
// src/db/schema.ts
export const globalSecrets = sqliteTable('global_secrets', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  key: text('key').notNull().unique(),
  encryptedValue: text('encrypted_value').notNull(),
  iv: text('iv').notNull(),
  createdAt: integer('created_at')
    .notNull()
    .$defaultFn(() => Date.now()),
  updatedAt: integer('updated_at')
    .notNull()
    .$defaultFn(() => Date.now()),
});
```

---

## 공통 유틸리티

### 로깅

```typescript
import { log } from '../lib/logger.js';

log.info('Scanning containers...');
log.warn('Port 8080 already in use');
log.error('Failed to scan:', error);
```

### OS 명령 실행

```typescript
import { $ } from 'bun';

// Bun shell로 OS 명령 실행
const result = await $`ss -tlnp`.text();
// 또는
const { stdout } = Bun.spawn(['ss', '-tlnp']);
```

---

## 하지 말 것 (Anti-patterns)

```typescript
// ❌ as any
const result = someFunction() as any;

// ❌ @ts-ignore
// @ts-ignore
someCall();

// ❌ 빈 catch
try { ... } catch(e) {}

// ❌ CSS named colors
<text fg="red">  // ❌
<text fg={theme.error}>  // ✅

// ❌ 기존 함수 시그니처 변경
export async function listManagedContainers(includeAll?: boolean)  // ❌ 기존 함수에 파라미터 추가
export async function listAllContainers()  // ✅ 새 함수 추가

// ❌ .ts 확장자 import
import { foo } from './bar.ts';  // ❌
import { foo } from './bar.js';  // ✅
```
