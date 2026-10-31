import type { Request, Response } from "express";
import { z } from "zod";
import type { ForYouResponse } from "../catalog-types.js";
import type { CatalogDatabase } from "../services/catalog-db.js";
import { queryList } from "./query-list.js";

const query = z
  .object({
    limit: z.coerce.number().int().min(1).max(120).default(80),
    // What the user's ratings favour; each widens the candidates past the
    // most-voted titles.
    genre: queryList(z.string().min(1).max(60), 6),
    director: queryList(z.string().min(1).max(200), 6, undefined, {
      split: false,
    }),
    decade: queryList(
      z.coerce
        .number()
        .int()
        .min(1870)
        .max(2100)
        .refine(
          (year) => year % 10 === 0,
          "Must be the first year of a decade",
        ),
      5,
    ),
  })
  .strict();

export function forYouHandler(db: CatalogDatabase) {
  return (req: Request, res: Response): void => {
    const { limit, genre, director, decade } = query.parse(req.query);
    const body: ForYouResponse = {
      library: db.listLibrary(),
      facets: db.facets(),
      candidates: db.listForYouCandidates(limit, {
        genres: genre,
        directors: director,
        decades: decade,
      }),
    };
    res.json(body);
  };
}
