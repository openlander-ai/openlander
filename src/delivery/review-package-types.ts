import type {
  ArtifactBlobRow,
  DeliveryArtifactRow,
  DeliveryGateRow,
  DeliveryReviewPackageItemRow,
  DeliveryReviewPackageRow,
  DeliveryRow,
} from '../db/schema.drizzle.js';

export type DeliveryReviewPackageRole = DeliveryReviewPackageItemRow['role'];
export type DeliveryReviewPackageStatus = DeliveryReviewPackageRow['status'];

export interface DeliveryReviewPackageFileSpec {
  role: DeliveryReviewPackageRole;
  filename: string;
  expected_sha256: string;
  expected_size_bytes: number;
  mime_type: string;
}

export type DeliveryReviewPackageOverview =
  | {
      mode: 'update';
      title?: string;
      summary?: string;
      limitations?: string | null;
    }
  | { mode: 'keep'; reason: string };

export interface DeliveryReviewPackageItemDetail {
  item: DeliveryReviewPackageItemRow;
  blob: ArtifactBlobRow | null;
  artifact: DeliveryArtifactRow | null;
}

export interface DeliveryReviewPackageDetail {
  package: DeliveryReviewPackageRow;
  delivery: DeliveryRow;
  items: DeliveryReviewPackageItemDetail[];
  gate: DeliveryGateRow | null;
}

export interface PublishedDeliveryReviewPackage extends DeliveryReviewPackageDetail {
  primaryArtifact: DeliveryArtifactRow;
  artifacts: DeliveryArtifactRow[];
}
