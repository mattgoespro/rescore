import type { JSX } from "react";
import Field from "./field";

export default function QueryField({
  value,
  onChange,
}: {
  value: string;
  onChange: (query: string) => void;
}): JSX.Element {
  return (
    <Field label="Title or IMDb ID">
      <input
        type="text"
        name="titleQuery"
        autoComplete="off"
        value={value}
        placeholder="Heat, or tt0113277…"
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
