import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import fontkit from 'pdf-fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import type { PDFImage, PDFPage, PDFFont } from 'pdf-lib';
import { ReceiptGenerationError } from '../errors.js';
import type { ProjectRow } from '../db/types.js';
import type { ArtifactStore } from './artifact-store.js';
import {
  formatReceiptArtifactKind,
  formatReceiptDeliveryMaturity,
  formatReceiptDeliveryStatus,
  formatReceiptDeliveryType,
  formatReceiptDeployRelation,
  formatReceiptDeployStatus,
  formatReceiptEnvironment,
  formatReceiptGateLabel,
  formatReceiptGateStatus,
  formatReceiptReadinessCheck,
  type ReceiptLocale,
} from './receipt-locale.js';
import type { DeliveryDetail, DeliveryReadiness, ReceiptSnapshot } from './types.js';
import { MAX_RECEIPT_PAGES } from './types.js';

const require = createRequire(import.meta.url);
const NOTO_SANS_KR_PATH =
  require.resolve('@fontsource/noto-sans-kr/files/noto-sans-kr-korean-400-normal.woff');

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

interface ReceiptTheme {
  primary: ReturnType<typeof rgb>;
  organizationName: string;
  documentName: string;
  footerText: string;
  locale: 'ko' | 'en';
}

export interface ReceiptBuildResult {
  bytes: Uint8Array;
  pageCount: number;
  snapshot: ReceiptSnapshot;
}

function parseColor(value: string): ReturnType<typeof rgb> {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match?.[1]) return rgb(0.145, 0.388, 0.922);
  const hex = match[1];
  return rgb(
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
  );
}

function splitLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const normalized = text.normalize('NFC').replace(/\r/g, '');
  const result: string[] = [];
  for (const paragraph of normalized.split('\n')) {
    if (!paragraph) {
      result.push('');
      continue;
    }
    let line = '';
    for (const char of paragraph) {
      const candidate = line + char;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        result.push(line);
        line = char;
      } else {
        line = candidate;
      }
    }
    result.push(line);
  }
  return result;
}

class ReceiptWriter {
  private page: PDFPage;
  private y = PAGE_HEIGHT - MARGIN;
  private pageNumber = 0;

  constructor(
    private readonly document: PDFDocument,
    private readonly font: PDFFont,
    private readonly theme: ReceiptTheme,
  ) {
    this.page = this.addPage();
  }

  private addPage(): PDFPage {
    const page = this.document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pageNumber++;
    page.drawText(this.theme.footerText, {
      x: MARGIN,
      y: 23,
      size: 7,
      font: this.font,
      color: rgb(0.38, 0.42, 0.48),
    });
    page.drawText(String(this.pageNumber), {
      x: PAGE_WIDTH - MARGIN - 15,
      y: 23,
      size: 7,
      font: this.font,
      color: rgb(0.38, 0.42, 0.48),
    });
    this.y = PAGE_HEIGHT - MARGIN;
    return page;
  }

  ensure(height: number): void {
    if (this.y - height < 48) {
      this.page = this.addPage();
    }
  }

  spacer(height = 8): void {
    this.y -= height;
  }

