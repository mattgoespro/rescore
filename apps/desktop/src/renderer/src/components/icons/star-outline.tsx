import type { JSX, SVGProps } from "react";
import Icon from "./icon";

/** A line star that fills in when `filled`, for an on/off star button. */
export default function IconStarOutline({
  filled = false,
  ...props
}: SVGProps<SVGSVGElement> & { filled?: boolean }): JSX.Element {
  return (
    <Icon {...props}>
      <path
        d="M12 3l2.4 6.6H21l-5.3 3.9 2 6.5L12 16.8 6.3 20l2-6.5L3 9.6h6.6z"
        fill={filled ? "currentColor" : undefined}
      />
    </Icon>
  );
}
