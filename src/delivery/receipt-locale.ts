import type {
  DeliveryArtifactKind,
  DeliveryMaturity,
  DeliveryReadinessCheck,
  DeliveryStatus,
  DeliveryType,
  GateStatus,
} from './types.js';

export type ReceiptLocale = 'ko' | 'en';

const KOREAN_DELIVERY_TYPES: Record<DeliveryType, string> = {
  software_release: '소프트웨어 릴리스',
  artifact_delivery: '자료 납품',
};

const KOREAN_DELIVERY_MATURITY: Record<DeliveryMaturity, string> = {
  concept: '개념 단계',
  functional_preview: '기능 시연본',
  customer_review: '고객 검토',
  release_candidate: '릴리스 후보',
  production: '운영',
};

const KOREAN_DELIVERY_STATUS: Record<DeliveryStatus, string> = {
  draft: '작성 중',
  in_review: '검토 중',
  revision_requested: '수정 요청됨',
  approved: '승인됨',
  ready: '준비 완료',
  delivered: '납품 완료',
  cancelled: '취소됨',
};

const KOREAN_GATE_STATUS: Record<GateStatus, string> = {
  pending: '대기',
  passed: '통과',
  warning: '경고',
  failed: '실패',
  waived: '면제',
};

const KOREAN_ARTIFACT_KIND: Record<DeliveryArtifactKind, string> = {
  review_html: '검토용 HTML',
  companion_pdf: '첨부 PDF',
  markdown: 'Markdown',
  qa_report: 'QA 보고서',
  data_report: '데이터 보고서',
  image: '이미지',
  other: '기타',
};

const KOREAN_DEPLOY_RELATION: Record<'candidate' | 'released' | 'rollback', string> = {
  candidate: '후보 배포',
  released: '운영 반영',
  rollback: '롤백',
};

const KOREAN_ENVIRONMENT: Record<'production' | 'development', string> = {
  production: '운영',
  development: '개발',
};

const KOREAN_DEPLOY_STATUS: Record<'success' | 'failed' | 'cancelled', string> = {
  success: '성공',
  failed: '실패',
  cancelled: '취소',
};

function koreanOrValue<T extends string>(
  locale: ReceiptLocale,
  value: T,
  translations: Record<T, string>,
): string {
  return locale === 'ko' ? translations[value] : value;
}

export function formatReceiptDeliveryType(value: DeliveryType, locale: ReceiptLocale): string {
  return koreanOrValue(locale, value, KOREAN_DELIVERY_TYPES);
}

export function formatReceiptDeliveryMaturity(
  value: DeliveryMaturity,
  locale: ReceiptLocale,
): string {
  return koreanOrValue(locale, value, KOREAN_DELIVERY_MATURITY);
}

export function formatReceiptDeliveryStatus(value: DeliveryStatus, locale: ReceiptLocale): string {
  return koreanOrValue(locale, value, KOREAN_DELIVERY_STATUS);
}

export function formatReceiptGateStatus(value: GateStatus, locale: ReceiptLocale): string {
  return koreanOrValue(locale, value, KOREAN_GATE_STATUS);
}

export function formatReceiptGateLabel(
  gateKey: string,
  label: string,
  locale: ReceiptLocale,
): string {
  if (locale !== 'ko') return label;
  if (gateKey === 'review' && label === 'Review') return '검토';
  if (gateKey === 'qa' && label === 'QA') return 'QA';
  if (gateKey === 'data' && label === 'Data') return '데이터';
  return label;
}

export function formatReceiptArtifactKind(
  value: DeliveryArtifactKind,
  locale: ReceiptLocale,
): string {
  return koreanOrValue(locale, value, KOREAN_ARTIFACT_KIND);
}

export function formatReceiptDeployRelation(
  value: 'candidate' | 'released' | 'rollback',
  locale: ReceiptLocale,
): string {
  return koreanOrValue(locale, value, KOREAN_DEPLOY_RELATION);
}

export function formatReceiptEnvironment(
  value: 'production' | 'development' | null,
  locale: ReceiptLocale,
): string {
  if (value === null) return locale === 'ko' ? '정보 없음' : 'unknown';
  return koreanOrValue(locale, value, KOREAN_ENVIRONMENT);
}

