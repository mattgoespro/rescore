export interface TasteCache<T> {
  read(load: () => Promise<T>): Promise<T>;
  drop(): void;
}

export function createTasteCache<T>(): TasteCache<T> {
  let cached: T | null = null;
  let generation = 0;
  let inflight: Promise<T> | null = null;
  return {
    async read(load) {
      if (cached !== null) return cached;
      if (inflight) return inflight;
      const started = generation;
      const work = load().then((value) => {
        if (started === generation) cached = value;
        return value;
      });
      inflight = work;
      try {
        return await work;
      } finally {
        if (inflight === work) inflight = null;
      }
    },
    drop() {
      cached = null;
      inflight = null;
      generation++;
    },
  };
}

export async function withLibraryWrite<T>(
  cache: { drop(): void },
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } finally {
    cache.drop();
  }
}
