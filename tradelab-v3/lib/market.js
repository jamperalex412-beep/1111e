'use strict';
/* Котировки, бары и история. Источники данных подключаются в feeds.js. */
const { db } = require('./db');
const { isOpen } = require('./catalog');

const TF = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 };
let LIST = [], INS = {};
function loadInstruments() {
  LIST = db.prepare('SELECT * FROM instruments ORDER BY sort, sym').all();
  INS = Object.fromEntries(LIST.map(i => [i.sym, i]));
}
loadInstruments();

const Q = new Map();        // sym -> { bid, ask, last, t, src, ref, at }
const LIVE = new Map();     // sym -> минутные бары из тиков
const ASSIGN = {};          // sym -> провайдер
const SIMFB = new Set();    // символы на резервной симуляции
const round = (v, d) => { const f = 10 ** d; return Math.round(v * f) / f; };

function tick(sym, { last, bid, ask, t = Date.now(), vol = 0, ref, src }) {
  const i = INS[sym]; if (!i) return;
  if (src === 'sim') { if (ASSIGN[sym] !== 'sim' && !SIMFB.has(sym)) return; }
  else if (src !== ASSIGN[sym]) return;
  else if (SIMFB.delete(sym)) { LIVE.delete(sym); clearHistory(sym); }
  if (!(last > 0) && bid > 0 && ask > 0) last = (bid + ask) / 2;
  if (!(last > 0) || !isFinite(last)) return;
  if (!(bid > 0 && ask > 0 && ask >= bid)) { const h = last * i.spread / 200; bid = last - h; ask = last + h; }
  const step = 10 ** -i.digits;
  bid = round(bid, i.digits); ask = round(ask, i.digits); if (ask <= bid) ask = round(bid + step, i.digits);
  const q = Q.get(sym) || {};
  Object.assign(q, { bid, ask, last, t, src, at: Date.now() });
  if (ref > 0) q.ref = ref; if (!q.ref) q.ref = last;
  Q.set(sym, q);
  const bt = Math.floor(t / 60000) * 60;
  let a = LIVE.get(sym); if (!a) LIVE.set(sym, a = []);
  const L = a[a.length - 1];
  if (L && L.time === bt) { if (last > L.high) L.high = last; if (last < L.low) L.low = last; L.close = last; L.volume += vol || 0; }
  else if (!L || bt > L.time) { a.push({ time: bt, open: L && bt - L.time <= 120 ? L.close : last, high: last, low: last, close: last, volume: vol || 0 }); if (a.length > 3000) a.shift(); }
}
const setRef = (sym, ref) => { const q = Q.get(sym); if (q && ref > 0) q.ref = ref; };

function quote(sym) {
  const i = INS[sym], q = Q.get(sym);
  if (!i || !q) return null;
  return { ...q, open: isOpen(i.session), mid: (q.bid + q.ask) / 2 };
}

// Перевод суммы в валюте котировки в доллары
const FALLBACK = { EUR: 1.05, GBP: 1.26, JPY: 1 / 154, CHF: 1 / 0.88, CAD: 1 / 1.4, AUD: 0.65, NZD: 0.59 };
function rate(ccy) {
  if (!ccy || ccy === 'USD') return 1;
  const d = Q.get(ccy + 'USD'); if (d) return (d.bid + d.ask) / 2;
  const r = Q.get('USD' + ccy); if (r) return 2 / (r.bid + r.ask);
  return FALLBACK[ccy] || 1;
}
const toUSD = (amount, ccy) => amount * rate(ccy);

