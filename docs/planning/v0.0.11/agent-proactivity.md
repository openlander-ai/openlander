# v0.0.11 — Agent Proactivity (에이전트 능동성)

# v2 — Web 컨텍스트 반영

> **상태**: 📋 기획 초안 (Web 적용) | **이전 버전**: v0.1.0 Web MVP (구현 완료)
>
> 이 기능은 OpenLander가 **"서버 상태를 아는 배포 에이전트"**에서 **"서버 상태를 알고, 먼저 말해주는 배포 에이전트"**로 진화하는 핵심 피처다.
>
> **v2 변경사항**: TUI → Web 플랫폼 전환에 따른 스펙 재정의. 채팅 메시지 대신 **Timeline Items** 사용, 알림 시스템 추가, 11-4 Idle Scan 제거.

---

## 핵심 문제

v0.0.9에서 에이전트가 서버 상태를 "알게" 됐다. 하지만 **묻기 전엔 말하지 않는다**.

```
현재 (수동):
  유저: "서버 상태 알려줘"  → 에이전트: "컨테이너 14개, 포트 12개 사용 중..."
  유저: "배포해줘"           → preflight → 배포

되어야 하는 것 (능동):
  배포 성공 후 Timeline에 자동으로:
    ✅ 헬스체크 통과 (응답 200, 2.1초)
    💡 이전 버전 (abc123) 컨테이너가 아직 있어. 정리할까?

  컨테이너 크래시 감지 시:
    🔴 api 컨테이너가 크래시했어 (exit code 137 — OOM killed)
       → Timeline에 이상 징후 항목 표시
       → 헤더에 알림 인디케이터 점멸

  재배포 시:
    "저번에 10003 썼으니까 같은 포트로 갈게."
       → InputRequestCard로 스마트 기본값 제안
```

**한 줄 요약**: 에이전트가 정보를 수동적으로 제공하는 것에서, **적절한 타이밍에 Timeline에 능동적으로 인사이트를 전달**하는 것으로 전환.

---

## 왜 이게 중요한가

1. **제품 정체성 강화** — "서버 상태를 아는"의 진짜 의미는 아는 것을 **활용**하는 것
2. **"AI다운" 체감** — 유저가 "이건 스크립트가 아니라 에이전트구나" 느끼는 순간
3. **경쟁 차별화** — Coolify/Dokploy에는 AI가 전혀 없음. 능동적 AI는 추격 불가능한 차별점
4. **Web Timeline 활용** — v0.1.0의 Agent Timeline을 히어로 화면으로 만드는 핵심 컨텐츠

---

## 설계 원칙

### 1. 안전 우선: 관찰만, 실행은 사용자 승인

```
✅ "이전 버전 컨테이너가 있어. 정리할까?"  → 유저 확인 후 실행 (Timeline Action 버튼)
❌ "이전 버전 컨테이너를 정리했어."         → 절대 금지
```

에이전트는 **제안만 한다**. 자율 실행은 인프라에서 위험하다 (DEC-001 참조).

### 2. 소음 방지: 보여주되, 귀찮게 하지 않는다

```
좋은 예: 배포 직후 한 번 "헬스체크 OK, 이전 버전 있음" → Timeline에 한 번 표시, 끝
나쁜 예: 30초마다 "CPU 12%입니다" "메모리 42%입니다" → 소음
```

**트리거 기반**: 주기적 알림이 아니라, **이벤트 발생 시**에만 능동적으로 말한다.

### 3. 컨텍스트 기억: 과거를 알고 현재를 판단한다

```
첫 배포: "포트 10003을 할당했어."
재배포: "저번에 10003 썼으니까 같은 포트로 갈게."  → 기억 기반 판단
       → InputRequestCard로 "같은 포트 사용" 선택지 제공
```

### 4. Timeline First: 웹에서 모든 것이 타임라인을 통과한다

```
배포 완료 → deploy:success 이벤트 → TimelineItem(성공)
   + Post-Deploy Insight → TimelineItem(insight) 추가

컨테이너 크래시 → monitor:healthcheck 이벤트 → TimelineItem(anomaly)

스마트 기본값 제안 → 배포 전 InputRequestCard → 사용자 선택 후 배포
```

---

## 기능별 상세

### 11-1: Post-Deploy Insight (배포 후 인사이트)

**트리거**: `deploy:success` 이벤트 발생 시

배포 성공 후 에이전트가 자동으로 서버 상태를 점검하고 **Timeline Item**으로 인사이트를 전달한다.

