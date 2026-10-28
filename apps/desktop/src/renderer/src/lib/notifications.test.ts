import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dropNotice,
  NOTICE_LIMIT,
  noticeDuration,
  pushNotice,
  type Notice,
} from "./notifications";

const notice = (id: number): Notice => ({
  id,
  tone: "success",
  message: `Notice ${id}`,
});

test("new notices stack at the end and the oldest gives way", () => {
  let notices: Notice[] = [];
  for (let id = 1; id <= NOTICE_LIMIT + 2; id += 1)
    notices = pushNotice(notices, notice(id));
  assert.deepEqual(
    notices.map((n) => n.id),
    [3, 4, 5],
  );
});

test("dismissing removes only that notice", () => {
  const notices = [notice(1), notice(2), notice(3)];
  assert.deepEqual(
    dropNotice(notices, 2).map((n) => n.id),
    [1, 3],
  );
});

test("a notice that can be undone stays longer", () => {
  assert.ok(noticeDuration({ undo: () => undefined }) > noticeDuration({}));
});
