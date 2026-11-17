import { isCatalogUsable, type CatalogStatus } from "../shared/catalog-status";

/**
 * Holds catalogue calls until the catalogue is usable, by the rule the
 * renderer uses to show its views. A call made while the service starts,
 * restarts, recovers or rebuilds waits for it instead of failing or answering
 * with empty data. It has no timeout of its own: while the catalogue is not
 * usable the app already shows why, and the call goes ahead once it is.
 */
export function createCatalogGate() {
  let usable = false;
  let waiters: Array<() => void> = [];
  return {
    note(status: CatalogStatus | null): void {
      usable = isCatalogUsable(status);
      if (!usable) return;
      const ready = waiters;
      waiters = [];
      for (const release of ready) release();
    },
    whenUsable(): Promise<void> {
      if (usable) return Promise.resolve();
      return new Promise<void>((resolve) => waiters.push(resolve));
    },
  };
}
