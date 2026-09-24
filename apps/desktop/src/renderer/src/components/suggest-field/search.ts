import type { PersonRef } from "../../../../shared/types";

export function personSearch(
  query: string,
  role: "director" | "cast" = "cast",
): Promise<PersonRef[]> {
  return window.api.searchPeople(query, role);
}
