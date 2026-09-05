// Tiny in-memory TTL cache with single-flight de-duplication.
const store = new Map(); // key -> { value, expires }
const inflight = new Map(); // key -> Promise

export function cacheGet(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expires !== 0 && Date.now() > hit.expires) {
    store.delete(key);
    return undefined;
  }
  return hit.value;
}

export function cacheSet(key, value, ttlMs) {
  store.set(key, { value, expires: ttlMs === Infinity ? 0 : Date.now() + ttlMs });
}

// Fetch-through helper: returns cached value or runs loader once (dedupes concurrent calls).
export async function cached(key, ttlMs, loader) {
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const value = await loader();
      cacheSet(key, value, ttlMs);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

// TTL policy: past days rarely change, future days change often.
export function ttlForDate(isoDate) {
  const today = etTodayISO();
  if (isoDate < today) return 24 * 60 * 60 * 1000; // 24h
  if (isoDate === today) return 5 * 60 * 1000; // 5 min
  return 30 * 60 * 1000; // 30 min for the future
}

export function etTodayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
