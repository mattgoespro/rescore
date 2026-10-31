/**
 * Runs `poll` now and every `ms` while the window is shown. A minimised or
 * hidden window stops polling, then polls once as soon as it is shown again.
 * Returns the function that stops it for good.
 */
export function pollWhileVisible(poll: () => void, ms: number): () => void {
  let timer: number | null = null;
  const start = (): void => {
    timer ??= window.setInterval(poll, ms);
  };
  const stop = (): void => {
    if (timer != null) window.clearInterval(timer);
    timer = null;
  };
  const onVisibility = (): void => {
    if (document.visibilityState === "hidden") {
      stop();
      return;
    }
    if (timer != null) return;
    poll();
    start();
  };
  poll();
  if (document.visibilityState !== "hidden") start();
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
