import type { JSX } from "react";

export default function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="kicker">{label}</span>
      <span className="text-[22px] font-bold tracking-tighter tabular">
        {value}
      </span>
    </div>
  );
}
