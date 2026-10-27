import type { JSX, SVGProps } from "react";
import Icon from "./icon";

export default function IconChevronDown(
  props: SVGProps<SVGSVGElement>,
): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M6 9l6 6 6-6" />
    </Icon>
  );
}
