import { Button } from '@/components/ui/button';
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
        <h3 className="text-sm font-display font-semibold text-primary-ol">Service Information</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg border border-[hsl(var(--border))] bg-bg-panel space-y-1">
            <div className="text-xs font-body text-secondary-ol">Image</div>
            <div className="text-sm font-mono text-primary-ol">{service.image}</div>
          </div>
          <div className="p-4 rounded-lg border border-[hsl(var(--border))] bg-bg-panel space-y-1">
            <div className="text-xs font-body text-secondary-ol">Port</div>
            <div className="text-sm font-mono text-primary-ol">{service.port || 'N/A'}</div>
          </div>
          <div className="p-4 rounded-lg border border-[hsl(var(--border))] bg-bg-panel space-y-1">
            <div className="text-xs font-body text-secondary-ol">Container Name</div>
            <div className="text-sm font-mono text-primary-ol">
              {service.container_name || 'N/A'}
            </div>
          </div>
          <div className="p-4 rounded-lg border border-[hsl(var(--border))] bg-bg-panel space-y-1">
            <div className="text-xs font-body text-secondary-ol">Created At</div>
            <div className="text-sm font-mono text-primary-ol">
              {new Date(service.created_at).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="space-y-4">
        <h3 className="text-sm font-display font-semibold text-error">Danger Zone</h3>
        <div className="p-4 rounded-lg border border-error/30 bg-error/5 space-y-4">
          <div>
            <h4 className="text-sm font-medium text-primary-ol">Delete Service</h4>
            <p className="text-sm font-body text-secondary-ol mt-1">
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
