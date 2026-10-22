import type { JSX, SVGProps } from "react";
import Icon from "./icon";

export default function IconBookmark(
  props: SVGProps<SVGSVGElement>,
): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M6 3h12v18l-6-4-6 4z" />
    </Icon>
  );
}
