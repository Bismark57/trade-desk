/* Trade Desk — personal market dashboard.
   Prices come from your own Cloudflare Worker (see README), which proxies
   Yahoo Finance. Alerts are evaluated in this tab every refresh cycle. */
'use strict';

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const DEFAULT_WATCHLIST = ['ATH.TO', 'CVE.TO', 'VFV.TO'];
let watchlist = LS.get('td.watchlist', DEFAULT_WATCHLIST);
let alerts = LS.get('td.alerts', []);
let workerUrl = (LS.get('td.settings', {}).workerUrl || '').replace(/\/$/, '');
let refreshSecs = LS.get('td.settings', {}).refreshSecs || 60;
let soundOn = LS.get('td.settings', {}).soundOn !== false;
let quotes = {}; // symbol -> quote
let timer = null;

const $ = (id) => document.getElementById(id);

function toast(msg, ms = 4200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), ms);
}

function fmt(n, d = 2) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-CA', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtVol(n) {
  if (n == null) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function sparkline(data, up) {
  if (!data || data.length < 2) return '<span class="muted">—</span>';
  const w = 90, h = 28, min = Math.min(...data), max = Math.max(...data);
  const span = (max - min) || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(' ');
  const color = up == null ? '#8b93a7' : (up ? '#26d07c' : '#f23645');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6"/></svg>`;
}

function renderQuotes() {
  const body = $('quoteBody');
  if (!watchlist.length) {
    body.innerHTML = '<tr><td colspan="7" class="muted center">Watchlist is empty — add a symbol above.</td></tr>';
    return;
  }
  body.innerHTML = watchlist.map((sym) => {
    const q = quotes[sym];
    if (!q) return `<tr><td class="sym">${esc(sym)}</td><td colspan="6" class="muted">No data</td></tr>`;
    if (!q.ok) return `<tr><td class="sym">${esc(sym)}</td><td colspan="6" class="muted">Error: ${esc(q.error || 'unknown')}</td></tr>`;
    const up = (q.changePct || 0) >= 0;
    const cls = up ? 'up' : 'down';
    const arrow = up ? '▲' : '▼';
    return `<tr>
      <td class="sym">${esc(sym.replace(/\.TO$/, ''))}<small>${esc(q.name || '')} · ${esc(q.currency || '')}</small></td>
      <td class="price">${fmt(q.price)}</td>
      <td class="${cls}">${arrow} ${fmt(Math.abs(q.changePct))}%</td>
      <td>${sparkline(q.spark, up)}</td>
      <td class="muted">${fmt(q.dayLow)} – ${fmt(q.dayHigh)}</td>
      <td class="muted">${fmtVol(q.volume)}</td>
      <td>
        <button class="rowbtn" data-act="alert" data-sym="${esc(sym)}">Alert</button>
        <button class="rowbtn" data-act="remove" data-sym="${esc(sym)}">✕</button>
      </td>
    </tr>`;
  }).join('');
  // alert symbol dropdown
  $('alertSymbol').innerHTML = watchlist.map((s) => `<option>${esc(s)}</option>`).join('');
}

function renderAlerts() {
  const ul = $('alertList');
  if (!alerts.length) {
    ul.innerHTML = '<li><span class="muted">No alerts set. Pick a symbol and a trigger above.</span></li>';
    return;
  }
  ul.innerHTML = alerts.map((a) => {
    const desc = a.type === 'above' ? `≥ $${fmt(a.value)}`
      : a.type === 'below' ? `≤ $${fmt(a.value)}`
      : a.type === 'pct_up' ? `up ${fmt(a.value, 1)}% from $${fmt(a.base)}`
      : `down ${fmt(a.value, 1)}% from $${fmt(a.base)}`;
    return `<li class="${a.fired ? 'fired' : ''}">
      <span><strong>${esc(a.symbol)}</strong> ${desc}</span>
      <span><span class="tag">${a.fired ? 'TRIGGERED' : 'watching'}</span>
      <button class="rowbtn" data-alert-del="${a.id}">✕</button></span>
    </li>`;
  }).join('');
}

function beep() {
  if (!soundOn) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = f; o.type = 'sine';
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.start(t); o.stop(t + 0.18);
    });
  } catch {}
}

function fireAlert(a, price) {
  a.fired = true;
  LS.set('td.alerts', alerts);
  renderAlerts();
  const msg = `🔔 ${a.symbol} alert: $${fmt(price)}`;
  beep();
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification('Trade Desk', { body: `${a.symbol} is now $${fmt(price)}` }); } catch {}
  }
  toast(msg, 8000);
}

function checkAlerts() {
  let changed = false;
  for (const a of alerts) {
    if (a.fired) continue;
    const q = quotes[a.symbol];
    if (!q || !q.ok || q.price == null) continue;
    const p = q.price;
    if (a.type === 'above' && p >= a.value) { fireAlert(a, p); changed = true; }
    else if (a.type === 'below' && p <= a.value) { fireAlert(a, p); changed = true; }
    else if ((a.type === 'pct_up' || a.type === 'pct_down') && a.base) {
      const pct = ((p - a.base) / a.base) * 100;
      if ((a.type === 'pct_up' && pct >= a.value) || (a.type === 'pct_down' && pct <= -a.value)) { fireAlert(a, p); changed = true; }
    }
  }
  if (changed) LS.set('td.alerts', alerts);
}

