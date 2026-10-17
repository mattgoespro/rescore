import { CATALOG_DB_PATH } from "../src/config.js";
import { CatalogDatabase } from "../src/services/catalog-db.js";

new CatalogDatabase(CATALOG_DB_PATH);
console.log(`Catalog migrations applied: ${CATALOG_DB_PATH}`);
