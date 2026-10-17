import { cn } from "../../lib/cn";

export function inspectorClass(docked?: boolean): string {
  return cn(
    "max-h-[34vh] min-h-0 overflow-auto overscroll-contain border-t border-line bg-transparent p-0 inspect:max-h-none inspect:border-t-0 inspect:border-l",
    docked && "max-inspect:col-start-2 max-inspect:max-h-[34vh]",
  );
}
