import { Badge } from '../ui/badge.js';
import { cn } from '../../lib/utils.js';
import { useLanguage } from '../../i18n/context.js';

interface SeverityBadgeProps {
  severity: string;
  count?: number;
  className?: string;
}

export function SeverityBadge({ severity, count, className }: SeverityBadgeProps) {
  const { t } = useLanguage();
  const isCritical = severity === 'critical';
  const isWarning = severity === 'warning';
  const isInfo = severity === 'info';

  if (isCritical) {
    return (
      <Badge variant="destructive" className={cn('h-5 px-1.5 text-[10px]', className)}>
        {count !== undefined ? `${count} ` : ''}
        {t('opsV2.severity.critical')}
      </Badge>
    );
  }

  if (isWarning) {
    return (
      <Badge
        variant="outline"
        className={cn('h-5 px-1.5 text-[10px] text-warning border-warning/50', className)}
      >
        {count !== undefined ? `${count} ` : ''}
        {t('opsV2.severity.warning')}
      </Badge>
    );
  }

  if (isInfo) {
    return (
      <Badge
        variant="outline"
        className={cn('h-5 px-1.5 text-[10px] text-info border-info/50', className)}
      >
        {count !== undefined ? `${count} ` : ''}
        {t('opsV2.severity.info')}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px] capitalize', className)}>
      {count !== undefined ? `${count} ` : ''}
      {severity}
    </Badge>
  );
}
