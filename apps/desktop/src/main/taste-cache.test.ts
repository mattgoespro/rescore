import assert from "node:assert/strict";
import { test } from "node:test";
import type { LibraryEntry } from "../shared/movie";
import {
  buildProfile,
  publicProfile,
  tasteRanked,
  tasteReady,
} from "./ranking";
import { createTasteCache, withLibraryWrite } from "./taste-cache";

test("invalidated in-flight reads cannot restore stale taste or clear a newer load", async () => {
  const cache = createTasteCache<string>();
  let resolveOld!: (value: string) => void;
  let resolveNew!: (value: string) => void;
  const old = cache.read(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  cache.drop();
  const fresh = cache.read(
    () =>
      new Promise((resolve) => {
        resolveNew = resolve;
      }),
  );
  resolveOld("old");
  await old;
  const shared = cache.read(() => {
    throw new Error("Concurrent fresh reads must share their loader");
  });
  resolveNew("new");
  assert.equal(await fresh, "new");
  assert.equal(await shared, "new");
  assert.equal(await cache.read(async () => "incorrect"), "new");
});

test("taste cache loads once until a library write drops it", async () => {
  const cache = createTasteCache<number>();
  let loads = 0;
  const load = async (): Promise<number> => {
    loads += 1;
    return loads;
  };
  assert.equal(await cache.read(load), 1);
  assert.equal(await cache.read(load), 1);
  cache.drop();
  assert.equal(await cache.read(load), 2);
});

test("taste cache drops when a library write throws", async () => {
  const cache = createTasteCache<string>();
  await cache.read(async () => "warm");
  await assert.rejects(
    withLibraryWrite(cache, async () => {
      throw new Error("save failed");
    }),
    /save failed/,
  );
  let loads = 0;
  await cache.read(async () => {
    loads += 1;
    return "cold";
  });
  assert.equal(loads, 1);
});

test("taste is ready at three rated titles", () => {
  assert.equal(tasteReady(2), false);
  assert.equal(tasteReady(3), true);
  const kept = tasteRanked(2, ["a", "b"], () => {
    throw new Error("rank must not run");
  });
  assert.deepEqual(kept, ["a", "b"]);
  assert.deepEqual(
    tasteRanked(3, ["a", "b"], (movies) => [...movies].reverse()),
    ["b", "a"],
  );
});

test("public profile uses the shared taste readiness rule", () => {
  const two = publicProfile(
    buildProfile([rated("tt1", 8), rated("tt2", 7)], []),
  );
  const three = publicProfile(
    buildProfile([rated("tt1", 8), rated("tt2", 7), rated("tt3", 6)], []),
  );
  assert.equal(two.ready, false);
  assert.equal(two.ratedCount, 2);
  assert.equal(three.ready, true);
  assert.equal(three.ratedCount, 3);
});

function rated(imdbId: string, rating: number): LibraryEntry {
  return {
    imdbId,
    mediaType: "movie",
    titleKind: "movie",
    title: imdbId,
    genreIds: [],
    voteAverage: 7,
    voteCount: 1000,
    directorIds: [],
    directorNames: [],
    castIds: [],
    castNames: [],
    status: "watched",
    rating,
    updatedAt: "2026-10-04T00:00:00.000Z",
  };
}

test("recent genre preferences use imported rating dates ahead of import timestamps", () => {
  const rows = Array.from({ length: 13 }, (_, index) => ({
    ...rated(`tt${index}`, 8),
    genreIds: [index],
    ratedAt: `${index === 0 ? "2000" : "2024"}-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    updatedAt: "2026-10-13T00:00:00.000Z",
  }));
  assert.ok(!buildProfile(rows, []).recentGenreIds.includes(0));
});
