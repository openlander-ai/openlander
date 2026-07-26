/* eslint-disable openlander-internal/no-dropped-columns */
/**
 * Lint note: reads `service.image` / `service.port` off the typed wire
 * shape exposed by `@/lib/api`, not the dropped DB columns. The wire
 * layer aliases services.image_url→image and services.assigned_port→port
 * for backward compatibility. The no-dropped-columns rule is name-based
 * and would misfire here.
 */
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/context';
import { parseTimestamp } from '@/lib/time';
import type { Service } from '@/lib/api';

interface ServiceSettingsTabProps {
  service: Service;
  onDeleteClick: () => void;
}

export function ServiceSettingsTab({ service, onDeleteClick }: ServiceSettingsTabProps) {
  const { t } = useLanguage();

  return (
    <div className="max-w-3xl space-y-8">
      {/* Read-only Info */}
      <div className="space-y-4">
        <h3 className="text-sm font-display font-semibold text-foreground">
          {t('serviceSettings.information')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg border border-[hsl(var(--border))] bg-bg-panel space-y-1">
            <div className="text-xs font-body text-foreground/80">{t('serviceSettings.image')}</div>
            <div className="text-sm font-mono text-foreground">{service.image}</div>
          </div>
          <div className="p-4 rounded-lg border border-[hsl(var(--border))] bg-bg-panel space-y-1">
            <div className="text-xs font-body text-foreground/80">{t('serviceSettings.port')}</div>
            <div className="text-sm font-mono text-foreground">
              {service.port || t('serviceSettings.notAvailable')}
            </div>
          </div>
          <div className="p-4 rounded-lg border border-[hsl(var(--border))] bg-bg-panel space-y-1">
            <div className="text-xs font-body text-foreground/80">
              {t('serviceSettings.containerName')}
            </div>
            <div className="text-sm font-mono text-foreground">
              {service.container_name || t('serviceSettings.notAvailable')}
            </div>
          </div>
          <div className="p-4 rounded-lg border border-[hsl(var(--border))] bg-bg-panel space-y-1">
            <div className="text-xs font-body text-foreground/80">
              {t('serviceSettings.createdAt')}
            </div>
            <div className="text-sm font-mono text-foreground">
              {parseTimestamp(String(service.created_at))?.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="space-y-4">
        <h3 className="text-sm font-display font-semibold text-error">
          {t('serviceSettings.dangerZone')}
        </h3>
        <div className="p-4 rounded-lg border border-error/30 bg-error/5 space-y-4">
          <div>
            <h4 className="text-sm font-medium text-foreground">
              {t('serviceSettings.deleteTitle')}
            </h4>
            <p className="text-sm font-body text-foreground/80 mt-1">
              {t('serviceSettings.deleteDescription')}
            </p>
          </div>
          <Button
            variant="outline"
            className="text-error border-error/30 hover:bg-error/10 hover:text-error"
            onClick={onDeleteClick}
          >
            {t('serviceSettings.deleteAction')}
          </Button>
        </div>
      </div>
    </div>
  );
}
