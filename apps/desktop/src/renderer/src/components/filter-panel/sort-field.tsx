import type { JSX } from "react";
import {
  mediaTypeOf,
  sortOptions,
  type DiscoverFilters,
  type TitleKind,
} from "../../../../shared/types";
import Select from "../select";
import Field from "./field";

export default function SortField({
  titleKind,
  value,
  profileReady,
  onChange,
}: {
  titleKind: TitleKind;
  value: DiscoverFilters["sortBy"];
  profileReady?: boolean;
  onChange: (sortBy: DiscoverFilters["sortBy"]) => void;
}): JSX.Element {
  const options = sortOptions(Boolean(profileReady)).filter((option) =>
    mediaTypeOf(titleKind) === "tv" ? option.value !== "revenue.desc" : true,
  );
  return (
    <Field label="Sort">
      <Select
        value={value}
        ariaLabel="Sort"
        options={options}
        onChange={onChange}
      />
    </Field>
  );
}
