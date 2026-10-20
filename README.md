# Label Detective

Scan a packaged food barcode, read the label in plain language, and compare two products per 100 g / 100 ml.

Next.js · TypeScript · Tailwind CSS · Motion · ZXing (with the native `BarcodeDetector` where available). Data from [Open Food Facts](https://world.openfoodfacts.org) (ODbL).

## Run

```bash
npm install
npm run dev
```

Set your contact in `.env.local`, as Open Food Facts asks every app to identify itself:

```
OFF_USER_AGENT="LabelDetective/0.1 (you@example.com)"
```

The phone camera needs HTTPS, so use a tunnel (e.g. ngrok) or deploy to test scanning on a phone. Add the tunnel's host to `allowedDevOrigins` in `next.config.ts`.

## How it treats the API

- Lookups go through `app/api/product/[code]`, which sends the User-Agent and caches results (6 h found, 10 min not found).
- 10 lookups per minute per visitor, and at most 15 upstream reads per minute (the Open Food Facts limit).
- Limits and cache live in memory, so they reset per server instance.

Nutrition context uses EU adult reference intakes as a sense of scale. No health scores, no additive verdicts.
