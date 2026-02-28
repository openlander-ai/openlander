export function parseDockerStep(
  line: string,
): { current: number; total: number; description: string } | null {
  const match = line.match(/^Step (\d+)\/(\d+)\s*:\s*(.*)/i);
  if (!match) return null;
  const [, current, total, description] = match;
  return {
    current: Number(current ?? 0),
    total: Number(total ?? 0),
    description: (description ?? '').trim(),
  };
}
