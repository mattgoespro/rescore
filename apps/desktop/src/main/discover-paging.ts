export function canLoadMoreFromPage(
  resultCount: number,
  pageSize: number,
  nextCursor: string | null,
): boolean {
  return resultCount >= pageSize && nextCursor !== null;
}
