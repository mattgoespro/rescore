import type { JSX } from "react";
import { TITLE_KIND_OPTIONS, type TitleKind } from "../../../../shared/types";
import { segmentedCell, segmentedGroup } from "../../lib/ui";

/** Movies / TV Series / Mini-Series as one segmented control. */
export default function TitleKindField({
  value,
  onChange,
}: {
  value: TitleKind;
  onChange: (titleKind: TitleKind) => void;
}): JSX.Element {
  return (
    <div
      role="group"
      aria-label="Title type"
      className={segmentedGroup("text")}
    >
      {TITLE_KIND_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          className={segmentedCell(value === option.value, "text")}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
