import type { JSX } from "react";
import { rangeInputClass } from "../../lib/ui";
import Field from "./field";

export default function RatingSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (ratingMin: number) => void;
}): JSX.Element {
  return (
    <Field label={`Minimum rating ${value.toFixed(1)}`}>
      <div className="flex min-w-0 items-center gap-2">
        <input
          type="range"
          name="ratingMin"
          className={rangeInputClass}
          min={0}
          max={9}
          step={0.5}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    </Field>
  );
}
