/** One cancellation boundary for downloads, producers, and queued writes. */
const controller = new AbortController();
const tasks = new Set<Promise<unknown>>();
export const shutdownSignal = controller.signal;

export function trackWork<T>(work: Promise<T>): Promise<T> {
  tasks.add(work);
  void work.finally(() => tasks.delete(work)).catch(() => undefined);
  return work;
}

export function requestShutdown(): void {
  controller.abort(new Error("Catalogue is stopping"));
}

export async function drainWork(): Promise<void> {
  while (tasks.size) await Promise.allSettled([...tasks]);
}

export async function cancellableDelay(ms: number): Promise<void> {
  shutdownSignal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const done = (): void => {
      shutdownSignal.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const abort = (): void => {
      clearTimeout(timer);
      shutdownSignal.removeEventListener("abort", abort);
      reject(shutdownSignal.reason);
    };
    shutdownSignal.addEventListener("abort", abort, { once: true });
  });
}