  heading(text: string): void {
    const sectionGap = 16;
    this.ensure(sectionGap + 42);
    this.y -= sectionGap;
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - 5,
      width: 5,
      height: 20,
      color: this.theme.primary,
    });
    this.page.drawText(text, {
      x: MARGIN + 14,
      y: this.y,
      size: 16,
      font: this.font,
      color: rgb(0.08, 0.11, 0.16),
    });
    this.y -= 36;
  }

  text(text: string, options: { size?: number; color?: ReturnType<typeof rgb> } = {}): void {
    const size = options.size ?? 9.5;
    const lineHeight = size * 1.55;
    const lines = splitLines(text || '—', this.font, size, CONTENT_WIDTH);
    for (const line of lines) {
      this.ensure(lineHeight);
      this.page.drawText(line || ' ', {
        x: MARGIN,
        y: this.y,
        size,
        font: this.font,
        color: options.color ?? rgb(0.18, 0.22, 0.28),
      });
      this.y -= lineHeight;
    }
  }

  row(label: string, value: string): void {
    this.ensure(24);
    this.page.drawText(label, {
      x: MARGIN,
      y: this.y,
      size: 8.5,
      font: this.font,
      color: rgb(0.42, 0.46, 0.53),
    });
    const valueLines = splitLines(value || '—', this.font, 9.5, CONTENT_WIDTH - 145);
    for (const [index, line] of valueLines.entries()) {
      if (index > 0) this.ensure(15);
      this.page.drawText(line || ' ', {
        x: MARGIN + 145,
        y: this.y,
        size: 9.5,
        font: this.font,
        color: rgb(0.12, 0.15, 0.2),
      });
      this.y -= 15;
    }
  }

  bullet(text: string): void {
    const lines = splitLines(text, this.font, 9.25, CONTENT_WIDTH - 18);
    for (const [index, line] of lines.entries()) {
      this.ensure(15);
      this.page.drawText(index === 0 ? '•' : ' ', {
        x: MARGIN,
        y: this.y,
        size: 9.25,
        font: this.font,
        color: this.theme.primary,
      });
      this.page.drawText(line || ' ', {
        x: MARGIN + 18,
        y: this.y,
        size: 9.25,
        font: this.font,
        color: rgb(0.18, 0.22, 0.28),
      });
      this.y -= 15;
    }
  }

  cover(title: string, subtitle: string, identifier: string, logo?: PDFImage): void {
    this.page.drawRectangle({
      x: 0,
      y: PAGE_HEIGHT - 205,
      width: PAGE_WIDTH,
      height: 205,
      color: this.theme.primary,
    });
    this.page.drawText(this.theme.organizationName, {
      x: MARGIN,
      y: PAGE_HEIGHT - 75,
      size: 11,
      font: this.font,
      color: rgb(1, 1, 1),
    });
    if (logo) {
      const scale = Math.min(110 / logo.width, 55 / logo.height, 1);
      const width = logo.width * scale;
      const height = logo.height * scale;
      this.page.drawImage(logo, {
        x: PAGE_WIDTH - MARGIN - width,
        y: PAGE_HEIGHT - 83 - height / 2,
        width,
        height,
      });
    }
    this.page.drawText(this.theme.documentName, {
      x: MARGIN,
      y: PAGE_HEIGHT - 112,
      size: 24,
      font: this.font,
      color: rgb(1, 1, 1),
    });
    const titleLines = splitLines(title, this.font, 25, CONTENT_WIDTH);
    let titleY = PAGE_HEIGHT - 280;
    for (const line of titleLines) {
      this.page.drawText(line, {
        x: MARGIN,
        y: titleY,
        size: 25,
        font: this.font,
        color: rgb(0.08, 0.11, 0.16),
      });
      titleY -= 38;
    }
    this.page.drawText(subtitle, {
      x: MARGIN,
      y: titleY - 12,
      size: 12,
      font: this.font,
      color: rgb(0.38, 0.42, 0.48),
    });
    this.page.drawText(identifier, {
      x: MARGIN,
      y: titleY - 48,
      size: 10,
      font: this.font,
      color: this.theme.primary,
    });
    this.page = this.addPage();
  }
}

function artifactLabel(detail: DeliveryDetail, artifactId: string, locale: ReceiptLocale): string {
  const artifact = detail.artifacts.find((item) => item.id === artifactId);
  if (!artifact) return artifactId;
  const revision =
    locale === 'ko' ? `버전 ${String(artifact.revision)}` : `r${String(artifact.revision)}`;
  return `${artifact.original_filename} (${revision})`;
}

function makeTheme(detail: DeliveryDetail): ReceiptTheme {
  return {
    primary: parseColor(detail.settings.primary_color),
    organizationName: detail.settings.organization_name || 'OpenLander',
    documentName: detail.settings.document_name,
    footerText:
      detail.settings.footer_text ||
      (detail.settings.locale === 'ko' ? 'OpenLander 납품 확인서' : 'OpenLander Delivery Receipt'),
    locale: detail.settings.locale,
  };
}

function snapshotDetail(detail: DeliveryDetail): ReceiptSnapshot['detail'] {
  const { project_context_items: _projectContextItems, ...receiptDetail } = detail;
  void _projectContextItems;
  return {
    ...receiptDetail,
    deploy_links: detail.deploy_links.map(({ link, deploy, service, environment }) => ({
      link,
      deploy: {
        id: deploy.id,
        service_id: deploy.service_id,
        environment_id: deploy.environment_id,
        status: deploy.status,
        commit_sha: deploy.commit_sha,
        commit_message: deploy.commit_message,
        duration_ms: deploy.duration_ms,
        created_at: deploy.created_at,
      },
      service: {
        id: service.id,
        project_id: service.project_id,
        name: service.name,
        kind: service.kind,
      },
      environment: environment
        ? {
            id: environment.id,
            service_id: environment.service_id,
            type: environment.type,
            branch: environment.branch,
            status: environment.status,
            image_tag: environment.image_tag,
            public_url: environment.public_url,
            created_at: environment.created_at,
            updated_at: environment.updated_at,
          }
        : null,
    })),
  };
}

export class ReceiptBuilder {
  private fontBytes: Uint8Array | null = null;

  constructor(private readonly artifactStore: ArtifactStore) {}