export function formatReceiptDeployStatus(
  value: 'success' | 'failed' | 'cancelled' | null,
  locale: ReceiptLocale,
): string {
  if (value === null) return locale === 'ko' ? '정보 없음' : 'unknown';
  return koreanOrValue(locale, value, KOREAN_DEPLOY_STATUS);
}

function readinessParam(check: DeliveryReadinessCheck, key: string): number | null {
  const value = check.params?.[key];
  return typeof value === 'number' ? value : null;
}

export function formatReceiptReadinessCheck(
  check: DeliveryReadinessCheck,
  locale: ReceiptLocale,
  deliveryType?: DeliveryType,
): string {
  if (locale === 'en') return check.message;

  const count = readinessParam(check, 'count');

  switch (check.key) {
    case 'delivery_approved':
      return check.passed
        ? '납품 승인이 기록되었습니다.'
        : '납품 확인서 미리보기를 만들기 전에 담당 FDE가 납품 건을 승인해야 합니다.';
    case 'approved_artifact':
      return check.passed
        ? count === null
          ? '승인된 산출물이 있습니다.'
          : `승인된 산출물 ${String(count)}개`
        : '승인된 산출물이 하나 이상 필요합니다.';
    case 'customer_approval':
      return check.passed
        ? count === null
          ? '유효한 고객 승인 근거가 기록되어 있습니다.'
          : `유효한 고객 승인 기록 ${String(count)}건`
        : '고객 승인 근거가 필요합니다.';
    case 'work_items_resolved':
      return check.passed
        ? '확정된 질문과 수정 요청을 모두 해결했습니다.'
        : count === null
          ? '확정된 질문 또는 수정 요청이 해결되지 않았습니다.'
          : `확정된 질문 또는 수정 요청 ${String(count)}건이 해결되지 않았습니다.`;
    case 'required_gates':
      return check.passed
        ? '필수 통과 기준을 모두 충족했거나 사유를 기록하고 면제했습니다.'
        : count === null
          ? '충족하지 못한 필수 통과 기준이 있습니다.'
          : `필수 통과 기준 ${String(count)}개를 충족하지 못했습니다.`;
    case 'warnings_acknowledged':
      return check.passed
        ? '통과 기준 경고를 모두 확인했습니다.'
        : count === null
          ? '확인이 필요한 통과 기준 경고가 있습니다.'
          : `확인이 필요한 통과 기준 경고가 ${String(count)}개 있습니다.`;
    case 'limitations_recorded':
      return check.passed
        ? '알려진 제한 사항을 기록했습니다.'
        : '알려진 제한 사항을 입력하거나 “없음”으로 표시하세요.';
    case 'html_companion_pdf':
      return check.passed
        ? '확인서에 포함되는 모든 HTML 산출물에 승인된 PDF가 연결되어 있습니다.'
        : count === null
          ? '승인된 PDF가 연결되지 않은 HTML 산출물이 있습니다.'
          : `HTML 산출물 ${String(count)}개에 승인된 PDF가 연결되어 있지 않습니다.`;
    case 'production_deploy':
      if (deliveryType === 'artifact_delivery' || check.params?.['not_required'] === 1) {
        return '자료 납품에는 운영 배포가 필요하지 않습니다.';
      }
      return check.passed
        ? '같은 프로젝트의 성공한 운영 배포가 연결되어 있습니다.'
        : '같은 프로젝트의 성공한 운영 배포를 “운영 반영”으로 연결해야 합니다.';
    case 'page_limit': {
      const max = readinessParam(check, 'max');
      return check.passed
        ? count === null
          ? '예상 확인서 분량이 허용 범위 이내입니다.'
          : `예상 확인서 분량은 ${String(count)}페이지입니다.`
        : count === null || max === null
          ? '예상 확인서 분량이 최대 페이지 수를 초과합니다.'
          : `예상 확인서 분량 ${String(count)}페이지가 최대 ${String(max)}페이지를 초과합니다.`;
    }
  }
}
