import type { JSX, SVGProps } from "react";
import Icon from "./icon";

export default function IconPlus(props: SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}
