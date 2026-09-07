import { join } from "node:path";
import {
  DATA_DIR,
  DATASET_FILE,
  DATASET_URL,
  IMDB_DATASETS_BASE,
} from "../config.js";
import { ensureGzipFile } from "../services/gzip-tsv.js";
import { reportDownload } from "./progress.js";

const TITLE_FILES = {
  basics: "title.basics.tsv.gz",
  crew: "title.crew.tsv.gz",
  principals: "title.principals.tsv.gz",
  names: "name.basics.tsv.gz",
} as const;

export interface TitleDumpFiles {
  ratings: string;
  basics: string;
}

export interface CreditDumpFiles {
  crew: string;
  principals: string;
  names: string;
}

export async function downloadTitleDumps(): Promise<TitleDumpFiles> {
  const dumps = [
    { key: "ratings" as const, name: DATASET_FILE, url: DATASET_URL },
    {
      key: "basics" as const,
      name: TITLE_FILES.basics,
      url: `${IMDB_DATASETS_BASE}/${TITLE_FILES.basics}`,
    },
  ];
  return downloadWave(dumps);
}

export async function downloadCreditDumps(): Promise<CreditDumpFiles> {
  const dumps = (
    ["crew", "principals", "names"] as const
  ).map((key) => ({
    key,
    name: TITLE_FILES[key],
    url: `${IMDB_DATASETS_BASE}/${TITLE_FILES[key]}`,
  }));
  return downloadWave(dumps);
}

async function downloadWave<K extends string>(
  dumps: Array<{ key: K; name: string; url: string }>,
): Promise<Record<K, string>> {
  const files = {} as Record<K, string>;
  await Promise.all(
    dumps.map(async (dump, index) => {
      const dest = join(DATA_DIR, dump.name);
      const fileIndex = index + 1;
      reportDownload({
        message: `Checking ${dump.name} (${fileIndex} of ${dumps.length})`,
      });
      files[dump.key] = await ensureGzipFile(dump.url, dest, false, (bytes) => {
        reportDownload({
          message: `Downloading ${dump.name} (${fileIndex} of ${dumps.length})`,
          download: {
            file: dump.name,
            fileIndex,
            fileCount: dumps.length,
            receivedBytes: bytes.receivedBytes,
            totalBytes: bytes.totalBytes,
          },
        });
      });
    }),
  );
  return files;
}