  private async loadFont(): Promise<Uint8Array> {
    this.fontBytes ??= await readFile(NOTO_SANS_KR_PATH);
    return this.fontBytes;
  }

  async countCompanionPages(detail: DeliveryDetail): Promise<number> {
    let pages = 0;
    for (const artifact of detail.artifacts) {
      if (
        artifact.kind !== 'companion_pdf' ||
        artifact.status !== 'approved' ||
        !artifact.include_in_receipt
      ) {
        continue;
      }
      try {
        const document = await PDFDocument.load(
          await this.artifactStore.read(artifact.blob.storage_key),
        );
        pages += document.getPageCount();
      } catch (error) {
        throw new ReceiptGenerationError('An approved companion PDF could not be read.', {
          artifactId: artifact.id,
          cause: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return pages;
  }

  async build(
    project: ProjectRow,
    detail: DeliveryDetail,
    readiness: DeliveryReadiness,
    generatedAt = new Date().toISOString(),
  ): Promise<ReceiptBuildResult> {
    try {
      const document = await PDFDocument.create();
      document.registerFontkit(fontkit);
      const font = await document.embedFont(await this.loadFont(), { subset: true });
      let logo: PDFImage | undefined;
      if (detail.settings.logo_blob_id) {
        const logoId = detail.settings.logo_blob_id;
        const logoBytes = await this.artifactStore.read(`sha256/${logoId.slice(0, 2)}/${logoId}`);
        if (
          logoBytes.length >= 8 &&
          Buffer.from(logoBytes.subarray(0, 8)).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        ) {
          logo = await document.embedPng(logoBytes);
        } else if (
          logoBytes.length >= 3 &&
          logoBytes[0] === 0xff &&
          logoBytes[1] === 0xd8 &&
          logoBytes[2] === 0xff
        ) {
          logo = await document.embedJpg(logoBytes);
        } else {
          throw new ReceiptGenerationError('Configured Receipt logo is not a PNG or JPEG.');
        }
      }
      const theme = makeTheme(detail);
      const writer = new ReceiptWriter(document, font, theme);
      const delivery = detail.delivery;
      const locale = theme.locale;

      writer.cover(
        delivery.title,
        project.display_name || project.name,
        `${locale === 'ko' ? '납품 건 ID' : 'Delivery ID'}: ${delivery.id}`,
        logo,
      );

      writer.heading(locale === 'ko' ? '범위 및 변경 요약' : 'Scope and change summary');
      writer.row(locale === 'ko' ? '프로젝트' : 'Project', project.display_name || project.name);
      writer.row(
        locale === 'ko' ? '유형' : 'Type',
        formatReceiptDeliveryType(delivery.delivery_type, locale),
      );
      writer.row(
        locale === 'ko' ? '납품 단계' : 'Maturity',
        formatReceiptDeliveryMaturity(delivery.maturity, locale),
      );
      writer.row(
        locale === 'ko' ? '상태' : 'Status',
        formatReceiptDeliveryStatus(delivery.status, locale),
      );
      writer.spacer();
      writer.text(delivery.summary);

      writer.heading(
        locale === 'ko' ? '고객 결정 및 승인 근거' : 'Decisions and approval evidence',
      );
      const decisions = detail.work_items.filter(
        (item) =>
          item.kind === 'decision' && (item.status === 'confirmed' || item.status === 'resolved'),
      );
      if (decisions.length === 0)
        writer.text(locale === 'ko' ? '확정된 결정 없음' : 'No confirmed decisions');
      for (const decision of decisions) writer.bullet(`${decision.title}: ${decision.detail}`);
      writer.spacer();
      for (const approval of detail.approvals.filter((item) => !item.invalidated_at)) {
        writer.bullet(
          `${approval.approver_display_name} · ${approval.approved_at} · ${approval.approval_excerpt}`,
        );
        writer.text(
          approval.artifact_ids.map((id) => artifactLabel(detail, id, locale)).join(', '),
          { size: 8 },
        );
      }

      writer.heading(locale === 'ko' ? '통과 기준 결과' : 'Gate results');
      for (const gate of detail.gates) {
        const waiver =
          gate.status === 'waived'
            ? ` · ${locale === 'ko' ? '면제 사유' : 'waiver'}: ${gate.waiver_reason ?? ''}`
            : '';
        const warning =
          gate.status === 'warning' && gate.warning_accepted
            ? ` · ${locale === 'ko' ? '경고 확인됨' : 'acknowledged'}`
            : '';
        writer.bullet(
          `${formatReceiptGateLabel(gate.gate_key, gate.label, locale)} [${formatReceiptGateStatus(gate.status, locale)}]${
            gate.required ? ` · ${locale === 'ko' ? '필수' : 'required'}` : ''
          }${waiver}${warning}`,
        );
        if (gate.summary) writer.text(gate.summary, { size: 8 });
        if (gate.report_artifact_id) {
          const report = detail.artifacts.find(
            (artifact) => artifact.id === gate.report_artifact_id,
          );
          writer.text(
            report
              ? `${locale === 'ko' ? '보고서' : 'report'}=${report.original_filename} sha256=${report.blob.sha256}`
              : `${locale === 'ko' ? '보고서' : 'report'}=${gate.report_artifact_id}`,
            { size: 7.5 },
          );
        }
      }

      writer.heading(locale === 'ko' ? '배포 근거' : 'Deployment evidence');
      if (detail.deploy_links.length === 0) {
        writer.text(locale === 'ko' ? '연결된 배포 없음' : 'No linked deployment');
      }
      for (const evidence of detail.deploy_links) {
        writer.bullet(
          `${formatReceiptDeployRelation(evidence.link.relation, locale)} · ${
            evidence.service.name
          } · ${formatReceiptEnvironment(evidence.environment?.type ?? null, locale)} · ${formatReceiptDeployStatus(
            evidence.deploy.status ?? null,
            locale,
          )}`,
        );
        const unknown = locale === 'ko' ? '정보 없음' : 'unknown';
        writer.text(
          `${locale === 'ko' ? '배포 ID' : 'deploy'}=${evidence.deploy.id} ${
            locale === 'ko' ? '커밋' : 'commit'
          }=${evidence.deploy.commit_sha ?? unknown} ${
            locale === 'ko' ? '생성 시각' : 'created'
          }=${evidence.deploy.created_at ?? unknown}`,
          { size: 8 },
        );
      }

      writer.heading(locale === 'ko' ? '알려진 제한 사항' : 'Known limitations');
      writer.text(delivery.limitations || (locale === 'ko' ? '없음' : 'None'));

      writer.heading(locale === 'ko' ? '산출물 및 SHA-256' : 'Artifacts and SHA-256');
      for (const artifact of detail.artifacts.filter((item) => item.status === 'approved')) {
        const revision =
          locale === 'ko' ? `버전 ${String(artifact.revision)}` : `r${String(artifact.revision)}`;
        writer.bullet(
          `${artifact.original_filename} · ${formatReceiptArtifactKind(artifact.kind, locale)} · ${revision}`,
        );
        writer.text(artifact.blob.sha256, { size: 7.5 });
      }

      writer.heading(locale === 'ko' ? '확정 준비 상태' : 'Readiness record');
      for (const check of readiness.checks) {
        const result =
          locale === 'ko' ? (check.passed ? '충족' : '미충족') : check.passed ? 'PASS' : 'BLOCK';
        writer.bullet(
          `${result} · ${formatReceiptReadinessCheck(check, locale, delivery.delivery_type)}`,
        );
      }
      writer.text(`${locale === 'ko' ? '생성 시각' : 'Generated at'}: ${generatedAt}`, {
        size: 8,
      });

      for (const artifact of detail.artifacts
        .filter(
          (item) =>
            item.kind === 'companion_pdf' && item.status === 'approved' && item.include_in_receipt,
        )
        .sort(
          (a, b) => a.receipt_order - b.receipt_order || a.created_at.localeCompare(b.created_at),
        )) {
        const source = await PDFDocument.load(
          await this.artifactStore.read(artifact.blob.storage_key),
        );
        const copied = await document.copyPages(source, source.getPageIndices());
        for (const page of copied) document.addPage(page);
      }

      if (document.getPageCount() > MAX_RECEIPT_PAGES) {
        throw new ReceiptGenerationError('Receipt exceeds the 250 page limit.', {
          pageCount: document.getPageCount(),
          maxPages: MAX_RECEIPT_PAGES,
        });
      }

      const snapshot: ReceiptSnapshot = {
        schema_version: 1,
        generated_at: generatedAt,
        project: {
          id: project.id,
          name: project.name,
          display_name: project.display_name || project.name,
        },
        detail: snapshotDetail(detail),
        readiness,
      };
      document.setTitle(`${theme.documentName} — ${delivery.title}`);
      document.setAuthor(theme.organizationName);
      document.setSubject(`OpenLander Delivery ${delivery.id}`);
      document.setCreationDate(new Date(generatedAt));
      document.setModificationDate(new Date(generatedAt));
      const bytes = await document.save({ useObjectStreams: true });
      return { bytes, pageCount: document.getPageCount(), snapshot };
    } catch (error) {
      if (error instanceof ReceiptGenerationError) throw error;
      throw new ReceiptGenerationError('Receipt PDF could not be generated.', {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
