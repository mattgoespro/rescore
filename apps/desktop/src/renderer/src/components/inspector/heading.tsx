import type { JSX } from "react";
import { AgeCaption } from "../movie-card";

export default function Heading({
  title,
  rating,
}: {
  title: string;
  rating?: string;
}): JSX.Element {
  return (
    <h2 className="mt-0 mb-1.5 text-2xl font-650 tracking-title text-shadow-(--imd-title-shadow)">
      {title}
      <AgeCaption rating={rating} />
    </h2>
  );
}
