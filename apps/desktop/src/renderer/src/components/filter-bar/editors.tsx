import { useCallback, useMemo, useState, type JSX } from "react";
import { languageName, searchLanguages } from "../../../../shared/languages";
import type { DiscoverFilters, Genre } from "../../../../shared/types";
import { mediaTypeOf } from "../../../../shared/types";
import type { FilterFieldId } from "../../lib/filter-fields";
import { btn } from "../../lib/ui";
import GenreChips from "../filter-panel/genre-chips";
import { YEAR_CEILING } from "../filter-panel/constants";
import RatingSlider from "../filter-panel/rating-slider";
import RuntimeRange from "../filter-panel/runtime-range";
import VisibilityToggles from "../filter-panel/visibility-toggles";
import VotesSlider from "../filter-panel/votes-slider";
import YearRange from "../filter-panel/year-range";
import SuggestField from "../suggest-field";

type Patch = (partial: Partial<DiscoverFilters>) => void;

const hintClass = "m-0 text-xs leading-label text-pretty text-faint";

/** The editor a filter pill opens; each reuses the panel's own control. */
export default function FieldEditor({
  id,
  filters,
  patch,
  genres,
  onDone,
}: {
  id: FilterFieldId;
  filters: DiscoverFilters;
  patch: Patch;
  genres: Genre[];
  onDone: () => void;
}): JSX.Element {
  switch (id) {
    case "genres":
      return (
        <GenresEditor
          filters={filters}
          patch={patch}
          genres={genres}
          onDone={onDone}
        />
      );
    case "released":
      return <ReleasedEditor filters={filters} patch={patch} />;
    case "quality":
      return (
        <div className="flex flex-col gap-4">
          <RatingSlider
            value={filters.ratingMin}
            onChange={(ratingMin) => patch({ ratingMin })}
          />
          <VotesSlider
            value={filters.voteCountMin}
            onChange={(voteCountMin) => patch({ voteCountMin })}
          />
          <p className={hintClass}>
            A vote floor keeps titles with a handful of perfect scores out of
            the way.
          </p>
        </div>
      );
    case "languages":
      return <LanguagesEditor filters={filters} patch={patch} />;
    case "library":
      return (
        <div className="flex flex-col gap-2">
          <VisibilityToggles
            hideWatched={filters.hideWatched}
            hideWatchlist={filters.hideWatchlist}
            onChange={patch}
          />
          <p className={hintClass}>
            Titles you marked not for you are always hidden.
          </p>
        </div>
      );
    case "runtime":
      return (
        <RuntimeRange
          label={
            mediaTypeOf(filters.titleKind) === "tv"
              ? "Episode length"
              : "Runtime"
          }
          runtimeMin={filters.runtimeMin}
          runtimeMax={filters.runtimeMax}
          onChange={(runtimeMin, runtimeMax) =>
            patch({ runtimeMin, runtimeMax })
          }
        />
      );
  }
}

function GenresEditor({
  filters,
  patch,
  genres,
  onDone,
}: {
  filters: DiscoverFilters;
  patch: Patch;
  genres: Genre[];
  onDone: () => void;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const used = (genre: Genre) =>
      filters.genres.includes(genre.id) ||
      filters.withoutGenres.includes(genre.id);
    return genres
      .filter((genre) => !needle || genre.name.toLowerCase().includes(needle))
      .sort((a, b) => Number(used(b)) - Number(used(a)));
  }, [genres, query, filters.genres, filters.withoutGenres]);

  function cycle(id: number, state: "include" | "exclude" | "any"): void {
    if (state === "any")
      patch({
        genres: [...filters.genres, id],
        withoutGenres: filters.withoutGenres.filter((g) => g !== id),
      });
    else if (state === "include")
      patch({
        genres: filters.genres.filter((g) => g !== id),
        withoutGenres: [...filters.withoutGenres, id],
      });
    else
      patch({ withoutGenres: filters.withoutGenres.filter((g) => g !== id) });
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="sr-only" htmlFor="genre-filter-find">
        Find a genre
      </label>
      <input
        id="genre-filter-find"
        type="text"
        placeholder="Find a genre"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="max-h-60 overflow-auto overscroll-contain">
        {shown.length ? (
          <GenreChips
            genres={shown}
            included={filters.genres}
            excluded={filters.withoutGenres}
            onCycle={cycle}
          />
        ) : (
          <p className="m-0 text-[13px] text-muted">No genre matches that.</p>
        )}
      </div>
      <p className={hintClass}>
        Click once to include, again to exclude, again to clear.
      </p>
      <div className="flex items-center justify-between">
        <button
          type="button"
          className={btn("ghost", "small")}
          disabled={!filters.genres.length && !filters.withoutGenres.length}
          onClick={() => patch({ genres: [], withoutGenres: [] })}
        >
          Clear genres
        </button>
        <button
          type="button"
          className={btn("primary", "small")}
          onClick={onDone}
        >
          Done
        </button>
      </div>
    </div>
  );
}

function ReleasedEditor({
  filters,
  patch,
}: {
  filters: DiscoverFilters;
  patch: Patch;
}): JSX.Element {
  const presets: Array<[string, number | null, number | null]> = [
    ["Any year", null, null],
    ["2000 on", 2000, YEAR_CEILING],
    ["2010 on", 2010, YEAR_CEILING],
    ["Last 5 years", YEAR_CEILING - 4, YEAR_CEILING],
  ];
  return (
    <div className="flex flex-col gap-4">
      <YearRange
        yearMin={filters.yearMin}
        yearMax={filters.yearMax}
        onChange={(yearMin, yearMax) => patch({ yearMin, yearMax })}
      />
      <div className="flex flex-wrap gap-1.5">
        {presets.map(([label, yearMin, yearMax]) => (
          <button
            key={label}
            type="button"
            className={btn("small")}
            onClick={() => patch({ yearMin, yearMax })}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function LanguagesEditor({
  filters,
  patch,
}: {
  filters: DiscoverFilters;
  patch: Patch;
}): JSX.Element {
  const search = useCallback(
    async (query: string) =>
      searchLanguages(query).filter(
        (language) => !filters.excludeLanguages.includes(language.id),
      ),
    [filters.excludeLanguages],
  );
  return (
    <SuggestField
      label="Hide titles in"
      name="excludeLanguages"
      hint={
        filters.excludeLanguages.length
          ? "Hides a title when any of these is one of its languages. Titles TMDb has not described yet stay visible."
          : "None hidden."
      }
      placeholder="Add a language…"
      minQueryLength={1}
      values={filters.excludeLanguages.map((code) => ({
        id: code,
        name: languageName(code),
      }))}
      onChange={(languages) =>
        patch({
          excludeLanguages: languages
            .map((language) => language.id)
            .slice(0, 12),
        })
      }
      search={search}
    />
  );
}
