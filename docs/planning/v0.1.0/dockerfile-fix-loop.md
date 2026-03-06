# v0.1.0 — 에이전트 경유 Dockerfile 수정 루프

> **버전**: v0.1.0 보완 (Dockerfile 자동 수정 루프)
> **관련 결정**: 없음 (신규 기능)
> **작성일**: 2026-03-06
> **상태**: 📋 기획 초안 — Tech Lead 리뷰 대기

---

## 0. Tech Lead 리뷰 대기

이 문서는 v0.1.0 보완으로 제안된 스펙 초안입니다. 아직 Tech Lead 리뷰를 거치지 않았습니다.

---

## 1. 개요

### 한 줄 요약

Dockerfile 생성 오류(잘못된 Node 버전 등)로 빌드 실패 시, 에이전트가 소스코드 분석 후 새 Dockerfile을 제안 → 파이프라인이 적용 후 재빌드 → 최대 3회 반복하여 해결.

### 핵심 문제

사용자가 `lehdqlsl/loan-calculator` (Next.js 15)를 배포하려 할 때:

- 결정론적 Dockerfile 템플릿(tier 2)이 `node:18.20.4-alpine`을 생성
- 하지만 Next.js 15는 `>=20.9.0` 필요
- 빌드 실패 → 현재 시스템에는 **고칠 경로가 없음**

**현재 시스템의 한계:**

- `Tier 1 (build-recovery.ts)`: 인프라 문제만(port, cache, disk). Dockerfile 재작성 불가.
- `Tier 2 (build-recovery.ts)`: 제안만, 자동 수정 불가.
- `Tier 3 (build-recovery.ts)`: 분석만, 수정 불가.
- `debug_build_error` 툴: Read-only 분석.
- LLM Dockerfile 생성(`auto-detect.ts`): Tier 2가 프레임워크 감지 못할 때만 실행. 틀린 Dockerfile 생성 시 호출 안 됨.

### 해결 방법

빌드 실패 시 Dockerfile 관련 오류라면 → 에이전트가 소스코드 + 빌드 에러 분석 → 새 Dockerfile 콘텐츠 제안 → 파이프라인이 쓰기 → 재빌드 → 최대 3회 반복 → 3회 초과 시 사용자에게 문맥 표시

---

## 2. 변경 범위

### 영향받는 파일/모듈

| 파일/모듈                        | 변경 내용                                               |
| -------------------------------- | ------------------------------------------------------- |
| `src/pipeline/build-recovery.ts` | Dockerfile 관련 오류 탐지 패턴 추가(tier 2.5 신규)      |
| `src/agent/tools.ts`             | `fix_dockerfile` 도구 신규 추가                         |
| `src/pipeline/deploy.ts`         | 빌드 실패 시 Dockerfile 수정 루프 로직 추가             |
| `src/agent/debugger.ts`          | `fixDockerfile` 메서드 추가 (LLM 기반 Dockerfile 생성)  |
| `src/pipeline/dockerfile-gen.ts` | 변경 없음(기존 템플릿 유지)                             |
| `src/pipeline/auto-detect.ts`    | 변경 없음(기존 LLM 생성 로직 유지)                      |
| `web/src/components/timeline/*`  | Dockerfile 수정 제안 카드 컴포넌트 신규                 |
| `web/src/lib/api.ts`             | `fix_dockerfile` API 호출 함수 신규                     |
| `src/web/api/routes.ts`          | `POST /api/projects/:id/fix-dockerfile` 엔드포인트 신규 |

### 새로 생성할 파일

- 없음 (기존 파일 확장)

---

## 3. 기능별 상세

### 3-1: Dockerfile 관련 빌드 오류 탐지 (Build Recovery 확장)

#### 현재 상태 (AS-IS)

`build-recovery.ts`의 `CATEGORY_DEFINITIONS`에서 Dockerfile 관련 오류는 없음. 현재는 인프라 문제만 처리:

- `port-conflict`, `cache-corrupt`, `disk-full`, `network-error` (Tier 1)
- `base-image`, `missing-dependency`, `env-missing` (Tier 2 - 제안만)
- `compile-error`, `test-failure` (Tier 3 - 정보만)

