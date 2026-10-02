export function retryDelay(attempt: number): number {
  return Math.min(30_000 * 2 ** Math.min(attempt, 5), 15 * 60_000);
}

export function permanentFailure(message: string): boolean {
  return /(?:401|403|unauthorized|invalid api key|no (?:usable )?tmdb|missing.*key|keys? (?:are )?missing|rejected.*key|SQLITE_CORRUPT|SQLITE_NOTADB|EACCES|EPERM|ENOSPC)/i.test(
    message,
  );
}
