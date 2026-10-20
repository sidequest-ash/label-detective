"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, MotionConfig, useReducedMotion } from "motion/react";
import {
  ALLERGENS, allergenLabel, allergyHits, compare, explain, fmt, headline, LIMITS, limitLine, NUTRIENTS,
  type Additive, type Ingredient, type Product,
} from "@/lib/product";
import type { Explanation } from "@/app/api/ingredient/route";
import { BarcodeIcon, MoonIcon, PlusIcon, SunIcon, WarningIcon } from "@phosphor-icons/react";
import Scanner from "./Scanner";

type View = { k: "home" } | { k: "product"; p: Product } | { k: "compare"; a: Product; b: Product };

// Views live in the URL (?p=code, ?a=code&b=code) so refresh, Back and shared links work.
const urlFor = (v: View) => (v.k === "product" ? `?p=${v.p.code}` : v.k === "compare" ? `?a=${v.a.code}&b=${v.b.code}` : location.pathname);
const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const EASE = [0.16, 1, 0.3, 1] as const;
const SAMPLES = [
  { code: "3017624010701", label: "Nutella" },
  { code: "5449000000996", label: "Coca-Cola" },
  { code: "5449000131805", label: "Coke Zero" },
  { code: "7622210449283", label: "Prince biscuits" },
];

const PER_MINUTE = 10; // matches the server's per-visitor limit
const searches: number[] = []; // timestamps of lookups sent to the API this session

// Browser storage: per-viewer history that doubles as a lookup cache.
const load = <T,>(k: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? "") as T;
  } catch {
    return fallback;
  }
};
const save = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

