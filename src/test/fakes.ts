// Shared test fakes (house style: hand-rolled fakes at module boundaries —
// see TESTING.md). Imported only by unit tests; nothing in app code reaches
// here.

/** In-memory Storage fake double for the mv:* store boundary. */
export default function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => {
      map.clear();
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}