#### 목표 상태 (TO-BE)

Dockerfile 콘텐츠 오류를 탐지하는 신규 카테고리 `dockerfile-content` 추가(tier 2.5):

```typescript
{
  category: 'dockerfile-content',
  tier: 2.5 as const,  // 신규 티어
  autoFixable: true,   // 에이전트가 자동 수정 제안 가능
  suggestible: false,   // 제안만(tier 2)이 아님, 자동 루프
  message: 'Dockerfile content appears invalid or incompatible with project requirements.',
  suggestedAction: undefined,  // 자동 수정 루프이므로 제안 불필요
  patterns: [
    /version.*not supported/i,                // Node 버전 미지원
    /python version.*not found/i,            // Python 버전 미지원
    /golang version.*not found/i,            // Go 버전 미지원
    /unexpected token.*dockerfile/i,          // Dockerfile 문법 오류
    /failed to solve.*process.*dockerfile/i,  // Dockerfile 실행 실패
    /error building image.*dockerfile/i,      // 이미지 빌드 오류
    /base image.*not found/i,                // 존재하지 않는 베이스 이미지
  ],
}
```

#### 구현 방향 (HOW)

**파일**: `src/pipeline/build-recovery.ts`

1. `BuildTier` 타입 확장:

   ```typescript
   export type BuildTier = 1 | 2 | 2.5 | 3; // 2.5 추가
   ```

2. `CATEGORY_DEFINITIONS` 배열에 위 `dockerfile-content` 항목 추가

3. `BuildRecoveryResult` 인터페이스에 `autoFixable: true`인 경우 에이전트가 자동 수정 가능하다는 플래그 추가 (기존과 동일)

4. `deploy.ts`에서 `recovery.attemptTier1Fix` 호출 로직 수정 → `tier === 1 || tier === 2.5`인 경우 자동 수정 시도

#### 수락기준

- [x] **AC-3-1-1**: `CATEGORY_DEFINITIONS`에 `dockerfile-content` 카테고리 추가
  - 검증: `build-recovery.ts`의 `CATEGORY_DEFINITIONS` 배열에 위 패턴 7개가 포함되어 있음
- [x] **AC-3-1-2**: Node 버전 관련 빌드 오류(`version not supported`, `requires >=20.9.0` 등)가 `tier: 2.5`로 분류됨
  - 검증: `lehdqlsl/loan-calculator` (Next.js 15 + Node 18) 빌드 실패 시 `classify()` 반환값의 `tier`가 `2.5`임
- [x] **AC-3-1-3**: Dockerfile 문법 오류(`unexpected token` 등)도 `tier: 2.5`로 분류됨
  - 검증: 잘못된 Dockerfile로 빌드 시 `tier: 2.5` 반환
- [x] **AC-3-1-4**: `BuildTier` 타입에 `2.5`가 포함됨
  - 검증: TypeScript 컴파일 통과, 타입 에러 없음

---

### 3-2: 에이전트 Dockerfile 수정 도구 (`fix_dockerfile`)

#### 현재 상태 (AS-IS)

`debug_build_error` 툴만 있으며, Read-only 분석만 수행. Dockerfile을 생성/수정하는 기능 없음.

#### 목표 상태 (TO-BE)

`fix_dockerfile` 도구를 통해 에이전트가 소스코드 + 빌드 에러를 분석하고 새 Dockerfile 콘텐츠를 제안.

#### 구현 방향 (HOW)

**파일**: `src/agent/tools.ts`

