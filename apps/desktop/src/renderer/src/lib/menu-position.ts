/** Where a portalled dropdown sits under (or over) the button that opened it. */
export interface MenuPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

/**
 * The current position when nothing moved, so a scroll or resize that leaves
 * the menu in place does not redraw it.
 */
export function keepMenuPosition(
  current: MenuPosition,
  next: MenuPosition,
): MenuPosition {
  return current.top === next.top &&
    current.left === next.left &&
    current.width === next.width &&
    current.maxHeight === next.maxHeight
    ? current
    : next;
}

/** Scrolling the menu's own list leaves the button, and so the menu, where they were. */
export function scrolledInside(
  event: Event,
  menu: HTMLElement | null,
): boolean {
  return Boolean(
    menu && event.target instanceof Node && menu.contains(event.target),
  );
}
