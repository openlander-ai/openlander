import { useState } from 'react';
import { DeploymentsList } from '@/components/project/DeploymentsList';
import { PRPreviewsList } from '@/components/timeline/PRPreviewsList';
import { cn } from '@/lib/utils';
import { History, GitPullRequest } from 'lucide-react';

type FilterMode = 'deploys' | 'previews';

interface DeploymentsTabProps {
  projectId: string;
  projectStatus?: string;
}

export function DeploymentsTab({ projectId, projectStatus }: DeploymentsTabProps) {
  const [filter, setFilter] = useState<FilterMode>('deploys');

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

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {filter === 'deploys' ? (
          <DeploymentsList projectId={projectId} projectStatus={projectStatus} />
        ) : (
          <PRPreviewsList projectId={projectId} />
        )}
      </div>
    </div>
  );
}
