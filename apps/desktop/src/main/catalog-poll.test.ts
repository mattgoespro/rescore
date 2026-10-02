import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldFinishCatalogPoll } from "./catalog-poll";

test("catalog poll finishes on a usable ready catalog or any error", () => {
  assert.equal(
    shouldFinishCatalogPoll({ phase: "ready", catalogUsable: true }),
    true,
  );
  assert.equal(
    shouldFinishCatalogPoll({ phase: "ready", catalogUsable: false }),
    false,
  );
  assert.equal(
    shouldFinishCatalogPoll({ phase: "error", catalogUsable: false }),
    true,
  );
  assert.equal(
    shouldFinishCatalogPoll({ phase: "error", catalogUsable: true }),
    true,
  );
  assert.equal(
    shouldFinishCatalogPoll({ phase: "building", catalogUsable: false }),
    false,
  );
  assert.equal(
    shouldFinishCatalogPoll({ phase: "building", catalogUsable: true }),
    false,
  );
  assert.equal(
    shouldFinishCatalogPoll({ phase: "starting", catalogUsable: false }),
    false,
  );
});
