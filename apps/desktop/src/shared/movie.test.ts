import assert from "node:assert/strict";
import { test } from "node:test";
import { genreId, movieFromTitle } from "./movie";

const base = {
  id: "tt0133093",
  title: "The Matrix",
  originalTitle: "The Matrix",
  kind: "movie",
  year: 1999,
  runtimeMinutes: 136,
  synopsis: null,
  posterUrl: null,
  certification: "",
  imdbRating: null,
  imdbVotes: null,
  genres: ["Action"],
  directors: [],
  cast: [],
  languages: [],
};

test("movie from a catalogue title", () => {
  const movie = movieFromTitle(base);
  assert.equal(movie.imdbId, "tt0133093");
  assert.equal(movie.titleKind, "movie");
  assert.equal(movie.mediaType, "movie");
  assert.equal(movie.voteAverage, 0);
  assert.equal(movie.voteCount, 0);
  assert.equal(movie.overview, "");
  assert.equal(movie.certification, undefined);
  assert.deepEqual(movie.genreIds, [genreId("Action")]);

  assert.equal(movieFromTitle({ ...base, kind: "tvMiniSeries" }).titleKind, "miniseries");
  assert.equal(movieFromTitle({ ...base, kind: "tvSeries" }).titleKind, "tv");
  assert.equal(movieFromTitle({ ...base, kind: "tvSeries" }).mediaType, "tv");
});
