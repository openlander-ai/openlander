import { ShieldCheck } from 'lucide-react';

import { OuterCard } from '@/components/Shell/OuterCard';
import { OperationPermissionsPanel } from '@/components/security/OperationPermissionsPanel';
import { useLanguage } from '@/i18n/context';

export function SecuritySettings() {
  const { t } = useLanguage();
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <OuterCard
        title={
          <span className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[color:var(--ol-fg-muted)]" />
            {t('securityPermissions.title')}
          </span>
        }
        subtitle={t('securityPermissions.description')}
      >
        <OperationPermissionsPanel scope="global" />
      </OuterCard>
    </div>
  );
}

export default SecuritySettings;
