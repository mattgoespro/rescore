import assert from "node:assert/strict";
import { test } from "node:test";
import { createCatalogGate } from "./catalog-gate";
import type { CatalogStatus } from "../shared/catalog-status";

const status = (phase: string, catalogUsable: boolean) =>
  ({ phase, catalogUsable }) as unknown as CatalogStatus;

test("catalogue calls wait for a usable catalogue and go ahead once it is", async () => {
  const gate = createCatalogGate();
  const order: string[] = [];
  const waiting = gate.whenUsable().then(() => order.push("released"));
  gate.note(status("starting", false));
  gate.note(status("error", false));
  await Promise.resolve();
  assert.deepEqual(order, []);
  gate.note(status("ready", true));
  await waiting;
  assert.deepEqual(order, ["released"]);
  // While usable, calls pass straight through.
  await gate.whenUsable();
  // A rebuild that makes titles unusable holds calls again.
  gate.note(status("building", false));
  let passed = false;
  void gate.whenUsable().then(() => (passed = true));
  await Promise.resolve();
  assert.equal(passed, false);
});
