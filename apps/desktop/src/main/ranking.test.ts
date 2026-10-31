import assert from "node:assert/strict";
import { test } from "node:test";
import type { LibraryEntry } from "../shared/types";
import { buildProfile, forYouHints } from "./ranking";

function rated(
  id: number,
  rating: number,
  genreId: number,
  year: number,
  director: string,
): LibraryEntry {
  return {
    imdbId: `tt${id}`,
    mediaType: "movie",
    titleKind: "movie",
    title: `Title ${id}`,
    year,
    genreIds: [genreId],
    voteAverage: 7,
    voteCount: 10_000,
    directorIds: [director === "Ann Lee" ? 1 : 2],
    directorNames: [director],
    castIds: [],
    castNames: [],
    status: "watched",
    rating,
    updatedAt: "2026-01-01",
  };
}

const genres = [
  { id: 1, name: "Drama" },
  { id: 2, name: "Horror" },
];

test("For You hints name only what rates above the user's average", () => {
  const profile = buildProfile(
    [
      rated(1, 10, 1, 1994, "Ann Lee"),
      rated(2, 9, 1, 1996, "Ann Lee"),
      rated(3, 3, 2, 2012, "Bo Park"),
      rated(4, 2, 2, 2015, "Bo Park"),
    ],
    genres,
  );
  assert.deepEqual(forYouHints(profile), {
    genres: ["Drama"],
    directors: ["Ann Lee"],
    decades: [1990],
  });
});

test("For You sends no hints before the taste model is ready", () => {
  const profile = buildProfile(
    [rated(1, 10, 1, 1994, "Ann Lee"), rated(2, 9, 1, 1996, "Ann Lee")],
    genres,
  );
  assert.deepEqual(forYouHints(profile), {});
});
