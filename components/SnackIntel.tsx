"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, MotionConfig, useReducedMotion } from "motion/react";
import {
  ALLERGENS, allergenLabel, allergyHits, amount, compare, compareLines, fmt, glance, LIMITS, limitLine, NUTRIENTS,
  nutrientNote, shortNames,
  type Additive, type Ingredient, type Line, type Product,
} from "@/lib/product";
import type { Explanation } from "@/app/api/ingredient/route";
import {
  ArrowLeftIcon, ArrowsLeftRightIcon, BarbellIcon, BarcodeIcon, CaretRightIcon, CheckIcon, ClockCounterClockwiseIcon,
  CoffeeIcon, CubeIcon, DropIcon, ExportIcon, ForkKnifeIcon, GrainsIcon, LeafIcon, MoonIcon, PlusIcon, ScanIcon,
  ShieldCheckIcon, SunIcon, WarningIcon, type Icon,
} from "@phosphor-icons/react";
import Scanner from "./Scanner";

type Tab = "scan" | "compare" | "history" | "allergies";
type View = { k: "tab"; tab: Tab } | { k: "product"; p: Product } | { k: "compare"; a: Product; b: Product };

// Views live in the URL (?p=code, ?a=code&b=code, ?tab=history) so refresh, Back and shared links work.
const urlFor = (v: View) =>
  v.k === "product" ? `?p=${v.p.code}` : v.k === "compare" ? `?a=${v.a.code}&b=${v.b.code}` : v.tab === "scan" ? location.pathname : `?tab=${v.tab}`;
const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const TABS: { tab: Tab; label: string; Icon: Icon }[] = [
  { tab: "scan", label: "Scan", Icon: ScanIcon },
  { tab: "compare", label: "Compare", Icon: ArrowsLeftRightIcon },
  { tab: "history", label: "History", Icon: ClockCounterClockwiseIcon },
  { tab: "allergies", label: "Allergies", Icon: ShieldCheckIcon },
];

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

