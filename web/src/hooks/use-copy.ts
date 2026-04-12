import { useState, useCallback, useRef } from 'react';
import { copyToClipboard } from '@/lib/utils';

const DEFAULT_RESET_MS = 2000;

export function useCopy(resetMs = DEFAULT_RESET_MS) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const copy = useCallback(
    async (text: string, key = '_') => {
      try {
        await copyToClipboard(text);
        clearTimeout(timerRef.current);
        setCopiedKey(key);
        timerRef.current = setTimeout(() => setCopiedKey(null), resetMs);
      } catch {
        /* best-effort */
      }
    },
    [resetMs],
  );

  const isCopied = useCallback((key = '_') => copiedKey === key, [copiedKey]);

  return { copy, isCopied, copiedKey } as const;
}
