import assert from "node:assert/strict";
import { test } from "node:test";
import { placePopover } from "./popover-position";

const viewport = { width: 1200, height: 800 };
const anchor = (left: number, width = 120) => ({
  left,
  right: left + width,
  top: 100,
  bottom: 134,
});

test("a popover centres on its anchor when the window has room", () => {
  const place = placePopover({
    anchor: anchor(500),
    width: 360,
    height: 200,
    viewport,
  });
  assert.equal(place.left + place.width / 2, 560);
  assert.equal(place.top, 140);
  assert.equal(place.side, "below");
});

test("near an edge it slides to stay inside the window", () => {
  const nearLeft = placePopover({
    anchor: anchor(20),
    width: 360,
    height: 200,
    viewport,
  });
  assert.equal(nearLeft.left, 12);
  const nearRight = placePopover({
    anchor: anchor(1100, 80),
    width: 360,
    height: 200,
    viewport,
  });
  assert.equal(nearRight.left + nearRight.width, 1188);
});

test("it narrows to the window and opens above when below is too short", () => {
  const narrow = placePopover({
    anchor: anchor(100),
    width: 600,
    height: 200,
    viewport: { width: 400, height: 800 },
  });
  assert.equal(narrow.width, 376);
  assert.equal(narrow.left, 12);
  const low = placePopover({
    anchor: { left: 500, right: 620, top: 700, bottom: 734 },
    width: 360,
    height: 300,
    viewport,
  });
  assert.equal(low.side, "above");
  assert.equal(low.top, 700 - 6 - 300);
});
