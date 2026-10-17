import { CATALOG_DB_PATH } from "../src/config.js";
import { buildCatalog } from "../src/services/catalog-builder.js";
import { CatalogDatabase } from "../src/services/catalog-db.js";

const force = process.argv.includes("--force");
const catalog = new CatalogDatabase(CATALOG_DB_PATH);

try {
  const result = await buildCatalog(catalog, { force });
  console.log(
    `Built ${result.titleCount.toLocaleString()} titles at ${result.builtAt}`,
  );
} finally {
  catalog.close();
}
