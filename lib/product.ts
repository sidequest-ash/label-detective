export type NutrientKey = "energy" | "fat" | "saturated" | "carbs" | "sugars" | "fiber" | "protein" | "salt";

// ri = EU adult Reference Intake (Regulation 1169/2011, Annex XIII). Fibre has none.
export const NUTRIENTS: { key: NutrientKey; label: string; unit: "kcal" | "g"; off: string; ri?: number; sub?: boolean }[] = [
  { key: "energy", label: "Energy", unit: "kcal", off: "energy-kcal_100g", ri: 2000 },
  { key: "fat", label: "Fat", unit: "g", off: "fat_100g", ri: 70 },
  { key: "saturated", label: "Saturates", unit: "g", off: "saturated-fat_100g", ri: 20, sub: true },
  { key: "carbs", label: "Carbohydrate", unit: "g", off: "carbohydrates_100g", ri: 260 },
  { key: "sugars", label: "Sugars", unit: "g", off: "sugars_100g", ri: 90, sub: true },
  { key: "fiber", label: "Fibre", unit: "g", off: "fiber_100g" },
  { key: "protein", label: "Protein", unit: "g", off: "proteins_100g", ri: 50 },
  { key: "salt", label: "Salt", unit: "g", off: "salt_100g", ri: 6 },
];

export type Product = {
  code: string;
  name: string;
  brand: string;
  image: string | null;
  quantity: string;
  basis: "100g" | "100ml";
  ingredients: string;
  allergens: string[];
  traces: string[];
  n: Partial<Record<NutrientKey, number>>;
};

export const OFF_FIELDS = [
  "product_name", "product_name_en", "brands", "image_front_url", "quantity",
  "ingredients_text", "ingredients_text_en", "allergens_tags", "traces_tags", "nutriments",
].join(",");

const tags = (t: unknown) =>
  Array.isArray(t) ? t.map((s: string) => s.replace(/^\w\w:/, "").replace(/-/g, " ")) : [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalize(code: string, p: any): Product {
  const raw = p.nutriments ?? {};
  const n: Product["n"] = {};
  for (const { key, off } of NUTRIENTS) {
    const v = Number(raw[off]);
    if (raw[off] !== undefined && raw[off] !== "" && Number.isFinite(v)) n[key] = v;
  }
  if (n.energy === undefined && Number.isFinite(Number(raw["energy-kj_100g"])))
    n.energy = Math.round(Number(raw["energy-kj_100g"]) / 4.184);
  const quantity = String(p.quantity ?? "");
  return {
    code,
    name: p.product_name_en || p.product_name || "Unnamed product",
    brand: String(p.brands ?? "").split(",")[0].trim(),
    image: p.image_front_url || null,
    quantity,
    // ponytail: liquid guessed from pack size unit; OFF stores both under *_100g keys
    basis: /\d\s*(ml|cl|l)\b/i.test(quantity) ? "100ml" : "100g",
    ingredients: p.ingredients_text_en || p.ingredients_text || "",
    allergens: tags(p.allergens_tags),
    traces: tags(p.traces_tags),
    n,
  };
}

export const fmt = (x: number, target = x) =>
  target >= 100 ? Math.round(x).toLocaleString("en") : target >= 1 ? x.toFixed(1) : x.toFixed(2);

const per = (p: Product) => (p.basis === "100ml" ? "100 ml" : "100 g");

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
  return meta.ri ? `${base} · ${Math.round((v / meta.ri) * 100)}% of an adult's reference intake` : base;
}

export type Diff = { key: NutrientKey; a?: number; b?: number; text: string; weight: number };

export function compare(a: Product, b: Product): Diff[] {
  return NUTRIENTS.map(({ key, label, unit, ri }) => {
    const x = a.n[key], y = b.n[key];
    if (x === undefined || y === undefined) return { key, a: x, b: y, text: "Missing for one product", weight: 0 };
    if (x === y) return { key, a: x, b: y, text: "Identical", weight: 0 };
    const [hi, lo, who] = x > y ? [x, y, "A"] : [y, x, "B"];
    const ratio = lo > 0 ? hi / lo : Infinity;
    const times = ratio >= 1.5 && ratio !== Infinity ? ` (${ratio.toFixed(1)}×)` : "";
    return {
      key, a: x, b: y,
      text: `${who} has ${fmt(hi - lo, unit === "kcal" ? 100 : hi - lo)} ${unit} more ${label.toLowerCase()}${times}`,
      weight: (hi - lo) / (ri ?? 30),
    };
  });
}

// Self-check: `node --experimental-strip-types lib/product.ts`
if (typeof process !== "undefined" && process.argv[1]?.endsWith("product.ts")) {
  const p = normalize("1", { product_name: "X", quantity: "330 ml", nutriments: { sugars_100g: 10.6, "energy-kj_100g": 418.4, carbohydrates_100g: "" } });
  const q = normalize("2", { nutriments: { sugars_100g: 0, "energy-kcal_100g": 0.3 } });
  console.assert(p.basis === "100ml" && p.n.energy === 100 && p.n.carbs === undefined, "normalize");
  const d = compare(p, q).find((x) => x.key === "sugars")!;
  console.assert(d.text === "A has 10.6 g more sugars", d.text);
  console.assert(explain(p, "sugars").includes("12% of"), explain(p, "sugars"));
  console.log("ok");
}
