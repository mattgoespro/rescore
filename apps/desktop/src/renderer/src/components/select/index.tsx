import {
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import Menu from "./menu";
import Trigger from "./trigger";
import type { SelectOption } from "./types";

export type { SelectOption };

export default function Select({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: ReadonlyArray<SelectOption>;
  onChange: (value: string) => void;
  ariaLabel?: string;
}): JSX.Element {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: 280,
  });
  const selected = options.find((opt) => opt.value === value) ?? options[0];

  function placeMenu(): void {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const maxHeight = Math.min(280, Math.max(spaceBelow, spaceAbove));
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
    setMenuPos({
      top: openUp ? rect.top - maxHeight - 4 : rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      maxHeight,
    });
  }

  useEffect(() => {
    if (!open) return;
    placeMenu();
    queueMicrotask(() => menuRef.current?.focus());
    const onDoc = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (
        buttonRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      )
        return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onReposition = (): void => placeMenu();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open, value, options]);

  function choose(next: string): void {
    onChange(next);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onButtonKey(event: ReactKeyboardEvent<HTMLButtonElement>): void {
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault();
      setOpen(true);
    }
  }

  function onMenuKey(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const index = Math.max(
      0,
      options.findIndex((opt) => opt.value === value),
    );
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = options[Math.min(options.length - 1, index + 1)];
      if (next) onChange(next.value);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = options[Math.max(0, index - 1)];
      if (next) onChange(next.value);
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = options[event.key === "Home" ? 0 : options.length - 1];
      if (next) onChange(next.value);
    }
    if (event.key === "Tab") {
      // Resume native tab navigation from the trigger, not the body portal.
      setOpen(false);
      buttonRef.current?.focus();
    }
    if (event.key === "Enter" || event.key === " " || event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }
  }

  return (
    <div className="w-full">
      <Trigger
        buttonRef={buttonRef}
        open={open}
        label={selected?.label ?? ""}
        ariaLabel={ariaLabel}
        menuId={id}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={onButtonKey}
      />
      {open
        ? createPortal(
            <Menu
              menuRef={menuRef}
              id={id}
              options={options}
              value={selected?.value ?? value}
              top={menuPos.top}
              left={menuPos.left}
              width={menuPos.width}
              maxHeight={menuPos.maxHeight}
              onKeyDown={onMenuKey}
              onChoose={choose}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
