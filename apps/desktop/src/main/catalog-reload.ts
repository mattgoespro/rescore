export function shouldTerminateCatalogApi(input: {
  ownsApi: boolean;
}): boolean {
  return input.ownsApi;
}
