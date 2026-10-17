interface MessageWindow {
  isDestroyed(): boolean;
  webContents: {
    isDestroyed(): boolean;
    send(channel: string, value: unknown): void;
  };
}

export function sendToWindow(
  window: MessageWindow | null,
  channel: string,
  value: unknown,
): void {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  try {
    window.webContents.send(channel, value);
  } catch (error) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) throw error;
  }
}
