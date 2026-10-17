import { useState, type JSX } from "react";
import { cn } from "../../lib/cn";

export default function Poster({
  src,
  grid,
  active,
  status = "pending",
}: {
  src: string | null;
  grid: boolean;
  active?: boolean;
  status?: "pending" | "available" | "unavailable";
}): JSX.Element {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = src && failedSrc !== src;
  const caption =
    src && failedSrc === src
      ? "Image failed to load"
      : status === "unavailable"
        ? "No poster available from TMDb"
        : "Poster lookup pending";
  return (
    <div
      data-poster-status={showImage ? "available" : src ? "error" : status}
      title={showImage ? undefined : caption}
      className={
        grid
          ? cn(
              "relative aspect-2/3 h-auto w-full shrink-0 overflow-hidden rounded-lg bg-poster",
              active && "shadow-[0_0_0_2px_var(--color-accent)]",
            )
          : "relative h-16.5 w-11 shrink-0 overflow-hidden rounded-md bg-poster"
      }
    >
      {showImage ? (
        <img
          className="block size-full object-cover"
          src={src}
          alt=""
          width={185}
          height={278}
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-1 text-center text-muted"
          role="img"
          aria-label={caption}
        >
          <svg
            className={grid ? "size-7" : "size-4"}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            {status === "unavailable" || src ? (
              <>
                <rect x="4" y="3" width="16" height="18" rx="2" />
                <path d="M4 16l5-5 4 4 3-3 4 4M3 3l18 18" />
              </>
            ) : (
              <>
                <circle cx="12" cy="12" r="8" />
                <path d="M12 7v5l3 2" />
              </>
            )}
          </svg>
          <span className={grid ? "text-[11px]" : "text-[9px] leading-tight"}>
            {src
              ? "No image"
              : status === "unavailable"
                ? "No poster"
                : grid
                  ? "Poster pending"
                  : "Pending"}
          </span>
        </div>
      )}
    </div>
  );
}
