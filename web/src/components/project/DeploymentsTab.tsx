import { useState } from 'react';
import { DeploymentsList } from '@/components/project/DeploymentsList';
import { PRPreviewsList } from '@/components/timeline/PRPreviewsList';
import { DEPLOYMENT_HISTORY_FILTERS } from '@/lib/deployments';
import { cn } from '@/lib/utils';
import { History, GitPullRequest } from 'lucide-react';
import type { DeploymentHistoryFilter } from '@/types';

type FilterMode = 'deploys' | 'previews';

interface DeploymentsTabProps {
  projectId: string;
  projectStatus?: string;
  projectBranch?: string;
}

export function DeploymentsTab({ projectId, projectStatus, projectBranch }: DeploymentsTabProps) {
  const [filter, setFilter] = useState<FilterMode>('deploys');
  const [statusFilter, setStatusFilter] = useState<DeploymentHistoryFilter>('all');

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Filter toggle */}
      <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b border-[hsl(var(--border))] bg-bg-panel/50">
        <button
          onClick={() => setFilter('deploys')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-body transition-colors',
            filter === 'deploys'
              ? 'bg-bg-subtle text-primary-ol font-medium'
              : 'text-secondary-ol hover:text-primary-ol hover:bg-bg-subtle/50',
          )}
        >
          <History className="h-3.5 w-3.5" />
          Deployments
        </button>
        <button
          onClick={() => setFilter('previews')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-body transition-colors',
            filter === 'previews'
              ? 'bg-bg-subtle text-primary-ol font-medium'
              : 'text-secondary-ol hover:text-primary-ol hover:bg-bg-subtle/50',
          )}
        >
          <GitPullRequest className="h-3.5 w-3.5" />
          PR Previews
        </button>
      </div>

      {filter === 'deploys' && (
        <div className="shrink-0 flex flex-wrap items-center gap-1 px-4 py-2 border-b border-[hsl(var(--border))] bg-bg-app/60">
          {DEPLOYMENT_HISTORY_FILTERS.map((item) => (
            <button
              key={item}
              onClick={() => setStatusFilter(item)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-body transition-colors capitalize',
                statusFilter === item
                  ? 'bg-bg-subtle text-primary-ol font-medium'
                  : 'text-secondary-ol hover:text-primary-ol hover:bg-bg-subtle/50',
              )}
            >
              {item === 'in_progress' ? 'In Progress' : item}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {filter === 'deploys' ? (
          <DeploymentsList
            projectId={projectId}
            projectStatus={projectStatus}
            projectBranch={projectBranch}
            statusFilter={statusFilter}
          />
        ) : (
          <PRPreviewsList projectId={projectId} />
        )}
      </div>
    </div>
  );
}
