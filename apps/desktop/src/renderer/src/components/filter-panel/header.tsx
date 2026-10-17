import type { JSX } from "react";
import type { SearchHistoryEntry } from "../../../../shared/types";
import { btn } from "../../lib/ui";
import HistoryMenu from "./history-menu";

export default function Header({
  onReset,
  history,
  activeHistoryId,
  onApplyHistory,
  onRemoveHistory,
}: {
  onReset: () => void;
  history: SearchHistoryEntry[];
  activeHistoryId: string | null;
  onApplyHistory: (entry: SearchHistoryEntry) => void;
  onRemoveHistory: (id: string) => void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="kicker min-w-0 text-[13px] leading-7">Filters</h2>
      <div className="flex shrink-0 items-center gap-1.5">
        <HistoryMenu
          entries={history}
          activeId={activeHistoryId}
          onApply={onApplyHistory}
          onRemove={onRemoveHistory}
        />
        <button
          className={btn("ghost", "compact")}
          type="button"
          onClick={onReset}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
