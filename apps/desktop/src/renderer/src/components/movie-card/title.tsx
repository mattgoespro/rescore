import type { JSX } from "react";
import OverflowTooltip from "../overflow-tooltip";

/**
 * One line in every layout, so captions line up across a row; a title that
 * does not fit ends in an ellipsis and shows in full in a tooltip.
 */
export default function Title({ title }: { title: string }): JSX.Element {
  return (
    <OverflowTooltip
      as="h2"
      text={title}
      className="m-0 text-sm leading-snug font-semibold"
    />
  );
}
