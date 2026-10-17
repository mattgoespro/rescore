import type { JSX, SVGProps } from "react";
import { cn } from "../../lib/cn";

export default function Chevron({
  className,
  ...props
}: SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0 fill-none stroke-muted stroke-icon [stroke-linecap:round] [stroke-linejoin:round]",
        className,
      )}
      {...props}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