**체크 항목**:

| 항목               | 조건                                      | Timeline 메시지 예시                                    |
| ------------------ | ----------------------------------------- | ------------------------------------------------------- |
| 헬스체크           | 배포 후 30초 내 통과                      | `✅ 헬스체크 통과 (응답 200, 2.1초)`                    |
| 헬스체크 실패      | 30초 내 미통과                            | `⚠️ 헬스체크 아직 미통과. 로그를 확인할까?`             |
| 이전 버전 컨테이너 | 같은 프로젝트의 이전 이미지 컨테이너 존재 | `💡 이전 버전 (abc123) 컨테이너가 아직 있어. 정리할까?` |
| 리소스 상태        | 배포 후 메모리 80%+ 도달                  | `⚠️ 배포 후 메모리 사용량이 82%로 올랐어. 주시할게.`    |
| 빌드 시간 비교     | 이전 빌드 대비 2배+ 느림                  | `📊 빌드 시간 3분 42초 — 저번보다 2배 느려졌어.`        |

**NDJSON 이벤트 타입**:

```typescript
// web/src/lib/event-types.ts — TimelineItem type 확장
export interface TimelineItem {
  id: string;
  // 기존 타입: 'progress' | 'success' | 'error' | 'question'
  type: 'progress' | 'success' | 'error' | 'question' | 'insight' | 'anomaly';
  timestamp: string;
  title: string;
  detail?: string;
  percent: number;
  url?: string;
  questionId?: string;
  questions?: QuestionData[];
  answered?: boolean;
  /** Insight/Anomaly 전용 */
  actionButtons?: ActionButton[];
  severity?: 'info' | 'warning' | 'error';
}

export interface ActionButton {
  label: string;
  action: string; // 'cleanup_stale', 'view_logs', 'retry_healthcheck'
}
```

**백엔드 구현 방향**:

```typescript
// src/pipeline/deploy.ts — deploy:success 이벤트 후크 추가
eventBus.on('deploy:success', async (payload) => {
  const insights = await generatePostDeployInsights(payload.projectId);

  // 각 인사이트를 NDJSON로 전송
  for (const insight of insights) {
    await streamTimelineItem({
      type: 'insight',
      projectId: payload.projectId,
      title: insight.title,
      detail: insight.detail,
      severity: insight.severity,
      actionButtons: insight.actions,
    });
  }
});

// src/pipeline/post-deploy-insight.ts — 신규 파일
export async function generatePostDeployInsights(projectId: string): Promise<Insight[]> {
  const insights: Insight[] = [];

  // 1. 헬스체크 상태
  const health = await waitForHealthCheck(projectId, 30_000);
  insights.push({
    title: health.ok
      ? `✅ 헬스체크 통과 (${health.responseTime}ms)`
      : `⚠️ 헬스체크 미통과. 로그를 확인할까?`,
    severity: health.ok ? 'info' : 'warning',
    actions: health.ok ? [] : [{ label: '로그 보기', action: 'view_logs' }],
  });

  // 2. 이전 버전 컨테이너
  const staleContainers = await findStaleContainers(projectId);
  if (staleContainers.length > 0) {
    insights.push({
      title: `💡 이전 버전 컨테이너 ${staleContainers.length}개가 있어. 정리할까?`,
      severity: 'info',
      actions: [{ label: '정리', action: 'cleanup_stale' }],
    });
  }

  // 3. 리소스 변화
  const stats = await getSystemStats();
  if (stats.memory.usedPercent > 80) {
    insights.push({
      title: `⚠️ 메모리 ${stats.memory.usedPercent}% 사용 중.`,
      severity: 'warning',
    });
  }

  return insights;
}
```

**프론트엔드 구현 방향**:

