export type NutrientKey = "energy" | "fat" | "saturated" | "carbs" | "sugars" | "fiber" | "protein" | "salt" | "caffeine";

// ri = EU adult Reference Intake (Regulation 1169/2011, Annex XIII). Fibre and caffeine have none.
// optional rows are hidden when the product doesn't list them.
export const NUTRIENTS: {
  key: NutrientKey; label: string; unit: "kcal" | "g" | "mg"; off: string; scale?: number; ri?: number; sub?: boolean; optional?: boolean;
}[] = [
  { key: "energy", label: "Energy", unit: "kcal", off: "energy-kcal_100g", ri: 2000 },
  { key: "fat", label: "Fat", unit: "g", off: "fat_100g", ri: 70 },
  { key: "saturated", label: "Saturates", unit: "g", off: "saturated-fat_100g", ri: 20, sub: true },
  { key: "carbs", label: "Carbohydrate", unit: "g", off: "carbohydrates_100g", ri: 260 },
  { key: "sugars", label: "Sugars", unit: "g", off: "sugars_100g", ri: 90, sub: true },
  { key: "fiber", label: "Fibre", unit: "g", off: "fiber_100g" },
  { key: "protein", label: "Protein", unit: "g", off: "proteins_100g", ri: 50 },
  { key: "salt", label: "Salt", unit: "g", off: "salt_100g", ri: 6 },
  { key: "caffeine", label: "Caffeine", unit: "mg", off: "caffeine_100g", scale: 1000, optional: true },
];

/** Published daily upper limits for adults. */
export const LIMITS: Partial<Record<NutrientKey, { max: number; by: string; note: string }>> = {
  salt: { max: 5, by: "WHO", note: "WHO advises adults keep salt under 5 g a day." },
  sugars: {
    max: 50,
    by: "WHO",
    note: "WHO advises keeping free sugars under 10% of energy (about 50 g on 2,000 kcal). Label sugars also include natural sugars from fruit and milk, so this is an upper bound.",
  },
  caffeine: { max: 400, by: "EFSA", note: "EFSA considers up to 400 mg a day safe for healthy adults (200 mg in pregnancy)." },
};

// EU's 14 mandatory allergens, keyed by Open Food Facts tag (after `tags()` below).
export const ALLERGENS: { tag: string; label: string }[] = [
  { tag: "gluten", label: "Gluten" },
  { tag: "milk", label: "Milk" },
  { tag: "eggs", label: "Eggs" },
  { tag: "peanuts", label: "Peanuts" },
  { tag: "nuts", label: "Tree nuts" },
  { tag: "soybeans", label: "Soy" },
  { tag: "sesame seeds", label: "Sesame" },
  { tag: "fish", label: "Fish" },
  { tag: "crustaceans", label: "Crustaceans" },
  { tag: "molluscs", label: "Molluscs" },
  { tag: "celery", label: "Celery" },
  { tag: "mustard", label: "Mustard" },
  { tag: "lupin", label: "Lupin" },
  { tag: "sulphur dioxide and sulphites", label: "Sulphites" },
];

export type Additive = {
  code: string; // "E951"
  name: string;
  adi?: string; // mg per kg body weight per day
  risk?: "high" | "moderate" | "no"; // EFSA overexposure estimate, whole diet
  groups?: string; // population groups whose high consumers may exceed the ADI
  year?: string;
  url?: string;
};

export type Ingredient = {
  id: string; // OFF taxonomy id, "en:palm-oil"
  name: string; // English where the taxonomy knows it, else as printed
  pct?: number;
  declared?: boolean; // pct printed on the pack, not estimated
  flags: string[];
  sub: string[];
};

/** English names from the OFF ingredients taxonomy, keyed "en:sugar". */
export type IngredientNames = Record<string, { name?: string }>;

const ANALYSIS: Record<string, string> = {
  "en:vegan": "Vegan", "en:non-vegan": "Not vegan", "en:maybe-vegan": "Maybe vegan",
  "en:vegetarian": "Vegetarian", "en:non-vegetarian": "Not vegetarian", "en:maybe-vegetarian": "Maybe vegetarian",
  "en:palm-oil-free": "Palm oil free", "en:palm-oil": "Contains palm oil", "en:may-contain-palm-oil": "May contain palm oil",
};

/** Compact EFSA facts from the Open Food Facts additives taxonomy, keyed "en:e951". */
export type AdditiveTaxonomy = Record<string, Omit<Additive, "code"> & { parents?: string[] }>;

