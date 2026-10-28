import type { JSX } from "react";
import { AgeCaption } from "../movie-card";

/** The title, with its age certificate right-aligned on the first line. */
export default function Heading({
  title,
  rating,
}: {
  title: string;
  rating?: string;
}): JSX.Element {
  return (
    <div className="mb-1.5 flex items-start justify-between gap-3">
      <h2 className="m-0 min-w-0 text-2xl font-650 tracking-title text-shadow-(--imd-title-shadow)">
        {title}
      </h2>
      <AgeCaption rating={rating} className="mt-1.5" />
    </div>
  );
}
