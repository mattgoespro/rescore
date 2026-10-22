import type { JSX } from "react";
import { rangeInputClass } from "../../lib/ui";
import Field from "./field";

export default function VotesSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (voteCountMin: number) => void;
}): JSX.Element {
  return (
    <Field label="Minimum votes" value={`${value.toLocaleString()}+`}>
      <input
        type="range"
        name="voteCountMin"
        className={rangeInputClass}
        min={0}
        max={5000}
        step={50}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}
