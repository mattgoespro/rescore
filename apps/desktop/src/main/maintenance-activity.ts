import { closeSync, openSync } from "node:fs";

/** A sharing probe observes activity; the privileged worker still owns admission. */
export function maintenanceActivity(path: string): "idle" | "busy" | "unknown" {
  let handle: number | undefined;
  try {
    handle = openSync(path, "r");
    return "idle";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "idle";
    if (code === "EBUSY") return "busy";
    return "unknown";
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
}
