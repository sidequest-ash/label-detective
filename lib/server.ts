import { parseTaxonomy, type AdditiveTaxonomy } from "./product";

// Open Food Facts and Wikimedia both ask apps to identify themselves: "AppName/Version (ContactEmail)".
export const UA = process.env.OFF_USER_AGENT ?? "LabelDetective/0.1 (sidequest; set OFF_USER_AGENT in .env.local)";

/** Sliding one-minute window. Returns seconds to wait, or 0 and records the hit. */
export function take(hits: number[], limit: number, now = Date.now()) {
  while (hits.length && now - hits[0] > 60_000) hits.shift();
  if (hits.length >= limit) return Math.ceil((60_000 - (now - hits[0])) / 1000);
  hits.push(now);
  return 0;
}

// ponytail: users map grows by one small array per visitor IP; prune if this ever serves real traffic
const users = new Map<string, Map<string, number[]>>();
/** Per-visitor limit, keyed by bucket ("product", "ingredient"). */
export function takeUser(req: Request, bucket: string, limit: number) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (!users.has(ip)) users.set(ip, new Map());
  const buckets = users.get(ip)!;
  if (!buckets.has(bucket)) buckets.set(bucket, []);
  return take(buckets.get(bucket)!, limit);
}

export const reply = (body: object, status: number, headers: HeadersInit = {}, maxAge = 3600) =>
  Response.json(body, { status, headers: { "Cache-Control": status === 200 ? `private, max-age=${maxAge}` : "no-store", ...headers } });

/** A static Open Food Facts taxonomy file, fetched once a day and shared by all lookups. */
function taxonomy<T>(file: string, parse: (raw: Record<string, unknown>) => T) {
  let entry: { at: number; data: Promise<T | null> } | undefined;
  return () => {
    if (!entry || Date.now() - entry.at > 24 * 3600_000) {
      const data = fetch(`https://static.openfoodfacts.org/data/taxonomies/${file}`, {
        headers: { "User-Agent": UA },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then(parse)
        .catch(() => {
          entry = undefined; // retry on the next lookup; callers work without it
          return null;
        });
      entry = { at: Date.now(), data };
    }
    return entry.data;
  };
}

export const additiveTaxonomy = taxonomy<AdditiveTaxonomy>("additives.json", parseTaxonomy);

export type IngredientTaxonomy = Record<string, { name?: string; wikidata?: string; parents?: string[] }>;

export const ingredientTaxonomy = taxonomy<IngredientTaxonomy>("ingredients.json", (raw) => {
  const out: IngredientTaxonomy = {};
  for (const [id, v] of Object.entries(raw as Record<string, { name?: { en?: string }; wikidata?: { en?: string }; parents?: string[] }>))
    out[id] = { name: v.name?.en, wikidata: v.wikidata?.en, parents: v.parents };
  return out;
});
