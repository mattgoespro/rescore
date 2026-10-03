export interface LanguageOption {
  id: string;
  name: string;
}

const LANGUAGES: readonly LanguageOption[] = [
  { id: "af", name: "Afrikaans" },
  { id: "sq", name: "Albanian" },
  { id: "am", name: "Amharic" },
  { id: "ar", name: "Arabic" },
  { id: "hy", name: "Armenian" },
  { id: "as", name: "Assamese" },
  { id: "az", name: "Azerbaijani" },
  { id: "eu", name: "Basque" },
  { id: "be", name: "Belarusian" },
  { id: "bn", name: "Bengali" },
  { id: "bs", name: "Bosnian" },
  { id: "br", name: "Breton" },
  { id: "bg", name: "Bulgarian" },
  { id: "my", name: "Burmese" },
  { id: "cn", name: "Cantonese" },
  { id: "ca", name: "Catalan" },
  { id: "zh", name: "Chinese" },
  { id: "hr", name: "Croatian" },
  { id: "cs", name: "Czech" },
  { id: "da", name: "Danish" },
  { id: "nl", name: "Dutch" },
  { id: "dz", name: "Dzongkha" },
  { id: "en", name: "English" },
  { id: "eo", name: "Esperanto" },
  { id: "et", name: "Estonian" },
  { id: "fi", name: "Finnish" },
  { id: "fr", name: "French" },
  { id: "gl", name: "Galician" },
  { id: "ka", name: "Georgian" },
  { id: "de", name: "German" },
  { id: "el", name: "Greek" },
  { id: "gu", name: "Gujarati" },
  { id: "ht", name: "Haitian Creole" },
  { id: "ha", name: "Hausa" },
  { id: "haw", name: "Hawaiian" },
  { id: "he", name: "Hebrew" },
  { id: "hi", name: "Hindi" },
  { id: "hu", name: "Hungarian" },
  { id: "is", name: "Icelandic" },
  { id: "ig", name: "Igbo" },
  { id: "id", name: "Indonesian" },
  { id: "ga", name: "Irish" },
  { id: "it", name: "Italian" },
  { id: "ja", name: "Japanese" },
  { id: "kn", name: "Kannada" },
  { id: "kk", name: "Kazakh" },
  { id: "km", name: "Khmer" },
  { id: "ko", name: "Korean" },
  { id: "ku", name: "Kurdish" },
  { id: "lo", name: "Lao" },
  { id: "la", name: "Latin" },
  { id: "lv", name: "Latvian" },
  { id: "lt", name: "Lithuanian" },
  { id: "lb", name: "Luxembourgish" },
  { id: "mk", name: "Macedonian" },
  { id: "mg", name: "Malagasy" },
  { id: "ms", name: "Malay" },
  { id: "ml", name: "Malayalam" },
  { id: "mt", name: "Maltese" },
  { id: "mr", name: "Marathi" },
  { id: "mn", name: "Mongolian" },
  { id: "ne", name: "Nepali" },
  { id: "no", name: "Norwegian" },
  { id: "nb", name: "Norwegian Bokmål" },
  { id: "nn", name: "Norwegian Nynorsk" },
  { id: "or", name: "Odia" },
  { id: "ps", name: "Pashto" },
  { id: "fa", name: "Persian" },
  { id: "pl", name: "Polish" },
  { id: "pt", name: "Portuguese" },
  { id: "pa", name: "Punjabi" },
  { id: "ro", name: "Romanian" },
  { id: "ru", name: "Russian" },
  { id: "sa", name: "Sanskrit" },
  { id: "gd", name: "Scottish Gaelic" },
  { id: "sr", name: "Serbian" },
  { id: "sd", name: "Sindhi" },
  { id: "si", name: "Sinhala" },
  { id: "sk", name: "Slovak" },
  { id: "sl", name: "Slovenian" },
  { id: "so", name: "Somali" },
  { id: "es", name: "Spanish" },
  { id: "sw", name: "Swahili" },
  { id: "sv", name: "Swedish" },
  { id: "tl", name: "Tagalog" },
  { id: "tg", name: "Tajik" },
  { id: "ta", name: "Tamil" },
  { id: "te", name: "Telugu" },
  { id: "th", name: "Thai" },
  { id: "bo", name: "Tibetan" },
  { id: "tr", name: "Turkish" },
  { id: "uk", name: "Ukrainian" },
  { id: "ur", name: "Urdu" },
  { id: "uz", name: "Uzbek" },
  { id: "vi", name: "Vietnamese" },
  { id: "cy", name: "Welsh" },
  { id: "fy", name: "Western Frisian" },
  { id: "wo", name: "Wolof" },
  { id: "xh", name: "Xhosa" },
  { id: "yi", name: "Yiddish" },
  { id: "yo", name: "Yoruba" },
  { id: "zu", name: "Zulu" },
];

const EXTRA_NAMES: Record<string, string> = {
  iw: "Hebrew",
  yue: "Cantonese",
};

const ALIASES: Record<string, readonly string[]> = {
  cn: ["cn", "yue"],
  he: ["he", "iw"],
  yue: ["cn", "yue"],
  iw: ["he", "iw"],
};

const BY_CODE = new Map(
  LANGUAGES.map((language) => [language.id, language.name]),
);

export function languageName(code: string): string {
  const key = code.toLowerCase();
  return BY_CODE.get(key) ?? EXTRA_NAMES[key] ?? code.toUpperCase();
}

export function languageQueryCodes(codes: readonly string[]): string[] {
  const seen = new Set<string>();
  const query: string[] = [];
  for (const code of codes) {
    for (const language of ALIASES[code] ?? [code]) {
      if (seen.has(language)) continue;
      seen.add(language);
      query.push(language);
    }
  }
  return query;
}

export function formatLanguages(
  codes: readonly string[] | undefined,
): string | null {
  if (!codes?.length) return null;
  return codes.map((code) => languageName(code)).join(", ");
}

export function searchLanguages(query: string, limit = 8): LanguageOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const prefix: LanguageOption[] = [];
  const contains: LanguageOption[] = [];
  const seen = new Set<string>();
  for (const language of LANGUAGES) {
    if (seen.has(language.name)) continue;
    const name = language.name.toLowerCase();
    const match =
      name.startsWith(needle) || language.id.startsWith(needle)
        ? prefix
        : name.includes(needle)
          ? contains
          : null;
    if (!match) continue;
    seen.add(language.name);
    match.push(language);
  }
  return [...prefix, ...contains].slice(0, limit);
}
