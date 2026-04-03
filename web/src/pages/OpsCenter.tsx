import { useLanguage } from '@/i18n/context';

export function OpsCenter() {
  const { t } = useLanguage();

  return (
    <div className="flex-1 overflow-auto bg-app p-4 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-xl lg:text-2xl font-display font-semibold tracking-tight text-primary-ol">
            {t('operations.title')}
          </h1>
          <p className="mt-1 text-sm text-muted-ol font-body">{t('operations.description')}</p>
        </div>

        {/* Sections will be added in subsequent tasks */}
        <div className="text-sm text-muted-ol font-body">Loading operations data...</div>
      </div>
    </div>
  );
}
