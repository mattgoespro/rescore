import { cn } from "./cn";

export function btn(
  ...variants: Array<
    "primary" | "ghost" | "danger" | "link" | "compact" | false | undefined
  >
): string {
  const primary = variants.includes("primary");
  const danger = variants.includes("danger");
  const ghost = variants.includes("ghost");
  const compact = variants.includes("compact");
  return cn(
    "app-no-drag rounded-full border font-semibold transition-colors duration-140 disabled:cursor-not-allowed disabled:opacity-45",
    compact ? "h-7 px-2.5 py-0 text-[11px]" : "px-3.5 py-2 text-[13px]",
    primary
      ? "border-transparent bg-linear-to-b from-accent-2 to-accent text-accent-ink shadow-accent hover:from-accent-2 hover:to-accent hover:text-accent-ink"
      : danger
        ? "border-(--color-danger-ring) bg-transparent text-danger hover:bg-wash-9"
        : ghost
          ? "border-line bg-transparent text-ink hover:bg-wash-9"
          : "border-line bg-wash text-ink hover:bg-wash-9",
    variants.includes("link") && "inline-flex items-center no-underline",
  );
}

export function iconBtn(...variants: Array<"busy" | false | undefined>): string {
  return cn(
    "grid size-10 shrink-0 place-items-center rounded-xl border border-transparent bg-linear-to-b from-accent-2 to-accent p-0 text-accent-ink shadow-accent hover:from-accent-2 hover:to-accent hover:text-accent-ink",
    variants.includes("busy") && "[&_svg]:animate-catalog",
  );
}

export function rankedRow(active = false, extra?: string): string {
  return cn(
    "grid w-full cursor-pointer grid-cols-[48px_52px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-none border-0 border-b border-line px-1.5 py-2.5 text-left text-inherit",
    active
      ? "inset-accent bg-accent-soft hover:bg-accent-soft"
      : "bg-transparent hover:bg-wash-3",
    extra,
  );
}

export function rankedThumb(): string {
  return "poster-ph h-19.5 w-13 rounded-md object-cover";
}

export const rangeInputClass =
  "h-1 w-full min-w-0 flex-1 appearance-none rounded-full bg-track outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent focus-visible:outline-offset-2 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_var(--color-accent-soft)]";

export const overlayPanelClass =
  "fixed z-40 overflow-auto rounded-app border border-line bg-raised p-1 shadow-panel";

export const progressBarClass = "h-2 overflow-hidden rounded-full bg-track";
export const progressFillClass = "h-full bg-accent";

export function chipClass(selected: boolean): string {
  return cn(
    "rounded-full border px-2.5 py-1 text-[11px] leading-[1.2] font-semibold whitespace-nowrap transition-[background,color,border-color] duration-140",
    selected
      ? "border-accent bg-accent text-accent-ink"
      : "border-line bg-wash-3 text-muted",
  );
}

export function segmentedGroup(density: "text" | "icon"): string {
  return cn(
    "flex overflow-hidden border border-line",
    density === "icon" ? "rounded-lg" : "rounded-app",
  );
}

export function segmentedCell(
  selected: boolean,
  density: "text" | "icon",
): string {
  if (density === "icon") {
    return cn(
      "grid h-7.5 w-8.5 place-items-center border-0 p-0 focus-visible:-outline-offset-2",
      selected ? "bg-accent-soft text-accent" : "bg-transparent text-muted",
    );
  }
  return cn(
    "flex-1 border-0 px-3 py-2.5 text-[13px] font-semibold focus-visible:-outline-offset-2",
    selected
      ? "bg-accent-soft text-accent"
      : "bg-transparent text-muted hover:bg-wash-6 hover:text-ink",
  );
}

export function ratingCell(filled: boolean): string {
  return cn(
    "h-8 flex-1 rounded-lg border p-0 text-xs font-650 transition-[background,color] duration-140",
    filled
      ? "border-accent bg-accent text-accent-ink"
      : "border-line bg-[rgba(8,8,10,0.4)] text-muted",
  );
}