```typescript
fix_dockerfile: tool({
  description: 'Analyze build failure and generate a fixed Dockerfile using AI. Use when a build fails with dockerfile-content error. Returns { dockerfileContent, explanation }. Errors: PROJECT_NOT_FOUND, NO_BUILD_ERROR if last deploy succeeded or error is not dockerfile-related.',
  inputSchema: z.object({
    project_name: z.string().describe('Name of project with Dockerfile build error'),
  }),
  execute: async ({ project_name }) => {
    const project = ctx.db.getProjectByName(project_name);
    if (!project) throw new ProjectNotFoundError(project_name);

    const lastDeploy = ctx.db.getLastDeployLog(project.id);
    if (!lastDeploy || lastDeploy.status !== 'failed') {
      return { error: 'No failed build found for this project.' };
    }

    // Dockerfile 콘텐츠 읽기
    const dockerfilePath = join(project.clone_path, 'Dockerfile');
    const currentDockerfile = readFileSync(dockerfilePath, 'utf8');

    // buildDebugger.fixDockerfile 호출 (LLM 기반 새 Dockerfile 생성)
    const fixResult = await ctx.buildDebugger.fixDockerfile({
      projectPath: project.clone_path,
      currentDockerfile,
      buildError: lastDeploy.build_log ?? 'No build log available',
      projectName: project_name,
    });

    return fixResult;
  },
}),
```

**파일**: `src/agent/debugger.ts`

```typescript
interface FixDockerfileInput {
  projectPath: string;
  currentDockerfile: string;
  buildError: string;
  projectName: string;
}

interface FixDockerfileOutput {
  dockerfileContent: string;
  explanation: string;
  changes: string[];  // 변경 사항 요약 (e.g., ["Updated Node.js from 18.20.4 to 20.12.2"])
}

// BuildDebugger 클래스에 메서드 추가
async fixDockerfile(input: FixDockerfileInput): Promise<FixDockerfileOutput> {
  if (!this.model) {
    throw new Error('Build debugger requires an LLM provider.');
  }

  const context = this.autoDetector.collectContext(input.projectPath);

  const systemPrompt = `You are an expert DevOps engineer specializing in Dockerfile debugging.
Given the current Dockerfile, build error, and project context, generate a FIXED Dockerfile.

Rules:
1. Output ONLY the new Dockerfile content, no explanation, no markdown fences.
2. Fix the specific error shown in the build log (e.g., wrong Node.js version, missing dependencies).
3. Keep the same structure (multi-stage build, EXPOSE port, etc.) unless it causes the error.
4. After the Dockerfile, on a new line starting with "CHANGES:", summarize what you changed in 1-3 bullet points.`;

  const userPrompt = `Project name: ${input.projectName}
Project path: ${input.projectPath}

Current Dockerfile:
${input.currentDockerfile}

Build error:
${input.buildError}

Project context:
${context}`;

  const response = await generateText({
    model: this.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const { dockerfileContent, changes } = this.parseFixResponse(response.text);

  return {
    dockerfileContent,
    explanation: 'Fixed Dockerfile based on build error and project context.',
    changes,
  };
}

private parseFixResponse(raw: string): { dockerfileContent: string; changes: string[] } {
  const lines = raw.split('\n');
  const changesLineIndex = lines.findIndex(line => line.trim().startsWith('CHANGES:'));

  let dockerfileContent = raw;
  const changes: string[] = [];

  if (changesLineIndex !== -1) {
    dockerfileContent = lines.slice(0, changesLineIndex).join('\n').trim();
    const changesText = lines.slice(changesLineIndex + 1).join('\n').trim();
    // 파싱: "CHANGES:" 다음 줄부터 "-"로 시작하는 각 라인
    for (const line of changesText.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
        changes.push(trimmed.replace(/^[-*]\s*/, ''));
      }
    }
  }

  return { dockerfileContent, changes };
}
```

#### 수락기준

- [x] **AC-3-2-1**: `tools.ts`에 `fix_dockerfile` 도구 추가됨
  - 검증: `src/agent/tools.ts` 파일에 `fix_dockerfile: tool({...})` 정의 존재
- [x] **AC-3-2-2**: `fix_dockerfile` 도구 호출 시 `buildDebugger.fixDockerfile()` 실행
  - 검증: 도구의 `execute` 함수에서 `ctx.buildDebugger.fixDockerfile()` 호출 확인
