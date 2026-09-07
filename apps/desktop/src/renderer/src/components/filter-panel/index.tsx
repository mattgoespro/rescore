import type { JSX } from "react";
import type {
  DiscoverFilters,
  Genre,
  SearchHistoryEntry,
} from "../../../../shared/types";
import { defaultFilters, mediaTypeOf } from "../../../../shared/types";
import GenreChips from "./genre-chips";
import Header from "./header";
import QueryField from "./query-field";
import RatingSlider from "./rating-slider";
import RuntimeRange from "./runtime-range";
import SortField from "./sort-field";
import TitleKindField from "./title-kind-field";
import VisibilityToggles from "./visibility-toggles";
import VotesSlider from "./votes-slider";
import YearRange from "./year-range";

export default function FilterPanel({
  filters,
  setFilters,
  genres,
  profileReady,
  history,
  activeHistoryId,
  onApplyHistory,
  onRemoveHistory,
}: {
  filters: DiscoverFilters;
  setFilters: (filters: DiscoverFilters) => void;
  genres: Genre[];
  profileReady?: boolean;
  history: SearchHistoryEntry[];
  activeHistoryId: string | null;
  onApplyHistory: (entry: SearchHistoryEntry) => void;
  onRemoveHistory: (id: string) => void;
}): JSX.Element {
  function patch(partial: Partial<DiscoverFilters>): void {
    setFilters({ ...filters, ...partial, page: 1 });
  }

  function toggleGenre(id: number): void {
    patch({
      genres: filters.genres.includes(id)
        ? filters.genres.filter((genreId) => genreId !== id)
        : [...filters.genres, id],
      withoutGenres: [],
    });
  }

  return (
    <aside className="flex min-h-0 max-h-[28vh] flex-col gap-2.5 overflow-auto border-b border-line bg-transparent px-4.5 py-5 inspect:max-h-none inspect:border-r inspect:border-b-0">
      <Header
        onReset={() => setFilters(defaultFilters())}
        history={history}
        activeHistoryId={activeHistoryId}
        onApplyHistory={onApplyHistory}
        onRemoveHistory={onRemoveHistory}
      />
      <QueryField
        value={filters.query}
        onChange={(query) => patch({ query })}
      />
      <TitleKindField
        value={filters.titleKind}
        onChange={(titleKind) =>
          patch({
            titleKind,
            genres: [],
            sortBy:
              titleKind !== "movie" && filters.sortBy === "revenue.desc"
                ? "popularity.desc"
                : filters.sortBy,
          })
        }
      />
      <SortField
        titleKind={filters.titleKind}
        value={filters.sortBy}
        profileReady={profileReady}
        onChange={(sortBy) => patch({ sortBy })}
      />
      <GenreChips
        genres={genres}
        selected={filters.genres}
        onToggle={toggleGenre}
      />
      <YearRange
        yearMin={filters.yearMin}
        yearMax={filters.yearMax}
        onChange={(yearMin, yearMax) => patch({ yearMin, yearMax })}
      />
      <RatingSlider
        value={filters.ratingMin}
        onChange={(ratingMin) => patch({ ratingMin })}
      />
      <VotesSlider
        value={filters.voteCountMin}
        onChange={(voteCountMin) => patch({ voteCountMin })}
      />
      <RuntimeRange
        label={
          mediaTypeOf(filters.titleKind) === "tv" ? "Episode length" : "Runtime"
        }
        runtimeMin={filters.runtimeMin}
        runtimeMax={filters.runtimeMax}
        onChange={(runtimeMin, runtimeMax) => patch({ runtimeMin, runtimeMax })}
      />
      <VisibilityToggles
        hideWatched={filters.hideWatched}
        hideWatchlist={filters.hideWatchlist}
        onChange={patch}
      />
    </aside>
  );
}
