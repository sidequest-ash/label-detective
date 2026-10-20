"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion } from "motion/react";
import { compare, explain, fmt, headline, NUTRIENTS, type Product } from "@/lib/product";
import Scanner from "./Scanner";

type View = { k: "home" } | { k: "product"; p: Product } | { k: "compare"; a: Product; b: Product };

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
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<Product[]>([]);
  const [pairs, setPairs] = useState<[string, string][]>([]);

  useEffect(() => {
    setRecent(load("ld:products", []));
    setPairs(load("ld:pairs", []));
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [view]);

  const remember = (p: Product) =>
    setRecent((r) => {
      const next = [p, ...r.filter((x) => x.code !== p.code)].slice(0, 24);
      save("ld:products", next);
      return next;
    });

  const rememberPair = (a: string, b: string) =>
    setPairs((r) => {
      const next = [[a, b] as [string, string], ...r.filter(([x, y]) => !(x === a && y === b))].slice(0, 8);
      save("ld:pairs", next);
      return next;
    });

  async function lookup(code: string): Promise<Product | null> {
    // ponytail: saved products never refresh; clear history to pick up OFF edits
    const local = recent.find((p) => p.code === code);
    if (local) return local;
    const now = Date.now();
    while (searches.length && now - searches[0] > 60_000) searches.shift();
    if (searches.length >= PER_MINUTE) {
      setError(`That's ${PER_MINUTE} lookups this minute. Try again in ${Math.ceil((60_000 - (now - searches[0])) / 1000)} s (saved products still open).`);
      return null;
    }
    searches.push(now);
    const res = await fetch(`/api/product/${code}`).catch(() => null);
    const json = await res?.json().catch(() => null);
    if (res?.ok && json?.product) return json.product;
    setError(
      res?.status === 404
        ? `No product found for ${code}. It may not be in Open Food Facts yet.`
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
    setBusy(true);
    const p = await lookup(code);
    setBusy(false);
    if (!p) return;
    remember(p);
    if (first && first.code !== p.code) {
      setView({ k: "compare", a: first, b: p });
      rememberPair(first.code, p.code);
      setFirst(null);
    } else {
      setFirst(null);
      setView({ k: "product", p });
    }
  }

  const openPair = (a: string, b: string) => {
    const pa = recent.find((p) => p.code === a), pb = recent.find((p) => p.code === b);
    if (pa && pb) setView({ k: "compare", a: pa, b: pb });
  };

  const closeScanner = useCallback(() => setScanning(false), []);
  const home = () => setView({ k: "home" });
  const startCompare = (p: Product) => {
    setFirst(p);
    setView({ k: "home" });
  };

  return (
    <div className="mx-auto min-h-dvh max-w-5xl px-4 pb-24 sm:px-8">
      <header className="sticky top-0 z-20 -mx-4 flex items-center justify-between bg-ink/80 px-4 py-4 backdrop-blur-xl sm:-mx-8 sm:px-8">
        <button onClick={home} className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em]">
          <span className="inline-block h-2 w-2 rounded-full bg-paper" /> Label Detective
        </button>
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-mute">Open Food Facts</span>
      </header>

      <AnimatePresence mode="wait">
        <motion.main
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
              onCancelCompare={() => setFirst(null)}
              onPair={openPair}
            />
          )}
          {view.k === "product" && <ProductView p={view.p} onCompare={() => startCompare(view.p)} onBack={home} />}
          {view.k === "compare" && (
            <CompareView a={view.a} b={view.b} onSwap={() => setView({ k: "compare", a: view.b, b: view.a })} onBack={home} />
          )}
        </motion.main>
      </AnimatePresence>

      <AnimatePresence>{scanning && <Scanner onCode={open} onClose={closeScanner} />}</AnimatePresence>
    </div>
  );
}

/* ───────────────────────── Home ───────────────────────── */