```typescript
// web/src/components/timeline/InsightCard.tsx — 신규 파일
export function InsightCard({ item, onAction }: { item: TimelineItem; onAction: (action: string) => void }) {
  const severityColors = {
    info: 'bg-info/10 border-info/30 text-info',
    warning: 'bg-warning/10 border-warning/30 text-warning',
    error: 'bg-error/10 border-error/30 text-error',
  };

  return (
    <div className={cn('timeline-item', severityColors[item.severity || 'info'])}>
      <Icon icon={item.severity === 'error' ? AlertCircle : Info} />
      <div className="content">
        <p>{item.title}</p>
        {item.detail && <p className="detail">{item.detail}</p>}
        {item.actionButtons && (
          <div className="actions">
            {item.actionButtons.map((btn) => (
              <button key={btn.action} onClick={() => onAction(btn.action)}>
                {btn.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

**수락기준**:

- [x] 배포 성공 후 에이전트가 자동으로 인사이트 Timeline Item을 표시한다
- [x] 헬스체크 결과(통과/미통과)를 포함한다
- [x] 이전 버전 컨테이너가 있으면 정리를 제안한다 (실행은 유저 승인 필요)
- [x] 리소스 임계값(메모리 80%+) 초과 시 경고한다
- [x] 인사이트가 없으면 (모든 것이 정상이면) 간결하게 `✅ 배포 완료. 이상 없음.` 만 표시
- [x] 배포 실패 시에는 이 기능이 트리거되지 않는다
- [x] Insight 카드에 액션 버튼("정리", "로그 보기")가 표시되고 클릭 시 해당 작업 실행
- [ ] 테스트: 정상 배포, 헬스체크 실패, 이전 버전 존재, 리소스 초과 시나리오

---

### 11-2: Anomaly Nudge (이상 징후 알림)

**트리거**: 기존 HealthMonitor의 `monitor:healthcheck` / `monitor:inactive` 이벤트

컨테이너가 비정상 상태가 되면, 에이전트가 **Timeline Item**으로 한 번 알려준다. 반복 알림은 하지 않는다.

**감지 항목**:

| 이상 징후          | 감지 방법                                 | Timeline 메시지                                                    |
| ------------------ | ----------------------------------------- | ------------------------------------------------------------------ |
| 컨테이너 크래시    | `state: exited` + `exitCode != 0`         | `🔴 frontend 컨테이너가 크래시했어 (exit code 1). 로그 볼까?`      |
| 반복 재시작        | `restartCount > 3` in 10분                | `🔴 api가 10분 내 4번 재시작됐어. 크래시 루프인 것 같아.`          |
| 리소스 포화        | 컨테이너 메모리 90%+ (cgroup limit 기준)  | `⚠️ postgres 컨테이너가 메모리 제한에 근접했어 (92%).`             |
| 디스크 부족        | 호스트 디스크 5GB 미만                    | `⚠️ 디스크 여유 3.2GB. Docker 이미지 정리 제안할까?`               |
| 외부 컨테이너 변화 | v0.0.9 listAllContainers와 이전 스캔 비교 | `📋 외부 컨테이너 변화 감지: grafana가 새로 추가됨.` (시스템 알림) |

**알림 시스템 설계**:

1. **Project Timeline**: 해당 프로젝트 관련 이상 징후는 프로젝트 디테일 페이지의 Timeline에 `anomaly` 타입으로 표시
2. **Global Notifications**: 시스템 전체 이상 징후(디스크 부족, 외부 컨테이너)는 헤더에 알림 인디케이터 + 드롭다운 패널
3. **알림 인디케이터**: 헤더에 🔔 아이콘, 읽지 않은 알림 개수 배지

**NDJSON 이벤트 타입**:

```typescript
// web/src/lib/event-types.ts — Anomaly 전용 타입 추가
export interface AnomalyTimelineItem extends TimelineItem {
  type: 'anomaly';
  anomalyType:
    | 'container_crash'
    | 'restart_loop'
    | 'resource_saturation'
    | 'disk_low'
    | 'external_change';
  projectId?: string; // null = 시스템 전체 알림
  containerId?: string;
  severity: 'warning' | 'error';
  dismissed: boolean;
}
```

**백엔드 구현 방향**:

```typescript
// src/monitor/anomaly.ts — 신규 파일
interface AnomalyState {
  notified: Map<string, number>; // key → last notified timestamp
  hourlyCount: number;
  mutedContainers: Set<string>;
}

async function checkAnomalies(
  containers: AllContainerInfo[],
  previousContainers: AllContainerInfo[],
  stats: SystemStats,
): Promise<AnomalyNudge[]> {
  // ...감지 로직
}

// src/monitor/anomaly.ts — EventBus에 훅 연결
eventBus.on('monitor:healthcheck', async (payload) => {
  if (!payload.healthy) {
    const anomaly = await detectContainerAnomaly(payload.projectId);
    if (anomaly && shouldNotify(anomaly)) {
      await streamTimelineItem({
        type: 'anomaly',
        projectId: payload.projectId,
        title: anomaly.title,
        detail: anomaly.detail,
        anomalyType: anomaly.type,
        severity: 'error',
      });
      markNotified(anomaly.key);
    }
  }
});
```

**프론트엔드 구현 방향**:

```typescript
// web/src/components/layout/NotificationCenter.tsx — 신규 파일
export function NotificationCenter({ notifications, onDismiss }: Props) {
  return (
    <div className="notification-center">
      {notifications.map((n) => (
        <div key={n.id} className={cn('notification-item', n.severity)}>
          <p>{n.title}</p>
          <button onClick={() => onDismiss(n.id)}>닫기</button>
        </div>
      ))}
    </div>
  );
}

