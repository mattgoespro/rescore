export function shouldRetryCredits(
  attempt: number,
  creditsReady: boolean,
): boolean {
  return attempt === 0 && !creditsReady;
}
