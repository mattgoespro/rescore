import type {
  Affinity,
  Genre,
  LibraryEntry,
  MovieSummary,
  RankReason,
  RankedMovie,
  RankingMode,
  TasteProfile,
} from "../shared/types";
import { titleKey } from "../shared/types";

interface InternalProfile {
  ratedCount: number;
  watchedCount: number;
  watchlistCount: number;
  skippedCount: number;
  globalAvg: number;
  runtimeMean: number;
  genres: Map<number, Stat>;
  decades: Map<string, Stat>;
  directors: Map<number, Stat>;
  cast: Map<number, Stat>;
  languages: Map<string, Stat>;
  skippedGenres: Map<number, number>;
  recentGenreIds: number[];
  names: {
    genres: Map<number, string>;
    directors: Map<number, string>;
    cast: Map<number, string>;
  };
}

interface Stat {
  count: number;
  sum: number;
  avg: number;
  weight: number;
  name: string;
}

const WEIGHTS = {
  genre: 0.3,
  director: 0.16,
  cast: 0.12,
  decade: 0.1,
  runtime: 0.06,
  language: 0.05,
  pattern: 0.07,
};

const PERSONAL_WEIGHT_SUM = Object.values(WEIGHTS).reduce(
  (sum, weight) => sum + weight,
  0,
);
const GENRE_VETO_THRESHOLD = -0.25;
const GENRE_VETO_PULL = 0.9;
const RATING_DELTA = 2.2;
const PRIOR_STRENGTH = 8;

export function buildProfile(
  library: LibraryEntry[],
  genres: Genre[],
): InternalProfile {
  const genreNames = new Map(genres.map((g) => [g.id, g.name]));
  const rated = library.filter(
    (e) => e.status === "watched" && typeof e.rating === "number",
  );
  const watched = library.filter((e) => e.status === "watched");
  const globalAvg = rated.length
    ? mean(rated.map((e) => e.rating as number))
    : 7;
  const runtimes = watched
    .map((e) => e.runtime)
    .filter((n): n is number => Boolean(n && n > 0));

  const profile: InternalProfile = {
    ratedCount: rated.length,
    watchedCount: watched.length,
    watchlistCount: library.filter((e) => e.status === "watchlist").length,
    skippedCount: library.filter((e) => e.status === "skipped").length,
    globalAvg,
    runtimeMean: runtimes.length ? mean(runtimes) : 120,
    genres: new Map(),
    decades: new Map(),
    directors: new Map(),
    cast: new Map(),
    languages: new Map(),
    skippedGenres: new Map(),
    recentGenreIds: [],
    names: {
      genres: genreNames,
      directors: new Map(),
      cast: new Map(),
    },
  };

  for (const entry of rated) {
    const rating = entry.rating as number;
    for (const id of entry.genreIds) {
      bump(
        profile.genres,
        id,
        rating,
        globalAvg,
        genreNames.get(id) ?? `Genre ${id}`,
      );
    }
    if (entry.year) {
      const decade = decadeOf(entry.year);
      bump(profile.decades, decade, rating, globalAvg, `${decade}s`);
    }
    entry.directorIds.forEach((id, i) => {
      const name = entry.directorNames[i] ?? `Director ${id}`;
      profile.names.directors.set(id, name);
      bump(profile.directors, id, rating, globalAvg, name);
    });
    entry.castIds.slice(0, 6).forEach((id, i) => {
      const name = entry.castNames[i] ?? `Actor ${id}`;
      profile.names.cast.set(id, name);
      bump(profile.cast, id, rating, globalAvg, name);
    });
    if (entry.originalLanguage) {
      bump(
        profile.languages,
        entry.originalLanguage,
        rating,
        globalAvg,
        entry.originalLanguage,
      );
    }
  }

  for (const entry of library.filter((e) => e.status === "skipped")) {
    for (const id of entry.genreIds) {
      profile.skippedGenres.set(id, (profile.skippedGenres.get(id) ?? 0) + 1);
    }
  }

  const recent = [...watched]
    .sort((a, b) =>
      (b.watchedAt ?? b.updatedAt).localeCompare(a.watchedAt ?? a.updatedAt),
    )
    .slice(0, 12);
  const recentCounts = new Map<number, number>();
  for (const entry of recent) {
    for (const id of entry.genreIds) {
      recentCounts.set(id, (recentCounts.get(id) ?? 0) + 1);
    }
  }
  profile.recentGenreIds = [...recentCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([id]) => id);

  return profile;
}

export function publicProfile(profile: InternalProfile): TasteProfile {
  return {
    ratedCount: profile.ratedCount,
    watchedCount: profile.watchedCount,
    watchlistCount: profile.watchlistCount,
    skippedCount: profile.skippedCount,
    globalAvg: round1(profile.globalAvg),
    runtimeMean: Math.round(profile.runtimeMean),
    topGenres: topAffinities(profile.genres, 6),
    topDecades: topAffinities(profile.decades, 5),
    topDirectors: topAffinities(profile.directors, 5),
    topCast: topAffinities(profile.cast, 5),
    topLanguages: topAffinities(profile.languages, 4),
    recentGenreIds: profile.recentGenreIds,
    ready: profile.ratedCount >= 3,
  };
}

