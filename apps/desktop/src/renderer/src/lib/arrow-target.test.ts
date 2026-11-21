import assert from "node:assert/strict";
import { test } from "node:test";
import { arrowTarget } from "./arrow-target";

test("a list moves up and down and ignores left and right", () => {
  assert.equal(arrowTarget("ArrowDown", 2, 10, 1), 3);
  assert.equal(arrowTarget("ArrowUp", 2, 10, 1), 1);
  assert.equal(arrowTarget("ArrowLeft", 2, 10, 1), null);
  assert.equal(arrowTarget("ArrowRight", 2, 10, 1), null);
  assert.equal(arrowTarget("Enter", 2, 10, 1), null);
});

test("a grid moves across by one and down by a row", () => {
  assert.equal(arrowTarget("ArrowRight", 2, 20, 4), 3);
  assert.equal(arrowTarget("ArrowLeft", 2, 20, 4), 1);
  assert.equal(arrowTarget("ArrowDown", 2, 20, 4), 6);
  assert.equal(arrowTarget("ArrowUp", 6, 20, 4), 2);
});

test("moves past the start stay put and past the end land on the last title", () => {
  assert.equal(arrowTarget("ArrowUp", 0, 10, 1), 0);
  assert.equal(arrowTarget("ArrowUp", 2, 20, 4), 2);
  assert.equal(arrowTarget("ArrowLeft", 0, 20, 4), 0);
  assert.equal(arrowTarget("ArrowDown", 9, 10, 1), 9);
  assert.equal(arrowTarget("ArrowDown", 5, 10, 4), 9);
  assert.equal(arrowTarget("ArrowRight", 9, 10, 4), 9);
});
