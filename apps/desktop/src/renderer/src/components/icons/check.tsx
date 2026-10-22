import type { JSX, SVGProps } from "react";
import Icon from "./icon";

export default function IconCheck(props: SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M5 12l5 5L20 7" />
    </Icon>
  );
}