- [x] **AC-3-2-3**: `debugger.ts`에 `fixDockerfile` 메서드 추가됨
  - 검증: `src/agent/debugger.ts` 파일에 `async fixDockerfile()` 메서드 존재
- [x] **AC-3-2-4**: `fixDockerfile`가 `dockerfileContent`, `explanation`, `changes`를 반환
  - 검증: 반환 타입이 `FixDockerfileOutput` 인터페이스와 일치함
- [x] **AC-3-2-5**: LLM 응답에서 Dockerfile 콘텐츠와 변경 요약을 올바르게 파싱
  - 검증: `parseFixResponse` 메서드가 "CHANGES:" 줄 이전은 Dockerfile, 이후는 변경 요약으로 분리함

---

### 3-3: 파이프라인 Dockerfile 수정 루프 (Deploy 확장)

#### 현재 상태 (AS-IS)

`deploy.ts`의 빌드 실패 처리:

- Tier 1 오류만 자동 수정 후 재시도(`attemptTier1Fix`)
- Tier 2는 제안만(`build:suggest` 이벤트)
- Tier 3는 정보만(`build:inform` 이벤트)
- Dockerfile 관련 오류는 처리 로직 없음

#### 목표 상태 (TO-BE)

빌드 실패 시 `tier === 2.5`이면 Dockerfile 수정 루프 실행:

1. 에이전트에게 Dockerfile 수정 요청 (`fix_dockerfile` 툴 내부 호출, not via agent chat)
2. 새 Dockerfile 콘텐츠 수신
3. Dockerfile 덮어쓰기
4. `_retryCount` 증가 후 재배포 (`return await this.deploy(retryConfig)`)
5. 최대 3회 반복 (`retryCount < 3`)

#### 구현 방향 (HOW)

**파일**: `src/pipeline/deploy.ts`

```typescript
// deploy() 메서드의 catch 블록에서 recovery 로직 확장

catch (error) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const failStep = this.detectFailStep(buildLog);
  const buildLogWithError = buildLog + `[error] ${errorMsg}\n`;
  const retryCount = config._retryCount ?? 0;
  this.jobManager?.updatePhase(projectId, 'failed', errorMsg);

  try {
    const recovery = new BuildRecovery(this.docker, this.db, eventBus);
    const failedStep: BuildContext['failedStep'] =
      failStep === 'clone' ||
      failStep === 'dockerfile' ||
      failStep === 'build' ||
      failStep === 'run'
        ? failStep
        : 'build';

    const recoveryContext: BuildContext = {
      projectId,
      projectName,
      imageTag,
      clonePath,
      buildLog: buildLogWithError,
      failedStep,
    };

    const classification = recovery.classify(buildLogWithError, recoveryContext);

    // Tier 1: 인프라 자동 수정 (기존)
    if (classification.tier === 1 && classification.autoFixable && retryCount < 2) {
      const fixResult = await recovery.attemptTier1Fix(classification, recoveryContext);

      if (fixResult.fixed && fixResult.retryNeeded) {
        const nextRetryCount = retryCount + 1;
        const retryConfig: ProjectConfig = {
          ...config,
          name: projectName,
          _projectId: projectId,
          _retryCount: nextRetryCount,
        };

        if (classification.category === 'cache-corrupt') {
          retryConfig._noCacheBuild = true;
        }

        buildLog += `[recovery] Tier 1 auto-fix: ${fixResult.action}\n`;
        return await this.deploy(retryConfig);
      }
    }

    // Tier 2.5: Dockerfile 자동 수정 (신규)
    if (classification.tier === 2.5 && classification.autoFixable && retryCount < 3) {
      if (!this.buildDebugger) {
        await eventBus.emit('build:inform', {
          projectId,
          summary: 'Dockerfile error detected but no LLM configured. Fix Dockerfile manually.',
          tier: 3,
        });
      } else {
        // Dockerfile 수정 루프
        buildLog += `[recovery] Dockerfile content error detected. Attempting fix...\n`;

        const fixResult = await this.buildDebugger.fixDockerfile({
          projectPath: cloneResult.path,
          currentDockerfile: readFileSync(join(cloneResult.path, 'Dockerfile'), 'utf8'),
          buildError: buildLogWithError,
          projectName,
        });

        // 새 Dockerfile 쓰기
        const dockerfilePath = join(cloneResult.path, 'Dockerfile');
        writeFileSync(dockerfilePath, fixResult.dockerfileContent + '\n', 'utf8');

        buildLog += `[recovery] Fixed Dockerfile:\n${fixResult.changes.map(c => `  - ${c}`).join('\n')}\n`;

        // 이벤트 발생 (타임라인 표시용)
        await eventBus.emit('build:dockerfile-fixed', {
          projectId,
          changes: fixResult.changes,
          explanation: fixResult.explanation,
          retryCount: retryCount + 1,
        });

        // 재배포
        const nextRetryCount = retryCount + 1;
        const retryConfig: ProjectConfig = {
          ...config,
          name: projectName,
          _projectId: projectId,
          _retryCount: nextRetryCount,
          _noCacheBuild: true,  // Dockerfile 변경이니 항상 no-cache
        };

        return await this.deploy(retryConfig);
      }
    }

    // Tier 2: 제안 (기존)
    if (
      classification.tier === 2 &&
      classification.suggestible &&
      classification.suggestedAction
    ) {
      await eventBus.emit('build:suggest', {
        projectId,
        suggestion: classification.suggestedAction,
      });
    }

    // Tier 3: 정보 (기존)
    if (classification.tier === 3) {
      const summary = recovery.extractErrorSummary(buildLogWithError);
      await eventBus.emit('build:inform', { projectId, summary, tier: 3 });
    }
  } catch (recoveryError) {
    log.warn(
      { err: recoveryError, projectId },
      'Build recovery failed; falling back to default error flow',
    );
  }

  this.db.updateProject(projectId, { status: 'error' });
  // ... 기존 에러 처리 로직
}
```

