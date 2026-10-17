import { CATALOG_DB_PATH } from "../src/config.js";
import { CatalogDatabase } from "../src/services/catalog-db.js";
import { enrichPosters } from "../src/services/tmdb-posters.js";

const catalog = new CatalogDatabase(CATALOG_DB_PATH);

try {
  const result = await enrichPosters(catalog);
  console.log(
    `Poster lookup finished: ${result.found} found, ${result.missing} without artwork, ${result.errors} errors`,
  );
} finally {
  catalog.close();
}