export default function LabelDetective() {
  const [view, setView] = useState<View>({ k: "home" });
  const [first, setFirst] = useState<Product | null>(null); // picked as A, waiting for B
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<React.ReactNode>(null);
  const [recent, setRecent] = useState<Product[]>([]);
  const [pairs, setPairs] = useState<[string, string][]>([]);
  const [allergies, setAllergies] = useState<string[]>([]);
  const request = useRef(0); // only the latest lookup may change the view

  const navigated = useRef(false); // focus the new view once it mounts, but not on first load

  const go = (v: View, how: "push" | "replace" = "push", url = urlFor(v)) => {
    navigated.current = true;
    setView(v);
    history[how === "push" ? "pushState" : "replaceState"](null, "", url);
  };

  useEffect(() => {
    setRecent(load("ld:products", []));
    setPairs(load("ld:pairs", []));
    setAllergies(load("ld:allergies", []));
    // The URL is the source of truth for the view and for a pending product A (?with=code).
    const fromUrl = async (e?: PopStateEvent) => {
      const q = new URLSearchParams(location.search);
      const id = ++request.current; // supersedes any lookup in flight
      const [p, a, b, w] = [q.get("p"), q.get("a"), q.get("b"), q.get("with")];
      if (e) navigated.current = true;
      setError(null);
      setBusy(Boolean(p || (a && b) || w));
      let next: View = { k: "home" };
      let pending: Product | null = null;
      if (p) {
        const found = await lookup(p, id);
        if (found) next = { k: "product", p: found };
      } else if (a && b) {
        const [pa, pb] = await Promise.all([lookup(a, id), lookup(b, id)]);
        if (pa && pb) next = { k: "compare", a: pa, b: pb };
      } else if (w) pending = await lookup(w, id);
      if (id !== request.current) return;
      setBusy(false);
      setFirst(pending);
      setView(next);
    };
    fromUrl();
    addEventListener("popstate", fromUrl);
    return () => removeEventListener("popstate", fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
  }, [view]);

  const remember = (p: Product) =>
    setRecent((r) => {
      const next = [p, ...r.filter((x) => x.code !== p.code)].slice(0, 24);
      save("ld:products", next);
      return next;
    });

  const toggleAllergy = (tag: string) =>
    setAllergies((r) => {
      const next = r.includes(tag) ? r.filter((t) => t !== tag) : [...r, tag];
      save("ld:allergies", next);
      return next;
    });

  const rememberPair = (a: string, b: string) =>
    setPairs((r) => {
      const next = [[a, b] as [string, string], ...r.filter(([x, y]) => !(x === a && y === b))].slice(0, 8);
      save("ld:pairs", next);
      return next;
    });

  /** `id` is the request this lookup belongs to; a superseded request must not touch the error message. */
  async function lookup(code: string, id: number): Promise<Product | null> {
    const fail = (msg: React.ReactNode) => id === request.current && setError(msg);
    // ponytail: saved products never refresh; clear history to pick up OFF edits
    // Read storage, not state: popstate and URL loads run from a closure made on first render.
    const local = load<Product[]>("ld:products", []).find((p) => p.code === code);
    if (local?.parts) return local;
    const now = Date.now();
    while (searches.length && now - searches[0] > 60_000) searches.shift();
    if (searches.length >= PER_MINUTE) {
      fail(`That's ${PER_MINUTE} lookups this minute. Try again in ${Math.ceil((60_000 - (now - searches[0])) / 1000)} s (saved products still open).`);
      return null;
    }
    searches.push(now);
    // ?v= changes whenever the Product shape does, so browsers drop responses cached in the old shape.
    const res = await fetch(`/api/product/${code}?v=3`).catch(() => null);
    const json = await res?.json().catch(() => null);
    if (res?.ok && json?.product) return json.product;
    fail(
      res?.status === 404 ? (
        <>
          No product found for {code}. It may not be in Open Food Facts yet; anyone can{" "}
          <a href="https://world.openfoodfacts.org/contribute" target="_blank" rel="noreferrer" className="underline underline-offset-2">
            add it
          </a>
          .
        </>
      )
        : res?.status === 400
          ? json.error
          : res?.status === 429
            ? `Lookup limit reached (${PER_MINUTE} a minute). Try again in ${json?.retryAfter ?? 60} s.`
            : "Couldn't reach Open Food Facts. Check your connection.",
    );
    return null;
  }

  async function open(raw: string) {
    const code = raw.replace(/\D/g, "");
    setError(null);
    setScanning(false);
    if (!/^\d{8,14}$/.test(code)) return setError("Barcodes are 8 to 14 digits.");
    const id = ++request.current;
    setBusy(true);
    const p = await lookup(code, id);
    if (id !== request.current) return; // a newer lookup started meanwhile
    setBusy(false);
    if (!p) return;
    remember(p);
    if (first && first.code !== p.code) {
      go({ k: "compare", a: first, b: p });
      rememberPair(first.code, p.code);
      setFirst(null);
    } else {
      setFirst(null);
      go({ k: "product", p });
    }
  }

  const openPair = async (a: string, b: string) => {
    setError(null);
    const id = ++request.current;
    setBusy(true);
    const [pa, pb] = await Promise.all([lookup(a, id), lookup(b, id)]); // refetches saved products in an old shape
    if (id !== request.current) return;
    setBusy(false);
    if (!pa || !pb) return;
    remember(pb);
    remember(pa);
    go({ k: "compare", a: pa, b: pb });
  };

  const closeScanner = useCallback(() => setScanning(false), []);
  const home = () => {
    request.current++; // drop any lookup still in flight
    setBusy(false);
    setFirst(null);
    go({ k: "home" });
  };
  const startCompare = (p: Product) => {
    setFirst(p);
    go({ k: "home" }, "push", `?with=${p.code}`);
  };
  const cancelCompare = () => {
    request.current++; // a product B still loading must not open the cancelled comparison
    setBusy(false);
    setFirst(null);
    history.replaceState(null, "", location.pathname);
  };

  return (
    <MotionConfig reducedMotion="user">
    <div className="mx-auto min-h-dvh max-w-5xl px-4 pb-24 sm:px-8">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-canvas">
        Skip to content
      </a>
      <div inert={scanning}>
      <header className="sticky top-0 z-20 -mx-4 flex items-center justify-between bg-canvas/80 px-4 py-4 backdrop-blur-xl sm:-mx-8 sm:px-8">
        <button onClick={home} className="font-mono text-[11px] uppercase tracking-[0.25em]">
          Label Detective
        </button>
        <ThemeToggle />
      </header>

      <AnimatePresence mode="wait">
        <motion.main
          ref={(el: HTMLElement | null) => {
            if (el && navigated.current) {
              navigated.current = false;
              el.focus({ preventScroll: true });
            }
          }}
          id="main"
          tabIndex={-1}
          className="outline-none"
          key={view.k === "home" ? "home" : view.k === "product" ? view.p.code : `${view.a.code}-${view.b.code}`}
          initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -16, filter: "blur(6px)" }}
          transition={{ duration: 0.55, ease: EASE }}
        >
          {view.k === "home" && (
            <Home
              first={first}
              busy={busy}
              error={error}
              recent={recent}
              pairs={pairs}
              onSubmit={open}
              onScan={() => setScanning(true)}
              onCancelCompare={cancelCompare}
              onPair={openPair}
              allergies={allergies}
              onToggleAllergy={toggleAllergy}
            />
          )}
          {view.k === "product" && <ProductView p={view.p} allergies={allergies} onCompare={() => startCompare(view.p)} onBack={home} />}
          {view.k === "compare" && (
            <CompareView a={view.a} b={view.b} allergies={allergies} onSwap={() => go({ k: "compare", a: view.b, b: view.a }, "replace")} onBack={home} />
          )}
        </motion.main>
      </AnimatePresence>

      <Footer />
      </div>

      <AnimatePresence>{scanning && <Scanner onCode={open} onClose={closeScanner} />}</AnimatePresence>
    </div>
    </MotionConfig>
  );
}

/* ───────────────────────── Home ───────────────────────── */

