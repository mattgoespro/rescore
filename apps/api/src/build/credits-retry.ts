export function shouldRetryCredits(
  attempt: number,
  creditsReady: boolean,
): boolean {
  return attempt === 0 && !creditsReady;
}

export type CreditsFailureDeps = {
  setCreditsFailed: (failed: boolean) => void;
  creditsReady: () => boolean;
  retry: () => Promise<void>;
  delay: (ms: number) => Promise<void>;
  retryDelayMs?: number;
  warn?: (message: string, detail: unknown) => void;
};

/**
 * Mark credits failed, optionally retry once after a delay, and never rethrow.
 * Callers that fire-and-forget startCreditsBuild rely on this containment.
 */
export async function recoverCreditsFailure(
  error: unknown,
  deps: CreditsFailureDeps,
): Promise<void> {
  const warn = deps.warn ?? ((message, detail) => console.warn(message, detail));
  warn(
    "Credits import failed.",
    error instanceof Error ? error.message : error,
  );
  deps.setCreditsFailed(true);
  if (!shouldRetryCredits(0, deps.creditsReady())) return;

  await deps.delay(deps.retryDelayMs ?? 60_000);
  try {
    await deps.retry();
  } catch (retryError: unknown) {
    warn(
      "Credits import retry failed.",
      retryError instanceof Error ? retryError.message : retryError,
    );
    deps.setCreditsFailed(true);
  }
}
