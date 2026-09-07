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

export function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
