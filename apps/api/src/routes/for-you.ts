import type { Request, Response } from "express";
import { z } from "zod";
import type { ForYouResponse } from "../catalog-types.js";
import type { CatalogDatabase } from "../services/catalog-db.js";

const query = z.object({
  limit: z.coerce.number().int().min(1).max(120).default(80),
});

export function forYouHandler(db: CatalogDatabase) {
  return (req: Request, res: Response): void => {
    const { limit } = query.parse(req.query);
    const body: ForYouResponse = {
      library: db.listLibrary(),
      facets: db.facets(),
      candidates: db.listForYouCandidates(limit),
    };
    res.json(body);
  };
}
