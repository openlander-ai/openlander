import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import fontkit from 'pdf-fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

import type { Database } from '../db/index.js';
import type { ArtifactStore } from '../delivery/artifact-store.js';
import type { EngagementService } from '../engagement/engagement-service.js';
import {
  EngagementValidationError,
  WeeklyReportNotFoundError,
  WeeklyReportStateError,
} from '../errors.js';

const require = createRequire(import.meta.url);
const NOTO_SANS_KR_PATH =
  require.resolve('@fontsource/noto-sans-kr/files/noto-sans-kr-korean-400-normal.woff');
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;

type ReportLocale = 'en' | 'ko';
type ReportPdfRenderer = (title: string, lines: string[]) => Promise<Uint8Array>;

const KOREAN_STATUS: Readonly<Record<string, string>> = {
  approved: '승인됨',
  building: '빌드 중',
  cancelled: '취소됨',
  completed: '완료',
  degraded: '문제 있음',
  delivered: '납품 완료',
  deploying: '배포 중',
  draft: '진행 중',
  error: '오류',
  failed: '실패',
  healthy: '정상',
  in_review: '검토 중',
  paused: '일시 중지',
  passed: '통과',
  pending: '대기 중',
  quality_gates_passed: '품질 검증 통과',
  ready: '준비됨',
  recalled: '승격 중단',
  revision_requested: '수정 요청',
  rolled_back: '롤백됨',
  running: '실행 중',
  scenario_qa: '시나리오 QA',
  stopped: '중지됨',
  succeeded: '성공',
  unknown: '확인 필요',
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function display(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value);
}

