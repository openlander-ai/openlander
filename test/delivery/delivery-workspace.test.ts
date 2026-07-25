import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { ArtifactStore } from '../../src/delivery/artifact-store.js';
import { evaluateDeliveryReadiness } from '../../src/delivery/readiness.js';
import { ReceiptBuilder } from '../../src/delivery/receipt-builder.js';
import { parseJUnitReport } from '../../src/delivery/report-normalizer.js';
import type {
  DeliveryArtifactWithBlob,
  DeliveryDetail,
  DeliveryReadiness,
} from '../../src/delivery/types.js';
import { DELIVERY_TRANSITIONS, parseDefaultDeliveryGates } from '../../src/delivery/types.js';
import type { ProjectRow } from '../../src/db/types.js';

const NOW = '2026-07-25T00:00:00.000Z';
const temporaryDirectories: string[] = [];

async function makeStore(): Promise<ArtifactStore> {
  const directory = await mkdtemp(join(tmpdir(), 'openlander-delivery-test-'));
  temporaryDirectories.push(directory);
  return new ArtifactStore(directory);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
}, 30_000);

function artifact(overrides: Partial<DeliveryArtifactWithBlob>): DeliveryArtifactWithBlob {
  return {
    id: 'artifact-html',
    delivery_id: 'delivery-1',
    blob_id: 'blob-html',
    logical_key: 'storyboard',
    revision: 1,
    kind: 'review_html',
    original_filename: 'storyboard.html',
    status: 'approved',
    companion_pdf_artifact_id: 'artifact-pdf',
    include_in_receipt: true,
    receipt_order: 1,
    idempotency_key: null,
    created_at: NOW,
    updated_at: NOW,
    blob: {
      id: 'blob-html',
      sha256: 'a'.repeat(64),
      mime_type: 'text/html',
      size_bytes: 20,
      storage_key: `sha256/${'a'.repeat(2)}/${'a'.repeat(64)}`,
      created_at: NOW,
    },
    ...overrides,
  };
}

