import assert from "node:assert/strict";
import { test } from "node:test";
import { sendToWindow } from "./window-lifecycle";

test("late background events cannot send to a closed window or renderer", () => {
  for (const [windowClosed, rendererClosed] of [[true, false], [false, true]]) {
    sendToWindow({
      isDestroyed: () => windowClosed,
      webContents: {
        isDestroyed: () => rendererClosed,
        send: () => { throw new Error("Object has been destroyed"); },
      },
    }, "catalog:status", {});
  }
  sendToWindow(null, "catalog:status", {});
});

test("a window destroyed during send does not produce an uncaught exception", () => {
  let destroyed = false;
  sendToWindow({
    isDestroyed: () => destroyed,
    webContents: {
      isDestroyed: () => destroyed,
      send: () => { destroyed = true; throw new Error("Object has been destroyed"); },
    },
  }, "catalog:status", {});
});

test("live windows receive events and unrelated errors remain visible", () => {
  const sent: unknown[] = [];
  const window = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel: string, value: unknown) => { sent.push([channel, value]); },
    },
  };
  sendToWindow(window, "catalog:status", { phase: "ready" });
  assert.deepEqual(sent, [["catalog:status", { phase: "ready" }]]);
  window.webContents.send = () => { throw new Error("unexpected send failure"); };
  assert.throws(() => sendToWindow(window, "catalog:status", {}), /unexpected/);
});
