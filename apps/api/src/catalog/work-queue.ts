type Work<T> = () => T | Promise<T>;

export class CatalogWorkQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue<T>(work: Work<T>): Promise<T> {
    const result = this.tail.then(
      () =>
        new Promise<T>((resolve, reject) => {
          setImmediate(() => {
            Promise.resolve()
              .then(work)
              .then(resolve, reject);
          });
        }),
    );
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export const catalogWorkQueue = new CatalogWorkQueue();
export const mediaWorkQueue = new CatalogWorkQueue();
export const maintenanceWorkQueue = new CatalogWorkQueue();

export const ANALYZE_IDLE_MS = 60_000;

export function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function queueIdleAnalyze(
  run: () => void,
  idleMs = ANALYZE_IDLE_MS,
): Promise<void> {
  return maintenanceWorkQueue.enqueue(async () => {
    await delay(idleMs);
    run();
  });
}