#### 수락기준

- [x] **AC-3-3-1**: `tier === 2.5`이면 Dockerfile 수정 루프 실행
  - 검증: `deploy.ts`의 catch 블록에 `if (classification.tier === 2.5 && ...)` 분기 존재
- [x] **AC-3-3-2**: Dockerfile 수정 루프 최대 3회 반복 (`retryCount < 3`)
  - 검증: 조건문이 `retryCount < 3`이고, 3회 초과 시 루프 진입 안 함
- [x] **AC-3-3-3**: Dockerfile 덮어쓰기 전에 원본을 백업하지 않음 (덮어쓰기만 수행)
  - 검증: 코드에 백업 로직(`cp Dockerfile Dockerfile.backup` 등)이 없음
- [x] **AC-3-3-4**: Dockerfile 수정 후 항상 `no-cache` 빌드로 재시도
  - 검증: `retryConfig._noCacheBuild = true` 설정 확인
- [x] **AC-3-3-5**: `build:dockerfile-fixed` 이벤트 발생으로 타임라인에 수정 내역 표시
  - 검증: `eventBus.emit('build:dockerfile-fixed', {...})` 호출 확인
- [x] **AC-3-3-6**: 3회 초과 시 일반 에러 플로우로 진입 (`status: 'error'`)
  - 검증: `retryCount >= 3`인 경우 루프 진입하지 않고 `this.db.updateProject({ status: 'error' })` 실행됨

---

### 3-4: Web UI Dockerfile 수정 표시

#### 현재 상태 (AS-IS)

Web UI 타임라인에 빌드 실패 시 "Fix with AI" 버튼만 표시. Dockerfile 수정 내역 별도 표시 없음.

#### 목표 상태 (TO-BE)

`build:dockerfile-fixed` 이벤트 수신 시 타임라인에 Dockerfile 수정 카드 표시:

- 수정 내용 요약 (`changes` 배열)
- 재시도 횟수 (`retryCount`)
- 설명 (`explanation`)

#### 구현 방향 (HOW)

**파일**: `web/src/lib/event-types.ts`

