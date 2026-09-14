import type { JSX, KeyboardEvent as ReactKeyboardEvent, Ref } from "react";
import type { SelectOption } from "./types";
import Option from "./option";
import { overlayPanelClass } from "../../lib/ui";

export default function Menu({
  menuRef,
  id,
  options,
  value,
  top,
  left,
  width,
  maxHeight,
  onKeyDown,
  onChoose,
}: {
  menuRef: Ref<HTMLDivElement>;
  id: string;
  options: ReadonlyArray<SelectOption>;
  value: string;
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onChoose: (value: string) => void;
}): JSX.Element {
  const selectedIndex = options.findIndex((opt) => opt.value === value);
  return (
    <div
      ref={menuRef}
      id={id}
      className={overlayPanelClass}
      role="listbox"
      aria-labelledby={`${id}-trigger`}
      aria-activedescendant={
        selectedIndex >= 0 ? `${id}-option-${selectedIndex}` : undefined
      }
      tabIndex={-1}
      style={{ top, left, width, maxHeight }}
      onKeyDown={onKeyDown}
    >
      {options.map((opt, index) => (
        <Option
          key={opt.value}
          id={`${id}-option-${index}`}
          label={opt.label}
          selected={opt.value === value}
          onSelect={() => onChoose(opt.value)}
        />
      ))}
    </div>
  );
}