export function describeProfile(profile: InternalProfile): string[] {
  const insights: string[] = [];
  const genres = topAffinities(profile.genres, 3);
  const decades = topAffinities(profile.decades, 2);
  const directors = topAffinities(profile.directors, 2);

  if (!profile.ratedCount) {
    insights.push(
      "Rate a handful of movies you have already seen so Rescore can learn your taste.",
    );
    return insights;
  }

  if (genres.length) {
    insights.push(
      `You score ${genres.map((g) => g.name).join(" / ")} highest — those genres carry the most weight.`,
    );
  }
  if (decades.length) {
    insights.push(
      `Your ratings lean ${decades.map((d) => d.name).join(" and ")}.`,
    );
  }
  if (directors.length && directors[0].count >= 2) {
    insights.push(
      `${directors[0].name} is a strong signal (avg ${directors[0].avg.toFixed(1)} across ${directors[0].count} films).`,
    );
  }
  if (profile.recentGenreIds.length && profile.watchedCount >= 4) {
    const names = profile.recentGenreIds
      .map((id) => profile.names.genres.get(id))
      .filter(Boolean)
      .slice(0, 2);
    if (names.length) {
      insights.push(
        `Lately your watch pattern has been clustering around ${names.join(" and ")}.`,
      );
    }
  }
  insights.push(
    `Typical runtime you finish: ~${Math.round(profile.runtimeMean)} minutes. Community rating baseline vs you: ${profile.globalAvg.toFixed(1)}/10.`,
  );
  return insights;
}

export function scoreMovie(
  movie: MovieSummary,
  profile: InternalProfile,
  mode: RankingMode,
  library: Map<string, LibraryEntry>,
): RankedMovie {
  const reasons: RankReason[] = [];
  const entry = library.get(titleKey(movie));

  const genre = genreAffinity(movie.genreIds, profile);
  pushReason(reasons, genre.score, "Genre taste", genre.detail);

  const decade = movie.year ? decadeOf(movie.year) : "";
  const decadeScore = decade ? (profile.decades.get(decade)?.weight ?? 0) : 0;
  pushReason(
    reasons,
    decadeScore,
    "Era",
    decade ? `${decade}s` : "Unknown year",
  );

  const directorScore = max(
    (movie.directorIds ?? []).map(
      (id) => profile.directors.get(id)?.weight ?? 0,
    ),
  );
  const directorName = (movie.directorNames ?? [])[0];
  if (directorName || directorScore !== 0) {
    pushReason(
      reasons,
      directorScore,
      "Director",
      directorName ?? "No director match yet",
    );
  }

  const castWeights = (movie.castIds ?? [])
    .map((id) => profile.cast.get(id)?.weight ?? 0)
    .filter((w) => w !== 0)
    .slice(0, 3);
  const castScore = average(castWeights);
  const knownCast = (movie.castNames ?? []).filter(
    (_, i) =>
      (movie.castIds ?? [])[i] && profile.cast.has((movie.castIds ?? [])[i]),
  );
  if (knownCast.length) {
    pushReason(reasons, castScore, "Cast", knownCast.slice(0, 2).join(", "));
  }

  const publicRating = bayesianRating(movie.voteAverage, movie.voteCount);
  const quality = clamp((publicRating - 6.2) / 2.4, -1, 1);
  pushReason(
    reasons,
    quality,
    "Public rating",
    `${movie.voteAverage.toFixed(1)} from ${formatCount(movie.voteCount)} votes`,
  );

  const runtimeScore =
    movie.runtime && profile.runtimeMean
      ? Math.exp(
          -((movie.runtime - profile.runtimeMean) ** 2) / (2 * 35 ** 2),
        ) *
          2 -
        1
      : 0;
  if (movie.runtime) {
    pushReason(
      reasons,
      runtimeScore,
      "Runtime",
      `${movie.runtime} min vs your ~${Math.round(profile.runtimeMean)} min`,
    );
  }

  const languageScore = movie.originalLanguage
    ? (profile.languages.get(movie.originalLanguage)?.weight ?? 0)
    : 0;

  const overlap = movie.genreIds.filter((id) =>
    profile.recentGenreIds.includes(id),
  ).length;
  let pattern = 0;
  if (mode === "same") pattern = overlap ? Math.min(1, overlap / 2) : -0.15;
  else if (mode === "diverse") pattern = overlap ? -0.35 * overlap : 0.25;
  else pattern = overlap ? 0.12 : 0.04;

  for (const id of movie.genreIds) {
    const skips = profile.skippedGenres.get(id) ?? 0;
    if (skips >= 3) pattern -= 0.08;
  }

  if (entry?.status === "skipped") pattern -= 0.8;
  if (entry?.status === "watched") pattern -= 1;

  pushReason(
    reasons,
    pattern,
    "Watch pattern",
    mode === "diverse"
      ? "Surprise mix vs recent watches"
      : mode === "same"
        ? "Continues your recent streak"
        : "Balanced against recent watches",
  );

  const personal =
    (WEIGHTS.genre * genre.score +
      WEIGHTS.director * directorScore +
      WEIGHTS.cast * castScore +
      WEIGHTS.decade * decadeScore +
      WEIGHTS.runtime * runtimeScore +
      WEIGHTS.language * languageScore +
      WEIGHTS.pattern * pattern) /
    PERSONAL_WEIGHT_SUM;

  const personalRating = profile.globalAvg + personal * RATING_DELTA;
  const priorMix = PRIOR_STRENGTH / (PRIOR_STRENGTH + profile.ratedCount);
  const predicted = priorMix * publicRating + (1 - priorMix) * personalRating;
  const match = clamp(round1(predicted * 10), 1, 99);

  return {
    ...movie,
    match,
    reasons: reasons
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
      .slice(0, 4),
  };
}

