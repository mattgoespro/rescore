export type CatalogOwner = "service" | "desktop";

export function catalogOwner(serviceOwns: boolean): CatalogOwner {
  return serviceOwns ? "service" : "desktop";
}

export function catalogUnreachableStep(
  owner: CatalogOwner,
): "refuse" | "spawn" {
  return owner === "service" ? "refuse" : "spawn";
}

export function catalogUrlChangeAllowed(owner: CatalogOwner): boolean {
  return owner === "desktop";
}
