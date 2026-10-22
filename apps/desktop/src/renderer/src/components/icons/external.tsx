import type { JSX, SVGProps } from "react";
import Icon from "./icon";

export default function IconExternal(
  props: SVGProps<SVGSVGElement>,
): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </Icon>
  );
}
