export function isGitNetworkFailure(error: unknown, message: string): boolean {
  const errorRecord = error && typeof error === 'object' ? error : undefined;
  const rawCode = errorRecord && 'code' in errorRecord ? errorRecord.code : undefined;
  const code = typeof rawCode === 'string' || typeof rawCode === 'number' ? String(rawCode) : '';
  const killed = errorRecord && 'killed' in errorRecord ? errorRecord.killed : undefined;
  const signal = errorRecord && 'signal' in errorRecord ? errorRecord.signal : undefined;
  if (killed === true && (signal === 'SIGTERM' || signal === 'SIGKILL')) {
    return true;
  }
  if (
    [
      'ETIMEDOUT',
      'ENETUNREACH',
      'EHOSTUNREACH',
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'EAI_AGAIN',
    ].includes(code)
  ) {
    return true;
  }

  return /(?:could not resolve (?:host|hostname)|temporary failure in name resolution|name or service not known|connection (?:timed out|reset by peer|refused)|operation timed out|network is unreachable|no route to host|failed to connect|ssh: connect to host .* port \d+|kex_exchange_identification:.*(?:closed|reset)|connection closed by remote host)/i.test(
    message,
  );
}
