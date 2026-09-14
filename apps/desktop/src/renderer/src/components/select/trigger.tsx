import type { JSX, KeyboardEvent as ReactKeyboardEvent, Ref } from "react";
import { cn } from "../../lib/cn";
import Chevron from "./chevron";

export default function Trigger({
  buttonRef,
  open,
  label,
  ariaLabel,
  menuId,
  onClick,
  onKeyDown,
}: {
  buttonRef: Ref<HTMLButtonElement>;
  open: boolean;
  label: string;
  ariaLabel?: string;
  menuId: string;
  onClick: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}): JSX.Element {
  return (
    <button
      ref={buttonRef}
      id={`${menuId}-trigger`}
      type="button"
      className={cn(
        "field-control flex items-center justify-between gap-2.5 text-left text-ink",
        open ? "border-accent" : "border-line focus-visible:border-accent",
      )}
      aria-label={ariaLabel}
      aria-describedby={ariaLabel ? `${menuId}-value` : undefined}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={menuId}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <span id={`${menuId}-value`} className="min-w-0 truncate">
        {label}
      </span>
      <Chevron />
    </button>
  );
}
