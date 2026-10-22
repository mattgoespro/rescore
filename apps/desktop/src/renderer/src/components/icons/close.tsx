import type { JSX, SVGProps } from "react";
import Icon from "./icon";

export default function IconClose(props: SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  );
}
