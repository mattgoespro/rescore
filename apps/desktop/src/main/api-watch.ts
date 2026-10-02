export function shouldRestartHungChild(consecutiveUnreachable: number): boolean {
  return consecutiveUnreachable >= 3;
}

/** Health can time out while a catalog build blocks the process. The port staying open means that process is still the API. */
export function shouldSpawnReplacement(input: {
  childAlive: boolean;
  portOpen: boolean;
}): boolean {
  return !input.childAlive && !input.portOpen;
}