function marketBadge() {
  // TSX hours: 9:30–16:00 America/Toronto, Mon–Fri
  try {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' }));
    const day = now.getDay(), mins = now.getHours() * 60 + now.getMinutes();
    const open = day > 0 && day < 6 && mins >= 570 && mins < 960;
    const b = $('marketBadge');
    b.textContent = open ? '● Market open' : '● Market closed';
    b.className = 'badge ' + (open ? 'open' : 'closed');
  } catch { $('marketBadge').textContent = '● —'; }
}

async function refresh() {
  marketBadge();
  if (!workerUrl) { $('setupBanner').classList.remove('hidden'); return; }
  $('setupBanner').classList.add('hidden');
  try {
    const res = await fetch(`${workerUrl}/quote?symbols=${encodeURIComponent(watchlist.join(','))}`);
    if (!res.ok) throw new Error(`proxy ${res.status}`);
    quotes = await res.json();
    const t = new Date();
    $('lastUpdated').textContent = 'Updated ' + t.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    renderQuotes();
    checkAlerts();
  } catch (e) {
    $('lastUpdated').textContent = 'Update failed — ' + (e.message || 'network error');
  }
}

function startTimer() {
  clearInterval(timer);
  timer = setInterval(refresh, refreshSecs * 1000);
}

// --- events ---
$('refreshBtn').onclick = refresh;

$('addForm').onsubmit = (e) => {
  e.preventDefault();
  const raw = $('symbolInput').value.trim().toUpperCase().replace(/\s+/g, '');
  if (!raw) return;
  const finalSym = raw; // use as typed: ATH.TO for TSX, AAPL for US
  if (watchlist.includes(finalSym)) { toast('Already on the watchlist.'); return; }
  watchlist.push(finalSym);
  LS.set('td.watchlist', watchlist);
  $('symbolInput').value = '';
  renderQuotes(); renderAlerts(); refresh();
  toast(`${finalSym} added. Tip: use .TO for TSX (e.g. RY.TO).`);
};

document.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.act === 'remove') {
    watchlist = watchlist.filter((s) => s !== btn.dataset.sym);
    alerts = alerts.filter((a) => a.symbol !== btn.dataset.sym);
    LS.set('td.watchlist', watchlist); LS.set('td.alerts', alerts);
    renderQuotes(); renderAlerts();
  }
  if (btn.dataset.act === 'alert') {
    $('alertSymbol').value = btn.dataset.sym;
    $('alertValue').focus();
    $('alertValue').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  if (btn.dataset.alertDel) {
    alerts = alerts.filter((a) => a.id !== btn.dataset.alertDel);
    LS.set('td.alerts', alerts); renderAlerts();
  }
});

$('alertType').onchange = () => {
  const t = $('alertType').value;
  $('alertUnit').textContent = (t === 'pct_up' || t === 'pct_down') ? '%' : '$';
  $('alertValue').placeholder = (t === 'pct_up' || t === 'pct_down') ? 'e.g. 3' : 'e.g. 12.50';
};

$('alertForm').onsubmit = (e) => {
  e.preventDefault();
  const symbol = $('alertSymbol').value;
  const type = $('alertType').value;
  const value = parseFloat($('alertValue').value);
  if (!symbol || !(value > 0)) { toast('Pick a symbol and enter a value.'); return; }
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
  const q = quotes[symbol];
  const base = (type === 'pct_up' || type === 'pct_down') && q && q.ok ? q.price : null;
  if ((type === 'pct_up' || type === 'pct_down') && !base) { toast('Need a current price first — wait for the next refresh.'); return; }
  alerts.push({ id: 'a' + Date.now().toString(36), symbol, type, value, base, fired: false });
  LS.set('td.alerts', alerts);
  $('alertValue').value = '';
  renderAlerts();
  toast(`Alert set on ${symbol}.`);
};

// settings
$('settingsBtn').onclick = () => {
  $('workerUrl').value = workerUrl;
  $('refreshSecs').value = String(refreshSecs);
  $('soundOn').checked = soundOn;
  $('settingsModal').classList.remove('hidden');
};
$('closeSettings').onclick = () => $('settingsModal').classList.add('hidden');
$('settingsModal').addEventListener('click', (e) => {
  if (e.target.id === 'settingsModal') $('settingsModal').classList.add('hidden');
});
$('saveSettings').onclick = () => {
  workerUrl = $('workerUrl').value.trim().replace(/\/$/, '');
  refreshSecs = parseInt($('refreshSecs').value, 10) || 60;
  soundOn = $('soundOn').checked;
  LS.set('td.settings', { workerUrl, refreshSecs, soundOn });
  $('settingsModal').classList.add('hidden');
  startTimer(); refresh();
  toast('Settings saved.');
};

// init
renderQuotes();
renderAlerts();
marketBadge();
if (!workerUrl) $('setupBanner').classList.remove('hidden');
else refresh();
startTimer();