```typescript
export interface DockerfileFixedEvent {
  type: 'dockerfile-fixed';
  projectId: string;
  changes: string[]; // ["Updated Node.js from 18.20.4 to 20.12.2", "Fixed missing dependency"]
  explanation: string;
  retryCount: number;
}
```

**파일**: `web/src/components/timeline/DockerfileFixedCard.tsx` (신규)

```typescript
interface DockerfileFixedCardProps {
  event: DockerfileFixedEvent;
}

export function DockerfileFixedCard({ event }: DockerfileFixedCardProps) {
  return (
    <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
      <div className="flex items-center gap-2 text-yellow-800 dark:text-yellow-200 mb-2">
        <span>🔧</span>
        <span className="font-semibold">Dockerfile Fixed (attempt {event.retryCount}/3)</span>
      </div>
      <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">{event.explanation}</p>
      <ul className="list-disc list-inside text-sm text-gray-700 dark:text-gray-300">
        {event.changes.map((change, i) => (
          <li key={i}>{change}</li>
        ))}
      </ul>
    </div>
  );
}
```

**파일**: `web/src/components/timeline/Timeline.tsx`

```typescript
// useTimeline 훅 또는 NDJSON 스트림 핸들러에 'dockerfile-fixed' 이벤트 처리 추가
if (eventType === 'dockerfile-fixed') {
  return <DockerfileFixedCard event={event} />;
}
```

#### 수락기준

- [x] **AC-3-4-1**: `event-types.ts`에 `DockerfileFixedEvent` 인터페이스 추가
  - 검증: `web/src/lib/event-types.ts` 파일에 인터페이스 정의 존재
- [x] **AC-3-4-2**: `DockerfileFixedCard` 컴포넌트 생성됨
  - 검증: `web/src/components/timeline/DockerfileFixedCard.tsx` 파일 존재
- [x] **AC-3-4-3**: Dockerfile 수정 카드에 변경 내용(`changes`)과 재시도 횟수(`retryCount`) 표시
  - 검증: 컴포넌트가 `event.changes`와 `event.retryCount`를 렌더링함
- [x] **AC-3-4-4**: 타임라인에 `dockerfile-fixed` 이벤트가 표시됨
  - 검증: 배포 후 Dockerfile 수정 시 TimelineItem이 `DockerfileFixedCard`로 렌더링됨

---

## 4. 구현 순서

의존성 기반 순서:

1. **build-recovery.ts 확장** (0.5일)
   - `BuildTier`에 `2.5` 추가
   - `CATEGORY_DEFINITIONS`에 `dockerfile-content` 카테고리 추가
   - 단위 테스트 추가 (각 패턴 매칭 검증)

2. **debugger.ts `fixDockerfile` 메서드** (1일)
   - `FixDockerfileInput`, `FixDockerfileOutput` 인터페이스 정의
   - `fixDockerfile` 메서드 구현 (LLM 호출)
   - `parseFixResponse` 메서드 구현
   - 단위 테스트 추가 (LLM 응답 파싱 검증)

3. **tools.ts `fix_dockerfile` 도구** (0.5일)
   - 도구 정의 및 `buildDebugger.fixDockerfile()` 호출
   - MCP 레지스트리에 등록 (MCP에서도 사용 가능)
   - 단위 테스트 추가

4. **deploy.ts Dockerfile 수정 루프** (1일)
   - `tier === 2.5` 분기 추가
   - Dockerfile 덮어쓰기 + 재배포 로직
   - `build:dockerfile-fixed` 이벤트 발생
   - 최대 3회 제한 로직
   - 통합 테스트 추가

5. **Web UI Dockerfile 수정 카드** (0.5일)
   - `event-types.ts`에 인터페이스 추가
   - `DockerfileFixedCard` 컴포넌트 구현
   - Timeline에 이벤트 매핑
   - 스타일링

6. **통합 테스트 + 도그푸딩** (2일)
   - E2E 테스트: Next.js 15 + Node 18 케이스로 자동 수정 검증
   - 3회 초과 시 정상 에러 플로우 진입 검증
   - Dockerfile 수정 내역 타임라인 표시 검증

**총 공수**: ~5.5일

---