// web/src/components/layout/Header.tsx — 수정
export function Header() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);

  return (
    <header>
      {/* ... */}
      <div className="relative">
        <button onClick={() => setShowNotifications(!showNotifications)}>
          <BellIcon />
          {unreadCount > 0 && <span className="badge">{unreadCount}</span>}
        </button>
        {showNotifications && (
          <NotificationCenter
            notifications={globalNotifications}
            onDismiss={handleDismiss}
          />
        )}
      </div>
    </header>
  );
}
```

**소음 방지 규칙**:

1. **동일 이슈는 한 번만 알림** — 같은 컨테이너의 같은 이상 징후는 해결되기 전까지 재알림 안 함
2. **쿨다운 5분** — 한 이슈를 알린 후 최소 5분은 대기
3. **최대 3개/시간** — 시간당 능동 메시지 3개 초과 금지
4. **사용자 닫기 가능** — 알림을 dismiss하면 해당 건 무시 (Timeline에서 사라짐)

**수락기준**:

- [ ] 관리 컨테이너의 크래시, 반복 재시작, 리소스 포화를 감지한다
- [ ] 호스트 디스크 부족(5GB 미만)을 감지한다
- [ ] 외부 컨테이너 추가/제거를 감지한다 (v0.0.9 `listAllContainers` 활용)
- [ ] 동일 이슈 반복 알림 방지 (한 번 알린 건 해결 전까지 재알림 안 함)
- [ ] 시간당 최대 3건 제한
- [ ] 사용자가 알림을 dismiss할 수 있다
- [ ] 프로젝트 관련 이상 징후는 해당 프로젝트 Timeline에 표시된다
- [ ] 시스템 전체 알림은 헤더 알림 인디케이터 + 드롭다운 패널에 표시된다
- [ ] 알림 메시지에 **액션 버튼** 포함 ("로그 볼까?", "정리할까?")
- [ ] 테스트: 크래시 감지, 반복 재시작, 디스크 부족, 소음 방지 시나리오

---

### 11-3: Smart Defaults (스마트 기본값)

**트리거**: 배포 요청 시 (`deploy_project` 도구 호출 전)

에이전트가 이전 배포 히스토리를 참고하여 더 나은 기본값을 제안한다.

**시나리오**:

| 상황                | 현재                       | Smart Defaults                                                |
| ------------------- | -------------------------- | ------------------------------------------------------------- |
| 재배포              | 유저가 포트/이름 다시 지정 | "저번에 10003 썼으니까 같은 포트로 갈게."                     |
| 환경변수            | 매번 새로 설정             | "저번 배포에서 DB_URL 설정했었어. 같이 적용할까?"             |
| 같은 레포 재배포    | clone부터 다시             | "이 레포 이미 clone 되어있어. pull만 할게."                   |
| 빌드 실패 후 재시도 | 같은 설정으로 재시도       | "저번 빌드 실패 원인이 메모리였어. --memory 옵션 추가해볼까?" |

**백엔드 구현 방향**:

```typescript
// src/agent/prompts.ts — buildContextSnapshot() 확장
// 기존: 현재 서버 상태만 포함
// 추가: 해당 프로젝트의 배포 히스토리

export async function buildContextSnapshotForProject(
  db: Database,
  docker: Docker,
  projectId?: string,
): Promise<ContextSnapshot> {
  // ... 기존 서버 상태 ...

  if (projectId) {
    const deploymentHistory = await db.getDeploymentHistory(projectId, limit: 3);
    // 시스템 프롬프트에 주입:
    // ## Deployment History for "frontend"
    // - Last deployed: 2h ago, port 10003, env: DB_URL=..., BUILD_TIME=2m30s
    // - Previous failures: 1 (memory limit, resolved with --memory 4g)
    // - Recommended: same port 10003, same env vars, add --memory 4g
  }
}

