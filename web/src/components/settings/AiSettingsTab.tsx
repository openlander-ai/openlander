import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { getProviders, type ProviderInfo } from '@/lib/api/index.js';
import { AiProvidersSection } from './AiProvidersSection.js';
import { AiFeaturesSection } from './AiFeaturesSection.js';
import { AiUsageSection } from './AiUsageSection.js';

export function AiSettingsTab() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProviders = useCallback(async () => {
    try {
      const res = await getProviders();
      setProviders(res.providers);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-agent" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <AiProvidersSection providers={providers} onProvidersChange={loadProviders} />
      <AiFeaturesSection providers={providers} />
      <AiUsageSection />
    </div>
  );
}