function Home(props: {
  first: Product | null;
  busy: boolean;
  error: string | null;
  recent: Product[];
  pairs: [string, string][];
  onSubmit: (code: string) => void;
  onScan: () => void;
  onCancelCompare: () => void;
  onPair: (a: string, b: string) => void;
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
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute">Product A</p>
                <p className="truncate">{first.name}</p>
              </div>
              <button onClick={props.onCancelCompare} className="px-3 text-sm text-mute hover:text-paper">
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <h1 className="text-[clamp(3.4rem,15vw,9.5rem)] font-semibold leading-[0.88] tracking-[-0.055em]">
        {first ? (
          <>
            Now the
            <br />
            <span className="font-serif font-normal italic tracking-[-0.03em]">other one.</span>
          </>
        ) : (
          <>
            Read the
            <br />
            <span className="font-serif font-normal italic tracking-[-0.03em]">label.</span>
          </>
        )}
      </h1>
      <p className="mt-6 max-w-md text-lg leading-snug text-mute">
        {first
          ? "Scan or type a second barcode to put the two side by side, per 100 g."
          : "Scan a barcode. See what's inside, in plain words. Compare two products on equal terms."}
      </p>

      <div className="mt-10 grid gap-3 sm:grid-cols-[1fr_auto]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            props.onSubmit(code);
          }}
          className="flex items-center rounded-full border border-line bg-card pl-5 focus-within:border-paper/50"
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
            className="m-1.5 h-11 rounded-full bg-paper px-5 font-medium text-ink transition disabled:opacity-30"
          >
            {busy ? <Dots /> : "Look up"}
          </button>
        </form>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={props.onScan}
          className="flex h-14 items-center justify-center gap-3 rounded-full border border-paper px-7 font-medium"
        >
          <BarcodeIcon /> Scan barcode
        </motion.button>
      </div>

      <AnimatePresence>
        {error && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-4 text-sm text-paper/80"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="mt-8 flex flex-wrap items-center gap-2">
        <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.2em] text-mute">Try</span>
        {SAMPLES.map((s) => (
          <button
            key={s.code}
            onClick={() => props.onSubmit(s.code)}
            className="rounded-full border border-line px-3.5 py-1.5 text-sm text-mute transition hover:border-paper/40 hover:text-paper"
          >
            {s.label}
          </button>
        ))}
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
                className="w-36 shrink-0 snap-start text-left"
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
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {pairs.map(([a, b]) => (
              <li key={a + b}>
                <button onClick={() => props.onPair(a, b)} className="flex w-full items-center gap-3 py-4 text-left">
                  <span className="min-w-0 flex-1 truncate">{name(a)}</span>
                  <span className="font-serif italic text-mute">vs</span>
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

function ProductView({ p, onCompare, onBack }: { p: Product; onCompare: () => void; onBack: () => void }) {
  const line = headline(p);
  const listed = NUTRIENTS.filter((m) => p.n[m.key] !== undefined).length;

  return (
    <article className="pt-6">
      <div className="grid gap-8 sm:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] sm:items-end">
        <motion.div
          initial={{ scale: 0.92, rotate: -2, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ duration: 0.8, ease: EASE }}
        >
          <Thumb p={p} size="aspect-[4/5] w-full" big />
        </motion.div>
        <div>
          <Eyebrow>{[p.brand, p.quantity].filter(Boolean).join(" · ") || "Product"}</Eyebrow>
          <h1 className="mt-3 text-[clamp(2.6rem,9vw,5.5rem)] font-semibold leading-[0.92] tracking-[-0.045em]">{p.name}</h1>
          <p className="tabular mt-4 font-mono text-xs tracking-[0.2em] text-mute">{p.code}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={onCompare}
              className="h-12 rounded-full bg-paper px-6 font-medium text-ink"
            >
              Compare with another
            </motion.button>
            <button onClick={onBack} className="h-12 rounded-full border border-line px-6 text-mute hover:text-paper">
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
          className="mt-20 max-w-3xl font-serif text-[clamp(2.2rem,7vw,4.2rem)] leading-[1] tracking-[-0.02em]"
        >
          {line}
        </motion.p>
      )}

      <section className="mt-14">
        <div className="flex items-baseline justify-between border-b border-line pb-3">
          <Eyebrow>Nutrition per {p.basis === "100ml" ? "100 ml" : "100 g"}</Eyebrow>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute">
            {listed}/{NUTRIENTS.length} listed
          </span>
        </div>
        {listed === 0 && (
          <p className="py-8 text-mute">This product&apos;s record has no nutrition values yet. The pack itself will have them.</p>
        )}
        <ul>
          {NUTRIENTS.map((m, i) => {
            const v = p.n[m.key];
            const pct = v !== undefined && m.ri ? Math.min(100, (v / m.ri) * 100) : 0;
            return (
              <li key={m.key} className="border-b border-line py-5">
                <div className="flex items-baseline justify-between gap-4">
                  <span className={m.sub ? "pl-5 text-mute" : "text-lg"}>
                    {m.sub && <span className="mr-2 text-line">└</span>}
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
                {m.ri && v !== undefined && <Bar pct={pct} delay={0.1 + i * 0.05} />}
                <p className="mt-2 text-sm text-mute">{explain(p, m.key)}</p>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-mute">
          Reference intakes are the EU guideline amounts for an average adult (2,000 kcal a day). They are a yardstick for
          scale, not a target or a limit.
        </p>
      </section>

      <section className="mt-16 grid gap-12 sm:grid-cols-2">
        <div>
          <Eyebrow>Allergens declared</Eyebrow>
          <Chips items={p.allergens} empty="None declared in the record. Always check the pack." />
          {p.traces.length > 0 && (
            <>
              <p className="mt-6 text-sm text-mute">May contain traces of</p>
              <Chips items={p.traces} />
            </>
          )}
        </div>
        <div>
          <Eyebrow>Ingredients</Eyebrow>
          <p className="mt-4 leading-relaxed text-paper/85">
            {p.ingredients || <span className="text-mute">No ingredient list in the record yet.</span>}
          </p>
          {p.ingredients && <p className="mt-3 text-xs text-mute">Listed in descending order by weight, as printed on the pack.</p>}
        </div>
      </section>

      <Source />
    </article>
  );
}

/* ───────────────────────── Compare ───────────────────────── */

function CompareView({ a, b, onSwap, onBack }: { a: Product; b: Product; onSwap: () => void; onBack: () => void }) {
  const diffs = compare(a, b);
  const top = diffs.reduce((x, y) => (y.weight > x.weight ? y : x));
  const topMeta = NUTRIENTS.find((m) => m.key === top.key)!;

  return (
    <article className="pt-6">
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3 sm:gap-8">
        {[a, b].map((p, i) => (
          <motion.div
            key={p.code}
            initial={{ opacity: 0, x: i ? 40 : -40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, ease: EASE }}
            className={i ? "order-3" : ""}
          >
            <Thumb p={p} size="aspect-square w-full" big />
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-mute">
              {i ? "B" : "A"} · {p.brand || p.code}
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
          className="order-2 mt-[22%] font-serif text-2xl italic text-mute sm:text-4xl"
        >
          vs
        </motion.button>
      </div>

      {a.basis !== b.basis && (
        <p className="mt-8 rounded-xl border border-line p-4 text-sm text-mute">
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
          <p className="mt-3 font-serif text-[clamp(2.4rem,8vw,4.8rem)] leading-[0.98] tracking-[-0.02em]">
            {topMeta.label}: <span className="italic">{top.text.replace(/^(A|B)/, (w) => (w === "A" ? a.name : b.name))}</span>.
          </p>
        </motion.div>
      )}

      <section className="mt-14">
        <div className="flex items-baseline justify-between border-b border-line pb-3">
          <Eyebrow>Per {a.basis === "100ml" && b.basis === "100ml" ? "100 ml" : "100 g"}</Eyebrow>
          <span className="flex gap-4 font-mono text-[10px] uppercase tracking-[0.2em] text-mute">
            <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-paper" />A</span>
            <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-mute/60" />B</span>
          </span>
        </div>
        <ul>
          {diffs.map((d, i) => {
            const m = NUTRIENTS.find((x) => x.key === d.key)!;
            const max = Math.max(d.a ?? 0, d.b ?? 0) || 1;
            return (
              <li key={d.key} className="border-b border-line py-5">
                <div className="flex items-baseline justify-between">
                  <span className={m.sub ? "pl-5 text-mute" : "text-lg"}>{m.label}</span>
                  <span className="text-xs text-mute">{d.text}</span>
                </div>
                {[d.a, d.b].map((v, j) => (
                  <div key={j} className="mt-3 grid grid-cols-[1fr_5.5rem] items-center gap-3">
                    <Bar pct={v === undefined ? 0 : (v / max) * 100} delay={0.15 + i * 0.06 + j * 0.08} dim={j === 1} />
                    <span className="tabular text-right text-lg font-medium">
                      {v === undefined ? <span className="text-sm text-mute">—</span> : <><Num v={v} /><span className="ml-1 text-xs text-mute">{m.unit}</span></>}
                    </span>
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-xs text-mute">Bars are scaled to the larger of the two values in each row.</p>
      </section>

      <section className="mt-14 grid gap-10 sm:grid-cols-2">
        {[a, b].map((p, i) => (
          <div key={p.code}>
            <Eyebrow>{i ? "B" : "A"} · allergens declared</Eyebrow>
            <Chips items={p.allergens} empty="None declared in the record." />
          </div>
        ))}
      </section>

      <div className="mt-14 flex flex-wrap gap-3">
        <button onClick={onBack} className="h-12 rounded-full bg-paper px-6 font-medium text-ink">
          New comparison
        </button>
      </div>
      <Source />
    </article>
  );
}

/* ───────────────────────── Bits ───────────────────────── */

function Num({ v }: { v: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const c = animate(0, v, {
      duration: 1.1,
      ease: EASE,
      onUpdate: (x) => ref.current && (ref.current.textContent = fmt(x, v)),
    });
    return () => c.stop();
  }, [v]);
  return <span ref={ref}>{fmt(v)}</span>;
}

function Bar({ pct, delay = 0, dim }: { pct: number; delay?: number; dim?: boolean }) {
  return (
    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
      <motion.div
        className={`h-full rounded-full ${dim ? "bg-mute/60" : "bg-paper"}`}
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(pct, pct > 0 ? 1.5 : 0)}%` }}
        transition={{ duration: 1.1, delay, ease: EASE }}
      />
    </div>
  );
}

function Thumb({ p, size, big }: { p: Product; size: string; big?: boolean }) {
  return (
    <div className={`${size} flex items-center justify-center overflow-hidden rounded-2xl ${big ? "rounded-3xl" : ""} bg-paper`}>
      {p.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.image} alt={p.name} className={`h-full w-full object-contain ${big ? "p-[12%]" : "p-2"} mix-blend-multiply`} />
      ) : (
        <span className="font-serif text-4xl italic text-ink/40">{p.name.slice(0, 1)}</span>
      )}
    </div>
  );
}

function Chips({ items, empty }: { items: string[]; empty?: string }) {
  if (!items.length) return <p className="mt-4 text-sm text-mute">{empty}</p>;
  return (
    <ul className="mt-4 flex flex-wrap gap-2">
      {items.map((t, i) => (
        <motion.li
          key={t}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 + i * 0.05 }}
          className="rounded-full border border-paper/60 px-3.5 py-1.5 text-sm capitalize"
        >
          {t}
        </motion.li>
      ))}
    </ul>
  );
}

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-mute">{children}</p>
);

const Source = () => (
  <p className="mt-20 text-xs leading-relaxed text-mute">
    Data from{" "}
    <a href="https://world.openfoodfacts.org" className="underline underline-offset-2" target="_blank" rel="noreferrer">
      Open Food Facts
    </a>
    , an open database built by volunteers (ODbL). Records can be incomplete or out of date, so the printed pack is the final word.
  </p>
);

const Dots = () => (
  <span className="flex gap-1" aria-label="Loading">
    {[0, 1, 2].map((i) => (
      <motion.i
        key={i}
        className="h-1.5 w-1.5 rounded-full bg-ink"
        animate={{ opacity: [0.2, 1, 0.2] }}
        transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
      />
    ))}
  </span>
);

const BarcodeIcon = () => (
  <svg width="22" height="16" viewBox="0 0 22 16" fill="currentColor" aria-hidden>
    {[0, 3, 5, 9, 11, 14, 17, 20].map((x, i) => (
      <rect key={x} x={x} width={i % 3 ? 1.2 : 2} height="16" />
    ))}
  </svg>
);