// src/agent/tools/deploy_project.ts — 기존 툴 수정
export async function deploy_project_tool(input: DeployInput, ctx: ToolContext) {
  const projectId = ctx.activeProjectId;

  // 스마트 기본값 제안 로직
  const suggestions = await generateSmartDefaults(projectId, input);

  if (suggestions.length > 0) {
    // InputRequestCard로 사용자에게 제안
    await questionBridge.ask({
      projectId,
      requestId: nanoid(),
      questions: [{
        question: '스마트 기본값 제안:',
        header: 'Smart Defaults',
        options: suggestions,
      }],
    });

    // 사용자 응답 대기...
    const answers = await questionBridge.waitForAnswer(requestId);
    // answers에 따라 input 수정
  }

  // 배포 진행...
}
```

**프론트엔드 구현 방향**:

기존 `InputRequestCard` 컴포넌트 재사용. 옵션 선택 후 `Submit` 클릭 시 배포 진행.

```typescript
// web/src/components/timeline/InputRequestCard.tsx — 기존 컴포넌트 활용
// Smart Defaults는 기존 QuestionData 포맷으로 제공
const questions: QuestionData[] = [
  {
    question: '스마트 기본값 제안:',
    header: 'Smart Defaults',
    options: [
      { label: '같은 포트 10003 사용', description: '저번 배포와 동일' },
      { label: '환경변수 유지 (DB_URL, API_KEY)', description: '2개 변수 재사용' },
      { label: '--memory 4g 옵션 추가', description: '이전 빌드 실패 대응' },
    ],
  },
];
```

**수락기준**:

- [x] 재배포 시 이전 포트를 자동 제안한다
- [x] 이전 배포의 환경변수를 기억하고 제안한다
- [x] 같은 레포가 이미 clone 되어있으면 git pull만 수행한다
- [x] 이전 빌드 실패 원인을 기억하고 대응 방안을 제안한다
- [x] 제안은 InputRequestCard로 표시 (기존 컴포넌트 재사용)
- [x] 사용자가 제안을 건너뛸 수 있다 (Skip 버튼)
- [ ] 테스트: 재배포 포트 유지, 환경변수 기억, 빌드 실패 히스토리 시나리오

---

### 11-4: Idle Scan (유휴 시 서버 점검) — **제거**

**제거 사유**: TUI "5분 미입력" 개념이 웹에 적용되지 않음. 웹에서는 **주기적 백그라운드 스캔**으로 대체 가능하지만, 우선순위 낮음.

**대안 (향향 고려)**:

- **Daily Background Scan**: 매일 한 번 백그라운드로 미사용 컨테이너/이미지를 스캔
- 결과를 Global Notifications로 전달 (11-2 시스템 알림 시스템 활용)
- v0.0.12 이후 또는 도그푸딩 피드백에 따라 검토

---

## 구현하지 않는 것

| 기능                                          | 왜 안 하는가                                    |
| --------------------------------------------- | ----------------------------------------------- |
| 자율 실행 (자동 정리, 자동 재시작)            | 인프라에서 자율 실행은 위험. DEC-001 원칙 적용. |
| 실시간 대시보드 이상 징후 표시                | Timeline 기반으로 충분. 별도 대시보드 불필요.   |
| 학습 기반 예측 ("다음 주에 디스크 부족 예상") | 데이터 부족 + 복잡도. 추후 검토.                |
| 알림 규칙 커스터마이징 UI                     | 오버엔지니어링. 하드코딩 임계값으로 시작.       |
| Idle Scan (TUI 스타일)                        | 웹 컨텍스트에 부적합. 제거됨.                   |

---

## 구현 순서 (의존성 기반)

```
Phase 1 (킬러): 11-1 Post-Deploy Insight
   ↓ — TimelineItem 타입 확장, InsightCard 컴포넌트
Phase 2 (기반): 11-3 Smart Defaults
   ↓ — InputRequestCard 재사용, 배포 히스토리 조회
Phase 3 (모니터링): 11-2 Anomaly Nudge
   ↓ — AnomalyCard 컴포넌트, 알림 시스템
