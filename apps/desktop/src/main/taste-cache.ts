export interface TasteCache<T> {
  read(load: () => Promise<T>): Promise<T>;
  drop(): void;
}

export function createTasteCache<T>(): TasteCache<T> {
  let cached: T | null = null;
  return {
    async read(load) {
      if (cached) return cached;
      cached = await load();
      return cached;
    },
    drop() {
      cached = null;
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
