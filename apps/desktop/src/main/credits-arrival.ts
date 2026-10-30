import type { CatalogStatus } from "../shared/catalog-status";

/**
 * Calls `arrived` once cast and directors turn ready after being missing.
 * Browsing opens before credits, so a taste model built earlier lacks them.
 */
export function watchCreditsArrival(
  arrived: () => void,
): (status: CatalogStatus) => void {
  let ready: boolean | undefined;
  return (status) => {
    const next = status.creditsReady === true && !status.creditsFailed;
    if (ready === false && next) arrived();
    ready = next;
  };
}