Phase 4 (부가): (11-4 제거됨)
```

**11-1이 먼저인 이유**: 가장 자연스러운 타이밍(배포 직후), Timeline Item 패턴 확립, 체감 효과 최고.
**11-3이 11-2보다 먼저인 이유**: Smart Defaults는 기존 InputRequestCard 패턴으로 구현 가능. Anomaly는 새 알림 시스템 필요.

---

## 공수 추정

| Phase          | 공수        | 사유                                                            |
| -------------- | ----------- | --------------------------------------------------------------- |
| Phase 1 (11-1) | 1.5-2일     | TimelineItem 타입 확장 + InsightCard 컴포넌트 + 백엔드 훅       |
| Phase 2 (11-3) | 2일         | 배포 히스토리 조회 + InputRequestCard 재사용 + 스마트 기본값    |
| Phase 3 (11-2) | 3-4일       | anomaly 감지 루프 + AnomalyCard + 알림 시스템 (헤더 인디케이터) |
| **총합**       | **6.5-8일** | 11-4 제거로 기존 8-10일보다 축소                                |

---

## 프론트엔드 컴포넌트 스펙

### 신규 컴포넌트

| 컴포넌트           | 경로                                               | 용도                                    |
| ------------------ | -------------------------------------------------- | --------------------------------------- |
| InsightCard        | `web/src/components/timeline/InsightCard.tsx`      | Post-Deploy Insight 표시 (insight 타입) |
| AnomalyCard        | `web/src/components/timeline/AnomalyCard.tsx`      | 이상 징후 표시 (anomaly 타입)           |
| NotificationCenter | `web/src/components/layout/NotificationCenter.tsx` | 시스템 알림 드롭다운 패널               |
| NotificationBadge  | `web/src/components/layout/NotificationBadge.tsx`  | 헤더 알림 인디케이터 + 배지             |

### 수정 컴포넌트

| 컴포넌트       | 경로                                           | 변경 내용                                 |
| -------------- | ---------------------------------------------- | ----------------------------------------- |
| TimelineItem   | `web/src/components/timeline/TimelineItem.tsx` | insight/anomaly 타입 케이스 추가          |
| event-types.ts | `web/src/lib/event-types.ts`                   | TimelineItem 타입 확장 (insight, anomaly) |
| Header         | `web/src/components/layout/Header.tsx`         | 알림 인디케이터 추가                      |

---

## 백엔드 구현 매핑

### 기존 아키텍처 활용

| v0.1.0 기반                 | v0.0.11에서 활용                                     |
| --------------------------- | ---------------------------------------------------- |
| `deploy:success` 이벤트     | Post-Deploy Insight — 트리거                         |
| NDJSON streaming            | insight/anomaly Timeline Item 전송                   |
| QuestionBridge/InputRequest | Smart Defaults — 제안 패턴                           |
| HealthMonitor               | Anomaly Nudge — 감지 기반                            |
| EventBus                    | 이벤트 훅 연결 (deploy:success, monitor:healthcheck) |
| `buildContextSnapshot()`    | Smart Defaults — 배포 히스토리 주입                  |

### 신규 파일/모듈

| 파일/모듈                             | 역할                          |
| ------------------------------------- | ----------------------------- |
| `src/pipeline/post-deploy-insight.ts` | Post-Deploy Insight 생성 로직 |
| `src/monitor/anomaly.ts`              | 이상 징후 감지 + 트리거 로직  |
| `src/agent/smart-defaults.ts`         | 스마트 기본값 생성 로직       |

---

## UX 예시 (웹 사용자에게 보이는 모습)

### Post-Deploy Insight (Timeline)

```
[Project: frontend — Timeline 탭]

14:32:01  [progress] Starting deployment...
14:32:15  [progress] Cloning repository...
14:32:45  [success] Deploy complete in 45s — http://frontend.local:10003
14:33:00  [insight]  ✅ 헬스체크 통과 (응답 200, 2.1초)
              💡 이전 버전 (abc123) 컨테이너가 아직 있어.
                 [정리] 버튼
```

### Anomaly Nudge (Timeline + Header)

```
[Project: api — Timeline 탭]

15:10:05  [anomaly]  🔴 api 컨테이너가 크래시했어 (exit code 137 — OOM killed).
                  최근 로그 마지막 10줄:
                  ...
                  메모리 제한(512MB)에 도달한 것 같아.
                 [로그 보기] [제한 늘리기] 버튼

[Header — 알림 인디케이터]

🔔 (2) ← 클릭 시 드롭다운:
  🔴 api 컨테이너 크래시됨
  ⚠️ 디스크 여유 3.2GB
```

### Smart Defaults (InputRequestCard)

```
[Project: frontend — 재배포 시]

