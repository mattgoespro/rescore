import type { PersonRef } from "../../../../shared/types";

export function personSearch(query: string): Promise<PersonRef[]> {
  return window.api.searchPeople(query);
}
