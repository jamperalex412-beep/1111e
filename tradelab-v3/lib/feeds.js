'use strict';
/* Источники котировок: Binance, Finnhub, Yahoo, Twelve Data и симуляция.
   Для каждой категории админ выбирает источник; если он молчит, инструмент
   автоматически переходит на следующий (Yahoo → симуляция). */
const WebSocket = require('ws');
const { setting } = require('./db');
const { isOpen } = require('./catalog');
const M = require('./market');

const E = process.env;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
async function getJSON(url, ms = 8000) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
const CODE = { binance: 'bn', finnhub: 'fh', yahoo: 'yh', twelvedata: 'td' };
const CAT_OPTIONS = {
  stocks: ['finnhub', 'yahoo', 'twelvedata', 'sim'], indices: ['yahoo', 'twelvedata', 'sim'], futures: ['yahoo', 'twelvedata', 'sim'],
  forex: ['finnhub', 'yahoo', 'twelvedata', 'sim'], crypto: ['binance', 'twelvedata', 'yahoo', 'sim'],
};
const status = name => ({ name, connected: false, symbols: 0, lastMsg: null, error: null, note: null });

function wsLoop(self, makeUrl, onOpen, onMsg) {
  const gen = ++self.gen;
  const connect = () => {
    if (gen !== self.gen) return;
    let ws;
    try { ws = new WebSocket(makeUrl(), { headers: { 'User-Agent': UA } }); } catch (e) { self.st.error = e.message; return setTimeout(connect, 15000); }
    self.ws = ws;
    ws.on('open', () => { self.st.connected = true; self.st.error = null; onOpen(ws); });
    ws.on('message', b => { self.st.lastMsg = Date.now(); try { onMsg(JSON.parse(b.toString())); } catch {} });
    ws.on('error', e => { self.st.error = e.message; });
    ws.on('close', () => { self.st.connected = false; if (gen === self.gen) setTimeout(connect, 5000 + Math.random() * 5000); });
  };
  connect();
}
function stopAll(self) { self.gen++; try { self.ws?.terminate(); } catch {} self.ws = null; (self.timers || []).forEach(clearInterval); self.timers = []; self.st.connected = false; }

