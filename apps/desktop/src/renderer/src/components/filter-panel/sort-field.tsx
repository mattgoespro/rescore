import type { JSX } from "react";
import { SORT_OPTIONS, type DiscoverFilters } from "../../../../shared/types";
import Select from "../select";
import Field from "./field";

export default function SortField({
  value,
  onChange,
}: {
  value: DiscoverFilters["sortBy"];
  onChange: (sortBy: DiscoverFilters["sortBy"]) => void;
}): JSX.Element {
  return (
    <Field label="Sort">
      <Select
        value={value}
        ariaLabel="Sort"
        options={SORT_OPTIONS}
        onChange={onChange}
      />
    </Field>
  );
}
