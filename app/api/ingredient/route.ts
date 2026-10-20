import { ingredientTaxonomy, reply, take, takeUser, UA } from "@/lib/server";

const USER_LIMIT = 30; // per visitor: 30 ingredient explanations / minute
const UPSTREAM_LIMIT = 60; // this server: 60 Wikimedia lookups / minute
const TTL = 7 * 24 * 3600_000;

export type Explanation = { title: string; extract: string; url: string; about?: string } | { none: true };

// ponytail: in-memory cache, per server process
const cache = new Map<string, { at: number; body: Explanation }>();
const upstream: number[] = [];

const get = (url: string) =>
  fetch(url, { headers: { "User-Agent": UA }, cache: "no-store", signal: AbortSignal.timeout(8_000) }).then((r) =>
    r.ok ? r.json() : null,
  );

/** The ingredient's English Wikipedia title, walking up to broader ingredients ("skimmed milk powder" → "milk powder"). */
async function wikiTitle(id: string): Promise<{ title: string; about?: string } | null> {
  const tax = await ingredientTaxonomy();
  if (!tax?.[id]) return null;
  const chain: string[] = [];
  for (let level = [id], depth = 0; level.length && depth < 3 && chain.length < 12; depth++) {
    chain.push(...level.filter((x) => !chain.includes(x)));
    level = level.flatMap((x) => tax[x]?.parents ?? []);
  }
  const withQid = chain.filter((x) => tax[x]?.wikidata);
  if (!withQid.length) return null;
  const ids = withQid.map((x) => tax[x].wikidata).join("|");
  const data = await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids}&props=sitelinks&sitefilter=enwiki&format=json`);
  for (const x of withQid) {
    const title = data?.entities?.[tax[x].wikidata!]?.sitelinks?.enwiki?.title;
    if (title) return { title, about: x === id ? undefined : tax[x].name };
  }
  return null;
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const id = params.get("id") ?? "";
  const name = (params.get("name") ?? "").trim();
  if (!/^[a-z]{2,3}:\S/.test(id) || id.length > 100 || !name || name.length > 100)
    return reply({ error: "Bad ingredient." }, 400);

  const wait = takeUser(req, "ingredient", USER_LIMIT);
  if (wait) return reply({ error: "rate_limited", retryAfter: wait }, 429, { "Retry-After": String(wait) });

  const key = `${id}|${name.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return reply(hit.body, 200, {}, 86_400);

  const upWait = take(upstream, UPSTREAM_LIMIT);
  if (upWait) return reply({ error: "rate_limited", retryAfter: upWait }, 429, { "Retry-After": String(upWait) });

  let body: Explanation = { none: true };
  try {
    const found = (await wikiTitle(id)) ?? { title: name.replace(/\(.*?\)|\d+(\.\d+)?\s*%/g, "").trim() };
    const page = await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(found.title.replace(/ /g, "_"))}?redirect=true`);
    if (page?.type === "standard" && page.extract) {
      // First two sentences are plenty for "what is this?"
      const extract = (page.extract.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [page.extract]).slice(0, 2).join("").trim();
      body = { title: page.title, extract, url: page.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${page.title}`, about: found.about };
    }
  } catch {
    return reply({ error: "unreachable" }, 502);
  }

  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), body });
  return reply(body, 200, {}, 86_400);
}
