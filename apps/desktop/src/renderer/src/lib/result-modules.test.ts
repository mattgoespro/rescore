import assert from "node:assert/strict";
import { test } from "node:test";
import { createDiscoverResults } from "./discover-results";
import { createForYouResults } from "./for-you-results";
import { defaultFilters } from "../../../shared/filters";
import type { PagedMovies, ForYouResult } from "../../../shared/types";
const page = (id: string, cursor: string | null = null): PagedMovies => ({
  page: 1,
  totalPages: null,
  totalResults: null,
  nextCursor: cursor,
  canLoadMore: !!cursor,
  results: [{ imdbId: id } as PagedMovies["results"][number]],
});
test("Search ignores superseded results and keeps the loaded depth when refreshing", async () => {
  const pending: Array<(p: PagedMovies) => void> = [];
  const results = createDiscoverResults(
    async () => new Promise((resolve) => pending.push(resolve)),
  );
  results.configure(defaultFilters());
  const old = results.replace();
  results.configure({ ...defaultFilters(), query: "new" });
  const fresh = results.replace();
  pending[1](page("new", "next"));
  await fresh;
  pending[0](page("old"));
  await old;
  assert.equal(results.getSnapshot().items[0].imdbId, "new");
  const append = results.loadMore();
  pending[2](page("second"));
  await append;
  const refresh = results.refresh();
  pending[3](page("revised", "next"));
  await new Promise((resolve) => setImmediate(resolve));
  pending[4](page("revised-second"));
  await refresh;
  assert.deepEqual(
    results.getSnapshot().items.map((x) => x.imdbId),
    ["revised", "revised-second"],
  );
  assert.equal(results.getSnapshot().completion?.reset, false);
});
test("Search prefetches the next page and appends it without another request", async () => {
  const requested: Array<string | null | undefined> = [];
  const results = createDiscoverResults(async (filters) => {
    requested.push(filters.cursor);
    return filters.cursor === "c1"
      ? page("second", "c2")
      : filters.cursor === "c2"
        ? page("third")
        : page("first", "c1");
  });
  results.configure(defaultFilters());
  await results.replace();
  assert.deepEqual(requested, [null, "c1"]);
  await results.loadMore();
  assert.deepEqual(requested, [null, "c1", "c2"]);
  await results.loadMore();
  assert.deepEqual(requested, [null, "c1", "c2"]);
  assert.deepEqual(
    results.getSnapshot().items.map((x) => x.imdbId),
    ["first", "second", "third"],
  );
  assert.equal(results.getSnapshot().canLoadMore, false);
});
test("Search drops a prefetched page when the filters change", async () => {
  const requested: Array<{ query: string; cursor?: string | null }> = [];
  const results = createDiscoverResults(async (filters) => {
    requested.push({ query: filters.query, cursor: filters.cursor });
    return page(
      `${filters.query}:${filters.cursor ?? "start"}`,
      filters.cursor ? null : "c1",
    );
  });
  results.configure(defaultFilters());
  await results.replace();
  results.configure({ ...defaultFilters(), query: "new" });
  await results.replace();
  await results.loadMore();
  assert.deepEqual(
    results.getSnapshot().items.map((x) => x.imdbId),
    ["new:start", "new:c1"],
  );
  assert.deepEqual(requested.at(-1), { query: "new", cursor: "c1" });
});
test("Search retries a failed prefetch when the list reaches its end", async () => {
  let failed = false;
  const results = createDiscoverResults(async (filters) => {
    if (filters.cursor && !failed) {
      failed = true;
      throw new Error("offline");
    }
    return filters.cursor ? page("second") : page("first", "c1");
  });
  results.configure(defaultFilters());
  await results.replace();
  await results.loadMore();
  assert.equal(results.getSnapshot().error, "");
  assert.deepEqual(
    results.getSnapshot().items.map((x) => x.imdbId),
    ["first", "second"],
  );
});
test("Search disposal prevents late updates and admits a fresh mount", async () => {
  let resolve!: (p: PagedMovies) => void;
  const results = createDiscoverResults(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  results.configure(defaultFilters());
  const request = results.replace();
  results.dispose();
  resolve(page("old"));
  await request;
  assert.equal(results.getSnapshot().items.length, 0);
  results.configure(defaultFilters());
  const next = results.replace();
  resolve(page("new"));
  await next;
  assert.equal(results.getSnapshot().items[0].imdbId, "new");
});
test("For You owns latest-result acceptance independently of Search paging", async () => {
  const pending: Array<(r: ForYouResult) => void> = [];
  const results = createForYouResults(
    () => new Promise((r) => pending.push(r)),
  );
  const old = results.refresh();
  const fresh = results.refresh();
  const response = (id: string) =>
    ({
      movies: [{ imdbId: id }],
      profile: { ready: false },
      insights: [],
    }) as unknown as ForYouResult;
  pending[1](response("new"));
  await fresh;
  pending[0](response("old"));
  await old;
  assert.equal(results.getSnapshot().result?.movies[0].imdbId, "new");
  const last = results.refresh();
  results.dispose();
  pending[2](response("ignored"));
  await last;
  assert.equal(results.getSnapshot().result?.movies[0].imdbId, "new");
});