// --- История ---
const bucket = (t, sec) => Math.floor(t / sec) * sec;
function normalize(bars, sec) {
  const out = [];
  for (const b of bars) {
    if (!(b.close > 0)) continue;
    const k = bucket(b.time, sec), L = out[out.length - 1];
    if (L && L.time === k) { L.high = Math.max(L.high, b.high); L.low = Math.min(L.low, b.low); L.close = b.close; L.volume += b.volume || 0; }
    else if (!L || k > L.time) out.push({ time: k, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 });
  }
  return out;
}
function seeded(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function simHistory(i, tf, n = 1000) {
  const sec = TF[tf], end = bucket(Date.now() / 1000, sec), last = Q.get(i.sym)?.last || i.base;
  let h = 0; for (const c of i.sym + tf) h = (h * 31 + c.charCodeAt(0)) | 0;
  const rnd = seeded(h), gauss = () => { let u = rnd() || 1e-9, v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const sig = i.vol * Math.sqrt(sec / 3600);
  let p = 1; const raw = [];
  for (let k = 0; k < n; k++) {
    const o = p; let hi = p, lo = p;
    for (let s = 0; s < 4; s++) { p *= Math.exp(sig / 2 * gauss()); hi = Math.max(hi, p); lo = Math.min(lo, p); }
    raw.push({ o, h: hi, l: lo, c: p, v: Math.round(100 + rnd() * 900) });
  }
  const f = last / p;
  return raw.map((b, k) => ({ time: end - (n - 1 - k) * sec, open: b.o * f, high: b.h * f, low: b.l * f, close: b.c * f, volume: b.v }));
}

const HC = new Map(); let historyFetcher = null;
const TTL = { M1: 20e3, M5: 60e3, M15: 90e3, M30: 120e3, H1: 180e3, H4: 300e3, D1: 600e3 };
async function history(sym, tf) {
  const i = INS[sym]; if (!i || !TF[tf]) throw new Error('Нет инструмента или таймфрейма');
  const key = sym + '|' + tf, c = HC.get(key);
  if (c && Date.now() - c.t < c.ttl) return c.bars;
  if (c?.p) return c.p;
  const p = (async () => {
    let bars = null, src = 'sim';
    try { if (historyFetcher) { const r = await historyFetcher(i, tf); if (r && r.bars?.length > 5) { bars = normalize(r.bars, TF[tf]); src = r.src; } } } catch (e) { /* падаем на симуляцию */ }
    if (!bars) bars = simHistory(i, tf);
    HC.set(key, { t: Date.now(), ttl: src === 'sim' && ASSIGN[sym] !== 'sim' ? 30e3 : TTL[tf], bars, src });
    return bars;
  })();
  HC.set(key, { ...(c || {}), t: c?.t || 0, ttl: c?.ttl || 0, bars: c?.bars, p });
  try { return await p; } finally { const x = HC.get(key); if (x) delete x.p; }
}
function mergeLive(sym, tf, hist) {
  const sec = TF[tf], live = LIVE.get(sym) || [], out = hist.map(b => ({ ...b }));
  const agg = [];
  for (const b of live) { const k = bucket(b.time, sec), L = agg[agg.length - 1];
    if (L && L.time === k) { L.high = Math.max(L.high, b.high); L.low = Math.min(L.low, b.low); L.close = b.close; L.volume += b.volume; }
    else agg.push({ ...b, time: k }); }
  for (const a of agg) {
    const L = out[out.length - 1];
    if (!L || a.time > L.time) { out.push(a); continue; }
    for (let j = out.length - 1; j >= 0 && out[j].time >= a.time; j--) if (out[j].time === a.time) {
      const e = out[j]; e.high = Math.max(e.high, a.high); e.low = Math.min(e.low, a.low); e.close = a.close; e.volume = Math.max(e.volume, a.volume); break; }
  }
  const q = Q.get(sym), L = out[out.length - 1];
  if (q && L) { L.close = q.last; if (q.last > L.high) L.high = q.last; if (q.last < L.low) L.low = q.last; }
  return out;
}
const MEMO = new Map();
async function candles(sym, tf, limit = 500) {
  const key = sym + '|' + tf, m = MEMO.get(key), now = Date.now();
  if (m && now - m.t < 900) return m.bars.slice(-limit);
  const bars = mergeLive(sym, tf, await history(sym, tf));
  MEMO.set(key, { t: now, bars });
  return bars.slice(-limit);
}
const historySrc = sym => HC.get(sym + '|M1')?.src || HC.get(sym + '|H1')?.src || null;
function clearHistory(sym) { for (const k of [...HC.keys()]) if (!sym || k.startsWith(sym + '|')) HC.delete(k); MEMO.clear(); }

module.exports = {
  TF, get LIST() { return LIST; }, get INS() { return INS; }, loadInstruments, Q, LIVE, ASSIGN, SIMFB, tick, setRef, quote, toUSD, rate, round,
  history, candles, simHistory, historySrc, clearHistory, setHistoryFetcher: f => { historyFetcher = f; },
};
