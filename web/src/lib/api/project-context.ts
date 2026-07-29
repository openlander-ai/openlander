import { apiPost } from './client';

export type ProjectUpdateKind =
  'decision' | 'action' | 'risk' | 'question' | 'dependency' | 'progress' | 'fact';

export type ProjectUpdateStatus =
  'open' | 'accepted' | 'noted' | 'resolved' | 'dismissed' | 'superseded';

export interface ProjectContextItem {
  item_id: string;
  update_id: string;
  kind: ProjectUpdateKind;
  title: string;
  detail_excerpt: string;
  status: ProjectUpdateStatus;
  occurred_at: string;
  created_by: string;
  related_delivery_ids: string[];
  related_delivery_count: number;
  related_delivery_ids_truncated: boolean;
}

export interface ProjectContext {
  status: 'ok';
  project_id: string;
  generated_at: string;
  counts: {
    total_by_kind: Record<string, number>;
    current_by_kind: Record<string, number>;
  };
  current_items: ProjectContextItem[];
  recent_updates: Array<{
    update_id: string;
    summary_excerpt: string;
    occurred_at: string;
    created_at: string;
    created_by: string;
    source_labels: string[];
    source_count: number;
    sources_truncated: boolean;
    item_count: number;
  }>;
  changed_delivery_context: Array<{
    delivery_id: string;
    item_id: string;
    linked_status: ProjectUpdateStatus;
    current_status: ProjectUpdateStatus;
  }>;
  truncated: {
    current_items: boolean;
    recent_updates: boolean;
    changed_delivery_context: boolean;
  };
}

interface OperationResponse<T> {
  operation_id: string | null;
  operation: string;
  version: number;
  status: 'succeeded';
  replayed: boolean;
  result: T;
}

export async function getProjectContext(projectId: string): Promise<ProjectContext> {
  const response = await apiPost<OperationResponse<ProjectContext>>(
    '/api/v1/operations/get_project_context',
    { project_id: projectId },
  );
  return response.result;
}
