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
    <Field label={`Minimum votes ${value}`}>
      <div className="flex min-w-0 items-center gap-2">
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
      </div>
    </Field>
  );
}
