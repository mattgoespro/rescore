import {
  useEffect,
  useId,
  useState,
  type JSX,
  type KeyboardEvent,
} from "react";
import Suggestions from "./suggestions";
import ValueChips from "./value-chips";

export default function SuggestField<
  T extends { id: string | number; name: string },
>({
  label,
  hint,
  placeholder,
  values,
  onChange,
  search,
  minQueryLength = 2,
}: {
  label: string;
  hint?: string;
  placeholder: string;
  values: T[];
  onChange: (values: T[]) => void;
  search: (query: string) => Promise<T[]>;
  minQueryLength?: number;
}): JSX.Element {
  const listId = useId();
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<T[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (query.trim().length < minQueryLength) {
      setHits([]);
      return;
    }
    const handle = window.setTimeout(() => {
      search(query)
        .then(setHits)
        .catch(() => setHits([]));
    }, 220);
    return () => window.clearTimeout(handle);
  }, [query, search, minQueryLength]);

  useEffect(() => {
    setActive(0);
  }, [hits]);

  function add(item: T): void {
    if (!values.some((value) => value.id === item.id))
      onChange([...values, item]);
    setQuery("");
    setHits([]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (!hits.length) {
      if (event.key === "Escape") setHits([]);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % hits.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index - 1 + hits.length) % hits.length);
      return;
    }
    if (event.key === "Enter" && hits[active]) {
      event.preventDefault();
      add(hits[active]);
      return;
    }
    if (event.key === "Escape") setHits([]);
  }

  const open = hits.length > 0;

  return (
    <div className="mb-1 flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted">
      <label htmlFor={inputId}>{label}</label>
      {hint ? (
        <p className="m-0 text-[11px] leading-[1.3] font-normal text-pretty text-faint">
          {hint}
        </p>
      ) : null}
      <div className="relative">
        <input
          id={inputId}
          type="text"
          role="combobox"
          value={query}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <Suggestions id={listId} hits={hits} active={active} onSelect={add} />
      </div>
      <ValueChips
        values={values}
        onRemove={(id) => onChange(values.filter((value) => value.id !== id))}
      />
    </div>
  );
}