function readyDetail(overrides: Partial<DeliveryDetail> = {}): DeliveryDetail {
  const html = artifact({});
  const pdf = artifact({
    id: 'artifact-pdf',
    blob_id: 'blob-pdf',
    kind: 'companion_pdf',
    original_filename: 'storyboard.pdf',
    companion_pdf_artifact_id: null,
    receipt_order: 2,
    blob: {
      id: 'blob-pdf',
      sha256: 'b'.repeat(64),
      mime_type: 'application/pdf',
      size_bytes: 100,
      storage_key: `sha256/${'b'.repeat(2)}/${'b'.repeat(64)}`,
      created_at: NOW,
    },
  });
  return {
    delivery: {
      id: 'delivery-1',
      project_id: 'project-1',
      title: '고객 검토 패키지',
      summary: '검토 결과와 배포 증빙',
      delivery_type: 'software_release',
      maturity: 'release_candidate',
      status: 'approved',
      limitations: '없음',
      predecessor_delivery_id: null,
      created_by: 'admin',
      created_at: NOW,
      updated_at: NOW,
    },
    settings: {
      project_id: 'project-1',
      organization_name: '테스트 조직',
      document_name: '전달 확인서',
      primary_color: '#2563EB',
      logo_blob_id: null,
      footer_text: 'OpenLander Delivery Receipt',
      locale: 'ko',
      default_gates_json: {},
      created_at: NOW,
      updated_at: NOW,
    },
    artifacts: [html, pdf],
    external_refs: [],
    feedback_sources: [],
    work_items: [
      {
        id: 'work-proposed',
        delivery_id: 'delivery-1',
        feedback_source_id: null,
        kind: 'change_request',
        title: 'AI 제안',
        detail: '확정 전 제안',
        status: 'proposed',
        is_ai_draft: true,
        resolution: null,
        created_by: 'external-agent',
        resolved_at: null,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    approvals: [
      {
        id: 'approval-1',
        delivery_id: 'delivery-1',
        artifact_ids: ['artifact-html', 'artifact-pdf'],
        approver_display_name: '고객 담당자',
        approval_excerpt: '이 버전으로 진행해 주세요.',
        source_type: 'slack',
        source_url: null,
        approved_at: NOW,
        invalidated_at: null,
        invalidated_reason: null,
        recorded_by: 'admin',
        created_at: NOW,
      },
    ],
    gates: [
      {
        id: 'gate-review',
        delivery_id: 'delivery-1',
        gate_key: 'review',
        gate_type: 'review',
        label: 'Review',
        required: true,
        status: 'passed',
        summary: 'Approved',
        waiver_reason: null,
        warning_accepted: false,
        report_artifact_id: null,
        idempotency_key: null,
        recorded_by: 'admin',
        recorded_at: NOW,
        created_at: NOW,
        updated_at: NOW,
      },
      {
        id: 'gate-qa',
        delivery_id: 'delivery-1',
        gate_key: 'qa',
        gate_type: 'qa',
        label: 'QA',
        required: true,
        status: 'passed',
        summary: '42 tests passed',
        waiver_reason: null,
        warning_accepted: false,
        report_artifact_id: null,
        idempotency_key: null,
        recorded_by: 'ci',
        recorded_at: NOW,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    deploy_links: [
      {
        link: {
          id: 'deploy-link-1',
          delivery_id: 'delivery-1',
          deploy_id: 'deploy-1',
          relation: 'released',
          linked_at: NOW,
        },
        deploy: {
          id: 'deploy-1',
          service_id: 'service-1',
          environment_id: 'environment-1',
          status: 'success',
          trigger: 'api',
          trigger_detail: null,
          commit_sha: 'abc123',
          commit_message: 'release',
          build_log: 'sensitive build output',
          runtime_log: 'sensitive runtime output',
          representative_traffic_json: 'sensitive request data',
          duration_ms: 1000,
          created_at: NOW,
        },
        service: {
          id: 'service-1',
          project_id: 'project-1',
          name: 'web',
          credentials: 'sensitive encrypted credentials',
        } as DeliveryDetail['deploy_links'][number]['service'],
        environment: {
          id: 'environment-1',
          service_id: 'service-1',
          type: 'production',
        } as DeliveryDetail['deploy_links'][number]['environment'],
      },
    ],
    receipt: null,
    ...overrides,
  };
}

describe('ArtifactStore', () => {
  it('streams, validates, hashes, and deduplicates content without using the display filename', async () => {
    const store = await makeStore();
    const bytes = Buffer.from('<!doctype html><title>검토</title>');
    const first = await store.storeBuffer(bytes, {
      filename: '../../storyboard.html',
      declaredMimeType: 'text/html',
    });
    const second = await store.storeBuffer(bytes, {
      filename: 'renamed.html',
      declaredMimeType: 'text/html',
    });

    expect(second).toEqual(first);
    expect(first.storageKey).toMatch(/^sha256\/[0-9a-f]{2}\/[0-9a-f]{64}$/);
    expect(first.storageKey).not.toContain('storyboard');
    expect(await store.read(first.storageKey)).toEqual(bytes);

    const restartedStore = new ArtifactStore(dirname(store.rootDir));
    expect(await restartedStore.read(first.storageKey)).toEqual(bytes);
  });

  it('rejects oversize, MIME-spoofed, corrupt, and path-escaping artifacts', async () => {
    const store = await makeStore();

    await expect(
      store.storeBuffer(Buffer.from('1234'), {
        filename: 'report.md',
        declaredMimeType: 'text/markdown',
        maxBytes: 3,
      }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_VALIDATION_FAILED' });
    await expect(
      store.storeBuffer(Buffer.from('<html></html>'), {
        filename: 'report.html',
        declaredMimeType: 'application/pdf',
      }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_VALIDATION_FAILED' });
    await expect(
      store.storeBuffer(Buffer.from('%PDF-not-a-pdf'), {
        filename: 'report.pdf',
        declaredMimeType: 'application/pdf',
      }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_VALIDATION_FAILED' });
    expect(() => store.resolveStorageKey('../../etc/passwd')).toThrowError(
      expect.objectContaining({ code: 'ARTIFACT_VALIDATION_FAILED' }),
    );
  });
});

describe('JUnit report normalization', () => {
  it('normalizes a successful report and sums suites without root totals', () => {
    const report = parseJUnitReport(
      '<testsuites><testsuite tests="2" failures="0" time="0.5"/><testsuite tests="3" errors="0" skipped="1" time="1.25"/></testsuites>',
    );
    expect(report).toMatchObject({
      status: 'passed',
      tests: 5,
      failures: 0,
      errors: 0,
      skipped: 1,
      durationSeconds: 1.75,
    });
  });

  it('marks failures and rejects executable XML declarations', () => {
    expect(
      parseJUnitReport('<testsuite tests="2" failures="1" errors="0" skipped="0"/>'),
    ).toMatchObject({ status: 'failed', tests: 2, failures: 1 });
    expect(() =>
      parseJUnitReport('<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><testsuite/>'),
    ).toThrowError(expect.objectContaining({ code: 'ARTIFACT_VALIDATION_FAILED' }));
  });
});

describe('Delivery readiness', () => {
  it('accepts complete evidence and ignores unconfirmed AI drafts', () => {
    const readiness = evaluateDeliveryReadiness(readyDetail(), 12);
    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).toEqual([]);
  });

  it('blocks confirmed work, unaccepted warnings, missing companion PDFs, and excess pages', () => {
    const detail = readyDetail();
    detail.work_items[0] = { ...detail.work_items[0]!, status: 'confirmed' };
    detail.gates[1] = { ...detail.gates[1]!, status: 'warning', warning_accepted: false };
    detail.artifacts[0] = { ...detail.artifacts[0]!, companion_pdf_artifact_id: null };

    const readiness = evaluateDeliveryReadiness(detail, 251);
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.filter((check) => !check.passed).map((check) => check.key)).toEqual([
      'work_items_resolved',
      'required_gates',
      'warnings_acknowledged',
      'html_companion_pdf',
      'page_limit',
    ]);
  });

  it('blocks an approved HTML artifact when its companion PDF is excluded from the Receipt', () => {
    const detail = readyDetail();
    detail.artifacts[1] = { ...detail.artifacts[1]!, include_in_receipt: false };

    const readiness = evaluateDeliveryReadiness(detail, 8);

    expect(readiness.ready).toBe(false);
    expect(readiness.checks.find((check) => check.key === 'html_companion_pdf')).toMatchObject({
      passed: false,
    });
  });

  it('does not require a Production deployment for artifact-only delivery', () => {
    const detail = readyDetail({
      delivery: {
        ...readyDetail().delivery,
        delivery_type: 'artifact_delivery',
      },
      deploy_links: [],
    });
    expect(evaluateDeliveryReadiness(detail, 8).ready).toBe(true);
  });
});

describe('Delivery state machine', () => {
  it('keeps ready calculated and finalized/cancelled Deliveries terminal', () => {
    expect(DELIVERY_TRANSITIONS.draft).not.toContain('ready');
    expect(DELIVERY_TRANSITIONS.in_review).not.toContain('ready');
    expect(DELIVERY_TRANSITIONS.approved).toContain('ready');
    expect(DELIVERY_TRANSITIONS.delivered).toEqual([]);
    expect(DELIVERY_TRANSITIONS.cancelled).toEqual([]);
  });
});

describe('default Gate templates', () => {
  it('fills omitted Delivery types from defaults and rejects duplicate keys', () => {
    expect(
      parseDefaultDeliveryGates({
        software_release: [
          { gate_key: 'review', gate_type: 'review', label: 'Review', required: true },
          { gate_key: 'security', gate_type: 'custom', label: 'Security', required: true },
        ],
      }),
    ).toMatchObject({
      software_release: [
        { gate_key: 'review', required: true },
        { gate_key: 'security', required: true },
      ],
      artifact_delivery: [
        { gate_key: 'review', required: true },
        { gate_key: 'qa', required: false },
        { gate_key: 'data', required: false },
      ],
    });
    expect(
      parseDefaultDeliveryGates({
        software_release: [
          { gate_key: 'qa', gate_type: 'qa', label: 'QA', required: true },
          { gate_key: 'qa', gate_type: 'custom', label: 'Duplicate', required: false },
        ],
      }),
    ).toBeNull();
  });
});

describe('ReceiptBuilder', () => {
  it('renders Korean evidence pages and appends every approved companion PDF in order', async () => {
    const store = await makeStore();
    const companion = await PDFDocument.create();
    companion.addPage([200, 300]);
    companion.addPage([210, 310]);
    const stored = await store.storeBuffer(await companion.save(), {
      filename: 'storyboard.pdf',
      declaredMimeType: 'application/pdf',
    });
    const storedLogo = await store.storeBuffer(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZxZkAAAAASUVORK5CYII=',
        'base64',
      ),
      {
        filename: 'logo.png',
        declaredMimeType: 'image/png',
      },
    );
    const detail = readyDetail();
    detail.settings = { ...detail.settings, logo_blob_id: storedLogo.sha256 };
    detail.artifacts[1] = artifact({
      ...detail.artifacts[1],
      blob: {
        id: stored.sha256,
        sha256: stored.sha256,
        mime_type: stored.mimeType,
        size_bytes: stored.sizeBytes,
        storage_key: stored.storageKey,
        created_at: NOW,
      },
    });
    const readiness: DeliveryReadiness = evaluateDeliveryReadiness(detail, 9);
    const project: ProjectRow = {
      id: 'project-1',
      name: 'demo-customer',
      display_name: '데모 프로젝트',
      description: null,
      tags: null,
      archived_at: null,
      created_at: NOW,
      updated_at: NOW,
      server_id: 'local',
      deploy_lock_session: null,
      deploy_lock_at: null,
      container_id: null,
    };

    const result = await new ReceiptBuilder(store).build(project, detail, readiness, NOW);
    const rendered = await PDFDocument.load(result.bytes);
    const pages = rendered.getPages();

    expect(result.pageCount).toBeGreaterThan(2);
    expect(pages.at(-2)?.getWidth()).toBe(200);
    expect(pages.at(-1)?.getWidth()).toBe(210);
    expect(result.snapshot).toMatchObject({
      schema_version: 1,
      generated_at: NOW,
      project: { id: 'project-1', display_name: '데모 프로젝트' },
      detail: { delivery: { id: 'delivery-1' } },
    });
    expect(JSON.stringify(result.snapshot)).not.toContain('sensitive');
  }, 120_000);
});
