export const OPENLANDER_LLM_CHANGED_EVENT = 'openlander:llm-changed';

export function emitLlmChanged(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(OPENLANDER_LLM_CHANGED_EVENT));
}

export function subscribeLlmChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  window.addEventListener(OPENLANDER_LLM_CHANGED_EVENT, listener);
  return () => window.removeEventListener(OPENLANDER_LLM_CHANGED_EVENT, listener);
}
