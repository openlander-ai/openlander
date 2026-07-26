import { useCallback, useEffect, useState } from 'react';
import { getMcpInstance, updateMcpInstanceName, type McpInstanceInfo } from '@/lib/api';
import { getMcpEndpoint } from '@/lib/mcp-endpoint';
import { useLanguage } from '@/i18n/context';
import { localizeApiError } from '@/lib/localized-api-error';

export function useMcpInstance() {
  const { t } = useLanguage();
  const [instance, setInstance] = useState<McpInstanceInfo | null>(null);
  const [draftName, setDraftName] = useState('openlander');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const info = await getMcpInstance();
      setInstance(info);
      setDraftName(info.name);
    } catch (err) {
      setError(localizeApiError(err, t, 'common.errors.load', 'common.errors.codes'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      // Trim before sending so a draft of " name " doesn't slip past
      // the dirty check (`draftName.trim() !== instance.name`) only to
      // be normalized server-side, leaving the on-screen input with
      // stale whitespace.
      const info = await updateMcpInstanceName(draftName.trim());
      setInstance(info);
      setDraftName(info.name);
      return info;
    } catch (err) {
      setError(localizeApiError(err, t, 'common.errors.save', 'common.errors.codes'));
      throw err;
    } finally {
      setSaving(false);
    }
  }, [draftName, t]);

  return {
    instance,
    draftName,
    setDraftName,
    endpoint: instance?.endpoint ?? getMcpEndpoint(),
    serverName: draftName.trim() || instance?.name || 'openlander',
    loading,
    saving,
    error,
    reload: load,
    save,
  };
}
