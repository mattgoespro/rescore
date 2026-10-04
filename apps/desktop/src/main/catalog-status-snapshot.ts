import type { CatalogStatus } from "../shared/catalog-status";

export type CatalogStatusChange = Pick<CatalogStatus, "phase" | "message"> &
  Partial<Omit<CatalogStatus, "phase" | "message">>;

export function catalogStatusSnapshot(
  current: CatalogStatus,
  change: CatalogStatusChange,
): CatalogStatus {
  return {
    phase: change.phase,
    message: change.message,
    titleCount: change.titleCount ?? current.titleCount,
    builtAt: change.builtAt !== undefined ? change.builtAt : current.builtAt,
    error: change.error !== undefined ? change.error : current.error,
    download:
      change.download !== undefined ? change.download : current.download,
    titlesReady:
      change.titlesReady !== undefined
        ? change.titlesReady
        : current.titlesReady,
    creditsReady:
      change.creditsReady !== undefined
        ? change.creditsReady
        : current.creditsReady,
    titlesUpdateAvailable:
      change.titlesUpdateAvailable ?? current.titlesUpdateAvailable,
    creditsFailed: change.creditsFailed ?? current.creditsFailed,
    catalogUsable: change.catalogUsable ?? current.catalogUsable,
    tmdbHydration:
      change.tmdbHydration !== undefined
        ? change.tmdbHydration
        : current.tmdbHydration,
  };
}
