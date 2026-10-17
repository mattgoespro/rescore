import type { JSX } from "react";
import { cn } from "../../lib/cn";
import { dualInput } from "./styles";

export default function ThumbInput({
  min,
  max,
  step,
  value,
  label,
  raised,
  onChange,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  label: string;
  raised: boolean;
  onChange: (next: number) => void;
}): JSX.Element {
  return (
    <input
      type="range"
      name={label?.toLowerCase().replaceAll(" ", "-")}
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      className={cn(dualInput, raised && "z-2")}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}
