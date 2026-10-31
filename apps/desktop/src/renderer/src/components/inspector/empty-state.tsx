import type { JSX } from "react";

export default function EmptyState(): JSX.Element {
  return (
    <div className="px-5 py-8 text-muted">
      <h3 className="mt-0 mb-2 text-lg tracking-title text-ink">
        Select a title
      </h3>
      <p>Ratings, watch status, and the IMDb page live here.</p>
    </div>
  );
}
