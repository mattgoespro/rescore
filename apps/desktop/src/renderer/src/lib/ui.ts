import { cn } from "./cn";

/**
 * Dark paper buttons: one filled primary per screen, outlined secondary,
 * text-only tertiary ("link") and outlined danger. Flat, 4px corners.
 */
export function btn(
  ...variants: Array<
    | "primary"
    | "ghost"
    | "danger"
    | "link"
    | "compact"
    | "small"
    | false
    | undefined
  >
): string {
  const primary = variants.includes("primary");
  const danger = variants.includes("danger");
  const ghost = variants.includes("ghost");
  const link = variants.includes("link");
  const compact = variants.includes("compact");
  const small = variants.includes("small");
  return cn(
    "inline-flex items-center justify-center gap-1.5 rounded-control border font-semibold whitespace-nowrap transition-colors duration-140 app-no-drag disabled:cursor-not-allowed disabled:opacity-45",
    compact
      ? "h-7 px-2.5 text-xs"
      : small
        ? "h-8 px-3 text-xs"
        : "h-9 px-3.5 text-sm",
    primary
      ? "border-accent bg-accent text-accent-ink hover:bg-accent/90"
      : danger
        ? "border-danger bg-transparent text-danger hover:bg-wash-6"
        : ghost || link
          ? "border-transparent bg-transparent text-muted hover:bg-wash-6 hover:text-ink"
          : "border-control bg-transparent text-ink hover:bg-wash-6",
    link && "no-underline",
  );
}

/** Square outlined icon button (refresh, history, settings). */
export function iconBtn(
  ...variants: Array<"busy" | "bare" | false | undefined>
): string {
  return cn(
    "grid size-9 shrink-0 place-items-center rounded-control border p-0 text-muted transition-colors duration-140 app-no-drag hover:bg-wash-6 hover:text-ink disabled:cursor-not-allowed",
    variants.includes("bare") ? "border-transparent" : "border-control",
    variants.includes("busy") &&
      "[&_svg]:animate-catalog motion-reduce:[&_svg]:animate-catalog-reduced!",
  );
}

export function rankedRow(active = false, extra?: string): string {
  return cn(
    "grid w-full cursor-pointer grid-cols-[40px_36px_minmax(0,1fr)_auto] items-center gap-4 rounded-none border-0 border-b border-line p-3 text-left text-inherit transition-colors duration-140",
    active
      ? "bg-selected inset-accent hover:bg-selected"
      : "bg-transparent hover:bg-wash-3",
    extra,
  );
}

export function rankedThumb(): string {
  return "poster-ph h-13.5 w-9 rounded-[3px] object-cover";
}

export const rangeInputClass =
  "h-3 w-full min-w-0 flex-1 cursor-pointer appearance-none bg-transparent outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent-text focus-visible:outline-offset-2 [&::-webkit-slider-runnable-track]:h-0.5 [&::-webkit-slider-runnable-track]:bg-track [&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:size-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-[2px] [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-accent";

export const overlayPanelClass =
  "fixed z-40 overflow-auto overscroll-contain rounded-control border border-control bg-raised p-1";

export const progressBarClass = "h-0.5 overflow-hidden bg-track";
export const progressFillClass = "h-full bg-accent";

/** Section label used above every filter and panel group. */
export const sectionLabelClass = "kicker";

export function chipClass(selected: boolean): string {
  return cn(
    "inline-flex h-8 items-center justify-center gap-1 rounded-control border px-2 text-[13px] font-medium whitespace-nowrap transition-colors duration-140",
    selected
      ? "border-accent bg-selected text-accent-text"
      : "border-control bg-transparent text-ink hover:bg-wash-6",
  );
}

/**
 * Segmented radio group. "text" fills its row and sizes each option to its
 * label; "icon" hugs its content. The selected cell sits 3px inside the
 * outline on every side.
 */
export function segmentedGroup(density: "text" | "icon"): string {
  return cn(
    "flex gap-[3px] rounded-control border border-control p-[3px]",
    density === "text" ? "w-full" : "w-fit",
  );
}

export function segmentedCell(
  selected: boolean,
  density: "text" | "icon",
): string {
  return cn(
    "flex h-7 min-w-0 items-center justify-center gap-1.5 truncate rounded-[2px] border-0 text-[13px] focus-visible:outline-offset-0",
    density === "icon" ? "px-2.5" : "flex-auto px-2",
    selected
      ? "bg-selected font-semibold text-accent-text"
      : "bg-transparent font-medium text-muted hover:bg-wash-6 hover:text-ink",
  );
}

export function ratingCell(filled: boolean): string {
  return cn(
    "h-8 flex-1 rounded-control border p-0 text-[13px] font-semibold transition-colors duration-140 disabled:cursor-wait",
    filled
      ? "border-accent bg-selected text-accent-text"
      : "border-control bg-transparent text-muted hover:bg-wash-6 hover:text-ink",
  );
}
