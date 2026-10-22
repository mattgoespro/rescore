import type { JSX } from "react";
import DualRange from "../dual-range";
import { YEAR_CEILING, YEAR_FLOOR, YEAR_STEP } from "./constants";
import { yearCaption } from "./captions";
import Field from "./field";

export default function YearRange({
  yearMin,
  yearMax,
  onChange,
}: {
  yearMin: number | null;
  yearMax: number | null;
  onChange: (yearMin: number | null, yearMax: number | null) => void;
}): JSX.Element {
  return (
    <Field label="Years" value={yearCaption(yearMin, yearMax)}>
      <DualRange
        min={YEAR_FLOOR}
        max={YEAR_CEILING}
        step={YEAR_STEP}
        valueMin={yearMin ?? YEAR_FLOOR}
        valueMax={yearMax ?? YEAR_CEILING}
        minLabel="From year"
        maxLabel="To year"
        onChange={(nextMin, nextMax) =>
          onChange(
            nextMin <= YEAR_FLOOR ? null : nextMin,
            nextMax >= YEAR_CEILING ? null : nextMax,
          )
        }
      />
    </Field>
  );
}
