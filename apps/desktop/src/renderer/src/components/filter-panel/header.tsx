import type { JSX } from "react";
import type { SearchHistoryEntry } from "../../../../shared/types";
import { btn } from "../../lib/ui";
import HistoryMenu from "./history-menu";

export default function Header({
  activeCount,
  onReset,
  history,
  activeHistoryId,
  onApplyHistory,
  onRemoveHistory,
}: {
  activeCount: number;
  onReset: () => void;
  history: SearchHistoryEntry[];
  activeHistoryId: string | null;
  onApplyHistory: (entry: SearchHistoryEntry) => void;
  onRemoveHistory: (id: string) => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <h2 className="m-0 text-base font-semibold">Filters</h2>
      <span className="text-xs text-faint tabular">
        {activeCount ? `${activeCount} active` : "None active"}
      </span>
      <span className="flex-1" />
      <HistoryMenu
        entries={history}
        activeId={activeHistoryId}
        onApply={onApplyHistory}
        onRemove={onRemoveHistory}
      />
      <button
        className={`${btn("link", "compact")} px-2 text-accent-text hover:text-accent-text`}
        type="button"
        disabled={activeCount === 0}
        onClick={onReset}
      >
        Clear all
      </button>
    </div>
  );
}