function escapeHtml(value: unknown): string {
  return display(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function splitLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const character of paragraph || ' ') {
      const candidate = line + character;
      if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(line);
        line = character;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

function reportHtml(title: string, lines: string[], locale: ReportLocale): string {
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:880px;margin:40px auto;padding:0 24px;color:#172033}h1{font-size:28px}li{margin:8px 0;line-height:1.5}.meta{color:#64748b}</style></head><body><h1>${escapeHtml(title)}</h1><ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul></body></html>`;
}

async function reportPdf(title: string, lines: string[]): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const font = await document.embedFont(await readFile(NOTO_SANS_KR_PATH), { subset: true });
  let page: PDFPage = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  const draw = (text: string, size: number, color = rgb(0.12, 0.16, 0.24)): void => {
    for (const line of splitLines(text, font, size, PAGE_WIDTH - MARGIN * 2)) {
      if (y < MARGIN + 20) {
        page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN;
      }
      page.drawText(line, { x: MARGIN, y, size, font, color });
      y -= size * 1.55;
    }
  };
  draw(title, 20);
  y -= 12;
  for (const line of lines) {
    draw(`• ${line}`, 9);
    y -= 4;
  }
  return await document.save({ useObjectStreams: false });
}

function isoBounds(periodStart: string, periodEnd: string): { from: string; to: string } {
  if (!DATE_PATTERN.test(periodStart) || !DATE_PATTERN.test(periodEnd)) {
    throw new EngagementValidationError('Weekly report period must use YYYY-MM-DD dates.');
  }
  const from = new Date(`${periodStart}T00:00:00.000Z`);
  const to = new Date(`${periodEnd}T23:59:59.999Z`);
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (!Number.isFinite(days) || days < 0 || days > 8) {
    throw new EngagementValidationError('Weekly report period must be between one and eight days.');
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

function reportLocale(snapshot: Record<string, unknown>): ReportLocale {
  return snapshot['locale'] === 'ko' ? 'ko' : 'en';
}

function statusLabel(value: unknown, locale: ReportLocale): string {
  const raw = String(value);
  return locale === 'ko' ? (KOREAN_STATUS[raw] ?? raw) : raw;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function activityMetadata(entry: Record<string, unknown>): Record<string, unknown> {
  const raw = entry['metadata'];
  if (typeof raw !== 'string') return recordValue(raw);
  try {
    return recordValue(JSON.parse(raw));
  } catch {
    return {};
  }
}

function descriptionMatch(description: string, pattern: RegExp): string | null {
  return description.match(pattern)?.[1] ?? null;
}

function koreanActivitySummary(entry: Record<string, unknown>): string {
  const eventType = display(entry['event_type']);
  const description = display(entry['description']).trim();
  const metadata = activityMetadata(entry);
  const phase = display(metadata['phase']);
  const commitSha = display(metadata['commit_sha']);
  const receiptId = display(metadata['receipt_id']);

  switch (eventType) {
    case 'engagement:created':
      return `고객 과제 생성 — ${display(metadata['customer_name'])} 고객의 ${display(metadata['engagement_title'])} 과제를 만들고 초기 프로젝트 ${display(metadata['project_name'])}을 연결했습니다.`;
    case 'deploy:start':
      return '배포 시작';
    case 'deploy:clone':
      return '소스 코드 가져오기 시작';
    case 'deploy:build':
      return '이미지 빌드 시작';
    case 'deploy:run':
      return '애플리케이션 실행 시작';
    case 'deploy:success':
      return '배포 완료';
    case 'release.adopted': {
      const deployIds = Array.isArray(metadata['deploy_ids']) ? metadata['deploy_ids'] : [];
      const artifactCount = Object.keys(recordValue(metadata['image_digests'])).length;
      return `기존 배포를 릴리스로 등록 — 배포 ${deployIds.map(display).join(', ')}의 산출물 ${String(artifactCount)}개를 재빌드 없이 기록했습니다.`;
    }
    case 'project.manifest_applied': {
      const count = descriptionMatch(description, /^(\d+) Environment/);
      return `프로젝트 manifest 적용 — ${display(metadata['manifest_path'])}의 환경 정의${count ? ` ${count}개` : ''}를 적용했습니다.`;
    }
    case 'delivery.created':
      return `납품 건 생성 — ${descriptionMatch(description, /"([^"]+)"/) ?? display(metadata['delivery_id'])}`;
    case 'delivery.agent_run_started':
      return `Agent 실행 시작 — commit ${commitSha}에 고정했습니다.`;
    case 'delivery.artifact_uploaded':
      return `산출물 업로드 — ${description}`;
    case 'delivery.gate_recorded': {
      const [label = display(metadata['gate_key']), rawStatus = display(metadata['status'])] =
        description.split(':').map((part) => part.trim());
      return `통과 기준 결과 기록 — ${label}: ${statusLabel(rawStatus, 'ko')}`;
    }
    case 'delivery.agent_run_failed':
      return 'Agent 실행 실패 — 품질 검증을 통과하지 못했습니다.';
    case 'delivery.agent_run_handoff':
      return `Agent 실행 인수인계 — 수정한 구현을 ${phase === 'verification' ? '검증 단계' : phase || '다음 단계'}로 넘겼습니다.`;
    case 'delivery.agent_run_resumed':
      return 'Agent 실행 재개 — 다른 Agent가 인수인계를 이어받았습니다.';
    case 'delivery.agent_run_progress':
      return phase === 'quality_gates_passed'
        ? 'Agent 실행 진행 — 모든 manifest 품질 검증을 통과했습니다.'
        : `Agent 실행 진행${phase ? ` — ${statusLabel(phase, 'ko')}` : ''}`;
    case 'release.created': {
      const version = descriptionMatch(description, /^(\S+) built once/);
      const count = descriptionMatch(description, /for (\d+) service artifact/);
      return `릴리스 생성 — ${version ?? display(metadata['release_id'])}을 한 번 빌드해 서비스 산출물 ${count ?? '1'}개를 만들었습니다.`;
    }
    case 'release.promoted': {
      const [version = display(metadata['release_id']), environment = ''] = description
        .split('→')
        .map((part) => part.trim());
      return `릴리스 환경 승격 — ${version}${environment ? ` → ${environment}` : ''}`;
    }
    case 'engagement.weekly_report_generated': {
      const revision = descriptionMatch(description, /revision (\d+)/);
      return `주간 보고서 버전 생성${revision ? ` — ${revision}차 보고` : ''}`;
    }
    case 'engagement.weekly_report_published': {
      const revision = descriptionMatch(description, /Revision (\d+)/);
      return `주간 보고서 발행${revision ? ` — ${revision}차 보고` : ''}`;
    }
    case 'delivery.artifact_status_changed': {
      const [artifact = description, transition = ''] = description
        .split(':')
        .map((part) => part.trim());
      const localizedTransition = transition
        .split('→')
        .map((part) => statusLabel(part.trim(), 'ko'))
        .join(' → ');
      return `산출물 상태 변경 — ${artifact}${localizedTransition ? `: ${localizedTransition}` : ''}`;
    }
    case 'delivery.receipt_previewed': {
      const pageCount = descriptionMatch(description, /^(\d+) page/);
      return `납품 확인서 미리보기 생성${pageCount ? ` — ${pageCount}페이지` : ''}`;
    }
    case 'delivery.receipt_finalized':
      return `납품 확인서 확정 — ${receiptId || display(metadata['delivery_id'])}`;
    case 'delivery.agent_run_completed':
      return receiptId
        ? `Agent 실행 완료 — 운영 환경 승격 후 완료 증빙 ${receiptId}을 확정했습니다.`
        : 'Agent 실행 완료 — 운영 환경 승격 후 완료 증빙을 확정했습니다.';
    case 'engagement:archived':
      return `고객 과제 보관 — ${display(metadata['engagement_title'])} 과제를 보관했습니다. 연결된 프로젝트와 납품 기록은 변경하지 않았습니다.`;
    case 'engagement:unarchived':
      return `고객 과제 보관 해제 — ${display(metadata['engagement_title'])} 과제를 다시 진행 상태로 전환했습니다.`;
    default: {
      const title = display(entry['title']) || eventType;
      return description ? `${title} — ${description}` : title;
    }
  }
}

function internalLines(snapshot: Record<string, unknown>, locale: ReportLocale): string[] {
  const detail = snapshot['engagement'] as Record<string, unknown>;
  const evidence = snapshot['evidence'] as Record<string, unknown>;
  const projects = detail['projects'] as Array<Record<string, unknown>>;
  const deliveries = evidence['deliveries'] as Array<Record<string, unknown>>;
  const runs = evidence['runs'] as Array<Record<string, unknown>>;
  const checks = evidence['checks'] as Array<Record<string, unknown>>;
  const releases = evidence['releases'] as Array<Record<string, unknown>>;
  const promotions = evidence['promotions'] as Array<Record<string, unknown>>;
  const activity = evidence['activity'] as Array<Record<string, unknown>>;
  if (locale === 'ko') {
    return [
      `고객: ${String(detail['customer_name'])}`,
      `고객 과제: ${String(detail['title'])}`,
      `기간: ${String(snapshot['period_start'])} – ${String(snapshot['period_end'])}`,
      `실행 상태: ${statusLabel(detail['runtime_health'], locale)} · 진행을 막는 항목 ${String(detail['blocker_count'])}건`,
      `프로젝트 ${String(projects.length)}개 · 납품 ${String(deliveries.length)}건`,
      ...runs.map((run) => {
        const runStatus = statusLabel(run['status'], locale);
        const runPhase = statusLabel(run['current_phase'], locale);
        return `Agent 실행 ${String(run['id'])}: ${runStatus}${runPhase === runStatus ? '' : ` · ${runPhase}`}`;
      }),
      ...checks.map(
        (check) =>
          `검사 ${String(check['check_key'])} #${String(check['attempt'])}: ${statusLabel(check['status'], locale)} · 로그 SHA-256 ${display(check['log_sha256'] ?? '없음')}`,
      ),
      ...releases.map(
        (release) =>
          `릴리스 ${String(release['version'])}: ${statusLabel(release['status'], locale)} · ${String(release['commit_sha'])}`,
      ),
      ...promotions.map(
        (promotion) =>
          `환경 승격 ${String(promotion['id'])}: ${statusLabel(promotion['status'], locale)} · 상태 ${statusLabel(promotion['health_status'], locale)}`,
      ),
      ...activity.map(
        (entry) => `활동 ${String(entry['created_at'])}: ${koreanActivitySummary(entry)}`,
      ),
    ];
  }
  return [
    `Customer: ${String(detail['customer_name'])}`,
    `Engagement: ${String(detail['title'])}`,
    `Period: ${String(snapshot['period_start'])} – ${String(snapshot['period_end'])}`,
    `Runtime: ${String(detail['runtime_health'])}; blockers: ${String(detail['blocker_count'])}`,
    `Projects: ${String(projects.length)}; Deliveries: ${String(deliveries.length)}`,
    ...runs.map(
      (run) =>
        `Agent Run ${String(run['id'])}: ${String(run['status'])} · ${String(run['current_phase'])}`,
    ),
    ...checks.map(
      (check) =>
        `Check ${String(check['check_key'])} #${String(check['attempt'])}: ${String(check['status'])} · log sha256 ${display(check['log_sha256'] ?? 'none')}`,
    ),
    ...releases.map(
      (release) =>
        `Release ${String(release['version'])}: ${String(release['status'])} · ${String(release['commit_sha'])}`,
    ),
    ...promotions.map(
      (promotion) =>
        `Promotion ${String(promotion['id'])}: ${String(promotion['status'])} · health ${String(promotion['health_status'])}`,
    ),
    ...activity.map(
      (entry) =>
        `Activity ${String(entry['created_at'])}: ${String(entry['title'])} — ${String(entry['description'])}`,
    ),
  ];
}

function customerLines(snapshot: Record<string, unknown>, locale: ReportLocale): string[] {
  const detail = snapshot['engagement'] as Record<string, unknown>;
  const evidence = snapshot['evidence'] as Record<string, unknown>;
  const projects = detail['projects'] as Array<Record<string, unknown>>;
  const deliveries = detail['deliveries'] as Array<Record<string, unknown>>;
  const customerDeliveries = deliveries.filter(
    (delivery) => !String(delivery['id']).startsWith('delivery_implicit_'),
  );
  const blockers = detail['blockers'] as Array<Record<string, unknown>>;
  const releases = evidence['releases'] as Array<Record<string, unknown>>;
  const customerReleases = releases.filter(
    (release) => !String(release['id']).startsWith('rel_implicit_'),
  );
  const promotions = evidence['promotions'] as Array<Record<string, unknown>>;
  const environments = evidence['environments'] as Array<Record<string, unknown>>;
  const environmentById = new Map(environments.map((entry) => [entry['id'], entry]));
  if (locale === 'ko') {
    return [
      `고객: ${String(detail['customer_name'])}`,
      `고객 과제: ${String(detail['title'])}`,
      `기간: ${String(snapshot['period_start'])} – ${String(snapshot['period_end'])}`,
      `전체 상태: ${statusLabel(detail['runtime_health'], locale)}`,
      ...projects.map(
        (project) =>
          `프로젝트 ${String(project['display_name'])}: ${statusLabel(project['runtime_status'], locale)}`,
      ),
      ...customerDeliveries.map(
        (delivery) =>
          `납품 ${String(delivery['title'])}: ${statusLabel(delivery['status'], locale)}`,
      ),
      ...customerReleases.map(
        (release) =>
          `릴리스 ${String(release['version'])}: ${statusLabel(release['status'], locale)}`,
      ),
      ...promotions.map((promotion) => {
        const environment = environmentById.get(promotion['project_environment_id']);
        return `환경 ${String(environment?.['display_name'] ?? promotion['project_environment_id'])}: ${statusLabel(promotion['status'], locale)}`;
      }),
      ...(blockers.length > 0
        ? blockers.map((blocker) => `확인할 이슈: ${String(blocker['title'])}`)
        : ['확인할 이슈 없음']),
    ];
  }
  return [
    `Customer: ${String(detail['customer_name'])}`,
    `Engagement: ${String(detail['title'])}`,
    `Period: ${String(snapshot['period_start'])} – ${String(snapshot['period_end'])}`,
    `Overall status: ${String(detail['runtime_health'])}`,
    ...projects.map(
      (project) =>
        `Project ${String(project['display_name'])}: ${String(project['runtime_status'])}`,
    ),
    ...customerDeliveries.map(
      (delivery) => `Delivery ${String(delivery['title'])}: ${String(delivery['status'])}`,
    ),
    ...customerReleases.map(
      (release) => `Release ${String(release['version'])}: ${String(release['status'])}`,
    ),
    ...promotions.map((promotion) => {
      const environment = environmentById.get(promotion['project_environment_id']);
      return `Environment ${String(environment?.['display_name'] ?? promotion['project_environment_id'])}: ${String(promotion['status'])}`;
    }),
    ...(blockers.length > 0
      ? blockers.map((blocker) => `Open issue: ${String(blocker['title'])}`)
      : ['Open issues: none']),
  ];
}

export class WeeklyReportService {
  constructor(
    private readonly db: Database,
    private readonly engagements: EngagementService,
    private readonly artifacts: ArtifactStore,
    private readonly resolveLocale: () => ReportLocale = () => 'en',
    private readonly renderPdf: ReportPdfRenderer = reportPdf,
  ) {}

  async generate(input: {
    engagementId: string;
    periodStart: string;
    periodEnd: string;
    actor: string;
  }) {
    const bounds = isoBounds(input.periodStart, input.periodEnd);
    const [engagement, evidence] = await Promise.all([
      this.engagements.get(input.engagementId),
      this.db.collectWeeklyReportEvidence(input.engagementId, bounds.from, bounds.to),
    ]);
    const snapshot = {
      schema_version: 1,
      locale: this.resolveLocale(),
      engagement,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      captured_at: new Date().toISOString(),
      evidence,
    };
    const evidenceSha256 = sha256(canonicalJson(snapshot));
    const report = await this.db.createWeeklyReport({
      engagementId: input.engagementId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      evidenceSnapshot: snapshot,
      evidenceSha256,
      createdBy: input.actor,
    });
    await this.db.insertActivityLog({
      event_type: 'engagement.weekly_report_generated',
      activity_type: 'engagement',
      severity: 'info',
      project_id: `engagement:${input.engagementId}`,
      correlation_id: input.engagementId,
      title: 'Weekly report generated',
      description: `${input.periodStart} – ${input.periodEnd}, revision ${String(report.revision)}.`,
      status: 'completed',
      metadata: JSON.stringify({ report_id: report.id, evidence_sha256: evidenceSha256 }),
    });
    return report;
  }

  async get(reportId: string) {
    const report = await this.db.getWeeklyReport(reportId);
    if (!report) throw new WeeklyReportNotFoundError(reportId);
    return report;
  }

  async list(engagementId: string) {
    await this.engagements.get(engagementId);
    return await this.db.listWeeklyReports(engagementId);
  }

  async getPublishedArtifact(input: {
    engagementId: string;
    reportId: string;
    audience: 'internal' | 'customer';
    format: 'html' | 'pdf';
  }) {
    const report = await this.get(input.reportId);
    if (report.engagement_id !== input.engagementId) {
      throw new WeeklyReportNotFoundError(input.reportId);
    }
    if (report.status !== 'published') {
      throw new WeeklyReportStateError(
        input.reportId,
        'Weekly report artifacts are unavailable until the report is published.',
        report.status,
      );
    }
    const blobId =
      input.audience === 'internal'
        ? input.format === 'html'
          ? report.internal_html_blob_id
          : report.internal_pdf_blob_id
        : input.format === 'html'
          ? report.customer_html_blob_id
          : report.customer_pdf_blob_id;
    if (!blobId) {
      throw new WeeklyReportStateError(
        input.reportId,
        'Published weekly report artifact metadata is incomplete.',
        report.status,
      );
    }
    const blob = await this.db.getArtifactBlob(blobId);
    if (!blob) {
      throw new WeeklyReportStateError(
        input.reportId,
        'Published weekly report artifact is missing from storage metadata.',
        report.status,
      );
    }
    if (input.format === 'pdf') {
      const expectedSha256 =
        input.audience === 'internal' ? report.internal_sha256 : report.customer_sha256;
      if (!expectedSha256 || blob.sha256 !== expectedSha256) {
        throw new WeeklyReportStateError(
          input.reportId,
          'Published weekly report PDF hash does not match its immutable record.',
          report.status,
        );
      }
    }
    return {
      report,
      blob,
      filename: `${report.id}-${input.audience}-r${String(report.revision)}.${input.format}`,
    };
  }

  async publish(reportId: string) {
    const report = await this.get(reportId);
    if (report.status === 'published') return report;
    const snapshot = report.evidence_snapshot;
    if (sha256(canonicalJson(snapshot)) !== report.evidence_sha256) {
      throw new EngagementValidationError('Weekly report evidence snapshot hash does not match.');
    }
    const locale = reportLocale(snapshot);
    const internalTitle = locale === 'ko' ? '내부 FDE 주간 보고서' : 'Internal FDE weekly report';
    const customerTitle =
      locale === 'ko' ? '고객 주간 진행 보고서' : 'Customer weekly delivery report';
    const internalReportLines = internalLines(snapshot, locale);
    const customerReportLines = customerLines(snapshot, locale);
    const internalHtml = reportHtml(internalTitle, internalReportLines, locale);
    const customerHtml = reportHtml(customerTitle, customerReportLines, locale);
    const [storedInternalHtml, storedCustomerHtml] = await Promise.all([
      this.artifacts.storeBuffer(Buffer.from(internalHtml), {
        filename: `${report.id}-internal.html`,
        declaredMimeType: 'text/html',
      }),
      this.artifacts.storeBuffer(Buffer.from(customerHtml), {
        filename: `${report.id}-customer.html`,
        declaredMimeType: 'text/html',
      }),
    ]);
    // Font subsetting is CPU intensive. Keep the two renders sequential so one report cannot
    // saturate a small runner (or the self-hosted instance) with duplicate fontkit work.
    const storedInternalPdf = await this.artifacts.storeBuffer(
      await this.renderPdf(internalTitle, internalReportLines),
      {
        filename: `${report.id}-internal.pdf`,
        declaredMimeType: 'application/pdf',
      },
    );
    const storedCustomerPdf = await this.artifacts.storeBuffer(
      await this.renderPdf(customerTitle, customerReportLines),
      {
        filename: `${report.id}-customer.pdf`,
        declaredMimeType: 'application/pdf',
      },
    );
    const [internalHtmlBlob, customerHtmlBlob, internalPdfBlob, customerPdfBlob] =
      await Promise.all([
        this.db.upsertArtifactBlob(storedInternalHtml),
        this.db.upsertArtifactBlob(storedCustomerHtml),
        this.db.upsertArtifactBlob(storedInternalPdf),
        this.db.upsertArtifactBlob(storedCustomerPdf),
      ]);
    const published = await this.db.publishWeeklyReport({
      id: report.id,
      internalHtmlBlobId: internalHtmlBlob.id,
      internalPdfBlobId: internalPdfBlob.id,
      customerHtmlBlobId: customerHtmlBlob.id,
      customerPdfBlobId: customerPdfBlob.id,
      internalSha256: storedInternalPdf.sha256,
      customerSha256: storedCustomerPdf.sha256,
    });
    await this.db.insertActivityLog({
      event_type: 'engagement.weekly_report_published',
      activity_type: 'engagement',
      severity: 'info',
      project_id: `engagement:${report.engagement_id}`,
      correlation_id: report.engagement_id,
      title: 'Weekly report published',
      description: `Revision ${String(report.revision)} published from evidence ${report.evidence_sha256}.`,
      status: 'completed',
      metadata: JSON.stringify({
        report_id: report.id,
        evidence_sha256: report.evidence_sha256,
        internal_pdf_sha256: storedInternalPdf.sha256,
        customer_pdf_sha256: storedCustomerPdf.sha256,
      }),
    });
    return published;
  }
}
