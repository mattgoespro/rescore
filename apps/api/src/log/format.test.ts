import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatClock,
  formatDuration,
  formatLine,
  searchKeyList,
} from "./format.js";

const at = new Date(2026, 8, 24, 19, 25, 3, 412);

test("formatClock is local HH:mm:ss.SSS", () => {
  assert.equal(formatClock(at), "19:25:03.412");
});

test("formatLine pads channel, phase, and level", () => {
  assert.equal(
    formatLine(
      {
        time: at,
        channel: "catalog",
        phase: "reconcile",
        level: "info",
        message: "Reconciled 482,500 titles",
      },
      false,
    ),
    "19:25:03.412  catalog  reconcile  info   Reconciled 482,500 titles",
  );
});

test("formatLine paints stone, amber, and green and leaves the message plain", () => {
  const line = formatLine(
    {
      time: at,
      channel: "catalog",
      phase: "download",
      level: "info",
      message: "Checking title.basics.tsv.gz",
    },
    true,
  );
  assert.match(
    line,
    /^\x1b\[38;5;245m19:25:03\.412\x1b\[0m  \x1b\[38;5;214mcatalog\x1b\[0m  /,
  );
  assert.match(
    line,
    /  \x1b\[32minfo\x1b\[0m {3}Checking title\.basics\.tsv\.gz$/,
  );
  assert.doesNotMatch(line, /Checking title\.basics\.tsv\.gz\x1b/);
});

test("http channel is cyan and warn is yellow", () => {
  const line = formatLine(
    {
      time: at,
      channel: "http",
      phase: "GET",
      level: "warn",
      message: "ab12  404     3ms  /v1/titles/tt1",
    },
    true,
  );
  assert.match(line, /\x1b\[36mhttp\x1b\[0m/);
  assert.match(line, /\x1b\[33mwarn\x1b\[0m/);
});

test("formatDuration uses milliseconds under one second and one decimal after", () => {
  assert.equal(formatDuration(12), "12ms");
  assert.equal(formatDuration(1200), "1.2s");
});

test("searchKeyList returns sorted names only for GET title search", () => {
  assert.equal(
    searchKeyList("/v1/titles", { sort: "rating", query: "heat", page: "1" }),
    "page,query,sort",
  );
  assert.equal(searchKeyList("/v1/titles/tt1", { query: "heat" }), "");
  assert.equal(searchKeyList("/v1/people", { q: "nolan" }), "");
});