function Home(props: {
  first: Product | null;
  busy: boolean;
  error: React.ReactNode;
  recent: Product[];
  pairs: [string, string][];
  onSubmit: (code: string) => void;
  onScan: () => void;
  onCancelCompare: () => void;
  onPair: (a: string, b: string) => void;
  allergies: string[];
  onToggleAllergy: (tag: string) => void;
}) {
  const { first, busy, error, recent, pairs } = props;
  const [code, setCode] = useState("");
  const name = (c: string) => recent.find((p) => p.code === c)?.name ?? c;

  return (
    <section className="pt-10 sm:pt-20">
      <AnimatePresence>
        {first && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mb-8 flex items-center gap-4 rounded-2xl border border-line bg-card p-3">
              <Thumb p={first} size="h-14 w-14" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-mute">Comparing with</p>
                <p className="truncate">{first.name}</p>
              </div>
              <button onClick={props.onCancelCompare} className="px-3 text-sm text-mute hover:text-ink">
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <h1 className="max-w-[9ch] text-[clamp(3rem,13vw,7rem)] font-semibold leading-[0.92] tracking-[-0.05em]">
        {first ? (
          <>
            Now the <span className="font-light text-mute">other one.</span>
          </>
        ) : (
          <>
            Read the <span className="font-light text-mute">label.</span>
          </>
        )}
      </h1>
      <p className="mt-6 max-w-md text-lg leading-snug text-mute">
        {first
          ? "Scan or type a second barcode to put the two side by side, using the units on each label."
          : "Scan a barcode. See what's inside, in plain words. Compare two products on equal terms."}
      </p>

      <div className="mt-10 grid gap-3 sm:grid-cols-[1fr_auto]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            props.onSubmit(code);
          }}
          className="flex items-center rounded-full border border-line bg-card pl-5 focus-within:border-ink/50"
        >
          <label htmlFor="code" className="sr-only">
            Barcode number
          </label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Barcode number"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
            className="tabular h-14 min-w-0 flex-1 bg-transparent font-mono text-lg tracking-wider outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-mute"
          />
          <button
            disabled={busy || !code.trim()}
            className="m-1.5 h-11 rounded-full bg-ink px-5 font-medium text-canvas transition disabled:opacity-30"
          >
            {busy ? <Dots /> : "Look up"}
          </button>
        </form>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={props.onScan}
          className="flex h-14 items-center justify-center gap-3 rounded-full border border-ink px-7 font-medium"
        >
          <BarcodeIcon size={22} weight="bold" aria-hidden /> Scan barcode
        </motion.button>
      </div>

      <AnimatePresence>
        {error && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-4 text-sm text-ink/80"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="mt-8 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm text-mute">Try a sample</span>
        {SAMPLES.map((s) => (
          <button
            key={s.code}
            onClick={() => props.onSubmit(s.code)}
            disabled={busy}
            className="rounded-full border border-line px-3.5 py-1.5 text-sm text-mute transition hover:border-ink/40 hover:text-ink disabled:opacity-40"
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="mt-16">
        <div className="flex items-baseline justify-between">
          <Eyebrow>Your allergies</Eyebrow>
          <span className="text-xs text-mute">Saved on this device only</span>
        </div>
        <p className="mt-2 text-sm text-mute">
          Products that contain, or may contain, one of these get a warning. Warnings only cover what the product&apos;s record
          lists, so no warning doesn&apos;t mean it&apos;s safe for you. Always read the pack.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {ALLERGENS.map(({ tag, label }) => {
            const on = props.allergies.includes(tag);
            return (
              <motion.button
                key={tag}
                whileTap={{ scale: 0.94 }}
                aria-pressed={on}
                onClick={() => props.onToggleAllergy(tag)}
                className={`rounded-full border px-3.5 py-1.5 text-sm transition ${on ? "border-ink bg-ink text-canvas" : "border-line text-mute hover:text-ink"}`}
              >
                {label}
              </motion.button>
            );
          })}
        </div>
      </div>

      {recent.length > 0 && (
        <div className="mt-20">
          <Eyebrow>Recently looked up</Eyebrow>
          <div className="-mx-4 mt-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:-mx-8 sm:px-8">
            {recent.map((p, i) => (
              <motion.button
                key={p.code}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, ease: EASE, duration: 0.5 }}
                whileHover={{ y: -4 }}
                onClick={() => props.onSubmit(p.code)}
                disabled={busy}
                className="w-36 shrink-0 snap-start text-left disabled:opacity-40"
              >
                <Thumb p={p} size="aspect-square w-full" />
                <p className="mt-2 truncate text-sm">{p.name}</p>
                <p className="truncate text-xs text-mute">{p.brand || p.quantity || p.code}</p>
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {pairs.length > 0 && (
        <div className="mt-14">
          <Eyebrow>Recent comparisons</Eyebrow>
          <ul className="mt-4 grid gap-2">
            {pairs.map(([a, b]) => (
              <li key={a + b}>
                <button onClick={() => props.onPair(a, b)} disabled={busy} className="flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-4 text-left transition active:scale-[0.99] disabled:opacity-40">
                  <span className="min-w-0 flex-1 truncate">{name(a)}</span>
                  <span className="text-sm text-mute">vs</span>
                  <span className="min-w-0 flex-1 truncate text-right">{name(b)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ───────────────────────── Product ───────────────────────── */

function ProductView({ p, allergies, onCompare, onBack }: { p: Product; allergies: string[]; onCompare: () => void; onBack: () => void }) {
  const line = headline(p);
  const rows = NUTRIENTS.filter((m) => !m.optional || p.n[m.key] !== undefined);
  const listed = rows.filter((m) => p.n[m.key] !== undefined).length;
  const limitNotes = rows.filter((m) => LIMITS[m.key] && p.n[m.key] !== undefined).map((m) => LIMITS[m.key]!.note);

  return (
    <article className="pt-6">
      <AllergyWarning p={p} allergies={allergies} />

      <div className="mt-6 grid gap-8 sm:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] sm:items-end">
        <motion.div
          initial={{ scale: 0.92, rotate: -2, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ duration: 0.8, ease: EASE }}
          className="order-2 sm:order-none"
        >
          <Thumb p={p} size="mx-auto aspect-[4/3] max-h-[38vh] w-full sm:aspect-[4/5] sm:max-h-none" big />
        </motion.div>
        <div className="order-1 sm:order-none">
          <p className="text-sm text-mute">{[p.brand, p.quantity].filter(Boolean).join(", ") || "Product"}</p>
          <h1 className="mt-3 text-[clamp(2.6rem,9vw,5.5rem)] font-semibold leading-[0.92] tracking-[-0.045em]">{p.name}</h1>
          <p className="tabular mt-4 font-mono text-xs tracking-[0.2em] text-mute">{p.code}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={onCompare}
              className="h-12 rounded-full bg-ink px-6 font-medium text-canvas"
            >
              Compare with another
            </motion.button>
            <button onClick={onBack} className="h-12 rounded-full border border-line px-6 text-mute hover:text-ink">
              New lookup
            </button>
          </div>
        </div>
      </div>

      {line && (
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.7, ease: EASE }}
          className="mt-20 max-w-3xl text-[clamp(2rem,6.5vw,3.6rem)] font-medium leading-[1.05] tracking-[-0.035em]"
        >
          {line}
        </motion.p>
      )}

      <section className="mt-14">
        <div className="flex items-baseline justify-between border-b border-line pb-3">
          <Eyebrow>Nutrition per {p.basis === "100ml" ? "100 ml" : "100 g"}</Eyebrow>
          <span className="text-sm text-mute">
            {listed} of {rows.length} listed
          </span>
        </div>
        {listed === 0 && (
          <p className="py-8 text-mute">This product&apos;s record has no nutrition values yet. The pack itself will have them.</p>
        )}
        <ul>
          {rows.map((m, i) => {
            const v = p.n[m.key];
            const limit = LIMITS[m.key];
            const scale = m.ri ?? limit?.max; // bar = share of the reference intake, else of the limit
            const mark = limit && scale && limit.max <= scale ? { at: (limit.max / scale) * 100, label: `${limit.by} daily limit` } : undefined;
            const pct = v !== undefined && scale ? Math.min(100, (v / scale) * 100) : 0;
            const limitText = limitLine(p, m.key);
            return (
              <li key={m.key} className="py-4">
                <div className="flex items-baseline justify-between gap-4">
                  <span className={m.sub ? "pl-5 text-mute" : "text-lg"}>
                    {m.label}
                  </span>
                  <span className="tabular text-2xl font-medium tracking-tight sm:text-3xl">
                    {v === undefined ? (
                      <span className="text-base text-mute">Not listed</span>
                    ) : (
                      <>
                        <Num v={v} />
                        <span className="ml-1 text-base text-mute">{m.unit}</span>
                      </>
                    )}
                  </span>
                </div>
                {scale && v !== undefined && <Bar pct={pct} delay={0.1 + i * 0.05} limit={mark} />}
                <p className="mt-2 text-sm text-mute">{explain(p, m.key)}</p>
                {limitText && (
                  <p className="mt-1.5 flex gap-2 text-sm text-ink/85">
                    <span className="mt-[3px] shrink-0 self-start rounded-sm border border-ink/40 px-1 font-mono text-[9px] leading-[14px] tracking-wider">
                      {limit!.by}
                    </span>
                    {limitText}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-mute">
          Reference intakes are the EU guideline amounts for an average adult (2,000 kcal a day). They are a yardstick for
          scale, not a target or a limit.{limitNotes.length > 0 && " The marked tick under a bar is the daily limit."} {limitNotes.join(" ")}
        </p>
      </section>

      <section className="mt-16 grid gap-12 sm:grid-cols-2">
        <div>
          <Eyebrow>Allergens declared</Eyebrow>
          <Chips items={p.allergens} mine={allergies} empty="None declared in the record." />
          {p.traces.length > 0 && (
            <>
              <p className="mt-6 text-sm text-mute">May contain traces of</p>
              <Chips items={p.traces} mine={allergies} />
            </>
          )}
          <AllergenNote />
        </div>
        <div>
          <Eyebrow>Ingredients, as printed</Eyebrow>
          <p className="mt-4 leading-relaxed text-ink/85">
            {p.ingredients || <span className="text-mute">No ingredient list in the record yet.</span>}
          </p>
          {p.ingredients && <p className="mt-3 text-xs text-mute">Listed in descending order by weight, as printed on the pack.</p>}
        </div>
      </section>

      <IngredientList p={p} />

      <Additives items={p.additives} />

    </article>
  );
}

/* ───────────────────────── Compare ───────────────────────── */

function CompareView({ a, b, allergies, onSwap, onBack }: { a: Product; b: Product; allergies: string[]; onSwap: () => void; onBack: () => void }) {
  const diffs = compare(a, b);
  const top = diffs.reduce((x, y) => (y.weight > x.weight ? y : x));
  const topMeta = NUTRIENTS.find((m) => m.key === top.key)!;

  return (
    <article className="pt-6">
      <h1 className="sr-only">
        {a.name} compared with {b.name}
      </h1>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3 sm:gap-8">
        {[a, b].map((p, i) => (
          <motion.div
            key={p.code}
            initial={{ opacity: 0, x: i ? 40 : -40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, ease: EASE }}
            className={i ? "order-3" : ""}
          >
            <Thumb p={p} size="aspect-square w-full" big />
            <p className="mt-3 flex items-center gap-2 text-sm text-mute">
              <Tag>{i ? "B" : "A"}</Tag>
              <span className="truncate">{p.brand || p.code}</span>
            </p>
            <p className="mt-1 text-lg font-medium leading-tight tracking-tight sm:text-2xl">{p.name}</p>
          </motion.div>
        ))}
        <motion.button
          onClick={onSwap}
          aria-label="Swap A and B"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          whileTap={{ rotate: 180 }}
          transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.3 }}
          className="order-2 mt-[22%] rounded-full border border-line px-3 py-1.5 text-sm text-mute transition hover:text-ink"
        >
          vs
        </motion.button>
      </div>

      <AllergyWarning p={a} allergies={allergies} label="A" className="mt-10" />
      <AllergyWarning p={b} allergies={allergies} label="B" />

      {a.basis !== b.basis && (
        <p className="mt-8 rounded-2xl bg-card p-4 text-sm text-mute">
          One is measured per 100 g and the other per 100 ml, so treat this as an approximate comparison.
        </p>
      )}

      {top.weight > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.7, ease: EASE }}
          className="mt-16"
        >
          <Eyebrow>Biggest difference</Eyebrow>
          <p className="mt-3 text-[clamp(2rem,7vw,4rem)] font-medium leading-[1.05] tracking-[-0.035em]">
            <span className="text-mute">{topMeta.label}.</span> {top.text.replace(/^(A|B)/, (w) => (w === "A" ? a.name : b.name))}.
          </p>
        </motion.div>
      )}

      <section className="mt-14">
        <div className="flex items-baseline justify-between border-b border-line pb-3">
          <Eyebrow>
            {a.basis === b.basis ? `Per ${basisLabel(a)}` : `A per ${basisLabel(a)}, B per ${basisLabel(b)}`}
          </Eyebrow>
          <span className="flex gap-4 text-sm text-mute" aria-hidden>
            <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-ink" />A</span>
            <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-mute" />B</span>
          </span>
        </div>
        <ul>
          {diffs.map((d, i) => {
            const m = NUTRIENTS.find((x) => x.key === d.key)!;
            const max = Math.max(d.a ?? 0, d.b ?? 0) || 1;
            return (
              <li key={d.key} className="py-4">
                <div className="flex items-baseline justify-between">
                  <span className={m.sub ? "pl-5 text-mute" : "text-lg"}>{m.label}</span>
                  <span className="text-xs text-mute">{d.text}</span>
                </div>
                {[d.a, d.b].map((v, j) => {
                  const p = j ? b : a;
                  return (
                    <div key={j} className={`mt-3 grid items-center gap-3 ${a.basis === b.basis ? "grid-cols-[1rem_1fr_6rem]" : "grid-cols-[1rem_1fr_9.5rem]"}`}>
                      <span className="text-xs font-medium text-mute">
                        {j ? "B" : "A"}
                        <span className="sr-only">, {p.name}:</span>
                      </span>
                      <Bar pct={v === undefined ? 0 : (v / max) * 100} delay={0.15 + i * 0.06 + j * 0.08} dim={j === 1} />
                      <span className="tabular whitespace-nowrap text-right text-lg font-medium">
                        {v === undefined ? (
                          <span className="text-sm text-mute">Not listed</span>
                        ) : (
                          <>
                            <Num v={v} />
                            <span className="ml-1 text-xs text-mute">
                              {m.unit}
                              {a.basis !== b.basis && ` /${basisLabel(p)}`}
                            </span>
                          </>
                        )}
                      </span>
                    </div>
                  );
                })}
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-xs text-mute">Bars are scaled to the larger of the two values in each row.</p>
      </section>

      <section className="mt-14 grid gap-10 sm:grid-cols-2">
        {[a, b].map((p, i) => (
          <div key={p.code}>
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <Tag>{i ? "B" : "A"}</Tag> {p.name}
            </h2>
            <h3 className="mt-4 text-sm font-medium">Allergens declared</h3>
            <Chips items={p.allergens} mine={allergies} empty="None declared in the record." />
            <AllergenNote />
            <h3 className="mt-6 text-sm font-medium">Additives</h3>
            <p className="mt-3 text-sm leading-relaxed text-ink/85">
              {p.additives.length ? p.additives.map((x) => (x.name ? `${x.code} ${x.name}` : x.code)).join(", ") : <span className="text-mute">None listed in the record.</span>}
            </p>
          </div>
        ))}
      </section>

      <div className="mt-14 flex flex-wrap gap-3">
        <button onClick={onBack} className="h-12 rounded-full bg-ink px-6 font-medium text-canvas">
          New comparison
        </button>
      </div>
    </article>
  );
}

/* ───────────────────────── Bits ───────────────────────── */

function Num({ v }: { v: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const still = useReducedMotion();
  useEffect(() => {
    if (still) return;
    const c = animate(0, v, {
      duration: 1.1,
      ease: EASE,
      onUpdate: (x) => ref.current && (ref.current.textContent = fmt(x, v)),
    });
    return () => c.stop();
  }, [v, still]);
  return <span ref={ref}>{fmt(v)}</span>;
}

function Bar({ pct, delay = 0, dim, limit }: { pct: number; delay?: number; dim?: boolean; limit?: { at: number; label: string } }) {
  const still = useReducedMotion();
  return (
    <div className="relative mt-3" aria-hidden>
      <div className="h-1.5">
        <motion.div
          className={`h-full rounded-full ${dim ? "bg-mute" : "bg-ink"}`}
          initial={still ? false : { width: 0 }}
          animate={{ width: `${Math.max(pct, pct > 0 ? 1.5 : 0)}%` }}
          transition={still ? { duration: 0 } : { duration: 1.1, delay, ease: EASE }}
        />
      </div>
      {limit && (
        // Daily-limit marker: a tick crossing the bar, a hairline over the room left before it, and a label.
        <motion.div
          className="relative h-5"
          initial={still ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: still ? 0 : delay + 0.9, duration: 0.4 }}
        >
          {pct < limit.at && (
            <span
              className="absolute top-0 border-t border-dashed border-mute"
              style={{ left: `${pct}%`, width: `${limit.at - pct}%`, marginTop: -3 }}
            />
          )}
          <span
            className="absolute -top-3 h-[18px] w-0.5 rounded-full bg-ink ring-2 ring-canvas"
            style={{ left: `${limit.at}%`, transform: `translateX(${limit.at >= 99 ? "-100%" : "-50%"})` }}
          />
          <span
            className="absolute top-1.5 whitespace-nowrap text-[11px] text-mute"
            style={{ left: `${limit.at}%`, transform: limit.at > 70 ? "translateX(calc(-100% - 6px))" : "translateX(6px)" }}
          >
            {limit.label}
          </span>
        </motion.div>
      )}
    </div>
  );
}

function AllergyWarning({ p, allergies, label, className = "" }: { p: Product; allergies: string[]; label?: string; className?: string }) {
  const { contains, traces } = allergyHits(p, allergies);
  if (!contains.length && !traces.length) return null;
  const list = (t: string[]) => t.map(allergenLabel).join(", ");
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.2, duration: 0.5, ease: EASE }}
      className={`mt-4 flex gap-4 rounded-2xl bg-ink p-5 text-canvas ${className}`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-canvas text-ink">
        <WarningIcon size={18} weight="bold" aria-hidden />
      </span>
      <div>
        <p className="text-xs font-medium text-canvas/70">{label ? `Product ${label}: on your allergy list` : "On your allergy list"}</p>
        {contains.length > 0 && <p className="mt-1 text-lg font-semibold leading-snug">Contains {list(contains)}.</p>}
        {traces.length > 0 && <p className="mt-1 leading-snug">May contain traces of {list(traces)}.</p>}
        <p className="mt-2 text-xs text-canvas/60">From the product&apos;s record. Check the pack to confirm.</p>
      </div>
    </motion.div>
  );
}

const AllergenNote = () => (
  <p className="mt-4 text-xs leading-relaxed text-mute">
    Taken from the product&apos;s record, which can be incomplete or wrong. A missing allergen here doesn&apos;t mean the
    product is free of it. Always read the pack.
  </p>
);

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function IngredientList({ p }: { p: Product }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!p.parts.length) return null;
  return (
    <section className="mt-16">
      <div className="flex items-baseline justify-between border-b border-line pb-3">
        <Eyebrow>What&apos;s in it</Eyebrow>
        <span className="text-sm text-mute">Tap one to learn more</span>
      </div>
      {p.analysis.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {p.analysis.map((t) => (
            <span key={t} className="rounded-full border border-line px-3 py-1 text-xs text-ink/85">
              {t}
            </span>
          ))}
        </div>
      )}
      <ul className="mt-2">
        {p.parts.map((x, i) => {
          const key = `${x.id}-${i}`;
          const isOpen = open === key;
          return (
            <li key={key}>
              <button
                onClick={() => setOpen(isOpen ? null : key)}
                aria-expanded={isOpen}
                className="w-full py-4 text-left"
              >
                <span className="flex items-baseline justify-between gap-4">
                  <span className="min-w-0">
                    <span className="text-lg">{cap(x.name)}</span>
                    {x.sub.length > 0 && <span className="ml-2 text-sm text-mute">({x.sub.join(", ")})</span>}
                  </span>
                  <span className="tabular shrink-0 text-right">
                    <Pct x={x} />
                    <motion.span animate={{ rotate: isOpen ? 45 : 0 }} className="ml-3 inline-flex align-middle text-mute">
                      <PlusIcon size={16} weight="bold" aria-hidden />
                    </motion.span>
                  </span>
                </span>
                {x.pct !== undefined && x.pct > 0 && <Bar pct={Math.min(100, x.pct)} dim={!x.declared} delay={0.05 * i} />}
                {x.flags.length > 0 && (
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {x.flags.map((f) => (
                      <span key={f} className="rounded-full border border-ink/40 px-2 py-0.5 text-xs">
                        {f}
                      </span>
                    ))}
                  </span>
                )}
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.35, ease: EASE }}
                    className="overflow-hidden"
                  >
                    <Explain x={x} />
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-xs leading-relaxed text-mute">
        Percentages without ≈ are printed on the pack. The rest are Open Food Facts estimates from the ingredient order and
        nutrition values, so treat them as rough. The vegan and palm oil notes are its estimates too, and this breakdown can
        come from a different version or language of the label than the printed text above.
      </p>
    </section>
  );
}

function Pct({ x }: { x: Ingredient }) {
  if (x.pct === undefined) return null;
  if (x.declared) return <span className="font-medium">{+x.pct.toFixed(1)}%</span>;
  return <span className="text-mute">{x.pct < 1 ? "<1%" : `≈${Math.round(x.pct)}%`}</span>;
}

// Explanations already fetched this session, so reopening a row is instant.
const explained = new Map<string, Explanation>();

function Explain({ x }: { x: Ingredient }) {
  const key = `${x.id}|${x.name}`;
  const [state, setState] = useState<Explanation | "loading" | string>(explained.get(key) ?? "loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (explained.has(key)) return;
    setState("loading");
    fetch(`/api/ingredient?${new URLSearchParams({ id: x.id, name: x.name })}`)
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        if (r.ok && json) {
          explained.set(key, json);
          setState(json);
        } else
          setState(r.status === 429 ? `That's a lot of lookups. Try again in ${json?.retryAfter ?? 60} s.` : "Couldn't load an explanation right now.");
      })
      .catch(() => setState("Couldn't load an explanation right now."));
  }, [key, x.id, x.name, attempt]);

  return (
    <div className="pb-5 pr-6" role="status" aria-live="polite">
      {state === "loading" ? (
        <span className="block py-2">
          <Dots label="Loading explanation" color="bg-mute" />
        </span>
      ) : typeof state === "string" ? (
        <p className="text-sm text-mute">
          {state}{" "}
          <button onClick={() => setAttempt((n) => n + 1)} className="text-ink underline underline-offset-2">
            Try again
          </button>
        </p>
      ) : "none" in state ? (
        <p className="text-sm text-mute">No encyclopedia entry found for this one.</p>
      ) : (
        <>
          {state.about && (
            <p className="mb-1 text-xs text-mute">
              No article for {x.name} itself. Here&apos;s the broader {state.about}:
            </p>
          )}
          <p className="leading-relaxed text-ink/85">{state.extract}</p>
          <a href={state.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-mute underline underline-offset-2">
            Excerpt from Wikipedia, “{state.title}”, CC BY-SA 4.0
          </a>
        </>
      )}
    </div>
  );
}

function Additives({ items }: { items: Additive[] }) {
  const risk = {
    high: "EFSA estimated some people may go over this amount from their overall diet",
    moderate: "EFSA estimated a moderate chance of some people going over this amount from their overall diet",
    no: "EFSA estimated typical intakes from the overall diet stay below this amount",
  };
  return (
    <section className="mt-16">
      <div className="flex items-baseline justify-between border-b border-line pb-3">
        <Eyebrow>Additives</Eyebrow>
        <span className="text-sm text-mute">{items.length} listed</span>
      </div>
      {!items.length && <p className="py-6 text-mute">None listed in the record.</p>}
      <ul>
        {items.map((a) => (
          <li key={a.code} className="py-4">
            <p className="flex items-baseline gap-3">
              <span className="font-mono text-sm text-mute">{a.code}</span>
              <span className="text-lg">{a.name || "Unnamed in the database"}</span>
            </p>
            {a.adi ? (
              <p className="mt-2 text-sm text-ink/85">
                Safe daily amount (ADI): {a.adi} mg per kg of body weight, so about{" "}
                {Math.round(Number(a.adi) * 70).toLocaleString("en")} mg a day for a 70 kg adult.
              </p>
            ) : (
              <p className="mt-2 text-sm text-mute">No safe daily amount (ADI) recorded for it in the database.</p>
            )}
            {a.risk && (
              <p className="mt-1 text-sm text-mute">
                {risk[a.risk]}
                {a.risk !== "no" && a.groups ? ` (high consumers among ${a.groups})` : ""}.
              </p>
            )}
            {a.year && (
              <p className="mt-1 text-xs text-mute">
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    EFSA evaluation, {a.year}
                  </a>
                ) : (
                  `EFSA evaluation, ${a.year}`
                )}
              </p>
            )}
          </li>
        ))}
      </ul>
      {items.length > 0 && (
        <p className="mt-4 text-xs leading-relaxed text-mute">
          An ADI is the amount EFSA, the EU food safety agency, considers can be eaten every day over a lifetime without
          appreciable health risk. Packs don&apos;t state how much of each additive they contain, so this can&apos;t show how
          much of the ADI one serving uses. Evaluations can be revised, so check the year.
        </p>
      )}
    </section>
  );
}

function Thumb({ p, size, big }: { p: Product; size: string; big?: boolean }) {
  return (
    <div className={`${size} flex items-center justify-center overflow-hidden rounded-2xl bg-photo`}>
      {p.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.image} alt={p.name} className={`h-full w-full object-contain ${big ? "p-[12%]" : "p-2"} mix-blend-multiply`} />
      ) : (
        <span className="text-4xl font-semibold text-neutral-400">{p.name.slice(0, 1)}</span>
      )}
    </div>
  );
}

function Chips({ items, empty, mine = [] }: { items: string[]; empty?: string; mine?: string[] }) {
  if (!items.length) return <p className="mt-4 text-sm text-mute">{empty}</p>;
  return (
    <ul className="mt-4 flex flex-wrap gap-2">
      {items.map((t, i) => (
        <motion.li
          key={t}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 + i * 0.05 }}
          className={`rounded-full border px-3.5 py-1.5 text-sm capitalize ${mine.includes(t) ? "border-ink bg-ink font-medium text-canvas" : "border-ink/60"}`}
        >
          {allergenLabel(t)}
        </motion.li>
      ))}
    </ul>
  );
}

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-lg font-semibold tracking-tight">{children}</h2>
);

/** Small A / B marker used wherever two products sit side by side. */
const Tag = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1.5 text-[11px] font-semibold text-canvas">
    {children}
  </span>
);

function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null); // unknown until mounted, avoids a hydration mismatch
  useEffect(() => {
    const pinned = document.documentElement.dataset.theme;
    setDark(pinned ? pinned === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);
  const flip = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("ld:theme", next);
    } catch {}
    setDark(!dark);
  };
  return (
    <button
      onClick={flip}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink transition hover:bg-card active:scale-95"
    >
      {dark === null ? null : dark ? <SunIcon size={16} weight="bold" aria-hidden /> : <MoonIcon size={16} weight="bold" aria-hidden />}
    </button>
  );
}

const basisLabel = (p: Product) => (p.basis === "100ml" ? "100 ml" : "100 g");

const Footer = () => (
  <footer className="mt-24 space-y-4 border-t border-line pt-8 text-xs leading-relaxed text-mute">
    <p className="text-ink/85">
      General information, not medical or dietary advice. Product records are written by volunteers and can be incomplete,
      out of date or wrong. The printed pack is the final word, and if you have an allergy or a medical condition, rely on
      the pack and your doctor, not this app.
    </p>
    <p>
      Product data and photos from{" "}
      <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer" className="underline underline-offset-2">
        Open Food Facts
      </a>
      : the database is under the{" "}
      <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer" className="underline underline-offset-2">
        Open Database License
      </a>
      , and product photos are by its contributors under{" "}
      <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer" className="underline underline-offset-2">
        CC BY-SA 3.0
      </a>
      . Ingredient explanations are shortened excerpts from{" "}
      <a href="https://en.wikipedia.org" target="_blank" rel="noreferrer" className="underline underline-offset-2">
        Wikipedia
      </a>{" "}
      under{" "}
      <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer" className="underline underline-offset-2">
        CC BY-SA 4.0
      </a>
      , linked to each article. Additive safety values are from EFSA evaluations (via Open Food Facts), daily limits from WHO
      and EFSA guidance, and reference intakes from EU Regulation 1169/2011.
    </p>
    <p>Not affiliated with or endorsed by Open Food Facts, Wikipedia, the WHO, EFSA or any brand shown.</p>
    <p>
      Privacy: the camera is only used to read the barcode in your browser, and no image is uploaded. Barcodes and ingredient
      names you look up go through this site&apos;s server to Open Food Facts and Wikipedia. Your allergy list and history
      are stored only on this device. Like most websites, the host keeps standard server logs, including IP addresses.
    </p>
  </footer>
);

function Dots({ label = "Loading", color = "bg-canvas" }: { label?: string; color?: string }) {
  const still = useReducedMotion();
  return (
    <span className="flex gap-1">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((i) => (
        <motion.i
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${color} ${still ? "opacity-60" : ""}`}
          animate={still ? undefined : { opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </span>
  );
}