// --- Binance ---
const binance = {
  st: status('Binance'), gen: 0, list: [],
  rest: E.BINANCE_REST || 'https://api.binance.com', wsBase: E.BINANCE_WS || 'wss://stream.binance.com:9443',
  setSymbols(list) {
    stopAll(this); this.list = list; this.st.symbols = list.length; if (!list.length) return;
    const map = Object.fromEntries(list.map(i => [i.bn, i.sym]));
    const codes = JSON.stringify(list.map(i => i.bn));
    wsLoop(this, () => this.wsBase + '/stream?streams=' + list.map(i => i.bn.toLowerCase() + '@bookTicker').join('/'), () => {}, m => {
      const d = m.data; if (d && map[d.s]) M.tick(map[d.s], { bid: +d.b, ask: +d.a, src: 'binance' });
    });
    const poll = async () => { if (this.st.connected) return;
      try { const a = await getJSON(this.rest + '/api/v3/ticker/bookTicker?symbols=' + encodeURIComponent(codes)); this.st.lastMsg = Date.now(); this.st.note = 'REST (WebSocket недоступен)';
        for (const x of a) if (map[x.symbol]) M.tick(map[x.symbol], { bid: +x.bidPrice, ask: +x.askPrice, src: 'binance' }); } catch (e) { this.st.error = e.message; } };
    const refs = async () => { try { const a = await getJSON(this.rest + '/api/v3/ticker/24hr?type=MINI&symbols=' + encodeURIComponent(codes));
        for (const x of a) if (map[x.symbol]) { M.tick(map[x.symbol], { last: +x.lastPrice, ref: +x.openPrice, src: 'binance' }); } } catch (e) { this.st.error = e.message; } };
    refs(); setTimeout(poll, 4000);
    this.timers.push(setInterval(poll, 2000), setInterval(refs, 60000));
  },
  async history(i, tf) {
    const iv = { M1: '1m', M5: '5m', M15: '15m', M30: '30m', H1: '1h', H4: '4h', D1: '1d' }[tf];
    const a = await getJSON(`${this.rest}/api/v3/klines?symbol=${i.bn}&interval=${iv}&limit=1000`);
    return a.map(k => ({ time: k[0] / 1000, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
  },
};

// --- Finnhub (акции США и форекс в реальном времени, бесплатный ключ) ---
const finnhub = {
  st: status('Finnhub'), gen: 0, list: [],
  setSymbols(list) {
    stopAll(this); this.list = list; this.st.symbols = list.length; if (!list.length) return;
    const key = setting('finnhub_key'); if (!key) { this.st.error = 'Нет API-ключа'; return; }
    if (list.length > 50) this.st.note = 'Бесплатный тариф: не больше 50 символов в потоке';
    const map = Object.fromEntries(list.map(i => [i.fh, i.sym]));
    wsLoop(this, () => 'wss://ws.finnhub.io?token=' + encodeURIComponent(key), ws => list.slice(0, 50).forEach(i => ws.send(JSON.stringify({ type: 'subscribe', symbol: i.fh }))), m => {
      if (m.type === 'trade') for (const d of m.data || []) { if (map[d.s]) M.tick(map[d.s], { last: +d.p, t: d.t, vol: +d.v || 0, src: 'finnhub' }); }
      else if (m.type === 'error') this.st.error = m.msg;
    });
    // начальные цены и закрытие прошлого дня (лимит бесплатного тарифа — 60 запросов в минуту)
    const gen = this.gen; let k = 0;
    const seed = async () => {
      if (gen !== this.gen) return;
      const i = list[k++ % list.length];
      try { const d = await getJSON(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(i.fh)}&token=${encodeURIComponent(key)}`);
        if (d.c > 0) { if (!M.Q.get(i.sym) || M.Q.get(i.sym).src !== 'finnhub') M.tick(i.sym, { last: d.c, t: d.t ? d.t * 1000 : Date.now(), ref: d.pc, src: 'finnhub' }); else M.setRef(i.sym, d.pc); }
      } catch (e) { if (/429/.test(e.message)) this.st.note = 'Лимит запросов Finnhub'; }
    };
    this.timers.push(setInterval(seed, 1500));
  },
};

// --- Yahoo Finance (неофициально, с задержкой; без ключа) ---
const yahoo = {
  st: status('Yahoo Finance'), gen: 0, list: [], spark: true,
  setSymbols(list) {
    stopAll(this); this.list = list; this.st.symbols = list.length; if (!list.length) return;
    this.st.connected = true; this.st.note = 'Опрос, данные могут идти с задержкой';
    const gen = this.gen, by = Object.fromEntries(list.map(i => [i.yh, i.sym]));
    let k = 0;
    const one = async () => {
      if (gen !== this.gen || !list.length) return;
      if (this.spark) {
        const chunk = []; for (let n = 0; n < Math.min(20, list.length); n++) chunk.push(list[(k + n) % list.length]); k += chunk.length;
        try {
          const j = await getJSON('https://query1.finance.yahoo.com/v7/finance/spark?range=1d&interval=1m&symbols=' + encodeURIComponent(chunk.map(i => i.yh).join(',')));
          const res = j?.spark?.result; if (!Array.isArray(res)) throw new Error('format');
          for (const r of res) { const m = r.response?.[0]?.meta; if (m && by[r.symbol]) this.apply(by[r.symbol], m); }
          this.st.lastMsg = Date.now(); this.st.error = null; return;
        } catch (e) { this.spark = false; this.st.note = 'Пакетный запрос недоступен, опрос по одному'; }
      }
      const i = list[k++ % list.length];
      try { const m = await this.meta(i.yh); this.apply(i.sym, m); this.st.lastMsg = Date.now(); this.st.error = null; } catch (e) { this.st.error = e.message; }
    };
    one();
    this.timers.push(setInterval(one, Math.max(500, +setting('yahoo_poll_ms') || 1200)));
    this.timers.push(setInterval(() => { this.spark = true; }, 600000));
  },
  apply(sym, m) { if (m.regularMarketPrice > 0) M.tick(sym, { last: m.regularMarketPrice, t: m.regularMarketTime ? m.regularMarketTime * 1000 : Date.now(), ref: m.chartPreviousClose || m.previousClose, src: 'yahoo' }); },
  async meta(yh) { const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yh)}?range=1d&interval=1m`); const m = j?.chart?.result?.[0]?.meta; if (!m) throw new Error('Нет данных'); return m; },
  async history(i, tf) {
    const [iv, rg] = { M1: ['1m', '5d'], M5: ['5m', '1mo'], M15: ['15m', '1mo'], M30: ['30m', '1mo'], H1: ['60m', '6mo'], H4: ['60m', '1y'], D1: ['1d', '5y'] }[tf];
    const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(i.yh)}?interval=${iv}&range=${rg}`, 12000);
    const r = j?.chart?.result?.[0], ts = r?.timestamp || [], q = r?.indicators?.quote?.[0] || {};
    const out = []; for (let n = 0; n < ts.length; n++) if (q.close?.[n] != null && q.open?.[n] != null)
      out.push({ time: ts[n], open: q.open[n], high: q.high[n], low: q.low[n], close: q.close[n], volume: q.volume?.[n] || 0 });
    return out;
  },
};

// --- Twelve Data (платный провайдер: всё через один ключ) ---
const twelvedata = {
  st: status('Twelve Data'), gen: 0, list: [],
  setSymbols(list) {
    stopAll(this); this.list = list; this.st.symbols = list.length; if (!list.length) return;
    const key = setting('twelvedata_key'); if (!key) { this.st.error = 'Нет API-ключа'; return; }
    const by = Object.fromEntries(list.map(i => [i.td, i.sym])), gen = this.gen;
    wsLoop(this, () => 'wss://ws.twelvedata.com/v1/quotes/price?apikey=' + encodeURIComponent(key),
      ws => { ws.send(JSON.stringify({ action: 'subscribe', params: { symbols: list.map(i => i.td).join(',') } })); this.hb = setInterval(() => { try { ws.send('{"action":"heartbeat"}'); } catch {} }, 10000); this.timers.push(this.hb); },
      m => { if (m.event === 'price' && by[m.symbol]) M.tick(by[m.symbol], { last: +m.price, bid: +m.bid || undefined, ask: +m.ask || undefined, t: m.timestamp ? m.timestamp * 1000 : Date.now(), src: 'twelvedata' });
        else if (m.event === 'subscribe-status' && m.fails?.length) this.st.note = 'Не подписаны: ' + m.fails.map(f => f.symbol).join(', '); });
    const poll = async () => {
      if (gen !== this.gen) return;
      for (let n = 0; n < list.length; n += 50) {
        const chunk = list.slice(n, n + 50);
        try {
          const j = await getJSON(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(chunk.map(i => i.td).join(','))}&apikey=${encodeURIComponent(key)}`);
          if (j.status === 'error') throw new Error(j.message);
          const items = chunk.length === 1 ? { [chunk[0].td]: j } : j;
          for (const [s, d] of Object.entries(items)) if (by[s] && +d.close > 0 && (!this.st.connected || !M.Q.get(by[s])))
            M.tick(by[s], { last: +d.close, ref: +d.previous_close, t: d.timestamp ? d.timestamp * 1000 : Date.now(), src: 'twelvedata' });
          else if (by[s] && +d.previous_close > 0) M.setRef(by[s], +d.previous_close);
          this.st.lastMsg = Date.now(); if (!this.st.connected) this.st.error = null;
        } catch (e) { this.st.error = e.message; }
      }
    };
    poll(); this.timers.push(setInterval(poll, Math.max(5, +setting('td_poll_sec') || 15) * 1000));
  },
  async history(i, tf) {
    const iv = { M1: '1min', M5: '5min', M15: '15min', M30: '30min', H1: '1h', H4: '4h', D1: '1day' }[tf];
    const j = await getJSON(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(i.td)}&interval=${iv}&outputsize=1500&timezone=UTC&apikey=${encodeURIComponent(setting('twelvedata_key'))}`, 15000);
    if (j.status === 'error' || !Array.isArray(j.values)) throw new Error(j.message || 'Нет данных');
    return j.values.reverse().map(v => ({ time: Date.parse(v.datetime.replace(' ', 'T') + (v.datetime.length > 10 ? 'Z' : 'T00:00:00Z')) / 1000, open: +v.open, high: +v.high, low: +v.low, close: +v.close, volume: +v.volume || 0 }));
  },
};

// --- Симуляция (когда реальный источник не настроен или недоступен) ---
const sim = {
  st: status('Симуляция'), list: [],
  setSymbols(list) { this.list = list; this.st.symbols = list.length; this.st.connected = true; },
};
function randn() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
setInterval(() => {
  const syms = new Set([...sim.list.map(i => i.sym), ...M.SIMFB]);
  for (const s of syms) {
    const i = M.INS[s]; if (!i || !i.enabled) continue;
    const q = M.Q.get(s);
    if (q && !isOpen(i.session)) continue;
    let p = q?.last || i.base;
    if (q) p *= Math.exp(i.vol / 60 * randn() + Math.log(i.base / p) * 0.0005);
    M.tick(s, { last: p, ref: q?.ref || i.base, vol: Math.round(Math.random() * 20), src: 'sim' });
  }
}, 1000);

const P = { binance, finnhub, yahoo, twelvedata, sim };
const FAILS = new Map(); // "провайдер:символ" -> время пометки
let appliedAt = 0;
function pick(i) {
  const first = setting('feed_' + i.cat) || 'sim';
  const chain = [first, ...(first !== 'yahoo' ? ['yahoo'] : []), 'sim'];
  for (const c of chain) {
    if (c === 'sim') return 'sim';
    if (!i[CODE[c]] || FAILS.has(c + ':' + i.sym)) continue;
    if (c === 'finnhub' && !setting('finnhub_key')) continue;
    if (c === 'twelvedata' && !setting('twelvedata_key')) continue;
    return c;
  }
  return 'sim';
}
function apply() {
  const groups = { binance: [], finnhub: [], yahoo: [], twelvedata: [], sim: [] };
  for (const i of M.LIST) { if (!i.enabled) continue; const p = pick(i); M.ASSIGN[i.sym] = p; groups[p].push(i); if (p !== 'sim' && !M.Q.get(i.sym)) M.SIMFB.add(i.sym); }
  for (const [k, list] of Object.entries(groups)) {
    const sig = list.map(i => i.sym).join(',') + '|' + (setting(k + '_key') || '');
    if (P[k]._sig !== sig) { P[k]._sig = sig; P[k].setSymbols(list); }
  }
  appliedAt = Date.now();
}
// Сторож: если источник не дал ни одной цены за 3 минуты — переводим символ на следующий источник
setInterval(() => {
  let changed = false;
  for (const i of M.LIST) {
    if (!i.enabled) continue;
    const a = M.ASSIGN[i.sym], q = M.Q.get(i.sym);
    if (!q && a !== 'sim') M.SIMFB.add(i.sym); // пока ждём — показываем симуляцию
    if (a === 'sim' || Date.now() - appliedAt < 180000) continue;
    if (!q || q.src !== a) { FAILS.set(a + ':' + i.sym, Date.now()); changed = true; }
  }
  for (const [k, t] of FAILS) if (Date.now() - t > 3600e3) { FAILS.delete(k); changed = true; }
  if (changed) apply();
}, 20000);

M.setHistoryFetcher(async (i, tf) => {
  const a = M.ASSIGN[i.sym];
  const order = a === 'binance' ? ['binance', 'yahoo'] : a === 'twelvedata' ? ['twelvedata', 'yahoo'] : a === 'sim' ? [] : ['yahoo'];
  for (const p of order) {
    if (!i[CODE[p]] || FAILS.has(p + ':' + i.sym) && p !== 'yahoo') continue;
    try { const bars = await P[p].history(i, tf); if (bars?.length) return { bars, src: p }; } catch {}
  }
  return null;
});

function statusAll() {
  const count = {}; for (const s of Object.values(M.ASSIGN)) count[s] = (count[s] || 0) + 1;
  return Object.entries(P).map(([k, p]) => ({ id: k, ...p.st, connected: k === 'sim' ? true : p.st.connected && k !== 'yahoo' || !!(p.st.lastMsg && Date.now() - p.st.lastMsg < 120000), assigned: count[k] || 0 }));
}
function reset() { for (const p of Object.values(P)) p._sig = null; FAILS.clear(); M.SIMFB.clear(); M.clearHistory(); apply(); }

module.exports = { apply, reset, statusAll, CAT_OPTIONS, FAILS, P };
