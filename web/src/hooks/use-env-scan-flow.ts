import { useState, useCallback } from 'react';
import { scanEnvVars, type EnvVarInfo } from '@/lib/api';
import { parseEnvContent } from '@/lib/parse-env';

export type EnvScanStep = 'idle' | 'scanning' | 'paste' | 'summary';

export interface MatchedVar {
  key: string;
  value: string;
  files: Array<{ path: string; line: number }>;
}

export interface ExtraVar {
  key: string;
  value: string;
}

export function useEnvScanFlow() {
  const [envStep, setEnvStep] = useState<EnvScanStep>('idle');
  const [envVars, setEnvVars] = useState<EnvVarInfo[]>([]);
  const [pasteText, setPasteText] = useState('');
  const [matchedVars, setMatchedVars] = useState<MatchedVar[]>([]);
  const [missingVars, setMissingVars] = useState<EnvVarInfo[]>([]);
  const [extraVars, setExtraVars] = useState<ExtraVar[]>([]);
  const [missingValues, setMissingValues] = useState<Record<string, string>>({});
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});

  const reset = useCallback(() => {
    setEnvStep('idle');
    setEnvVars([]);
    setPasteText('');
    setMatchedVars([]);
    setMissingVars([]);
    setExtraVars([]);
    setMissingValues({});
    setEditedValues({});
  }, []);

  const startScan = useCallback(async (repoUrl: string, branch?: string): Promise<boolean> => {
    setEnvStep('scanning');
    try {
      const result = await scanEnvVars(repoUrl, branch);
      if (result.vars.length === 0) {
        setEnvStep('idle');
        return false;
      }
      setEnvVars(result.vars);
      setPasteText('');
      setMatchedVars([]);
      setMissingVars([]);
      setExtraVars([]);
      setMissingValues({});
      setEditedValues({});
      setEnvStep('paste');
      return true;
    } catch {
      setEnvStep('idle');
      return false;
    }
  }, []);

  const parseAndMap = useCallback((): boolean => {
    if (!pasteText.trim()) return false;

    const parsed = parseEnvContent(pasteText);
    if (parsed.length === 0) return false;

    const parsedMap = new Map(parsed.map((p) => [p.key, p.value]));
    const scannedKeys = new Set(envVars.map((v) => v.key));

    setMatchedVars(
      envVars
        .filter((v) => parsedMap.has(v.key))
        .map((v) => ({ ...v, value: parsedMap.get(v.key)! })),
    );
    setMissingVars(envVars.filter((v) => !parsedMap.has(v.key)));
    setExtraVars(parsed.filter((p) => !scannedKeys.has(p.key)));
    setEditedValues({});
    setMissingValues({});
    setEnvStep('summary');
    return true;
  }, [pasteText, envVars]);

  const removeExtra = useCallback((key: string) => {
    setExtraVars((prev) => prev.filter((v) => v.key !== key));
  }, []);

  const buildFinalVars = useCallback((): Record<string, string> => {
    const vars: Record<string, string> = {};
    for (const v of matchedVars) {
      vars[v.key] = editedValues[v.key] ?? v.value;
    }
    for (const v of missingVars) {
      if (missingValues[v.key]) {
        vars[v.key] = missingValues[v.key];
      }
    }
    for (const v of extraVars) {
      vars[v.key] = v.value;
    }
    return vars;
  }, [matchedVars, missingVars, extraVars, editedValues, missingValues]);

  const goBackToPaste = useCallback(() => {
    setEnvStep('paste');
  }, []);

  return {
    envStep,
    envVars,
    pasteText,
    setPasteText,
    matchedVars,
    missingVars,
    extraVars,
    missingValues,
    setMissingValues,
    editedValues,
    setEditedValues,
    startScan,
    parseAndMap,
    removeExtra,
    buildFinalVars,
    goBackToPaste,
    reset,
  };
}
