export function shouldRestartHungChild(consecutiveUnreachable: number): boolean {
  return consecutiveUnreachable >= 3;
}
