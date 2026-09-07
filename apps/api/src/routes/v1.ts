import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { CatalogDatabase } from "../services/catalog-db.js";
import { catalogStatus, ensureCatalog, isCatalogBuilding } from "../services/ensure-catalog.js";
import { syncDataset } from "../services/dataset.js";
import type { RatingsStore } from "../services/ratings-store.js";
import { mediaHandler } from "./media.js";
import { forYouHandler } from "./for-you.js";
import {
  enrichOneTitle,
  isPosterEnrichmentRunning,
  startPosterEnrichment,
} from "../services/tmdb-posters.js";

const titleId = z.string().regex(/^tt\d+$/i, "Must be an IMDb title id").transform((id) => id.toLowerCase());
const optionalInteger = (min: number, max: number) => z.coerce.number().int().min(min).max(max).optional();
const optionalBoolean = z.enum(["true", "false"]).transform((value) => value === "true").optional();
const listQuery = z.object({
  page: optionalInteger(1, 100000).default(1),
  pageSize: optionalInteger(1, 100).default(25),
  limit: optionalInteger(1, 100),
  sort: z.enum(["title", "year", "rating", "votes", "updatedAt"]).default("title"),
  order: z.enum(["asc", "desc"]).default("asc"),
  query: z.string().trim().min(1).max(200).optional(),
  genre: z.preprocess((value) => {
    if (value == null || value === "") return undefined;
    const list = Array.isArray(value) ? value : String(value).split(",");
    const genres = list.map((item) => String(item).trim()).filter(Boolean);
    return genres.length ? genres : undefined;
  }, z.array(z.string().trim().min(1).max(60)).max(30).optional()),
  kind: z.string().trim().min(1).max(40).optional(),
  yearMin: optionalInteger(1870, 3000),
  yearMax: optionalInteger(1870, 3000),
  ratingMin: z.coerce.number().min(0).max(10).optional(),
  votesMin: optionalInteger(0, 2_000_000_000),
  runtimeMin: optionalInteger(1, 2000),
  runtimeMax: optionalInteger(1, 2000),
  hideWatched: optionalBoolean,
  hideWatchlist: optionalBoolean,
  includeTotal: optionalBoolean,
}).strict().refine((value) => !value.yearMin || !value.yearMax || value.yearMin <= value.yearMax, { message: "yearMin must be less than or equal to yearMax" }).transform(({ limit, genre, ...query }) => ({
  ...query,
  pageSize: limit ?? query.pageSize,
  genres: genre,
  includeTotal: query.includeTotal ?? true,
}));

const manifestTitle = z.object({
  id: titleId,
  title: z.string().trim().min(1).max(500),
  originalTitle: z.string().trim().min(1).max(500).nullable().optional(),
  kind: z.string().trim().min(1).max(40).optional(),
  year: z.number().int().min(1870).max(3000).nullable().optional(),
  runtimeMinutes: z.number().int().min(1).max(2000).nullable().optional(),
  synopsis: z.string().trim().max(10000).nullable().optional(),
  posterUrl: z.string().url().max(2000).nullable().optional(),
  genres: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  directors: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  cast: z.array(z.string().trim().min(1).max(200)).max(500).optional(),
}).strict();

// The licensed bundle format is deliberately provider-neutral and versioned.
const catalogManifest = z.object({
  version: z.literal(1),
  titles: z.array(manifestTitle).min(1).max(50_000),
}).strict().superRefine((manifest, context) => {
  const seen = new Set<string>();
  manifest.titles.forEach((title, index) => {
    if (seen.has(title.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["titles", index, "id"], message: "Duplicate title id" });
    seen.add(title.id);
  });
});

const libraryBody = z.object({
  status: z.enum(["watched", "watchlist", "skipped"]),
  personalRating: z.number().min(0).max(10).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
}).strict().refine((body) => body.status !== "watched" || body.personalRating === undefined || body.personalRating !== null, { message: "Watched titles require a personalRating when provided" });

