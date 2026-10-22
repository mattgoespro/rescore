import type { JSX } from "react";
import DualRange from "../dual-range";
import { RUNTIME_CEILING, RUNTIME_FLOOR, RUNTIME_STEP } from "./constants";
import { runtimeCaption } from "./captions";
import Field from "./field";

export default function RuntimeRange({
  label,
  runtimeMin,
  runtimeMax,
  onChange,
}: {
  label: string;
  runtimeMin: number | null;
  runtimeMax: number | null;
  onChange: (runtimeMin: number | null, runtimeMax: number | null) => void;
}): JSX.Element {
  return (
    <Field label={label} value={runtimeCaption(runtimeMin, runtimeMax)}>
      <DualRange
        min={RUNTIME_FLOOR}
        max={RUNTIME_CEILING}
        step={RUNTIME_STEP}
        valueMin={runtimeMin ?? RUNTIME_FLOOR}
        valueMax={runtimeMax ?? RUNTIME_CEILING}
        minLabel="Minimum runtime"
        maxLabel="Maximum runtime"
        onChange={(nextMin, nextMax) =>
          onChange(
            nextMin <= RUNTIME_FLOOR ? null : nextMin,
            nextMax >= RUNTIME_CEILING ? null : nextMax,
          )
        }
      />
    </Field>
  );
}
