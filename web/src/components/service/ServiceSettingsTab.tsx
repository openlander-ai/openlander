import { Button } from '@/components/ui/button';
import { parseTimestamp } from '@/lib/time';
import type { Service } from '@/lib/api';

interface ServiceSettingsTabProps {
  service: Service;
  onDeleteClick: () => void;
}

export function ServiceSettingsTab({ service, onDeleteClick }: ServiceSettingsTabProps) {
  return (
    <div className="max-w-3xl space-y-8">
      {/* Read-only Info */}
      <div className="space-y-4">
        <h3 className="text-sm font-display font-semibold text-foreground">Service Information</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg border border-[hsl(var(--border))] bg-bg-panel space-y-1">
            <div className="text-xs font-body text-foreground/80">Image</div>
            <div className="text-sm font-mono text-foreground">{service.image}</div>
          </div>
          <div className="p-4 rounded-lg border border-[hsl(var(--border))] bg-bg-panel space-y-1">
            <div className="text-xs font-body text-foreground/80">Port</div>
            <div className="text-sm font-mono text-foreground">{service.port || 'N/A'}</div>
          </div>
          <div className="p-4 rounded-lg border border-[hsl(var(--border))] bg-bg-panel space-y-1">
            <div className="text-xs font-body text-foreground/80">Container Name</div>
            <div className="text-sm font-mono text-foreground">
              {service.container_name || 'N/A'}
            </div>
          </div>
          <div className="p-4 rounded-lg border border-[hsl(var(--border))] bg-bg-panel space-y-1">
            <div className="text-xs font-body text-foreground/80">Created At</div>
            <div className="text-sm font-mono text-foreground">
              {parseTimestamp(String(service.created_at))?.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="space-y-4">
        <h3 className="text-sm font-display font-semibold text-error">Danger Zone</h3>
        <div className="p-4 rounded-lg border border-error/30 bg-error/5 space-y-4">
          <div>
            <h4 className="text-sm font-medium text-foreground">Delete Service</h4>
            <p className="text-sm font-body text-foreground/80 mt-1">
              Permanently delete this service and all its data. This action cannot be undone.
            </p>
          </div>
          <Button
            variant="outline"
            className="text-error border-error/30 hover:bg-error/10 hover:text-error"
            onClick={onDeleteClick}
          >
            Delete Service
          </Button>
        </div>
      </div>
    </div>
  );
}
