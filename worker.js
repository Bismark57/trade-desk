/* Trade Desk quote proxy — Cloudflare Worker.
   Proxies Yahoo Finance chart API (no key needed) and returns compact JSON.
   Deploy: npx wrangler deploy  (see README.md) */

const YAHOO = 'https://query1.finance.yahoo.com';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

async function yahooQuote(symbol) {
  const url = `${YAHOO}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  const j = await res.json();
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r) throw new Error('no data for ' + symbol);
  const m = r.meta || {};
  const closes = ((r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close) || []).filter((v) => v != null);
  const prev = m.chartPreviousClose;
  const price = m.regularMarketPrice;
  const changePct = m.regularMarketChangePercent != null ? m.regularMarketChangePercent
    : (prev && price ? ((price - prev) / prev) * 100 : null);
  return {
    symbol: m.symbol || symbol,
    name: m.longName || m.shortName || symbol,
    currency: m.currency || '',
    price,
    changePct,
    dayHigh: m.regularMarketDayHigh ?? null,
    dayLow: m.regularMarketDayLow ?? null,
    volume: m.regularMarketVolume ?? null,
    marketTime: m.regularMarketTime ?? null,
    spark: closes.slice(-30),
  };
}

export default {
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

    if (url.pathname === '/health') return json({ ok: true, time: Date.now() });

    if (url.pathname === '/quote') {
      const symbols = (url.searchParams.get('symbols') || '')
        .split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
      if (!symbols.length) return json({ error: 'pass ?symbols=ATH.TO,CVE.TO' }, 400);
      const out = {};
      await Promise.all(symbols.map(async (s) => {
        try { out[s] = { ok: true, ...(await yahooQuote(s)) }; }
        catch (e) { out[s] = { ok: false, error: String((e && e.message) || e) }; }
      }));
      return json(out);
    }

    return json({ error: 'use /quote?symbols=ATH.TO,CVE.TO or /health' }, 404);
  },
};