export default function SnackIntel() {
  const [view, setView] = useState<View>({ k: "tab", tab: "scan" });
  const [first, setFirst] = useState<Product | null>(null); // compare: first pick, waiting for the second
  const [scanning, setScanning] = useState(false);
  const [typing, setTyping] = useState(false); // show the barcode-number field instead of the link
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<React.ReactNode>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [recent, setRecent] = useState<Product[]>([]);
  const [pairs, setPairs] = useState<[string, string][]>([]);
  const [allergies, setAllergies] = useState<string[]>([]);
  const request = useRef(0); // only the latest lookup may change the view
  const navigated = useRef(false); // focus the new view once it mounts, but not on first load

  const go = (v: View, how: "push" | "replace" = "push", url = urlFor(v)) => {
    navigated.current = true;
    setView(v);
    history[how === "push" ? "pushState" : "replaceState"]({ inApp: true }, "", url);
  };

  useEffect(() => {
    setRecent(load("ld:products", []));
    setPairs(load("ld:pairs", []));
    setAllergies(load("ld:allergies", []));
    // The URL is the source of truth for the view and for a pending first pick (?tab=compare&with=code).
    const fromUrl = async (e?: PopStateEvent) => {
      const q = new URLSearchParams(location.search);
      const id = ++request.current; // supersedes any lookup in flight
      const [p, a, b, w, t] = [q.get("p"), q.get("a"), q.get("b"), q.get("with"), q.get("tab")];
      if (e) navigated.current = true;
      setError(null);
      setBusy(Boolean(p || (a && b) || w));
      const tab: Tab = TABS.some((x) => x.tab === t) ? (t as Tab) : "scan";
      let next: View = { k: "tab", tab };
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

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

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

  const clearHistory = () => {
    setRecent([]);
    setPairs([]);
    save("ld:products", []);
    save("ld:pairs", []);
  };

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
    const onCompareTab = view.k === "tab" && view.tab === "compare";
    if (first && first.code !== p.code) {
      go({ k: "compare", a: first, b: p });
      rememberPair(first.code, p.code);
      setFirst(null);
    } else if (onCompareTab) {
      setFirst(p); // first pick on the Compare tab
      history.replaceState({ inApp: true }, "", `?tab=compare&with=${p.code}`);
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
  const goTab = (tab: Tab) => {
    request.current++; // drop any lookup still in flight
    setBusy(false);
    setError(null);
    if (tab !== "compare") setFirst(null);
    setTyping(false);
    go({ k: "tab", tab }, "push", tab === "compare" && first ? `?tab=compare&with=${first.code}` : undefined);
  };
  const startCompare = (p: Product) => {
    setFirst(p);
    setError(null);
    go({ k: "tab", tab: "compare" }, "push", `?tab=compare&with=${p.code}`);
  };
  const cancelCompare = () => {
    request.current++; // a second product still loading must not open the cancelled comparison
    setBusy(false);
    setFirst(null);
    history.replaceState({ inApp: true }, "", "?tab=compare");
  };
  const back = () => (history.state?.inApp ? history.back() : goTab("scan"));
  const share = async (title: string) => {
    try {
      if (navigator.share) await navigator.share({ title, url: location.href });
      else {
        await navigator.clipboard.writeText(location.href);
        setToast("Link copied");
      }
    } catch {}
  };

  const activeTab: Tab = view.k === "tab" ? view.tab : view.k === "compare" ? "compare" : "scan";
  const title = view.k === "product" ? view.p.name : view.k === "compare" ? `${view.a.name} vs ${view.b.name}` : "";

  return (
    <MotionConfig reducedMotion="user">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-canvas"
      >
        Skip to content
      </a>
      <div inert={scanning} className="mx-auto min-h-dvh max-w-xl px-5 pb-32">
        <header className="sticky top-0 z-20 -mx-5 flex h-14 items-center justify-between bg-canvas/85 px-5 backdrop-blur-xl">
          {view.k === "tab" ? (
            <span className="text-[17px] font-semibold tracking-tight">Snack Intel</span>
          ) : (
            <button onClick={back} aria-label="Back" className="-ml-2 grid h-10 w-10 place-items-center rounded-full active:scale-95">
              <ArrowLeftIcon size={22} aria-hidden />
            </button>
          )}
          <div className="flex items-center gap-1">
            {view.k !== "tab" && (
              <button onClick={() => share(title)} aria-label="Share" className="grid h-10 w-10 place-items-center rounded-full active:scale-95">
                <ExportIcon size={22} aria-hidden />
              </button>
            )}
            <ThemeToggle />
          </div>
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
            key={view.k === "tab" ? view.tab : view.k === "product" ? view.p.code : `${view.a.code}-${view.b.code}`}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            {view.k === "tab" && view.tab === "scan" && (
              <ScanTab
                busy={busy}
                error={error}
                typing={typing}
                onType={() => setTyping(true)}
                recent={recent}
                allergies={allergies}
                onScan={() => setScanning(true)}
                onSubmit={open}
                goTab={goTab}
              />
            )}
            {view.k === "tab" && view.tab === "compare" && (
              <CompareTab
                first={first}
                busy={busy}
                error={error}
                typing={typing}
                onType={() => setTyping(true)}
                recent={recent}
                pairs={pairs}
                onScan={() => setScanning(true)}
                onPick={open}
                onCancel={cancelCompare}
                onPair={openPair}
              />
            )}
            {view.k === "tab" && view.tab === "history" && (
              <HistoryTab recent={recent} pairs={pairs} busy={busy} onOpen={open} onPair={openPair} onClear={clearHistory} goTab={goTab} />
            )}
            {view.k === "tab" && view.tab === "allergies" && <AllergiesTab allergies={allergies} onToggle={toggleAllergy} />}
            {view.k === "product" && <ProductView p={view.p} allergies={allergies} onCompare={() => startCompare(view.p)} />}
            {view.k === "compare" && (
              <CompareView
                a={view.a}
                b={view.b}
                allergies={allergies}
                onSwap={() => go({ k: "compare", a: view.b, b: view.a }, "replace")}
                onNew={() => goTab("compare")}
              />
            )}
          </motion.main>
        </AnimatePresence>

        <Footer />
      </div>

      <nav aria-label="Main" inert={scanning} className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
        <div className="mx-auto grid max-w-xl grid-cols-4">
          {TABS.map(({ tab, label, Icon }) => {
            const on = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => goTab(tab)}
                aria-current={on ? "page" : undefined}
                className={`flex flex-col items-center gap-1 pb-2 pt-2.5 text-[11px] transition active:scale-95 ${on ? "font-semibold text-ink" : "text-mute"}`}
              >
                <Icon size={24} weight={on ? "fill" : "regular"} className={on ? "text-accent" : ""} aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
      </nav>

      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-16 z-40 flex justify-center">
        <AnimatePresence>
          {(busy || toast) && (
            <motion.span
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-canvas shadow-lg"
            >
              {busy ? (
                <>
                  <Dots label="" /> Looking it up
                </>
              ) : (
                toast
              )}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>{scanning && <Scanner onCode={open} onClose={closeScanner} onType={() => (setScanning(false), setTyping(true))} />}</AnimatePresence>
    </MotionConfig>
  );
}

/* ───────────────────────── Tabs ───────────────────────── */

function ScanTab(props: {
  busy: boolean;
  error: React.ReactNode;
  typing: boolean;
  onType: () => void;
  recent: Product[];
  allergies: string[];
  onScan: () => void;
  onSubmit: (code: string) => void;
  goTab: (t: Tab) => void;
}) {
  const { busy, recent, allergies } = props;
  return (
    <section className="pt-4">
      <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.02em]">What are you eating today?</h1>
      <p className="mt-2 text-[15px] text-mute">Scan the barcode on any packaged food.</p>

      <ScanCard title="Scan a barcode" sub="Point your camera at the pack" onClick={props.onScan} disabled={busy} />
      <TypeInstead typing={props.typing} onType={props.onType} busy={busy} onSubmit={props.onSubmit} />
      <ErrorText error={props.error} />

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm text-mute">No pack handy? Try</span>
        {SAMPLES.map((s) => (
          <button
            key={s.code}
            onClick={() => props.onSubmit(s.code)}
            disabled={busy}
            className="rounded-full bg-card px-3.5 py-1.5 text-sm transition active:scale-95 disabled:opacity-40"
          >
            {s.label}
          </button>
        ))}
      </div>

      <button
        onClick={() => props.goTab("allergies")}
        className="mt-6 flex w-full items-center gap-3 rounded-[22px] bg-card px-4 py-4 text-left transition active:scale-[0.99]"
      >
        <ShieldCheckIcon size={24} weight="fill" className="shrink-0 text-accent" aria-hidden />
        <span className="flex-1">
          <span className="block text-[15px]">
            {allergies.length ? (
              <>
                Watching for <b className="font-semibold">{allergies.map(allergenLabel).join(", ")}</b>
              </>
            ) : (
              "Add your allergies"
            )}
          </span>
          <span className="text-[13px] text-mute">{allergies.length ? "Flagged on every product" : "We'll flag them on every product"}</span>
        </span>
        <CaretRightIcon size={18} className="text-mute" aria-hidden />
      </button>

      {recent.length > 0 && (
        <>
          <div className="mb-3 mt-8 flex items-baseline justify-between">
            <h2 className="text-[19px] font-semibold">Recently scanned</h2>
            <button onClick={() => props.goTab("history")} className="text-sm text-mute">
              See all
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {recent.slice(0, 4).map((p) => (
              <ProductCard key={p.code} p={p} onClick={() => props.onSubmit(p.code)} disabled={busy} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function CompareTab(props: {
  first: Product | null;
  busy: boolean;
  error: React.ReactNode;
  typing: boolean;
  onType: () => void;
  recent: Product[];
  pairs: [string, string][];
  onScan: () => void;
  onPick: (code: string) => void;
  onCancel: () => void;
  onPair: (a: string, b: string) => void;
}) {
  const { first, busy, recent, pairs } = props;
  const choices = recent.filter((p) => p.code !== first?.code);
  const name = (c: string) => recent.find((p) => p.code === c)?.name ?? c;
  return (
    <section className="pt-4">
      <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.02em]">Compare</h1>
      <p className="mt-2 text-[15px] text-mute">
        {first ? "Now pick the second product." : "Pick two products to see them side by side."}
      </p>

      <AnimatePresence>
        {first && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-5 flex items-center gap-3 rounded-[22px] bg-card p-3">
              <Thumb p={first} size="h-14 w-14" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-mute">First pick</p>
                <p className="truncate font-medium">{first.name}</p>
              </div>
              <button onClick={props.onCancel} className="px-3 text-sm text-mute">
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ScanCard
        title={first ? "Scan the second product" : "Scan a product"}
        sub="Or pick one you've scanned below"
        onClick={props.onScan}
        disabled={busy}
      />
      <TypeInstead typing={props.typing} onType={props.onType} busy={busy} onSubmit={props.onPick} />
      <ErrorText error={props.error} />

      <h2 className="mb-3 mt-8 text-[19px] font-semibold">{first ? "Pick the second one" : "Pick from your history"}</h2>
      {choices.length ? (
        <div className="grid grid-cols-2 gap-3">
          {choices.map((p) => (
            <ProductCard key={p.code} p={p} onClick={() => props.onPick(p.code)} disabled={busy} />
          ))}
        </div>
      ) : (
        <p className="rounded-[22px] bg-card px-4 py-5 text-[15px] text-mute">Products you scan will show up here.</p>
      )}

      {pairs.length > 0 && <PairList pairs={pairs} name={name} busy={busy} onPair={props.onPair} />}
    </section>
  );
}

function HistoryTab(props: {
  recent: Product[];
  pairs: [string, string][];
  busy: boolean;
  onOpen: (code: string) => void;
  onPair: (a: string, b: string) => void;
  onClear: () => void;
  goTab: (t: Tab) => void;
}) {
  const { recent, pairs, busy } = props;
  const [confirm, setConfirm] = useState(false);
  const name = (c: string) => recent.find((p) => p.code === c)?.name ?? c;
  return (
    <section className="pt-4">
      <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.02em]">History</h1>
      <p className="mt-2 text-[15px] text-mute">Saved on this device only.</p>
      {!recent.length ? (
        <div className="mt-6 rounded-[24px] bg-card px-5 py-8 text-center">
          <p className="text-[17px] font-medium">Nothing scanned yet</p>
          <p className="mt-1 text-[15px] text-mute">Products you look up will appear here.</p>
          <button onClick={() => props.goTab("scan")} className="mt-5 h-12 rounded-full bg-ink px-6 font-medium text-canvas active:scale-95">
            Scan a barcode
          </button>
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3">
            {recent.map((p) => (
              <ProductCard key={p.code} p={p} onClick={() => props.onOpen(p.code)} disabled={busy} />
            ))}
          </div>
          {pairs.length > 0 && <PairList pairs={pairs} name={name} busy={busy} onPair={props.onPair} />}
          <button
            onClick={() => (confirm ? (props.onClear(), setConfirm(false)) : setConfirm(true))}
            className="mx-auto mt-10 block rounded-full border border-line px-5 py-2.5 text-sm text-mute active:scale-95"
          >
            {confirm ? "Tap again to clear everything" : "Clear history"}
          </button>
        </>
      )}
    </section>
  );
}

function AllergiesTab({ allergies, onToggle }: { allergies: string[]; onToggle: (tag: string) => void }) {
  return (
    <section className="pt-4">
      <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.02em]">Your allergies</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-mute">
        Tap the ones that matter to you. Products that contain, or may contain, them get a warning.
      </p>
      <div className="mt-6 grid grid-cols-2 gap-2.5">
        {ALLERGENS.map(({ tag, label }) => {
          const on = allergies.includes(tag);
          return (
            <motion.button
              key={tag}
              whileTap={{ scale: 0.97 }}
              aria-pressed={on}
              onClick={() => onToggle(tag)}
              className={`flex items-center justify-between rounded-[18px] px-4 py-3.5 text-left text-[15px] transition ${on ? "bg-ink font-medium text-canvas" : "bg-card"}`}
            >
              {label}
              <span className={`grid h-6 w-6 place-items-center rounded-full ${on ? "bg-accent text-white" : "border border-line"}`}>
                {on && <CheckIcon size={14} weight="bold" aria-hidden />}
              </span>
            </motion.button>
          );
        })}
      </div>
      <p className="mt-5 rounded-[18px] bg-card px-4 py-4 text-[13px] leading-relaxed text-mute">
        Saved on this device only. Warnings only cover what the product&apos;s record lists, so no warning doesn&apos;t mean
        a product is safe for you. Always read the pack.
      </p>
    </section>
  );
}

/* ───────────────────────── Product ───────────────────────── */

const PRODUCT_TABS = ["Nutrition", "Ingredients", "Additives"] as const;

function ProductView({ p, allergies, onCompare }: { p: Product; allergies: string[]; onCompare: () => void }) {
  const [tab, setTab] = useState<(typeof PRODUCT_TABS)[number]>("Nutrition");
  const lines = glance(p);
  return (
    <article className="pt-2">
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: EASE }}
      >
        <Thumb p={p} size="h-60 w-full" big />
      </motion.div>
      <h1 className="mt-5 text-[32px] font-semibold leading-[1.1] tracking-[-0.02em]">{p.name}</h1>
      <p className="mt-1 text-[15px] text-mute">{[p.brand, p.quantity].filter(Boolean).join(", ") || `Barcode ${p.code}`}</p>

      <AllergyWarning p={p} allergies={allergies} className="mt-4" />
      {lines.length > 0 && <LineCard title="At a glance" lines={lines} />}

      <div role="tablist" aria-label="Product details" className="mt-6 grid grid-cols-3 rounded-2xl bg-line/70 p-1 text-sm">
        {PRODUCT_TABS.map((t) => (
          <button
            key={t}
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            onClick={() => setTab(t)}
            className={`rounded-xl py-2.5 transition ${tab === t ? "bg-card font-semibold text-ink shadow-sm" : "text-mute"}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "Nutrition" && <NutritionPanel p={p} />}
        {tab === "Ingredients" && <IngredientsPanel p={p} allergies={allergies} />}
        {tab === "Additives" && <Additives items={p.additives} />}
      </div>

      <motion.button whileTap={{ scale: 0.98 }} onClick={onCompare} className="mt-6 h-14 w-full rounded-full bg-ink text-base font-semibold text-canvas">
        Compare with another
      </motion.button>
    </article>
  );
}

function NutritionPanel({ p }: { p: Product }) {
  const [serving, setServing] = useState(false);
  const factor = serving && p.serving ? p.serving / 100 : 1;
  const ml = p.basis === "100ml";
  const rows = NUTRIENTS.filter((m) => !m.optional || p.n[m.key] !== undefined);
  const listed = rows.filter((m) => p.n[m.key] !== undefined).length;
  const limitNotes = rows.filter((m) => LIMITS[m.key] && p.n[m.key] !== undefined).map((m) => LIMITS[m.key]!.note);
  return (
    <div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {p.serving ? (
          [false, true].map((s) => (
            <button
              key={String(s)}
              aria-pressed={serving === s}
              onClick={() => setServing(s)}
              className={`rounded-full px-3.5 py-1.5 text-[13px] transition ${serving === s ? "bg-ink text-canvas" : "border border-line text-mute"}`}
            >
              {s ? `In a ${amount(p.serving!, ml)} serving` : `In ${basisLabel(p)}`}
            </button>
          ))
        ) : (
          <span className="text-[13px] text-mute">In every {basisLabel(p)}</span>
        )}
        <span className="ml-auto text-[13px] text-mute">
          {listed} of {rows.length} listed
        </span>
      </div>
      {listed === 0 && (
        <p className="mt-3 rounded-[24px] bg-card px-5 py-5 text-[15px] text-mute">
          This product&apos;s record has no nutrition values yet. The pack itself will have them.
        </p>
      )}
      <ul className="mt-3 rounded-[24px] bg-card px-5">
        {rows.map((m, i) => {
          const base = p.n[m.key];
          const v = base === undefined ? undefined : base * factor;
          const limit = LIMITS[m.key];
          const scale = m.ri ?? limit?.max; // bar = share of the reference intake, else of the limit
          const pct = v !== undefined && scale ? Math.min(100, (v / scale) * 100) : 0;
          const mark = limit && scale && limit.max <= scale ? { at: (limit.max / scale) * 100, label: `${limit.by} daily limit` } : undefined;
          const detail = limitLine(p, m.key);
          return (
            <li key={m.key} className={`py-3.5 ${i ? "border-t border-line" : ""}`}>
              <div className="flex items-baseline justify-between gap-4">
                <span className={m.sub ? "pl-4 text-mute" : "text-[16px]"}>{m.label}</span>
                <span className="tabular text-[17px] font-semibold">
                  {v === undefined ? (
                    <span className="text-sm font-normal text-mute">Not listed</span>
                  ) : (
                    <>
                      <Num v={v} key={`${m.key}-${serving}`} />
                      <span className="ml-0.5 text-sm font-normal text-mute">{m.unit}</span>
                    </>
                  )}
                </span>
              </div>
              {scale && v !== undefined && <Bar pct={pct} delay={0.05 + i * 0.04} limit={mark} />}
              {v !== undefined && nutrientNote(m.key, v) && <p className="mt-1.5 text-[13px] text-mute">{nutrientNote(m.key, v)}</p>}
              {detail && <p className="mt-0.5 text-[13px] text-mute">{detail}</p>}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-mute">
        &ldquo;A typical adult&apos;s day&rdquo; uses EU reference intakes for an average adult (2,000 kcal). They are a
        yardstick, not a target or a limit.{limitNotes.length > 0 && " The marked tick on a bar is the daily limit."}{" "}
        {limitNotes.join(" ")}
      </p>
    </div>
  );
}

function IngredientsPanel({ p, allergies }: { p: Product; allergies: string[] }) {
  return (
    <div>
      <div className="mt-4 rounded-[24px] bg-card px-5 py-4">
        <h2 className="text-[17px] font-semibold">Allergens declared</h2>
        <Chips items={p.allergens} mine={allergies} empty="None declared in the record." />
        {p.traces.length > 0 && (
          <>
            <p className="mt-4 text-sm text-mute">May contain traces of</p>
            <Chips items={p.traces} mine={allergies} />
          </>
        )}
        <AllergenNote />
      </div>
      <IngredientList p={p} />
      <div className="mt-4 rounded-[24px] bg-card px-5 py-4">
        <h2 className="text-[17px] font-semibold">As printed on the pack</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-ink/85">
          {p.ingredients || <span className="text-mute">No ingredient list in the record yet.</span>}
        </p>
        {p.ingredients && <p className="mt-2 text-xs text-mute">Listed in descending order by weight.</p>}
      </div>
    </div>
  );
}

/* ───────────────────────── Compare ───────────────────────── */

function CompareView(props: { a: Product; b: Product; allergies: string[]; onSwap: () => void; onNew: () => void }) {
  const { a, b, allergies } = props;
  const [na, nb] = shortNames(a, b);
  const diffs = compare(a, b);
  const mixed = a.basis !== b.basis;
  const lines = compareLines(a, b);
  return (
    <article className="pt-4">
      <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.02em]">Side by side</h1>
      <p className="mt-2 text-[15px] text-mute">
        {mixed ? `${na} per ${basisLabel(a)}, ${nb} per ${basisLabel(b)}, so this is approximate` : `Compared in every ${basisLabel(a)}`}
      </p>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5">
        <ProductCard p={a} />
        <motion.button
          onClick={props.onSwap}
          aria-label="Swap the two products"
          whileTap={{ rotate: 180 }}
          className="grid h-10 w-10 place-items-center rounded-full bg-card text-sm text-mute"
        >
          vs
        </motion.button>
        <ProductCard p={b} />
      </div>

      <AllergyWarning p={a} allergies={allergies} label={na} className="mt-4" />
      <AllergyWarning p={b} allergies={allergies} label={nb} className="mt-3" />

      {lines.length > 0 && <LineCard title="The big differences" lines={lines} />}

      <ul className="mt-4 rounded-[24px] bg-card px-5">
        {diffs.map((d, i) => {
          const m = NUTRIENTS.find((x) => x.key === d.key)!;
          const max = Math.max(d.a ?? 0, d.b ?? 0) || 1;
          return (
            <li key={d.key} className={`py-3.5 ${i ? "border-t border-line" : ""}`}>
              <p className="text-[15px] font-semibold">{m.label}</p>
              {[d.a, d.b].map((v, j) => {
                const p = j ? b : a;
                return (
                  <div key={j} className={`mt-2 grid items-center gap-2.5 ${mixed ? "grid-cols-[5rem_1fr_8.5rem]" : "grid-cols-[5rem_1fr_5rem]"}`}>
                    <span className="truncate text-[13px] text-mute">{j ? nb : na}</span>
                    <Bar pct={v === undefined ? 0 : (v / max) * 100} delay={0.1 + i * 0.05 + j * 0.06} dim={j === 1} className="mt-0" />
                    <span className="tabular whitespace-nowrap text-right text-[15px] font-semibold">
                      <span className="sr-only">{p.name}: </span>
                      {v === undefined ? (
                        <span className="text-[13px] font-normal text-mute">Not listed</span>
                      ) : (
                        <>
                          <Num v={v} />
                          <span className="ml-0.5 text-xs font-normal text-mute">
                            {m.unit}
                            {mixed && ` /${basisLabel(p)}`}
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
      <p className="mt-3 text-xs text-mute">Bars are scaled to the larger of the two values in each row.</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {[a, b].map((p, i) => (
          <div key={p.code} className="rounded-[24px] bg-card px-5 py-4">
            <h2 className="text-[17px] font-semibold">{i ? nb : na}</h2>
            <h3 className="mt-3 text-sm font-medium">Allergens declared</h3>
            <Chips items={p.allergens} mine={allergies} empty="None declared in the record." />
            <h3 className="mt-4 text-sm font-medium">Additives</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink/85">
              {p.additives.length ? (
                p.additives.map((x) => (x.name ? `${x.code} ${x.name}` : x.code)).join(", ")
              ) : (
                <span className="text-mute">None listed in the record.</span>
              )}
            </p>
            <AllergenNote />
          </div>
        ))}
      </div>

      <motion.button whileTap={{ scale: 0.98 }} onClick={props.onNew} className="mt-6 h-14 w-full rounded-full bg-ink text-base font-semibold text-canvas">
        New comparison
      </motion.button>
    </article>
  );
}

/* ───────────────────────── Bits ───────────────────────── */

const LINE_ICON: Record<Line["kind"], Icon> = {
  sugars: CubeIcon, carbs: GrainsIcon, fat: DropIcon, saturated: DropIcon, protein: BarbellIcon, fiber: LeafIcon,
  energy: ForkKnifeIcon, salt: GrainsIcon, caffeine: CoffeeIcon, allergen: WarningIcon,
};

function LineCard({ title, lines }: { title: string; lines: Line[] }) {
  return (
    <section className="mt-4 rounded-[26px] bg-card px-5 pb-1.5 pt-3.5">
      <h2 className="text-[13px] font-medium text-mute">{title}</h2>
      <ul>
        {lines.map((l, i) => {
          const I = LINE_ICON[l.kind];
          return (
            <motion.li
              key={l.text}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.07, duration: 0.4, ease: EASE }}
              className={`flex items-center gap-3.5 py-3 ${i ? "border-t border-line" : ""}`}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] bg-accent-soft text-accent">
                <I size={20} weight="bold" aria-hidden />
              </span>
              <span>
                <span className="block text-[16px] leading-snug">{l.text}</span>
                <span className="text-[13px] text-mute">{l.note}</span>
              </span>
            </motion.li>
          );
        })}
      </ul>
    </section>
  );
}

function ScanCard({ title, sub, onClick, disabled }: { title: string; sub: string; onClick: () => void; disabled?: boolean }) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      disabled={disabled}
      className="mt-6 flex w-full items-center gap-4 rounded-[28px] bg-ink p-5 text-left text-canvas disabled:opacity-60"
    >
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] bg-accent text-white">
        <BarcodeIcon size={30} weight="bold" aria-hidden />
      </span>
      <span>
        <span className="block text-[20px] font-semibold">{title}</span>
        <span className="text-sm opacity-75">{sub}</span>
      </span>
    </motion.button>
  );
}

function TypeInstead({ typing, onType, busy, onSubmit }: { typing: boolean; onType: () => void; busy: boolean; onSubmit: (code: string) => void }) {
  return typing ? (
    <CodeForm busy={busy} onSubmit={onSubmit} />
  ) : (
    <button onClick={onType} className="mx-auto mt-4 block text-[15px] text-mute underline underline-offset-4">
      Type the number instead
    </button>
  );
}

function CodeForm({ busy, onSubmit }: { busy: boolean; onSubmit: (code: string) => void }) {
  const [code, setCode] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(code);
      }}
      className="mt-4"
    >
      <label htmlFor="code" className="mb-1.5 block text-sm text-mute">
        Barcode number
      </label>
      <div className="flex items-center rounded-full bg-card pl-5 ring-1 ring-line focus-within:ring-2 focus-within:ring-ink">
        <input
          id="code"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
          className="tabular h-14 min-w-0 flex-1 bg-transparent text-lg tracking-wider outline-none"
        />
        <button disabled={busy || !code.trim()} className="m-1.5 h-11 rounded-full bg-ink px-5 font-medium text-canvas transition disabled:opacity-30">
          Look up
        </button>
      </div>
    </form>
  );
}

function ErrorText({ error }: { error: React.ReactNode }) {
  return (
    <AnimatePresence>
      {error && (
        <motion.p role="alert" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 rounded-2xl bg-card px-4 py-3 text-sm">
          {error}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

function ProductCard({ p, onClick, disabled }: { p: Product; onClick?: () => void; disabled?: boolean }) {
  const body = (
    <>
      <Thumb p={p} size="h-[120px] w-full" />
      <span className="mt-2.5 block truncate text-[15px] font-medium">{p.name}</span>
      <span className="block truncate text-[13px] text-mute">{[p.brand, p.quantity].filter(Boolean).join(", ") || p.code}</span>
    </>
  );
  return onClick ? (
    <motion.button whileTap={{ scale: 0.97 }} onClick={onClick} disabled={disabled} className="min-w-0 rounded-[22px] bg-card p-3 text-left disabled:opacity-40">
      {body}
    </motion.button>
  ) : (
    <div className="min-w-0 rounded-[22px] bg-card p-3">{body}</div>
  );
}

function PairList({ pairs, name, busy, onPair }: { pairs: [string, string][]; name: (c: string) => string; busy: boolean; onPair: (a: string, b: string) => void }) {
  return (
    <>
      <h2 className="mb-3 mt-8 text-[19px] font-semibold">Recent comparisons</h2>
      <ul className="grid gap-2">
        {pairs.map(([a, b]) => (
          <li key={a + b}>
            <button
              onClick={() => onPair(a, b)}
              disabled={busy}
              className="flex w-full items-center gap-3 rounded-[18px] bg-card px-4 py-3.5 text-left text-[15px] transition active:scale-[0.99] disabled:opacity-40"
            >
              <span className="min-w-0 flex-1 truncate">{name(a)}</span>
              <span className="text-sm text-mute">vs</span>
              <span className="min-w-0 flex-1 truncate text-right">{name(b)}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

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

function Bar({
  pct, delay = 0, dim, limit, className = "mt-2.5",
}: { pct: number; delay?: number; dim?: boolean; limit?: { at: number; label: string }; className?: string }) {
  const still = useReducedMotion();
  return (
    <div className={`relative ${className}`} aria-hidden>
      <div className="h-2">
        <motion.div
          className={`h-full rounded-full ${dim ? "bg-mute/50" : "bg-ink"}`}
          initial={still ? false : { width: 0 }}
          animate={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }}
          transition={still ? { duration: 0 } : { duration: 1.1, delay, ease: EASE }}
        />
      </div>
      {limit && (
        // Daily-limit marker: a tick crossing the bar, a dashed line over the room left before it, and a label.
        <motion.div
          className="relative h-5"
          initial={still ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: still ? 0 : delay + 0.9, duration: 0.4 }}
        >
          {pct < limit.at && (
            <span className="absolute top-0 border-t border-dashed border-mute" style={{ left: `${pct}%`, width: `${limit.at - pct}%`, marginTop: -4 }} />
          )}
          <span
            className="absolute -top-3.5 h-5 w-0.5 rounded-full bg-ink ring-2 ring-card"
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
  const list = (t: string[]) => t.map((x) => allergenLabel(x).toLowerCase()).join(", ");
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, duration: 0.45, ease: EASE }}
      className={`flex gap-3 rounded-[22px] bg-ink px-4 py-3.5 text-canvas ${className}`}
    >
      <WarningIcon size={22} weight="fill" className="mt-0.5 shrink-0" aria-hidden />
      <p className="text-[15px] leading-snug">
        {label && <span className="font-semibold">{label}: </span>}
        {contains.length > 0 && <b className="font-semibold">Contains {list(contains)}. </b>}
        {traces.length > 0 && <b className="font-semibold">May contain {list(traces)}. </b>}
        It&apos;s on your list. Check the pack to be sure.
      </p>
    </motion.div>
  );
}

const AllergenNote = () => (
  <p className="mt-3 text-xs leading-relaxed text-mute">
    From the product&apos;s record, which can be incomplete or wrong. A missing allergen here doesn&apos;t mean the product
    is free of it. Always read the pack.
  </p>
);

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function IngredientList({ p }: { p: Product }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!p.parts.length) return null;
  return (
    <section className="mt-4 rounded-[24px] bg-card px-5 pb-3 pt-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[17px] font-semibold">What&apos;s in it</h2>
        <span className="text-[13px] text-mute">Tap one to learn more</span>
      </div>
      {p.analysis.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {p.analysis.map((t) => (
            <span key={t} className="rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
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
            <li key={key} className={i ? "border-t border-line" : ""}>
              <button onClick={() => setOpen(isOpen ? null : key)} aria-expanded={isOpen} className="w-full py-3.5 text-left">
                <span className="flex items-baseline justify-between gap-4">
                  <span className="min-w-0">
                    <span className="text-[16px]">{cap(x.name)}</span>
                    {x.sub.length > 0 && <span className="ml-2 text-[13px] text-mute">({x.sub.join(", ")})</span>}
                  </span>
                  <span className="tabular flex shrink-0 items-center text-right text-[15px]">
                    <Pct x={x} />
                    <motion.span animate={{ rotate: isOpen ? 45 : 0 }} className="ml-3 inline-flex text-mute">
                      <PlusIcon size={16} weight="bold" aria-hidden />
                    </motion.span>
                  </span>
                </span>
                {x.pct !== undefined && x.pct > 0 && <Bar pct={Math.min(100, x.pct)} dim={!x.declared} delay={0.04 * i} />}
                {x.flags.length > 0 && (
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {x.flags.map((f) => (
                      <span key={f} className="rounded-full border border-line px-2 py-0.5 text-xs text-mute">
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
                    transition={{ duration: 0.3, ease: EASE }}
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
      <p className="mt-2 text-xs leading-relaxed text-mute">
        Percentages without ≈ are printed on the pack. The rest are Open Food Facts estimates, so treat them as rough. The
        vegan and palm oil notes are its estimates too, and this breakdown can come from a different version or language of
        the label.
      </p>
    </section>
  );
}

function Pct({ x }: { x: Ingredient }) {
  if (x.pct === undefined) return null;
  if (x.declared) return <span className="font-semibold">{+x.pct.toFixed(1)}%</span>;
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
    <div className="pb-4 pr-6" role="status" aria-live="polite">
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
        <div className="rounded-2xl bg-canvas px-4 py-3">
          {state.about && <p className="mb-1 text-xs text-mute">No article for {x.name} itself. Here&apos;s the broader {state.about}:</p>}
          <p className="text-[15px] leading-relaxed text-ink/85">{state.extract}</p>
          <a href={state.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-mute underline underline-offset-2">
            Excerpt from Wikipedia, “{state.title}”, CC BY-SA 4.0
          </a>
        </div>
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
    <section className="mt-4 rounded-[24px] bg-card px-5 pb-4 pt-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[17px] font-semibold">Additives</h2>
        <span className="text-[13px] text-mute">{items.length} listed</span>
      </div>
      {!items.length && <p className="pt-3 text-[15px] text-mute">None listed in the record.</p>}
      <ul>
        {items.map((a, i) => (
          <li key={a.code} className={`py-3.5 ${i ? "border-t border-line" : ""}`}>
            <p className="flex items-baseline gap-2.5">
              <span className="text-sm font-medium text-mute">{a.code}</span>
              <span className="text-[16px]">{a.name || "Unnamed in the database"}</span>
            </p>
            {a.adi ? (
              <p className="mt-1.5 text-sm text-ink/85">
                Safe daily amount: {a.adi} mg per kg of body weight, about {Math.round(Number(a.adi) * 70).toLocaleString("en")} mg a day
                for a 70 kg adult.
              </p>
            ) : (
              <p className="mt-1.5 text-sm text-mute">No safe daily amount recorded for it in the database.</p>
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
        <p className="mt-1 text-xs leading-relaxed text-mute">
          The safe daily amount (ADI) is what EFSA, the EU food safety agency, considers can be eaten every day over a lifetime
          without appreciable health risk. Packs don&apos;t state how much of each additive they contain, so this can&apos;t show
          how much one serving uses. Evaluations can be revised, so check the year.
        </p>
      )}
    </section>
  );
}

function Thumb({ p, size, big }: { p: Product; size: string; big?: boolean }) {
  return (
    <div className={`${size} flex items-center justify-center overflow-hidden bg-photo ${big ? "rounded-[28px]" : "rounded-2xl"}`}>
      {p.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.image} alt={p.name} className={`h-full w-full object-contain mix-blend-multiply ${big ? "p-[8%]" : "p-2"}`} />
      ) : (
        <span className="text-4xl font-semibold text-neutral-400">{p.name.slice(0, 1)}</span>
      )}
    </div>
  );
}

function Chips({ items, empty, mine = [] }: { items: string[]; empty?: string; mine?: string[] }) {
  if (!items.length) return <p className="mt-2 text-sm text-mute">{empty}</p>;
  return (
    <ul className="mt-2.5 flex flex-wrap gap-2">
      {items.map((t) => (
        <li
          key={t}
          className={`rounded-full px-3.5 py-1.5 text-sm capitalize ${mine.includes(t) ? "bg-ink font-medium text-canvas" : "bg-canvas"}`}
        >
          {allergenLabel(t)}
        </li>
      ))}
    </ul>
  );
}

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
      className="grid h-10 w-10 place-items-center rounded-full text-ink transition active:scale-95"
    >
      {dark === null ? null : dark ? <SunIcon size={21} aria-hidden /> : <MoonIcon size={21} aria-hidden />}
    </button>
  );
}

const basisLabel = (p: Product) => (p.basis === "100ml" ? "100 ml" : "100 g");

const Footer = () => (
  <footer className="mt-16 space-y-3 border-t border-line pt-6 text-xs leading-relaxed text-mute">
    <p className="text-ink/80">
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
      {label && <span className="sr-only">{label}</span>}
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
