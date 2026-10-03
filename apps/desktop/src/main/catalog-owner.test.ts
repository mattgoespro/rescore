import assert from "node:assert/strict";
import { test } from "node:test";
import {
  catalogOwner,
  catalogUnreachableStep,
  catalogUrlChangeAllowed,
} from "./catalog-owner";

test("a service-owned catalogue refuses spawn and locks the URL", () => {
  const owner = catalogOwner(true);
  assert.equal(owner, "service");
  assert.equal(catalogUnreachableStep(owner), "refuse");
  assert.equal(catalogUrlChangeAllowed(owner), false);
});

test("a desktop-owned catalogue may spawn and change the URL", () => {
  const owner = catalogOwner(false);
  assert.equal(owner, "desktop");
  assert.equal(catalogUnreachableStep(owner), "spawn");
  assert.equal(catalogUrlChangeAllowed(owner), true);
});
