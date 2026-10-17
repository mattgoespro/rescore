export type SettingsErrors = Partial<Record<"catalogApiUrl", string>>;

export function validateRankingSettings(
  input: {
    catalogApiUrl: string;
  },
  serviceRequired: boolean,
): SettingsErrors {
  const errors: SettingsErrors = {};
  for (const key of ["catalogApiUrl"] as const) {
    if (key === "catalogApiUrl" && serviceRequired) continue;
    try {
      const url = new URL(input[key].trim());
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname)
        throw new Error();
    } catch {
      errors[key] =
        "Enter a complete HTTP or HTTPS URL, such as http://127.0.0.1:3847.";
    }
  }
  return errors;
}
