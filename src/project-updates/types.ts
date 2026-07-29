export type ProjectUpdateSourceType = 'repository' | 'url' | 'meeting' | 'wbs' | 'other';

export type ProjectUpdateKind =
  'decision' | 'action' | 'risk' | 'question' | 'dependency' | 'progress' | 'fact';

export type ProjectUpdateStatus =
  'open' | 'accepted' | 'noted' | 'resolved' | 'dismissed' | 'superseded';

export type ProjectUpdateTerminalStatus = 'resolved' | 'dismissed' | 'superseded';

export interface ProjectUpdateSource {
  source_type: ProjectUpdateSourceType;
  label: string;
  locator?: string;
  revision?: string;
  sha256?: string;
  artifact_id?: string;
}

export interface ProjectUpdateEntryInput {
  kind: ProjectUpdateKind;
  title: string;
  detail: string;
  status: ProjectUpdateStatus;
}

export interface ProjectUpdateTransitionInput {
  itemId: string;
  expectedStatus: ProjectUpdateStatus;
  status: ProjectUpdateTerminalStatus;
  note: string;
}

export function defaultProjectUpdateStatus(kind: ProjectUpdateKind): ProjectUpdateStatus {
  if (kind === 'decision') return 'accepted';
  if (kind === 'progress' || kind === 'fact') return 'noted';
  return 'open';
}

export function canTransitionProjectUpdateItem(
  current: ProjectUpdateStatus,
  _target: ProjectUpdateTerminalStatus,
): boolean {
  return current !== 'resolved' && current !== 'dismissed' && current !== 'superseded';
}
