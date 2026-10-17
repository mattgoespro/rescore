export interface ImdbCsvRow {
  imdbId: string;
  rating: number;
  dateRated?: string;
  title: string;
  titleType: string;
}

export function parseImdbRatingsCsv(text: string): ImdbCsvRow[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  const idx = {
    const: header.findIndex((h) => /^const$/i.test(h)),
    rating: header.findIndex((h) => /your rating/i.test(h)),
    date: header.findIndex((h) => /date rated/i.test(h)),
    title: header.findIndex((h) => /^title$/i.test(h)),
    type: header.findIndex((h) => /title type/i.test(h)),
  };
  if (idx.const < 0 || idx.rating < 0) {
    throw new Error(
      "This file does not look like an IMDb ratings export. Expected Const and Your Rating columns.",
    );
  }

  const out: ImdbCsvRow[] = [];
  for (const row of rows.slice(1)) {
    const imdbId = (row[idx.const] ?? "").trim();
    const rating = Number(row[idx.rating]);
    const titleType =
      (idx.type >= 0 ? row[idx.type] : "movie")?.trim().toLowerCase() ??
      "movie";
    if (!/^tt\d+$/i.test(imdbId) || !Number.isFinite(rating)) continue;
    if (titleType && !isSupportedTitleType(titleType)) continue;
    out.push({
      imdbId,
      rating: Math.max(1, Math.min(10, Math.round(rating))),
      dateRated: idx.date >= 0 ? parseRatingDate(row[idx.date]) : undefined,
      title: idx.title >= 0 ? row[idx.title] : imdbId,
      titleType,
    });
  }
  return out;
}

export function parseRatingDate(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === raw
    ? date.toISOString()
    : undefined;
}

export function preferredMediaType(titleType: string): "movie" | "tv" {
  return /tv ?(series|mini)/i.test(titleType) ? "tv" : "movie";
}

function isSupportedTitleType(type: string): boolean {
  return /^(movie|tv ?movie|tv ?(mini ?)?series)$/i.test(type);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim().length));
}
