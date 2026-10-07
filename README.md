# Trade Desk — personal market dashboard

A dark, fast watchlist with price alerts. Static site (GitHub Pages) + a tiny
Cloudflare Worker that proxies Yahoo Finance quotes (no API key needed).

**Live:** https://bismark57.github.io/trade-desk/

## What it does (v1)

- Watchlist with live quotes: price, day change %, 5-day sparkline, day range, volume
- Auto-refresh every 60s (configurable 30s–5m), TSX market open/closed badge
- Price alerts: "above/below $X" or "moves ±N% from now" — browser notification + sound while the tab is open
- Add any Yahoo symbol (`ATH.TO` for TSX, `AAPL` for US). Watchlist + alerts persist in the browser.

## Setup — the data worker (one time, ~5 min)

The dashboard needs the quote proxy because browsers can't call Yahoo Finance
directly (CORS). Deploy it from any machine with Node:

```bash
cd trade-desk
npx wrangler login
npx wrangler deploy
```

That prints your worker URL, e.g.
`https://trade-desk-proxy.<your-subdomain>.workers.dev`.

Then open the dashboard → ⚙ Settings → paste the worker URL → Save.
Verify: visit `<worker-url>/health` (should say `{"ok":true,...}`) and
`<worker-url>/quote?symbols=ATH.TO,CVE.TO` (should return prices).

## Deploying the site

Push this folder to the `Bismark57/trade-desk` repo and enable GitHub Pages
(root). No build step — it's plain HTML/CSS/JS.

## Notes

- Quotes are delayed ~15 minutes (Yahoo free tier). Not investment advice.
- Alerts only fire while the dashboard tab is open. True push alerts while
  closed would need a backend scheduler — possible v2.
- No accounts, no tracking, no keys. Your watchlist lives in your browser.
