export function shouldFinishCatalogPoll(input: {
  phase: string;
  catalogUsable: boolean;
}): boolean {
  return input.phase === "error" || (input.phase === "ready" && input.catalogUsable);
}
