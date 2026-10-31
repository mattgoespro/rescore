import { z } from "zod";

/**
 * A repeated or comma-separated query value as a trimmed list, or undefined
 * when it holds nothing. `split: false` keeps commas inside a value, for
 * names, so only repeating the parameter makes a list.
 */
export function queryList<T extends z.ZodTypeAny>(
  item: T,
  max: number,
  normalize: (value: string) => string = (value) => value,
  options: { split?: boolean } = {},
) {
  const split = options.split ?? true;
  return z.preprocess((value) => {
    if (value == null || value === "") return undefined;
    const list = Array.isArray(value)
      ? value
      : split
        ? String(value).split(",")
        : [String(value)];
    const items = list
      .map((entry) => normalize(String(entry).trim()))
      .filter(Boolean);
    return items.length ? items : undefined;
  }, z.array(item).max(max).optional());
}
