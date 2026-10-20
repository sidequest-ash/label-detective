# Snack Intel

Scan a packaged food barcode, read the label in plain language, and compare two products per 100 g / 100 ml.

Next.js · TypeScript · Tailwind CSS · Motion · ZXing (with the native `BarcodeDetector` where available). Data from [Open Food Facts](https://world.openfoodfacts.org) (ODbL).

## Run

```bash
npm install
npm run dev
```

Set your contact in `.env.local`, as Open Food Facts asks every app to identify itself:

```
OFF_USER_AGENT="SnackIntel/0.1 (you@example.com)"
```

The phone camera needs HTTPS, so use a tunnel (e.g. ngrok) or deploy to test scanning on a phone. Add the tunnel's host to `allowedDevOrigins` in `next.config.ts`.

## How it treats the API

- Lookups go through `app/api/product/[code]`, which sends the User-Agent and caches results (6 h found, 10 min not found).
- 10 lookups per minute per visitor, and at most 15 upstream reads per minute (the Open Food Facts limit).
- Limits and cache live in memory, so they reset per server instance.

Ingredient explanations go through `app/api/ingredient`: Open Food Facts ingredients taxonomy → Wikidata → English Wikipedia summary. 30 per minute per visitor, cached for a week.

Nutrition context uses EU adult reference intakes as a sense of scale. No health scores, no additive verdicts.

## Credits and licences

- **Product data** from [Open Food Facts](https://world.openfoodfacts.org), under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/). Product photos are by Open Food Facts contributors under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). Additive and ingredient names come from the Open Food Facts taxonomies.
- **Ingredient explanations** are shortened excerpts of English [Wikipedia](https://en.wikipedia.org) article summaries, under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), each linked to its article. Wikidata is used to find the article (CC0).
- **Additive safety values** (ADI, overexposure estimates) are from [EFSA](https://www.efsa.europa.eu) evaluations, as recorded by Open Food Facts.
- **Daily limits**: salt and free sugars from WHO guidelines; caffeine from EFSA's 2015 opinion. **Reference intakes** from EU Regulation 1169/2011, Annex XIII.
- **Barcode reading**: [ZXing for JS](https://github.com/zxing-js) (Apache 2.0) or the browser's built-in `BarcodeDetector`.
- **Font**: Outfit (SIL Open Font License).

Not affiliated with or endorsed by Open Food Facts, Wikipedia, the WHO, EFSA or any brand shown.

## Disclaimer

General information only, not medical or dietary advice. Records are crowd-sourced and can be incomplete or wrong; the printed pack is the final word, especially for allergies.