export function pickSeeds(library: LibraryEntry[]): LibraryEntry[] {
  const watched = library.filter(
    (e) =>
      (e.mediaType ?? "movie") === "movie" &&
      e.status === "watched" &&
      (e.rating ?? 0) >= 7,
  );
  const ranked = [...watched].sort(
    (a, b) =>
      (b.rating ?? 0) - (a.rating ?? 0) ||
      (b.voteAverage ?? 0) - (a.voteAverage ?? 0),
  );
  const seeds: LibraryEntry[] = [];
  const usedGenres = new Set<number>();
  for (const entry of ranked) {
    const novel = entry.genreIds.some((id) => !usedGenres.has(id));
    if (novel || seeds.length < 3) {
      seeds.push(entry);
      entry.genreIds.forEach((id) => usedGenres.add(id));
    }
    if (seeds.length >= 8) break;
  }
  return seeds;
}

function bump<K extends string | number>(
  map: Map<K, Stat>,
  key: K,
  rating: number,
  globalAvg: number,
  name: string,
): void {
  const current = map.get(key) ?? { count: 0, sum: 0, avg: 0, weight: 0, name };
  current.count += 1;
  current.sum += rating;
  current.avg = current.sum / current.count;
  const confidence = Math.log1p(current.count) / Math.log1p(10);
  current.weight =
    Math.tanh((current.avg - globalAvg) / 1.8) * Math.min(1, confidence);
  current.name = name;
  map.set(key, current);
}

function topAffinities<K extends string | number>(
  map: Map<K, Stat>,
  n: number,
): Affinity[] {
  return [...map.entries()]
    .map(([id, stat]) => ({
      id: String(id),
      name: stat.name,
      weight: round2(stat.weight),
      count: stat.count,
      avg: round1(stat.avg),
    }))
    .sort((a, b) => b.weight - a.weight || b.count - a.count)
    .slice(0, n);
}

function pushReason(
  reasons: RankReason[],
  weight: number,
  label: string,
  detail: string,
): void {
  reasons.push({ label, detail, weight: round2(weight) });
}

function genreAffinity(
  genreIds: number[],
  profile: InternalProfile,
): { score: number; detail: string } {
  const signals = genreIds.map((id) => ({
    id,
    name: profile.names.genres.get(id),
    weight: profile.genres.get(id)?.weight ?? 0,
  }));
  const named = signals
    .map((signal) => signal.name)
    .filter(Boolean)
    .slice(0, 2);
  const fallback = named.length ? named.join(", ") : "Limited genre overlap";
  if (!signals.length) return { score: 0, detail: fallback };

  const best = signals.reduce((lead, signal) =>
    signal.weight > lead.weight ? signal : lead,
  );
  const disliked = signals.filter(
    (signal) => signal.weight <= GENRE_VETO_THRESHOLD,
  );
  const liked = signals.filter(
    (signal) => signal.weight > 0 && signal.id !== best.id,
  );

  if (disliked.length === signals.length) {
    const score = clamp(
      average(disliked.map((signal) => signal.weight)),
      -1,
      1,
    );
    const vetoNames = disliked
      .map((signal) => signal.name)
      .filter(Boolean)
      .slice(0, 2);
    return {
      score,
      detail: vetoNames.length
        ? `${vetoNames.join(", ")} clashes with your taste`
        : fallback,
    };
  }

  let score = best.weight;
  for (const signal of disliked) {
    score += Math.min(0, signal.weight) * GENRE_VETO_PULL;
  }
  if (liked.length) {
    score = score * 0.75 + average(liked.map((signal) => signal.weight)) * 0.25;
  }

  const vetoNames = disliked
    .map((signal) => signal.name)
    .filter(Boolean)
    .slice(0, 2);
  const detail = vetoNames.length
    ? `${best.name ?? "Strong genre"}, but ${vetoNames.join(", ")} is a poor fit`
    : fallback;
  return { score: clamp(score, -1, 1), detail };
}

function bayesianRating(voteAverage: number, voteCount: number): number {
  const m = 800;
  const C = 6.8;
  return (
    (voteCount / (voteCount + m)) * voteAverage + (m / (voteCount + m)) * C
  );
}

function decadeOf(year: number): string {
  return String(Math.floor(year / 10) * 10);
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return mean(values);
}

function max(values: number[]): number {
  if (!values.length) return 0;
  return Math.max(...values);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}

export type { InternalProfile };
