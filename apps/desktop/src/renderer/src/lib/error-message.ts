/**
 * The message to show for a failed call. Electron prefixes every error that
 * crosses `ipcRenderer.invoke` with "Error invoking remote method '<channel>':
 * Error:", which says nothing to the person reading it.
 */
export function errorMessage(cause: unknown, fallback: string): string {
  if (!(cause instanceof Error)) return fallback;
  const message = cause.message
    .replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "")
    .trim();
  return message || fallback;
}
