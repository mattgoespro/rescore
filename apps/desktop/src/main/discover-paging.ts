export function canLoadMoreFromPage(resultCount: number, pageSize: number): boolean {
  return resultCount >= pageSize;
}