export type Product = {
  code: string;
  name: string;
  brand: string;
  image: string | null;
  quantity: string;
  serving: number | null; // g or ml
  basis: "100g" | "100ml";
  ingredients: string;
  allergens: string[];
  traces: string[];
  additives: Additive[];
  parts: Ingredient[];
  analysis: string[]; // OFF's vegan / vegetarian / palm oil estimate
  n: Partial<Record<NutrientKey, number>>;
};

export const OFF_FIELDS = [
  "product_name", "product_name_en", "brands", "image_front_url", "quantity", "serving_quantity",
  "ingredients_text", "ingredients_text_en", "allergens_tags", "traces_tags", "additives_tags", "nutriments",
  "ingredients", "ingredients_analysis_tags",
].join(",");

const tags = (t: unknown) =>
  Array.isArray(t) ? t.map((s: string) => s.replace(/^\w\w:/, "").replace(/-/g, " ")) : [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseTaxonomy(raw: Record<string, any>): AdditiveTaxonomy {
  const en = (v: { en?: string } | undefined) => v?.en;
  const out: AdditiveTaxonomy = {};
  for (const [id, v] of Object.entries(raw)) {
    const name = en(v.name);
    if (!name) continue;
    const risk = en(v.efsa_evaluation_overexposure_risk)?.replace("en:", "");
    out[id] = {
      name: name.replace(/^E\d+\w*\s*-\s*/, ""),
      adi: en(v.efsa_evaluation_adi),
      risk: risk === "high" || risk === "moderate" || risk === "no" ? risk : undefined,
      groups: en(v.efsa_evaluation_exposure_95th_greater_than_adi)?.replace(/en:/g, ""),
      year: en(v.efsa_evaluation_date)?.slice(0, 4),
      url: en(v.efsa_evaluation_url),
      parents: v.parents,
    };
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalize(code: string, p: any, taxonomy: AdditiveTaxonomy = {}, names: IngredientNames = {}): Product {
  const raw = p.nutriments ?? {};
  const n: Product["n"] = {};
  for (const { key, off, scale = 1 } of NUTRIENTS) {
    const v = Number(raw[off]);
    if (raw[off] !== undefined && raw[off] !== "" && Number.isFinite(v)) n[key] = Math.round(v * scale * 1000) / 1000;
  }
  const kj = Number(raw["energy-kj_100g"]);
  const fromKj = raw["energy-kj_100g"] !== undefined && Number.isFinite(kj) ? Math.round(kj / 4.184) : undefined;
  if (n.energy === undefined) n.energy = fromKj;
  else if (fromKj !== undefined && Math.abs(n.energy - fromKj) > 0.2 * Math.max(n.energy, fromKj)) {
    // Records sometimes have a typo in one of kcal / kJ. Keep the one that matches the macros (4/4/9 kcal per g).
    const macros = 4 * (n.carbs ?? 0) + 4 * (n.protein ?? 0) + 9 * (n.fat ?? 0);
    if (Math.abs(fromKj - macros) < Math.abs(n.energy - macros)) n.energy = fromKj;
  }
  const quantity = String(p.quantity ?? "");
  const addTags: string[] = Array.isArray(p.additives_tags) ? p.additives_tags : [];
  const serving = Number(p.serving_quantity);
  return {
    code,
    name: p.product_name_en || p.product_name || "Unnamed product",
    brand: String(p.brands ?? "").split(",")[0].trim(),
    image: p.image_front_url || null,
    quantity,
    serving: serving > 0 ? serving : null,
    // ponytail: liquid guessed from pack size unit; OFF stores both under *_100g keys
    basis: /\d\s*(ml|cl|l)\b/i.test(quantity) ? "100ml" : "100g",
    ingredients: p.ingredients_text_en || p.ingredients_text || "",
    allergens: tags(p.allergens_tags),
    traces: tags(p.traces_tags),
    // Sub-variants (e500ii) are dropped when their parent (e500) is listed too.
    additives: addTags
      .filter((t) => !taxonomy[t]?.parents?.some((x) => addTags.includes(x)))
      .map((t) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { parents, ...info } = taxonomy[t] ?? { name: "" };
        return { ...info, code: t.replace(/^\w\w:/, "").toUpperCase() };
      }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parts: (Array.isArray(p.ingredients) ? p.ingredients : []).map((i: any): Ingredient => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const name = (x: any) => String(taxonomy[x.id] ? `${x.id.slice(3).toUpperCase()} ${taxonomy[x.id].name}` : names[x.id]?.name ?? x.text ?? x.id);
      const declared = Number.isFinite(Number(i.percent)) && i.percent !== undefined;
      const pct = declared ? Number(i.percent) : Number(i.percent_estimate);
      const flags = [
        i.vegan === "no" && "Not vegan",
        i.vegetarian === "no" && "Not vegetarian",
        i.from_palm_oil === "yes" && "Palm oil",
        i.from_palm_oil === "maybe" && "May be palm oil",
      ].filter(Boolean) as string[];
      return {
        id: String(i.id),
        name: name(i),
        ...(Number.isFinite(pct) && { pct: Math.round(pct * 10) / 10, declared }),
        flags,
        sub: Array.isArray(i.ingredients) ? i.ingredients.map(name) : [],
      };
    }),
    analysis: (Array.isArray(p.ingredients_analysis_tags) ? p.ingredients_analysis_tags : []).flatMap((t: string) => ANALYSIS[t] ?? []),
    n,
  };
}

export const fmt = (x: number, target = x) =>
  target >= 100 ? Math.round(x).toLocaleString("en") : target >= 1 ? x.toFixed(1) : x.toFixed(2);

const per = (p: Product) => (p.basis === "100ml" ? "100 ml" : "100 g");
const amount = (x: number, ml: boolean) =>
  x >= 1000 ? `${(x / 1000).toFixed(1)} ${ml ? "L" : "kg"}` : `${x >= 50 ? Math.round(x / 5) * 5 : Math.round(x)} ${ml ? "ml" : "g"}`;

/** One neutral, factual sentence about the biggest macronutrient. */
export function headline(p: Product): string | null {
  const macros = (["carbs", "fat", "protein"] as const).filter((k) => p.n[k] !== undefined);
  if (!macros.length) return null;
  const top = macros.reduce((a, b) => (p.n[a]! >= p.n[b]! ? a : b));
  const label = { carbs: "carbohydrate", fat: "fat", protein: "protein" }[top];
  return `${fmt(p.n[top]!)} g of every ${per(p)} is ${label}.`;
}

export function explain(p: Product, key: NutrientKey): string {
  const meta = NUTRIENTS.find((m) => m.key === key)!;
  const v = p.n[key];
  if (v === undefined) return "Not listed on this product's record.";
  const base = `${fmt(v)} ${meta.unit} per ${per(p)}`;
  return meta.ri ? `${base}, ${Math.round((v / meta.ri) * 100)}% of an adult's reference intake` : base;
}

/** How much of the product reaches a published daily limit, and what one serving uses. */
export function limitLine(p: Product, key: NutrientKey): string | null {
  const lim = LIMITS[key], v = p.n[key];
  if (!lim || v === undefined) return null;
  const unit = NUTRIENTS.find((m) => m.key === key)!.unit;
  const label = `${lim.by} daily limit (${lim.max} ${unit})`;
  if (v === 0) return `None in it, so it adds nothing toward the ${label}.`;
  const ml = p.basis === "100ml";
  let s = `You'd reach the ${label} at about ${amount((lim.max / v) * 100, ml)} of this.`;
  if (p.serving) s += ` One ${amount(p.serving, ml)} serving is ${Math.round(((v * p.serving) / 100 / lim.max) * 100)}% of it.`;
  return s;
}

export type Diff = { key: NutrientKey; a?: number; b?: number; text: string; weight: number };

export function compare(a: Product, b: Product): Diff[] {
  return NUTRIENTS.filter((m) => !m.optional || a.n[m.key] !== undefined || b.n[m.key] !== undefined).map(
    ({ key, label, unit, ri }) => {
      const x = a.n[key], y = b.n[key];
      if (x === undefined && y === undefined) return { key, text: "Not listed for either", weight: 0 };
      if (x === undefined || y === undefined) return { key, a: x, b: y, text: "Missing for one product", weight: 0 };
      if (x === y) return { key, a: x, b: y, text: "Identical", weight: 0 };
      const [hi, lo, who] = x > y ? [x, y, "A"] : [y, x, "B"];
      const ratio = lo > 0 ? hi / lo : Infinity;
      const times = ratio >= 1.5 && ratio !== Infinity ? ` (${ratio.toFixed(1)}×)` : "";
      return {
        key, a: x, b: y,
        text: `${who} has ${fmt(hi - lo, unit === "g" ? hi - lo : 100)} ${unit} more ${label.toLowerCase()}${times}`,
        weight: (hi - lo) / (ri ?? LIMITS[key]?.max ?? 30),
      };
    },
  );
}

/** Allergens on the visitor's list that the product contains or may contain. */
export function allergyHits(p: Product, mine: string[]) {
  return { contains: p.allergens.filter((t) => mine.includes(t)), traces: p.traces.filter((t) => mine.includes(t) && !p.allergens.includes(t)) };
}

export const allergenLabel = (tag: string) => ALLERGENS.find((a) => a.tag === tag)?.label ?? tag;

// Self-check: `node --experimental-strip-types lib/product.ts`
if (typeof process !== "undefined" && process.argv[1]?.endsWith("product.ts")) {
  const assert = (ok: boolean, msg: string) => { if (!ok) { console.error("FAIL", msg); process.exit(1); } };
  const tax = parseTaxonomy({
    "en:e951": { name: { en: "E951 - Aspartame" }, efsa_evaluation_adi: { en: "40" }, efsa_evaluation_overexposure_risk: { en: "en:no" }, efsa_evaluation_date: { en: "2013-12-10" } },
    "en:e500": { name: { en: "E500 - Sodium carbonates" } },
    "en:e500ii": { name: { en: "E500ii - Sodium hydrogen carbonate" }, parents: ["en:e500"] },
  });
  const p = normalize("1", {
    product_name: "X", quantity: "330 ml", serving_quantity: 250,
    allergens_tags: ["en:milk"], traces_tags: ["en:nuts", "en:milk"],
    additives_tags: ["en:e951", "en:e500", "en:e500ii", "en:e9999"],
    nutriments: { sugars_100g: 10.6, "energy-kj_100g": 418.4, carbohydrates_100g: "", caffeine_100g: 0.032, salt_100g: 0 },
  }, tax);
  const typo = normalize("3", { nutriments: { "energy-kcal_100g": 463, "energy-kj_100g": 194, carbohydrates_100g: 11 } });
  assert(typo.n.energy === 46, `kcal typo -> ${typo.n.energy}`);
  const ing = normalize("4", {
    ingredients: [
      { id: "en:sugar", text: "azúcar", percent_estimate: 10.63 },
      { id: "en:cereal", text: "Céréale", percent: 50, vegan: "yes", ingredients: [{ id: "en:wheat-flour", text: "farine" }] },
      { id: "en:oil", text: "huiles", from_palm_oil: "maybe", vegan: "no" },
    ],
    ingredients_analysis_tags: ["en:non-vegan", "en:vegetarian-status-unknown", "en:may-contain-palm-oil"],
  }, {}, { "en:sugar": { name: "sugar" }, "en:wheat-flour": { name: "wheat flour" } });
  assert(JSON.stringify(ing.parts.map((x) => [x.name, x.pct, x.declared, x.flags.join("|"), x.sub.join()])) ===
    JSON.stringify([["sugar", 10.6, false, "", ""], ["Céréale", 50, true, "", "wheat flour"], ["huiles", undefined, undefined, "Not vegan|May be palm oil", ""]]), JSON.stringify(ing.parts));
  assert(ing.analysis.join() === "Not vegan,May contain palm oil", ing.analysis.join());
  const q = normalize("2", { nutriments: { sugars_100g: 0, "energy-kcal_100g": 0.3 } });
  assert(p.basis === "100ml" && p.n.energy === 100 && p.n.carbs === undefined && p.n.caffeine === 32, "normalize");
  assert(p.additives.map((a) => a.code).join() === "E951,E500,E9999", "additive parents");
  assert(p.additives[0].name === "Aspartame" && p.additives[0].adi === "40" && p.additives[0].year === "2013", "additive info");
  const d = compare(p, q).find((x) => x.key === "sugars")!;
  assert(d.text === "A has 10.6 g more sugars", d.text);
  assert(explain(p, "sugars").includes("12% of"), explain(p, "sugars"));
  assert(limitLine(p, "caffeine") === "You'd reach the EFSA daily limit (400 mg) at about 1.3 L of this. One 250 ml serving is 20% of it.", limitLine(p, "caffeine")!);
  assert(limitLine(p, "salt")!.startsWith("None in it"), "zero salt");
  const hits = allergyHits(p, ["milk", "nuts"]);
  assert(hits.contains.join() === "milk" && hits.traces.join() === "nuts", "allergy hits");
  console.log("ok");
}
