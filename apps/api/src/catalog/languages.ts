const LANGUAGE_CODE = /^[a-z]{2,3}$/;

export function normalizeLanguageCodes(codes: readonly string[]): string[] {
  const seen = new Set<string>();
  const languages: string[] = [];
  for (const code of codes) {
    const language = code.trim().toLowerCase();
    if (!LANGUAGE_CODE.test(language) || language === "xx" || seen.has(language)) {
      continue;
    }
    seen.add(language);
    languages.push(language);
  }
  return languages;
}

export function languageCodes(details: {
  original_language?: string | null;
  spoken_languages?: Array<{ iso_639_1?: string | null }> | null;
}): string[] {
  return normalizeLanguageCodes([
    details.original_language ?? "",
    ...(details.spoken_languages ?? []).map((language) => language.iso_639_1 ?? ""),
  ]);
}
