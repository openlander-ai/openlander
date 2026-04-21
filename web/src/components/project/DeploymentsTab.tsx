import { useState } from 'react';
import { DeploymentsList } from '@/components/project/DeploymentsList';
import { DEPLOYMENT_HISTORY_FILTERS } from '@/lib/deployments';
import { cn } from '@/lib/utils';
import type { DeploymentHistoryFilter } from '@/types';

interface DeploymentsTabProps {
  projectId: string;
  projectStatus?: string;
  projectBranch?: string;
}

export function DeploymentsTab({ projectId, projectStatus, projectBranch }: DeploymentsTabProps) {
  const [statusFilter, setStatusFilter] = useState<DeploymentHistoryFilter>('all');

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 flex flex-wrap items-center gap-1 px-4 py-2 border-b border-[hsl(var(--border))] bg-bg-app/60">
        {DEPLOYMENT_HISTORY_FILTERS.map((item) => (
          <button
            key={item}
            onClick={() => setStatusFilter(item)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-body transition-colors capitalize',
              statusFilter === item
                ? 'bg-bg-subtle text-foreground font-medium'
                : 'text-foreground/80 hover:text-foreground hover:bg-bg-subtle/50',
            )}
          >
            {item === 'in_progress' ? 'In Progress' : item}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <DeploymentsList
          projectId={projectId}
          projectStatus={projectStatus}
          projectBranch={projectBranch}
          statusFilter={statusFilter}
        />
      </div>
    </div>
  );
}
