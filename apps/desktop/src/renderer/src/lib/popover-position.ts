export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PopoverPlacement {
  top: number;
  left: number;
  width: number;
  side: "below" | "above";
}

/**
 * Centres the popover on its anchor when the window has room, otherwise
 * slides it just far enough to stay `margin` inside the window. It opens
 * below the anchor unless it would not fit there and fits better above.
 */
export function placePopover(input: {
  anchor: Rect;
  width: number;
  height: number;
  viewport: { width: number; height: number };
  margin?: number;
  gap?: number;
}): PopoverPlacement {
  const margin = input.margin ?? 12;
  const gap = input.gap ?? 6;
  const { anchor, viewport } = input;
  const width = Math.max(0, Math.min(input.width, viewport.width - margin * 2));
  const centre = (anchor.left + anchor.right) / 2;
  const left = Math.min(
    Math.max(centre - width / 2, margin),
    Math.max(margin, viewport.width - margin - width),
  );
  const spaceBelow = viewport.height - anchor.bottom - gap - margin;
  const spaceAbove = anchor.top - gap - margin;
  const below = input.height <= spaceBelow || spaceBelow >= spaceAbove;
  return {
    left,
    width,
    side: below ? "below" : "above",
    top: below ? anchor.bottom + gap : anchor.top - gap - input.height,
  };
}