export function v1Router(db: CatalogDatabase, ratings: RatingsStore): Router {
  const router = Router();
  router.get("/titles", (req, res) => res.json(db.listTitles(listQuery.parse(req.query))));
  router.get("/titles/:id", async (req, res, next) => {
    try {
      const id = titleId.parse(req.params.id);
      let title = db.title(id);
      if (!title) return res.status(404).json({ error: "Title not found" });
      if (db.titleNeedsMedia(id)) {
        await enrichOneTitle(db, title.id, title.kind);
        title = db.title(id) ?? title;
      }
      return res.json({ data: title });
    } catch (error) {
      return next(error);
    }
  });
  router.get("/facets", (_req, res) => res.json(db.facets()));
  router.get("/for-you", forYouHandler(db));
  router.get("/media", mediaHandler);

  router.post("/catalog/rebuild", (req, res) => {
    z.object({ force: z.boolean().optional() }).strict().parse(
      req.body && typeof req.body === "object" ? req.body : {},
    );
    if (isCatalogBuilding()) {
      return res.status(409).json({ error: "A catalog rebuild is already in progress." });
    }
    void ensureCatalog(db, { force: true })
      .then(async () => {
        await syncDataset(ratings, true).catch((error: unknown) => {
          console.warn("Ratings sync after catalog rebuild failed.", error);
        });
        void startPosterEnrichment(db);
      })
      .catch((error: unknown) => {
        console.error("Catalog rebuild failed.", error);
      });
    return res.status(202).json({ ok: true, ...catalogStatus() });
  });

  router.post("/catalog/enrich-posters", (req, res) => {
    const body = z
      .object({
        ids: z.array(titleId).max(400).optional(),
        extraPages: z.number().int().min(0).max(5).optional(),
        page: optionalInteger(1, 100000),
        pageSize: optionalInteger(1, 100),
        limit: optionalInteger(1, 100),
        sort: z.enum(["title", "year", "rating", "votes", "updatedAt"]).optional(),
        order: z.enum(["asc", "desc"]).optional(),
        query: z.string().trim().min(1).max(200).optional(),
        genre: z.union([z.string(), z.array(z.string())]).optional(),
        kind: z.string().trim().min(1).max(40).optional(),
        yearMin: optionalInteger(1870, 3000),
        yearMax: optionalInteger(1870, 3000),
        ratingMin: z.coerce.number().min(0).max(10).optional(),
        votesMin: optionalInteger(0, 2_000_000_000),
        runtimeMin: optionalInteger(1, 2000),
        runtimeMax: optionalInteger(1, 2000),
        hideWatched: z.boolean().optional(),
        hideWatchlist: z.boolean().optional(),
      })
      .strict()
      .parse(req.body && typeof req.body === "object" ? req.body : {});
    const ids = [...(body.ids ?? [])];
    if ((body.extraPages ?? 0) > 0 && body.page) {
      const lookAhead = listQuery.parse({
        page: body.page,
        pageSize: body.pageSize ?? body.limit ?? 40,
        sort: body.sort,
        order: body.order,
        query: body.query,
        genre: body.genre,
        kind: body.kind,
        yearMin: body.yearMin,
        yearMax: body.yearMax,
        ratingMin: body.ratingMin,
        votesMin: body.votesMin,
        runtimeMin: body.runtimeMin,
        runtimeMax: body.runtimeMax,
        hideWatched: body.hideWatched === undefined ? undefined : body.hideWatched ? "true" : "false",
        hideWatchlist: body.hideWatchlist === undefined ? undefined : body.hideWatchlist ? "true" : "false",
        includeTotal: "false",
      });
      for (let page = lookAhead.page + 1; page <= lookAhead.page + (body.extraPages ?? 0); page += 1) {
        ids.push(...db.listTitleIds({ ...lookAhead, page, includeTotal: false }));
      }
    }
    void startPosterEnrichment(db, { ids });
    return res.status(202).json({ ok: true, running: isPosterEnrichmentRunning() });
  });

  router.get("/library", (req, res) => {
    const { status } = z.object({ status: z.enum(["watched", "watchlist", "skipped"]).optional() }).strict().parse(req.query);
    res.json({ data: db.listLibrary(status) });
  });
  router.put("/library/:id", (req, res) => {
    const entry = db.saveLibrary(titleId.parse(req.params.id), ...toLibraryArgs(libraryBody.parse(req.body)));
    if (!entry) return res.status(404).json({ error: "Title not found" });
    return res.json({ data: entry });
  });
  router.delete("/library/:id", (req, res) => {
    if (!db.deleteLibrary(titleId.parse(req.params.id))) return res.status(404).json({ error: "Library entry not found" });
    return res.status(204).end();
  });

  router.post("/imports/catalog", (req, res) => {
    const manifest = catalogManifest.parse(req.body);
    const id = randomUUID();
    db.createImport(id, "catalog");
    try {
      const importedTitles = db.upsertTitles(manifest.titles);
      db.upsertRatings(ratings.forIds(manifest.titles.map((title) => title.id)));
      db.finishImport(id, "completed", importedTitles);
    } catch (error) {
      db.finishImport(id, "failed", 0, error instanceof Error ? error.message : "Import failed");
      throw error;
    }
    return res.status(201).json({ data: db.importStatus(id) });
  });
  router.get("/imports/:id", (req, res) => {
    const result = db.importStatus(z.string().uuid().parse(req.params.id));
    if (!result) return res.status(404).json({ error: "Import not found" });
    return res.json({ data: result });
  });
  return router;
}

function toLibraryArgs(body: z.infer<typeof libraryBody>): [z.infer<typeof libraryBody>["status"], number | null, string | null] {
  return [body.status, body.personalRating ?? null, body.note ?? null];
}
