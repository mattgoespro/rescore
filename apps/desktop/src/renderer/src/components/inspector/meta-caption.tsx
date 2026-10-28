import type { JSX } from "react";
import { iconBtn } from "../../lib/ui";
import { IconExternal } from "../icons";

/** The facts line under the title, with the IMDb link at its right end. */
export default function MetaCaption({
  parts,
  imdb,
}: {
  parts: Array<string | number | null | undefined>;
  imdb: string | null;
}): JSX.Element {
  return (
    <div className="mb-3.5 flex items-start justify-between gap-3">
      <div className="min-w-0 pt-1.5 text-xs leading-copy text-muted tabular">
        {parts.filter(Boolean).join(" · ")}
      </div>
      {imdb ? (
        <a
          className={`${iconBtn("bare")} size-7`}
          href={imdb}
          target="_blank"
          rel="noreferrer"
          aria-label="Open on IMDb"
          title="Open on IMDb"
        >
          <IconExternal className="size-4" />
        </a>
      ) : null}
    </div>
  );
}
