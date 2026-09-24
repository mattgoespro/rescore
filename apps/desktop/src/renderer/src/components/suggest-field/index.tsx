import { useEffect, useState, type JSX } from "react";
import Suggestions from "./suggestions";
import ValueChips from "./value-chips";

export { personSearch } from "./search";

export default function SuggestField<T extends { id: number; name: string }>({
  label,
  placeholder,
  values,
  onChange,
  search,
}: {
  label: string;
  placeholder: string;
  values: T[];
  onChange: (values: T[]) => void;
  search: (query: string) => Promise<T[]>;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<T[]>([]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    const handle = window.setTimeout(() => {
      search(query)
        .then(setHits)
        .catch(() => setHits([]));
    }, 220);
    return () => window.clearTimeout(handle);
  }, [query, search]);

  function add(item: T): void {
    if (!values.some((v) => v.id === item.id)) onChange([...values, item]);
    setQuery("");
    setHits([]);
  }

  return (
    <label className="mb-1 flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted">
      {label}
      <div className="relative">
        <input
          type="text"
          value={query}
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Suggestions hits={hits} onSelect={add} />
      </div>
      <ValueChips
        values={values}
        onRemove={(id) => onChange(values.filter((v) => v.id !== id))}
      />
    </label>
  );
}
