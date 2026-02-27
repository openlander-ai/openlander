/**
 * Detect numbered options in assistant messages for quick selection.
 * Patterns matched: "1) ...", "1. ...", "1: ..."
 */

const CHOICE_PATTERN = /^(\d)[.):\s]\s*(.+)/;

export interface DetectedChoice {
  number: number;
  label: string;
}

export function detectChoices(content: string): DetectedChoice[] {
  const lines = content.split('\n');
  const choices: DetectedChoice[] = [];
  const seenNumbers = new Set<number>();

  for (const line of lines) {
    const trimmed = line.trim();
    const match = CHOICE_PATTERN.exec(trimmed);
    if (match) {
      const numStr = match[1];
      const labelStr = match[2];
      if (numStr && labelStr) {
        const num = parseInt(numStr, 10);
        if (num >= 1 && num <= 9 && !seenNumbers.has(num)) {
          seenNumbers.add(num);
          choices.push({ number: num, label: labelStr.trim() });
        }
      }
    }
  }

  // Only return if we found at least 2 sequential choices starting from 1
  if (choices.length < 2) return [];
  const sorted = choices.sort((a, b) => a.number - b.number);
  if (sorted[0]?.number !== 1) return [];

  return sorted;
}
