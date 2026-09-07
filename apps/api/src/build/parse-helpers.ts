import { imdbValue } from "../services/gzip-tsv.js";

export function mapKind(titleType: string | undefined): string | null {
  switch ((titleType ?? "").toLowerCase()) {
    case "movie":
      return "movie";
    case "tvseries":
      return "tv";
    case "tvminiseries":
      return "miniseries";
    default:
      return null;
  }
}

export function parseYear(value: string | undefined): number | null {
  const year = Number(imdbValue(value));
  return Number.isInteger(year) && year >= 1870 && year <= 3000 ? year : null;
}

export function parseRuntime(value: string | undefined): number | null {
  const runtime = Number(imdbValue(value));
  return Number.isInteger(runtime) && runtime > 0 && runtime <= 2000
    ? runtime
    : null;
}

export function parseGenres(value: string | undefined): string[] {
  const raw = imdbValue(value);
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((genre) => genre.trim())
        .filter(Boolean),
    ),
  ];
}

export function trimCredits<T extends { nconst: string; ordering: number }>(
  list: T[],
  max: number,
): void {
  list.sort(
    (a, b) => a.ordering - b.ordering || a.nconst.localeCompare(b.nconst),
  );
  const seen = new Set<string>();
  let write = 0;
  for (const credit of list) {
    if (seen.has(credit.nconst)) continue;
    seen.add(credit.nconst);
    list[write] = credit;
    write += 1;
    if (write >= max) break;
  }
  list.length = write;
}