Input Request Card:
┌─ Smart Defaults ───────────────┐
│ 스마트 기본값 제안:            │
│                                │
│ ◉ 같은 포트 10003 사용        │
│    저번 배포와 동일            │
│                                │
│ ◉ 환경변수 유지 (2개)         │
│    DB_URL, API_KEY 재사용      │
│                                │
│ [Submit] [Skip]               │
└────────────────────────────────┘
```

---

## 우선순위 제안

현재 로드맵: `v0.0.9(🧪)` → `v0.1.0(✅)` → `v0.0.12(📋)` → `v0.0.11(📋)` → `v0.0.10(📋)`

**PM 의견**: v0.0.11을 v0.0.12/v0.0.10보다 먼저 하는 것을 권장.

| 기준        | v0.0.10 (Env & Secrets)         | v0.0.11 (Agent Proactivity) |
| ----------- | ------------------------------- | --------------------------- |
| 유저 체감   | 중간 (이미 프로젝트별 env 있음) | **높음** ("이건 AI다" 순간) |
| 제품 정체성 | 보조 기능                       | **핵심 차별화**             |
| 경쟁 대응   | Coolify도 env 관리 있음         | **아무도 안 하고 있음**     |
| 기술 리스크 | 낮음 (DB 스키마 + CRUD)         | 중간 (이벤트 훅 + Timeline) |
| 공수        | ~6일                            | ~6.5-8일                    |

→ **v0.0.11 (Phase 1: Post-Deploy Insight만이라도)을 먼저 하면, Web Timeline의 핵심 가치를 검증할 수 있다.**
→ 최종 결정은 User에게.

---

## 버전 맵 업데이트

`docs/planning/version-map.md` 업데이트 필요:

| #      | 항목                | 버전    | 상태                  |
| ------ | ------------------- | ------- | --------------------- |
| 16     | Post-Deploy Insight | v0.0.11 | 📋 기획 완료 (v2 Web) |
| 17     | Anomaly Nudge       | v0.0.11 | 📋 기획 완료 (v2 Web) |
| 18     | Smart Defaults      | v0.0.11 | 📋 기획 완료 (v2 Web) |
| ~~19~~ | ~~Idle Scan~~       | v0.0.11 | ❌ 제거됨 (Web 전환)  |

---

## 도그푸딩 체크리스트

### 환경 준비

- [ ] v0.1.0 Web MVP 구현 완료 상태
- [ ] 테스트용 프로젝트 (frontend, api) 등록

### 테스트 항목

#### 11-1 Post-Deploy Insight

- [ ] 시나리오 1: 정상 배포 후 헬스체크 통과 확인
      사전조건: 빌드 성공하는 프로젝트
      절차:
  1. "frontend 배포해줘" 명령
  2. 배포 완료까지 대기
     기대결과:
  - Timeline에 `success` 타임라인 아이템 표시
  - 배포 완료 30초 내에 `insight` 타임라인 아이템 추가
  - "✅ 헬스체크 통과 (응답 200, Xms)" 메시지 표시
    확인방법: Timeline 탭에서 아이템 확인

- [ ] 시나리오 2: 헬스체크 실패 시 로그 보기 제안
      사전조건: 헬스체크 URL이 잘못된 프로젝트
      절차: 배포 실행
      기대결과:
  - `insight` 타임라인 아이템에 "⚠️ 헬스체크 미통과" 메시지
  - [로그 보기] 액션 버튼 표시
  - 버튼 클릭 시 Logs 탭으로 이동
    확인방법: 버튼 클릭 후 탭 전환 확인

- [ ] 시나리오 3: 이전 버전 컨테이너 정리 제안
      사전조건:
  - 같은 프로젝트로 2회 이상 배포
  - 이전 버전 컨테이너 1개 이상 존재
    절차: 재배포 실행
    기대결과:
  - `insight` 타임라인 아이템에 "💡 이전 버전 컨테이너 N개" 메시지
  - [정리] 액션 버튼 표시
  - 버튼 클릭 시 이전 컨테이너 삭제
    확인방법: 버튼 클릭 후 `docker ps`로 확인

- [ ] 시나리오 4: 모든 것이 정상이면 간결한 메시지만 표시
      사전조건: 정상 프로젝트, 이전 버전 없음, 리소스 정상
      절차: 배포 실행
      기대결과:
  - `success` 타임라인 아이템만 표시
  - 추가 `insight` 아이템 없음
    확인방법: Timeline에 아이템 수 확인

#### 11-2 Anomaly Nudge

- [ ] 시나리오 5: 컨테이너 크래시 감지 및 알림
      사전조건: OOM 실패하도록 설정된 컨테이너
      절차: 배포 후 메모리 부하
      기대결과:
  - 해당 프로젝트 Timeline에 `anomaly` 타임라인 아이템
  - "🔴 컨테이너 크래시" 메시지
  - exit code 표시
    확인방법: Timeline 탭에서 확인

- [ ] 시나리오 6: 시스템 전체 알림 (디스크 부족)
      사전조건: 디스크 여유 5GB 미만 상태
      절차: 대기 (10분 내 HealthMonitor 감지)
      기대결과:
  - 헤더 알림 인디케이터 점멸
  - 배지 숫자 표시
  - 드롭다운에 "⚠️ 디스크 여유 XGB" 메시지
    확인방법: 헤더 알림 클릭 후 확인

- [ ] 시나리오 7: 동일 이슈 반복 알림 방지
      사전조건: 크래시한 컨테이너 유지
      절차:
  1. 첫 크래시 감지 확인 (Timeline에 anomaly 아이템)
  2. 5분 대기
     기대결과:
  - 재알림 없음 (Timeline에 새 anomaly 아이템 추가 안 됨)
    확인방법: Timeline 아이템 수 유지 확인

- [ ] 시나리오 8: 알림 dismiss 가능
      절차:
  1. anomaly 아이템 표시 확인
  2. [닫기] 버튼 클릭
     기대결과:
  - 아이템이 Timeline에서 사라짐
  - 헤더 알림 카운트 감소
    확인방법: Timeline, 헤더 상태 확인

#### 11-3 Smart Defaults

- [ ] 시나리오 9: 재배포 시 포트 제안
      사전조건:
  - 프로젝트 "frontend" 포트 10003으로 배포 완료
    절차: "frontend 다시 배포해줘" 명령
    기대결과:
  - InputRequestCard 표시
  - "같은 포트 10003 사용" 옵션 선택
  - [Submit] 클릭 후 포트 10003으로 배포
    확인방법: 배포 완료 후 포트 확인

- [ ] 시나리오 10: 환경변수 기억 및 제안
      사전조건:
  - 이전 배포에 DB_URL, API_KEY 설정
    절차: 재배포
    기대결과:
  - InputRequestCard에 "환경변수 유지 (2개)" 옵션
  - 선택 후 같은 환경변수로 배포
    확인방법: 배포 완료 후 Config 탭에서 환경변수 확인

- [ ] 시나리오 11: 제안 건너뛰기
      절차:
  1. InputRequestCard 표시
  2. [Skip] 클릭
     기대결과:
  - InputRequestCard 사라짐
  - 기본값으로 배포 진행
    확인방법: 배포 완료 확인

---

## 기존 인프라 활용

v0.0.9 + v0.1.0에서 구축한 기반이 이 기능의 **데이터 소스**가 된다:

| v0.0.9 기반              | v0.0.11에서 활용                        |
| ------------------------ | --------------------------------------- |
| `listAllContainers()`    | Anomaly Nudge — 외부 컨테이너 변화 감지 |
| `scanUsedPorts()`        | Smart Defaults — 이전 포트 제안         |
| `detectReverseProxy()`   | Post-Deploy — 프록시 상태 보고          |
| `preflightCheck()`       | Smart Defaults — 이전 실패 원인 기억    |
| `buildContextSnapshot()` | 모든 기능의 시스템 프롬프트 기반        |
| `HealthMonitor`          | Anomaly Nudge — 크래시/재시작 감지      |
| `monitor/alerts.ts`      | Anomaly Nudge — IPC 알림 전달           |
| `deploy:success` 이벤트  | Post-Deploy — 트리거                    |

| v0.1.0 기반              | v0.0.11에서 활용                   |
| ------------------------ | ---------------------------------- |
| Agent Timeline           | Post-Deploy Insight/Anomaly 표시   |
| NDJSON Streaming         | insight/anomaly Timeline Item 전송 |
| InputRequestCard         | Smart Defaults 제안 UI             |
| EventBus                 | 이벤트 훅 연결                     |
| TimelineItem type system | insight/anomaly 타입 확장          |

---

## 결정 로그

이 스펙은 다음 결정 사항을 반영함:

- **DEC-001**: 에이전트는 제안만 하고 자율 실행은 금지 (TUI/공통 원칙, Web에도 적용)
- **Web pivot decision**: v0.1.0에서 TUI → Web 전환 결정, Timeline을 히어로 화면으로 채택
- **11-4 제거**: Idle Scan은 TUI 컨셉이며 Web에서는 적용되지 않아 제거 (도그푸딩 피드백에 따라 향후 재검토)

---

**문서 작성일**: 2026-03-04
**v2 Web 컨텍스트 반영**: 2026-03-04
**작성자**: Project Owner (PM)
