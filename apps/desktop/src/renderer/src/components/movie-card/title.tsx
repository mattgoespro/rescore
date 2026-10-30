import type { JSX } from "react";
import OverflowTooltip from "../overflow-tooltip";

/**
 * One line in every layout, so captions line up across a row; a title that
 * does not fit ends in an ellipsis and shows in full in a tooltip. It is a
 * block span, not a heading: the card is a button, which holds no headings.
 */
export default function Title({ title }: { title: string }): JSX.Element {
  return (
    <OverflowTooltip
      text={title}
      className="block text-sm leading-snug font-semibold"
    />
  );
}
