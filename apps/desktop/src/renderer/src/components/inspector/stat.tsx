import type { JSX } from "react";

export default function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div>
      <small className="mb-1 block text-[10px] tracking-[0.12em] text-faint uppercase">
        {label}
      </small>
      <b className="text-[22px] tracking-tighter tabular">{value}</b>
    </div>
  );
}
