import { apiGet, apiPatch } from './client';

export type DataSourceKind = 'postgres' | 'redis' | 'external';
export type DataSourceAccessStatus =
  | 'enabled'
  | 'disabled'
  | 'external_requires_setup'
  | 'unsupported';

export interface DataSourceSummary {
  data_source_id: string;
  service_id: string | null;
  project_id: string;
  name: string;
  kind: DataSourceKind;
  status: DataSourceAccessStatus;
  queryable: boolean;
  access_mode: 'read' | 'disabled' | null;
  source: 'managed_service' | 'external_env';
  env_key?: string;
  host?: string;
  database?: string;
}

export interface ProjectDataSourcesResponse {
  project_id: string;
  data_sources: DataSourceSummary[];
}

export function listProjectDataSources(projectId: string): Promise<ProjectDataSourcesResponse> {
  return apiGet<ProjectDataSourcesResponse>(`/api/projects/${projectId}/data-sources`);
}

export function updateDataSourceAccess(
  projectId: string,
  serviceId: string,
  mode: 'read' | 'disabled',
): Promise<{ project_id: string; data_source: DataSourceSummary }> {
  return apiPatch<{ project_id: string; data_source: DataSourceSummary }>(
    `/api/projects/${projectId}/data-sources/${serviceId}/access`,
    { mode },
  );
}
