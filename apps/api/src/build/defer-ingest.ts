export function shouldDeferTitleIngest(input: {
  force: boolean;
  titleCount: number;
  builtAt: string | null;
  storedFingerprint: string | null;
  remoteFingerprint: string | null;
}): boolean {
  return (
    !input.force &&
    input.titleCount > 0 &&
    Boolean(input.builtAt) &&
    input.storedFingerprint != null &&
    input.remoteFingerprint != null &&
    input.storedFingerprint !== input.remoteFingerprint
  );
}
