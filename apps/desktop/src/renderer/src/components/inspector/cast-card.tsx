import { useState, type JSX } from "react";
import type { MovieDetails } from "../../../../shared/types";
import { posterUrl } from "../../../../shared/types";

export default function CastCard({
  person,
}: {
  person: NonNullable<MovieDetails["cast"]>[number];
}): JSX.Element {
  const [failedPath, setFailedPath] = useState<string | null>(null);
  return (
    <div className="w-24 shrink-0 text-[11px] wrap-break-word text-muted">
      {person.profilePath && person.profilePath !== failedPath ? (
        <img
          className="block size-[72px] rounded-app bg-poster object-cover"
          src={posterUrl(person.profilePath, "w185") ?? ""}
          alt=""
          width={72}
          height={72}
          loading="lazy"
          decoding="async"
          onError={() => setFailedPath(person.profilePath)}
        />
      ) : (
        <div className="grid size-[72px] place-items-center rounded-app bg-poster">
          {person.name.slice(0, 1)}
        </div>
      )}
      <b className="mt-1.5 block text-[11px] font-semibold text-ink">
        {person.name}
      </b>
      <div>{person.character}</div>
    </div>
  );
}