## 5. 테스트 계획

### v0.1.0 Dockerfile 수정 루프 도그푸딩 체크리스트

#### 환경 준비

- [ ] OpenLander 서버 실행 중
- [ ] LLM 설정 완료 (Gemini Flash 또는 OpenAI)
- [ ] Docker 실행 중
- [ ] Web UI 접속 가능 (`http://localhost:10003`)

#### 테스트 항목

##### 시나리오 1: Next.js 15 + 잘못된 Node 버전 (자동 수정)

사전조건:

- `lehdqlsl/loan-calculator` 또는 유사한 Next.js 15 레포

절차:

1. Web UI에서 "New Project" 클릭
2. 레포 URL 입력 후 "Deploy" 클릭
3. 빌드 실패 대기 (Node 버전 오류)
4. 자동으로 Dockerfile 수정이 시도되는지 확인
5. 타임라인에 "Dockerfile Fixed (attempt 1/3)" 카드 표시 확인
6. 변경 내용 요약 확인 (e.g., "Updated Node.js from 18.20.4 to 20.12.2")
7. 재빌드가 성공하는지 확인
8. 프로젝트가 실행 중 상태인지 확인
9. URL 접속하여 앱 동작 확인

기대결과:

- 1회 시도에 Dockerfile 수정 성공
- 재빌드 성공
- 타임라인에 수정 내역 표시

확인방법:

- 타임라인의 `DockerfileFixedCard` 확인
- Project 상태가 `running`인지 확인
- URL 접속 후 앱 렌더링 확인

---

##### 시나리오 2: Dockerfile 문법 오류 (자동 수정)

사전조건:

- 테스트 레포에 잘못된 Dockerfile 준비 (`FROm node:20-alpine` 등)

절차:

1. 레포에 잘못된 Dockerfile 커밋
2. OpenLander에서 배포 시도
3. 빌드 실패 대기 (문법 오류)
4. 자동으로 Dockerfile 수정이 시도되는지 확인
5. 타임라인에 수정 카드 표시 확인
6. 재빌드 성공 확인

기대결과:

- LLM이 문법 오류를 수정
- 재빌드 성공

확인방법:

- 타임라인 확인
- 최종 Dockerfile 내용 검증 (`FROm` → `FROM` 수정됨)

---

##### 시나리오 3: 3회 반복 후 실패 (사용자 인터벤션)

사전조건:

- Dockerfile 수정으로 해결 불가능한 빌드 오류 (e.g., 소스코드 컴파일 오류)

절차:

1. 테스트 레포에 고의로 빌드 실패하는 코드 커밋
2. OpenLander에서 배포 시도
3. Dockerfile 관련 오류가 아님에도 Dockerfile 수정이 시도되지 않는지 확인 (tier 분류 정확성)
4. Dockerfile 관련 오류인 경우 3회 시도 후 실패 확인
5. 타임라인에 3개의 "Dockerfile Fixed" 카드 표시 확인
6. 최종적으로 에러 상태로 표시 확인
7. "Fix with AI" 버튼 클릭 후 `debug_build_error` 툴로 분석 가능한지 확인

기대결과:

- Dockerfile 관련 오류만 수정 시도
- 3회 초과 시 에러 상태
- 사용자가 수동으로 `debug_build_error`로 분석 가능

확인방법:

- 타임라인 카드 개수 확인
- 프로젝트 상태 `error` 확인
- "Fix with AI" 버튼 클릭 가능 확인

---

##### 시나리오 4: LLM 미설정 시 폴백

사전조건:

- LLM 설정되지 않은 상태

절차:

1. LLM 설정 해제
2. Next.js 15 레포 배포 시도
3. Dockerfile 수정이 시도되지 않는지 확인
4. 에러 메시지에 "no LLM configured" 포함 확인

기대결과:

- Dockerfile 수정 루프 진입 안 함
- 사용자에게 명확한 에러 메시지 표시

확인방법:

- 타임라인에 에러 메시지 확인
- `build:inform` 이벤트 내용 확인

---

