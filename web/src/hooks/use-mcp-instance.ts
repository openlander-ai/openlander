import { useCallback, useEffect, useState } from 'react';
import { getMcpInstance, updateMcpInstanceName, type McpInstanceInfo } from '@/lib/api';
import { getMcpEndpoint } from '@/lib/mcp-endpoint';

export function useMcpInstance() {
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
      setError(err instanceof Error ? err.message : 'Failed to load MCP instance');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const info = await updateMcpInstanceName(draftName);
      setInstance(info);
      setDraftName(info.name);
      return info;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save MCP instance');
      throw err;
    } finally {
      setSaving(false);
    }
  }, [draftName]);

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
