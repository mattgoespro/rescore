import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldTerminateCatalogApi } from "./catalog-reload";

test("terminates only the API child that Electron owns", () => {
  assert.equal(shouldTerminateCatalogApi({ ownsApi: true }), true);
  assert.equal(shouldTerminateCatalogApi({ ownsApi: false }), false);
});