##### 시나리오 5: 사용자 Dockerfile 유지 (수정 불필요)

사전조건:

- 이미 올바른 Dockerfile이 있는 레포

절차:

1. 정상적인 레포 배포
2. 빌드 성공
3. Dockerfile 수정이 시도되지 않는지 확인

기대결과:

- Dockerfile 수정 루프 진입 안 함

확인방법:

- 타임라인에 `DockerfileFixedCard`가 없는지 확인
- 최초 빌드 성공인지 확인

---

## 6. 리스크

| 리스크                                         | 확률 | 대응                                                       |
| ---------------------------------------------- | ---- | ---------------------------------------------------------- |
| LLM이 Dockerfile를 더 망가뜨림                 | 중간 | 3회 제한 + no-cache 빌드. 3회 초과 시 사용자 인터벤션 유도 |
| LLM 응답 시간이 길어서 전체 배포 지연          | 낮음 | 3회 시도해도 총 5분 이내 (LLM 응답 ~30초 × 3)              |
| 잘못된 패턴 분류로 Dockerfile 아닌 것을 수정함 | 낮음 | 패턴 구체화 + 단위 테스트로 탐지 정확도 확보               |
| 사용자 Dockerfile를 덮어써서 의도치 않은 변경  | 중간 | 타임라인에 변경 내역 명시적으로 표시. Git으로 복원 가능    |
| 비용 (LLM 호출) 증가                           | 낮음 | 3회 제한 + Dockerfile 관련 오류에만 호출                   |

---

## 7. 핵심 원칙 준수 확인

### "LLM은 대화/해석/설명만. 배포 실행은 100% 결정론적 파이프라인."

✅ **준수**: 에이전트는 Dockerfile 콘텐츠만 제안 (`fixDockerfile` 반환값). 실제 파일 쓰기와 재배포는 `deploy.ts` 파이프라인이 결정론적으로 수행.

### "에이전트는 제안만 한다. 자율 실행은 인프라에서 위험하다."

✅ **준수**: 에이전트가 Dockerfile 수정을 스스로 결정하여 실행하는 것이 아니라, **빌드 실패라는 이벤트**에 대해 파이프라인이 요청하는 형태. 3회 제한으로 무한 루프 방지. 사용자에게 타임라인을 통해 모든 변경 내역 투명하게 표시.

### 1인 메인테이너 스코프 준수

✅ **준수**: 범위가 Dockerfile 콘텐츠 오류로 명확히 제한됨. 일반적인 빌드 오류(컴파일, 테스트 실패 등)는 Tier 3로 분류하여 수동 분석 유도.

---

## 8. Phase 2 (후속 버전) 범위

v0.1.0에서 명시적으로 **하지 않는 것**:

1. **일반적인 빌드 오류 자동 수정**: Dockerfile 콘텐츠 오류(tier 2.5)만 자동 수정. 소스코드 컴파일 오류는 수동 분석(`debug_build_error`)로 유지.
2. **Dockerfile 백업/롤백**: Git history가 있으므로 OpenLander 차원의 백업 불필요.
3. **사용자 Dockerfile 힌트**: `.dockerfile-hint` 등 파일로 사용자 의도 파앱 (향후 고려).
4. **에이전트 채팅을 통한 Dockerfile 수정 요청**: Web UI에서 "Fix Dockerfile with AI" 버튼으로 수동 요청만 가능. 에이전트 채팅에서는 아직 지원 안 함.

---

## 9. 관련 문서

- `docs/planning/v0.1.0/web-deploy-agent-mediated.md` — 에이전트 경유 패턴 참조
- `docs/planning/v0.0.11/agent-proactivity.md` — 에이전트 제안 원칙 참조
- `.opencode/skills/project-owner/references/decision-log.md` — DEC-001 (Import 제거), DEC-022 (에이전트 경유)
- `src/pipeline/build-recovery.ts` — 기존 티어 구조 참조
- `src/agent/tools.ts` — `debug_build_error` 도구 참조
- `src/pipeline/dockerfile-gen.ts` — 결정론적 Dockerfile 생성 참조
