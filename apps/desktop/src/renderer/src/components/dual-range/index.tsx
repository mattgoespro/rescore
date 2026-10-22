import { useState, type JSX } from "react";
import ThumbInput from "./thumb-input";
import Track from "./track";

type DualRangeProps = {
  min: number;
  max: number;
  step: number;
  valueMin: number;
  valueMax: number;
  minLabel?: string;
  maxLabel?: string;
  onChange: (nextMin: number, nextMax: number) => void;
};

export default function DualRange({
  min,
  max,
  step,
  valueMin,
  valueMax,
  minLabel,
  maxLabel,
  onChange,
}: DualRangeProps): JSX.Element {
  const [lastMoved, setLastMoved] = useState<"min" | "max">("min");
  const span = max - min || 1;
  const fillLeft = ((valueMin - min) / span) * 100;
  const fillWidth = ((valueMax - valueMin) / span) * 100;

  return (
    <div className="relative h-4">
      <Track fillLeft={fillLeft} fillWidth={fillWidth} />
      <ThumbInput
        min={min}
        max={max}
        step={step}
        value={valueMin}
        label={minLabel ?? "Minimum"}
        raised={lastMoved === "min"}
        onChange={(next) => {
          setLastMoved("min");
          onChange(Math.min(next, valueMax), valueMax);
        }}
      />
      <ThumbInput
        min={min}
        max={max}
        step={step}
        value={valueMax}
        label={maxLabel ?? "Maximum"}
        raised={lastMoved === "max"}
        onChange={(next) => {
          setLastMoved("max");
          onChange(valueMin, Math.max(next, valueMin));
        }}
      />
    </div>
  );
}
