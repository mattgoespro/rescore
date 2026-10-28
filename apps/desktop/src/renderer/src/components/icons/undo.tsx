import type { JSX, SVGProps } from "react";
import Icon from "./icon";

export default function IconUndo(props: SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Icon>
  );
}
