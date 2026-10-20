import { normalize, OFF_FIELDS } from "@/lib/product";
import { additiveTaxonomy, ingredientTaxonomy, reply, take, takeUser, UA } from "@/lib/server";

const UPSTREAM_LIMIT = 15; // OFF: 15 product reads / minute / IP (this server's IP)
const USER_LIMIT = 10; // per visitor: 10 lookups / minute, cached or not
const FOUND_TTL = 6 * 3600_000;
const MISSING_TTL = 10 * 60_000;

// ponytail: in-memory cache + limiter, per server process; fine for one dev box or one instance
const cache = new Map<string, { at: number; ttl: number; status: number; body: object }>();
const upstream: number[] = [];

export async function GET(req: Request, ctx: RouteContext<"/api/product/[code]">) {
  const { code } = await ctx.params;
  if (!/^\d{8,14}$/.test(code)) return reply({ error: "Barcodes are 8 to 14 digits." }, 400);

  const wait = takeUser(req, "product", USER_LIMIT);
  if (wait) return reply({ error: "rate_limited", retryAfter: wait }, 429, { "Retry-After": String(wait) });

  const now = Date.now();
  const hit = cache.get(code);
  if (hit && now - hit.at < hit.ttl) return reply(hit.body, hit.status);

  const upWait = take(upstream, UPSTREAM_LIMIT, now);
  if (upWait) return reply({ error: "rate_limited", retryAfter: upWait }, 429, { "Retry-After": String(upWait) });

  const taxonomies = Promise.all([additiveTaxonomy(), ingredientTaxonomy()]); // load in parallel with the product
  let res: Response;
  try {
    res = await fetch(`https://world.openfoodfacts.org/api/v3/product/${code}.json?fields=${OFF_FIELDS}`, {
      headers: { "User-Agent": UA },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return reply({ error: "unreachable" }, 502);
  }

  const json = await res.json().catch(() => null);
  let entry: { status: number; body: object; ttl: number };
  if (res.status === 404 || json?.result?.id === "product_not_found") entry = { status: 404, body: { error: "not_found" }, ttl: MISSING_TTL };
  else if (res.ok && json?.product) {
    const [additives, ingredients] = await taxonomies;
    entry = { status: 200, body: { product: normalize(code, json.product, additives ?? {}, ingredients ?? {}) }, ttl: FOUND_TTL };
  } else return reply({ error: res.status === 429 || res.status === 503 ? "rate_limited" : "upstream" }, res.status === 429 ? 429 : 502);

  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  cache.set(code, { at: now, ...entry });
  return reply(entry.body, entry.status);
}
