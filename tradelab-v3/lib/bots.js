'use strict';
/* Роботы (аналог советников MT5). Код пользователя исполняется в изолированной песочнице V8 (isolated-vm):
   без доступа к файлам, сети и серверу, с лимитом памяти и времени. Робот только возвращает список
   торговых действий, а сервер проверяет каждое по лимитам пользователя и исполняет через движок. */
const ivm = require('isolated-vm');
const { db, setting } = require('./db');
const { tzParts } = require('./catalog');
const M = require('./market');
const E = require('./engine');

const BOOT = String.raw`
'use strict';
var __actions = [], __logs = [], __defs = [], __ovr = {}, __all = null;
var state = {}, symbol = '', timeframe = '', bars = [], current = null, bid = 0, ask = 0, digits = 2, point = 0.01,
  minLot = 0.01, lotStep = 0.01, contract = 1, account = {}, positions = [], orders = [], time = 0, marketOpen = true;
function input(name, def, label) {
  if (!__defs.some(d => d.name === name)) __defs.push({ name: String(name), def, label: label ? String(label) : String(name), type: typeof def });
  const v = __ovr[name];
  if (v === undefined || v === null || v === '') return def;
  return typeof def === 'number' ? Number(v) : typeof def === 'boolean' ? (v === true || v === 'true') : String(v);
}
function log(...a) { if (__logs.length < 50) __logs.push(a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ').slice(0, 500)); }
function __act(a) { if (__actions.length >= 20) throw new Error('Не больше 20 торговых действий за один вызов'); __actions.push(a); }
const __o = (o = {}) => ({ sl: o.sl, tp: o.tp, trail: o.trail, comment: o.comment, expires: o.expires });
function buy(lots, o) { __act({ op: 'market', side: 'buy', lots, ...__o(o) }); }
function sell(lots, o) { __act({ op: 'market', side: 'sell', lots, ...__o(o) }); }
function buyLimit(price, lots, o) { __act({ op: 'pending', type: 'buy_limit', price, lots, ...__o(o) }); }
function sellLimit(price, lots, o) { __act({ op: 'pending', type: 'sell_limit', price, lots, ...__o(o) }); }
function buyStop(price, lots, o) { __act({ op: 'pending', type: 'buy_stop', price, lots, ...__o(o) }); }
function sellStop(price, lots, o) { __act({ op: 'pending', type: 'sell_stop', price, lots, ...__o(o) }); }
function buyStopLimit(price, limitPrice, lots, o) { __act({ op: 'pending', type: 'buy_stop_limit', price, stoplimit: limitPrice, lots, ...__o(o) }); }
function sellStopLimit(price, limitPrice, lots, o) { __act({ op: 'pending', type: 'sell_stop_limit', price, stoplimit: limitPrice, lots, ...__o(o) }); }
function close(id, lots) { __act({ op: 'close', id, lots }); }
function closeAll() { __act({ op: 'closeAll' }); }
function modify(id, o = {}) { __act({ op: 'modify', id, ...o }); }
function cancel(id) { __act({ op: 'cancel', id }); }
function cancelAll() { __act({ op: 'cancelAll' }); }
function position(side) { return positions.find(p => !side || p.side === side) || null; }
const closes = () => bars.map(b => b.close), opens = () => bars.map(b => b.open), highs = () => bars.map(b => b.high),
  lows = () => bars.map(b => b.low), volumes = () => bars.map(b => b.volume);
const last = (a, k = 0) => a[a.length - 1 - k];
const normalizeLots = v => Math.max(minLot, +(Math.floor(v / lotStep + 1e-9) * lotStep).toFixed(8));
const roundPrice = v => { const f = 10 ** digits; return Math.round(v * f) / f; };
const ta = {
  sma(a, n) { const o = new Array(a.length).fill(NaN); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; },
  ema(a, n) { const o = new Array(a.length).fill(NaN), k = 2 / (n + 1); let e; for (let i = n - 1; i < a.length; i++) { if (e === undefined) { let s = 0; for (let j = i - n + 1; j <= i; j++) s += a[j]; e = s / n; } else e = a[i] * k + e * (1 - k); o[i] = e; } return o; },
  rsi(a, n = 14) { const o = new Array(a.length).fill(NaN); let g = 0, l = 0; for (let i = 1; i < a.length; i++) { const d = a[i] - a[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
      else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } return o; },
  macd(a, f = 12, s = 26, g = 9) { const ef = ta.ema(a, f), es = ta.ema(a, s), m = a.map((_, i) => ef[i] - es[i]), sig = new Array(a.length).fill(NaN), st = m.findIndex(x => !isNaN(x));
    if (st >= 0) ta.ema(m.slice(st), g).forEach((v, i) => { sig[st + i] = v; }); return { macd: m, signal: sig, hist: m.map((x, i) => x - sig[i]) }; },
  bb(a, n = 20, k = 2) { const mid = ta.sma(a, n), up = [], lo = []; for (let i = 0; i < a.length; i++) { if (isNaN(mid[i])) { up.push(NaN); lo.push(NaN); continue; } let s = 0; for (let j = i - n + 1; j <= i; j++) s += (a[j] - mid[i]) ** 2; const sd = Math.sqrt(s / n); up.push(mid[i] + k * sd); lo.push(mid[i] - k * sd); } return { upper: up, middle: mid, lower: lo }; },
  atr(b, n = 14) { const o = new Array(b.length).fill(NaN); let v; for (let i = 1; i < b.length; i++) { const tr = Math.max(b[i].high - b[i].low, Math.abs(b[i].high - b[i - 1].close), Math.abs(b[i].low - b[i - 1].close));
      if (i < n) { v = (v || 0) + tr; if (i === n - 1) { v /= n - 1; o[i] = v; } } else { v = (v * (n - 1) + tr) / n; o[i] = v; } } return o; },
  stdev(a, n) { const m = ta.sma(a, n); return a.map((_, i) => { if (isNaN(m[i])) return NaN; let s = 0; for (let j = i - n + 1; j <= i; j++) s += (a[j] - m[i]) ** 2; return Math.sqrt(s / n); }); },
  highest(a, n) { return Math.max(...a.slice(-n)); },
  lowest(a, n) { return Math.min(...a.slice(-n)); },
  crossOver(a, b) { const b0 = typeof b === 'number' ? b : last(b), b1 = typeof b === 'number' ? b : last(b, 1); return last(a, 1) <= b1 && last(a) > b0; },
  crossUnder(a, b) { const b0 = typeof b === 'number' ? b : last(b), b1 = typeof b === 'number' ? b : last(b, 1); return last(a, 1) >= b1 && last(a) < b0; },
};
function __dispatch() {
  const i = __in; __actions = []; __logs = [];
  if (i.all) __all = i.all;
  if (i.idx !== undefined) bars = __all.slice(Math.max(0, i.idx - i.hist + 1), i.idx + 1);
  else if (i.bars) bars = i.bars;
  if (i.current !== undefined) current = i.current;
  bid = i.bid; ask = i.ask; account = i.account; positions = i.positions; orders = i.orders; time = i.time; marketOpen = i.open;
  const fn = i.ev === 'onInit' ? (typeof onInit === 'function' ? onInit : null) : i.ev === 'onBar' ? (typeof onBar === 'function' ? onBar : null)
    : i.ev === 'onTick' ? (typeof onTick === 'function' ? onTick : null) : i.ev === 'onStop' ? (typeof onStop === 'function' ? onStop : null) : null;
  if (fn) fn();
  return JSON.stringify({ a: __actions, l: __logs, s: state });
}
`;

class Runner {
  init(code, inputs, ctx, st) {
    this.iso = new ivm.Isolate({ memoryLimit: 32 });
    this.ctx = this.iso.createContextSync();
    this.ctx.evalSync(BOOT, { timeout: 1000 });
    const g = this.ctx.global;
    g.setSync('__ovrIn', new ivm.ExternalCopy(inputs || {}).copyInto());
    g.setSync('__ctxIn', new ivm.ExternalCopy({ ...ctx, state: st || {} }).copyInto());
    this.ctx.evalSync('__ovr=__ovrIn; symbol=__ctxIn.symbol; timeframe=__ctxIn.timeframe; digits=__ctxIn.digits; point=Math.pow(10,-digits); minLot=__ctxIn.minLot; lotStep=__ctxIn.lotStep; contract=__ctxIn.contract; state=__ctxIn.state||{};', { timeout: 200 });
    this.iso.compileScriptSync(String(code), { filename: 'robot.js' }).runSync(this.ctx, { timeout: 1000 });
    this.disp = this.iso.compileScriptSync('__dispatch()');
    this.defs = JSON.parse(this.ctx.evalSync('JSON.stringify(__defs)', { timeout: 200 }));
    return this;
  }
  call(ev, data, timeout = 250) {
    this.ctx.global.setSync('__in', new ivm.ExternalCopy({ ev, ...data }).copyInto());
    return JSON.parse(this.disp.runSync(this.ctx, { timeout }));
  }
  dispose() { try { if (!this.iso.isDisposed) this.iso.dispose(); } catch {} }
}
const ctxFor = (i, tf) => ({ symbol: i.sym, timeframe: tf, digits: i.digits, minLot: i.min_lot, lotStep: i.lot_step, contract: i.contract });
const errText = e => String(e?.message || e).replace(/\s+at .*$/s, '').slice(0, 500);

function inspect(code) {
  const r = new Runner();
  try { r.init(code, {}, { symbol: 'TEST', timeframe: 'M15', digits: 2, minLot: 0.01, lotStep: 0.01, contract: 1 }, {}); return { ok: true, inputs: r.defs }; }
  catch (e) { return { ok: false, error: errText(e) }; }
  finally { r.dispose(); }
}

// --- Лимиты ---
const DEF_LIMITS = { maxLots: 1, maxPositions: 3, maxTotalLots: 3, maxDailyLoss: 1000, maxDrawdownPct: 20, maxTradesPerDay: 50, maxLeverage: 100,
  requireSL: false, hoursFrom: '00:00', hoursTo: '24:00', days: [1, 2, 3, 4, 5, 6, 0], tz: 'Europe/Moscow', closeOnStop: true, history: 300 };
function cleanLimits(l = {}) {
  const n = (v, def, lo, hi) => { v = +v; return isFinite(v) && v >= lo && v <= hi ? v : def; };
  const hm = (v, def) => /^([01]\d|2[0-4]):[0-5]\d$/.test(v || '') ? v : def;
  let tz = String(l.tz || DEF_LIMITS.tz); try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { tz = 'UTC'; }
  return {
    maxLots: n(l.maxLots, 1, 0.000001, 1e9), maxPositions: Math.floor(n(l.maxPositions, 3, 1, 100)), maxTotalLots: n(l.maxTotalLots, 3, 0.000001, 1e9),
    maxDailyLoss: n(l.maxDailyLoss, 1000, 0, 1e12), maxDrawdownPct: n(l.maxDrawdownPct, 20, 0, 100), maxTradesPerDay: Math.floor(n(l.maxTradesPerDay, 50, 1, 10000)),
    maxLeverage: Math.floor(n(l.maxLeverage, 100, 1, 1000)), requireSL: !!l.requireSL, hoursFrom: hm(l.hoursFrom, '00:00'), hoursTo: hm(l.hoursTo, '24:00'),
    days: Array.isArray(l.days) ? l.days.map(Number).filter(d => d >= 0 && d <= 6) : DEF_LIMITS.days, tz, closeOnStop: l.closeOnStop !== false,
    history: Math.floor(n(l.history, 300, 50, 1000)),
  };
}
const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
function inHours(L, t = new Date()) {
  const { wd, hm } = tzParts(t, L.tz);
  if (!L.days.includes(wd)) return false;
  const a = toMin(L.hoursFrom), b = toMin(L.hoursTo);
  return a <= b ? hm >= a && hm < b : hm >= a || hm < b;
}
function dayStart(tz, now = Date.now()) { const d = new Date(now), { hm } = tzParts(d, tz); return now - hm * 60000 - d.getUTCSeconds() * 1000 - d.getUTCMilliseconds(); }

// --- Живые роботы ---
const RUN = new Map();
const log = (id, level, msg) => db.prepare('INSERT INTO bot_logs(bot_id,level,msg,t) VALUES(?,?,?,?)').run(id, level, String(msg).slice(0, 1000), Date.now());
const getBot = id => db.prepare('SELECT * FROM bots WHERE id=?').get(id);
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const fmt = v => (Math.round(v * 100) / 100).toLocaleString('ru-RU');

function view(uid, botId) {
  const a = E.account(uid);
  return {
    account: { balance: a.balance, equity: a.equity, margin: a.margin, free: a.free, level: a.level, leverage: a.leverage },
    positions: a.positions.filter(p => p.bot_id === botId).map(p => ({ id: p.id, side: p.side, lots: p.lots, entry: p.entry, sl: p.sl, tp: p.tp, trail: p.trail, pnl: p.pnl, openedAt: p.opened_at, comment: p.comment })),
    orders: E.orders(uid).filter(o => o.bot_id === botId).map(o => ({ id: o.id, type: o.type, lots: o.lots, price: o.price, stoplimit: o.stoplimit, sl: o.sl, tp: o.tp })),
    raw: a,
  };
}
function tradesToday(b, L) {
  const from = dayStart(L.tz);
  return db.prepare(`SELECT (SELECT COUNT(*) FROM positions WHERE bot_id=? AND opened_at>=?) + (SELECT COUNT(DISTINCT position_id) FROM deals WHERE bot_id=? AND opened_at>=? AND position_id NOT IN (SELECT id FROM positions)) + (SELECT COUNT(*) FROM orders WHERE bot_id=? AND created_at>=? AND status IN ('pending','cancelled','expired','rejected')) n`)
    .get(b.id, from, b.id, from, b.id, from).n;
}
function dailyPnl(b, L) {
  const from = dayStart(L.tz);
  const d = db.prepare('SELECT COALESCE(SUM(pnl),0) s FROM deals WHERE bot_id=? AND closed_at>=?').get(b.id, from).s;
  const fl = E.account(b.user_id).positions.filter(p => p.bot_id === b.id).reduce((s, p) => s + p.pnl, 0);
  return d + fl;
}

function execActions(en, acts) {
  const b = en.bot, L = en.limits, uid = b.user_id;
  for (const a of acts) {
    try {
      if (a.op === 'market' || a.op === 'pending') {
        if (!inHours(L)) throw new Error('вне разрешённых часов торговли');
        const lots = +a.lots; if (!(lots > 0)) throw new Error('не указан объём');
        if (lots > L.maxLots) throw new Error(`объём ${lots} больше лимита ${L.maxLots}`);
        const v = view(uid, b.id), open = v.positions.length + v.orders.length;
        if (open >= L.maxPositions) throw new Error(`лимит позиций и ордеров (${L.maxPositions})`);
        const tl = v.positions.reduce((s, p) => s + p.lots, 0) + v.orders.reduce((s, o) => s + o.lots, 0);
        if (tl + lots > L.maxTotalLots + 1e-9) throw new Error(`общий объём превысит лимит ${L.maxTotalLots}`);
        if (tradesToday(b, L) >= L.maxTradesPerDay) throw new Error(`лимит сделок в день (${L.maxTradesPerDay})`);
        if (L.requireSL && !(+a.sl > 0)) throw new Error('лимит требует стоп-лосс');
        const o = { symbol: b.symbol, lots, sl: a.sl, tp: a.tp, trail: a.trail, comment: a.comment || b.name, bot_id: b.id, levCap: L.maxLeverage };
        if (a.op === 'market') { const r = E.openMarket(uid, { ...o, side: a.side }); log(b.id, 'trade', `${a.side === 'buy' ? 'Покупка' : 'Продажа'} ${r.lots} ${b.symbol} по ${r.price} (позиция #${r.id})`); }
        else { const r = E.placePending(uid, { ...o, type: a.type, price: a.price, stoplimit: a.stoplimit, expires: a.expires }); log(b.id, 'trade', `Ордер ${a.type} ${lots} ${b.symbol} по ${a.price} (#${r.id})`); }
      } else if (a.op === 'close') {
        const p = db.prepare('SELECT * FROM positions WHERE id=? AND bot_id=?').get(+a.id, b.id); if (!p) throw new Error('позиция не найдена или не принадлежит роботу');
        const r = E.closePosition(uid, p.id, a.lots, 'bot'); log(b.id, 'trade', `Закрыто ${r.lots} по позиции #${p.id}, результат ${fmt(r.pnl)} $`);
      } else if (a.op === 'closeAll') {
        const r = E.closeAll(uid, { bot_id: b.id }, 'bot'); if (r.closed) log(b.id, 'trade', `Закрыто позиций: ${r.closed}, результат ${fmt(r.pnl)} $`);
      } else if (a.op === 'modify') {
        const p = db.prepare('SELECT * FROM positions WHERE id=? AND bot_id=?').get(+a.id, b.id); if (!p) throw new Error('позиция не найдена или не принадлежит роботу');
        const ch = {}; for (const k of ['sl', 'tp', 'trail']) if (k in a && a[k] !== undefined) ch[k] = a[k];
        if (L.requireSL && 'sl' in ch && !(+ch.sl > 0)) throw new Error('лимит требует стоп-лосс');
        E.modifyPosition(uid, p.id, ch);
      } else if (a.op === 'cancel') {
        const o = db.prepare("SELECT * FROM orders WHERE id=? AND bot_id=? AND status='pending'").get(+a.id, b.id); if (!o) throw new Error('ордер не найден');
        E.cancelOrder(uid, o.id, 'Отменён роботом');
      } else if (a.op === 'cancelAll') {
        for (const o of db.prepare("SELECT id FROM orders WHERE bot_id=? AND status='pending'").all(b.id)) E.cancelOrder(uid, o.id, 'Отменён роботом');
      }
    } catch (e) { log(b.id, 'warn', `Отклонено (${a.op}${a.side ? ' ' + a.side : ''}${a.type ? ' ' + a.type : ''}): ${e.message}`); }
  }
}

function start(id) {
  const b = getBot(id); if (!b) throw new Error('Робот не найден');
  if (RUN.has(id)) return;
  if (setting('bots_enabled') !== '1') throw new Error('Роботы отключены администратором');
  const u = db.prepare('SELECT blocked FROM users WHERE id=?').get(b.user_id); if (!u || u.blocked) throw new Error('Аккаунт заблокирован');
  const i = M.INS[b.symbol]; if (!i || !i.enabled) throw new Error('Инструмент недоступен');
  const L = cleanLimits(parse(b.limits, {}));
  const r = new Runner();
  try { r.init(b.code, parse(b.inputs, {}), ctxFor(i, b.tf), parse(b.state, {})); }
  catch (e) { r.dispose(); throw new Error('Ошибка в коде: ' + errText(e)); }
  const en = { r, bot: b, limits: L, lastBar: null, lastBid: null, errors: 0, busy: false, savedAt: Date.now() };
  RUN.set(id, en);
  const eq = E.account(b.user_id).equity;
  db.prepare("UPDATE bots SET status='running', started_at=?, start_equity=?, stop_reason=NULL WHERE id=?").run(Date.now(), eq, id);
  log(id, 'info', `Запущен на ${b.symbol} ${b.tf}. Эквити на старте ${fmt(eq)} $`);
  try { const v = view(b.user_id, id), q = M.quote(b.symbol); const res = r.call('onInit', { bid: q?.bid, ask: q?.ask, account: v.account, positions: v.positions, orders: v.orders, time: Date.now(), open: !!q?.open }, 1000); handle(en, res); }
  catch (e) { stop(id, 'Ошибка в onInit: ' + errText(e), 'error'); throw new Error('Ошибка в onInit: ' + errText(e)); }
}
function handle(en, res) {
  for (const l of res.l || []) log(en.bot.id, 'log', l);
  en.state = res.s;
  if (res.a?.length) execActions(en, res.a);
}
function stop(id, reason = 'Остановлен пользователем', status = 'stopped') {
  const en = RUN.get(id), b = getBot(id); if (!b) return;
  if (en) {
    try { const v = view(b.user_id, id), q = M.quote(b.symbol); const res = en.r.call('onStop', { bid: q?.bid, ask: q?.ask, account: v.account, positions: v.positions, orders: v.orders, time: Date.now(), open: !!q?.open }, 500); for (const l of res.l || []) log(id, 'log', l); en.state = res.s; } catch {}
    en.r.dispose(); RUN.delete(id);
    if (en.state) db.prepare('UPDATE bots SET state=? WHERE id=?').run(JSON.stringify(en.state).slice(0, 100000), id);
    if (en.limits.closeOnStop) {
      try { const r = E.closeAll(b.user_id, { bot_id: id }, 'bot_stop'); if (r.closed) log(id, 'trade', `При остановке закрыто позиций: ${r.closed}, результат ${fmt(r.pnl)} $${r.skipped ? `; не закрыто (рынок закрыт): ${r.skipped}` : ''}`); } catch {}
      for (const o of db.prepare("SELECT id FROM orders WHERE bot_id=? AND status='pending'").all(id)) try { E.cancelOrder(b.user_id, o.id, 'Робот остановлен'); } catch {}
    }
  }
  db.prepare('UPDATE bots SET status=?, stop_reason=? WHERE id=?').run(status, reason, id);
  log(id, status === 'error' ? 'error' : 'info', 'Остановлен: ' + reason);
}

async function stepBot(en) {
  const b = en.bot, L = en.limits, id = b.id;
  const u = db.prepare('SELECT blocked FROM users WHERE id=?').get(b.user_id);
  if (!u || u.blocked) return stop(id, 'Аккаунт заблокирован');
  const v = view(b.user_id, id);
  if (L.maxDailyLoss > 0 && dailyPnl(b, L) <= -L.maxDailyLoss) return stop(id, `Достигнут дневной лимит убытка ${fmt(L.maxDailyLoss)} $`);
  const se = getBot(id)?.start_equity;
  if (L.maxDrawdownPct > 0 && se && v.raw.equity <= se * (1 - L.maxDrawdownPct / 100)) return stop(id, `Просадка счёта достигла ${L.maxDrawdownPct}% от эквити на старте`);
  const q = M.quote(b.symbol); if (!q || !q.open) return;
  const all = await M.candles(b.symbol, b.tf, L.history + 1);
  if (!RUN.has(id) || all.length < 2) return;
  const cur = all[all.length - 1], closed = all.slice(0, -1);
  const base = { bid: q.bid, ask: q.ask, account: v.account, positions: v.positions, orders: v.orders, time: Date.now(), open: true, current: cur };
  let res;
  if (en.lastBar === null) { en.lastBar = cur.time; en.lastBid = q.bid; res = en.r.call('onTick', { ...base, bars: closed }); }
  else if (cur.time !== en.lastBar) { en.lastBar = cur.time; en.lastBid = q.bid; res = en.r.call('onBar', { ...base, bars: closed }); }
  else if (q.bid !== en.lastBid) { en.lastBid = q.bid; res = en.r.call('onTick', base); }
  if (res) { handle(en, res); en.errors = 0; }
  if (Date.now() - en.savedAt > 60000 && en.state) { en.savedAt = Date.now(); db.prepare('UPDATE bots SET state=? WHERE id=?').run(JSON.stringify(en.state).slice(0, 100000), id); }
}
setInterval(() => {
  for (const en of RUN.values()) {
    if (en.busy) continue; en.busy = true;
    stepBot(en).catch(e => {
      en.errors++; log(en.bot.id, 'error', errText(e));
      if (/disposed|memory/i.test(String(e))) return stop(en.bot.id, 'Превышен лимит памяти (32 МБ)', 'error');
      if (en.errors >= 5) stop(en.bot.id, '5 ошибок подряд', 'error');
    }).finally(() => { en.busy = false; });
  }
}, 1000);
setInterval(() => { db.prepare('DELETE FROM bot_logs WHERE id IN (SELECT l.id FROM bot_logs l WHERE (SELECT COUNT(*) FROM bot_logs x WHERE x.bot_id=l.bot_id AND x.id>l.id) >= 2000)').run(); }, 600000);

function resumeAll() {
  for (const b of db.prepare("SELECT id FROM bots WHERE status='running'").all()) {
    try { start(b.id); } catch (e) { db.prepare("UPDATE bots SET status='error', stop_reason=? WHERE id=?").run('Не запустился после перезапуска сервера: ' + e.message, b.id); }
  }
}
function stopAllFor(uid, reason) { for (const [id, en] of RUN) if (en.bot.user_id === uid) stop(id, reason); }
function stopAll(reason) { for (const id of [...RUN.keys()]) stop(id, reason); }
function reloadLimits(id) { const en = RUN.get(id); if (en) en.limits = cleanLimits(parse(getBot(id).limits, {})); }

// --- Тестер стратегий ---
async function backtest({ code, inputs, symbol, tf, bars: count = 1000, deposit = 10000, leverage = 100, limits }) {
  const i = M.INS[symbol]; if (!i) throw new Error('Нет инструмента');
  if (!M.TF[tf]) throw new Error('Неверный таймфрейм');
  const L = cleanLimits(limits || {});
  count = Math.max(100, Math.min(5000, +count || 1000)); deposit = Math.max(100, Math.min(1e9, +deposit || 10000));
  const hist = await M.candles(symbol, tf, 5000);
  const data = hist.slice(0, -1).slice(-count);
  if (data.length < 60) throw new Error('Мало истории для теста');
  const warm = Math.min(50, Math.floor(data.length / 4)), H = L.history;
  const lev = Math.max(1, Math.min(leverage, i.max_lev, L.maxLeverage)), so = +setting('stop_out') || 50;
  const half = p => p * i.spread / 200, conv = v => M.toUSD(v, i.ccy), rd = v => M.round(v, i.digits);
  let bal = deposit, nid = 1, stopped = null, peak = deposit, maxDD = 0, maxDDp = 0;
  const pos = [], ord = [], deals = [], curve = [], logs = [];
  const pnl = (p, px) => conv((p.side === 'buy' ? 1 : -1) * (px - p.entry) * p.lots * i.contract);
  const equityAt = c => bal + pos.reduce((s, p) => s + pnl(p, p.side === 'buy' ? c - half(c) : c + half(c)), 0);
  const marginUsed = () => pos.reduce((s, p) => s + p.margin, 0);
  const dayKey = t => { const d = new Date(t * 1000); return d.toISOString().slice(0, 10); };
  const daily = {};
  const closeP = (p, px, why, t) => { const v = pnl(p, px); bal += v; deals.push({ id: p.id, side: p.side, lots: p.lots, entry: p.entry, exit: px, pnl: v, comm: p.comm, reason: why, opened: p.t, closed: t }); pos.splice(pos.indexOf(p), 1); const k = dayKey(t); daily[k] = (daily[k] || 0) + v; };
  const open = (side, lots, px, o, t) => {
    const mar = conv(lots * i.contract * px) / lev, comm = conv(lots * i.contract * px) * i.comm / 100;
    if (equityAt(px) - marginUsed() - comm < mar) throw new Error('недостаточно маржи');
    bal -= comm; const p = { id: nid++, side, lots, entry: px, margin: mar, comm, sl: +o.sl || null, tp: +o.tp || null, trail: +o.trail || null, t };
    pos.push(p); const k = dayKey(t); daily[k] = (daily[k] || 0) - comm; return p;
  };
  const r = new Runner();
  try { r.init(code, inputs || {}, ctxFor(i, tf), {}); }
  catch (e) { r.dispose(); throw new Error('Ошибка в коде: ' + errText(e)); }
  const t0 = Date.now(), tradesByDay = {};
  const ctxData = (idx) => {
    const c = data[idx].close, eq = equityAt(c), mu = marginUsed();
    return { bid: rd(c - half(c)), ask: rd(c + half(c)), account: { balance: bal, equity: eq, margin: mu, free: eq - mu, level: mu ? eq / mu * 100 : null, leverage: lev },
      positions: pos.map(p => ({ id: p.id, side: p.side, lots: p.lots, entry: p.entry, sl: p.sl, tp: p.tp, trail: p.trail, pnl: pnl(p, p.side === 'buy' ? c - half(c) : c + half(c)), openedAt: p.t * 1000 })),
      orders: ord.map(o => ({ id: o.id, type: o.type, lots: o.lots, price: o.price, stoplimit: o.stoplimit, sl: o.sl, tp: o.tp })), time: data[idx].time * 1000, open: true, current: data[idx] };
  };
  const act = (acts, idx) => {
    const b = data[idx], c = b.close, t = b.time;
    for (const a of acts) {
      try {
        if (a.op === 'market' || a.op === 'pending') {
          if (!inHours(L, new Date(t * 1000))) throw new Error('вне часов торговли');
          const lots = +a.lots; if (!(lots >= i.min_lot)) throw new Error('объём меньше минимального');
          if (lots > L.maxLots) throw new Error('объём больше лимита');
          if (pos.length + ord.length >= L.maxPositions) throw new Error('лимит позиций');
          if (pos.reduce((s, p) => s + p.lots, 0) + ord.reduce((s, o) => s + o.lots, 0) + lots > L.maxTotalLots + 1e-9) throw new Error('лимит общего объёма');
          const dk = dayKey(t); if ((tradesByDay[dk] || 0) >= L.maxTradesPerDay) throw new Error('лимит сделок в день'); tradesByDay[dk] = (tradesByDay[dk] || 0) + 1;
          if (L.requireSL && !(+a.sl > 0)) throw new Error('нужен стоп-лосс');
          if (a.op === 'market') open(a.side, lots, a.side === 'buy' ? c + half(c) : c - half(c), a, t);
          else ord.push({ id: nid++, type: a.type, lots, price: +a.price, stoplimit: +a.stoplimit || null, sl: a.sl, tp: a.tp, trail: a.trail, exp: a.expires ? +new Date(a.expires) / 1000 : null });
        } else if (a.op === 'close') { const p = pos.find(p => p.id === +a.id); if (!p) throw new Error('нет позиции'); const px = p.side === 'buy' ? c - half(c) : c + half(c);
          if (a.lots && +a.lots < p.lots) { const part = { ...p, lots: +a.lots, comm: p.comm * a.lots / p.lots }; pos.push(part); p.lots -= +a.lots; p.margin *= p.lots / (p.lots + +a.lots); closeP(part, px, 'bot', t); } else closeP(p, px, 'bot', t); }
        else if (a.op === 'closeAll') { for (const p of [...pos]) closeP(p, p.side === 'buy' ? c - half(c) : c + half(c), 'bot', t); }
        else if (a.op === 'modify') { const p = pos.find(p => p.id === +a.id); if (!p) throw new Error('нет позиции'); for (const k of ['sl', 'tp', 'trail']) if (k in a && a[k] !== undefined) p[k] = +a[k] || null; }
        else if (a.op === 'cancel') { const k = ord.findIndex(o => o.id === +a.id); if (k >= 0) ord.splice(k, 1); }
        else if (a.op === 'cancelAll') ord.length = 0;
      } catch (e) { if (logs.length < 300) logs.push({ t: t * 1000, level: 'warn', msg: `Отклонено (${a.op}): ${e.message}` }); }
    }
  };
  try {
    let res = r.call('onInit', { all: data, idx: warm - 1, hist: H, ...ctxData(warm - 1) }, 1000);
    for (const l of res.l) logs.push({ t: data[warm - 1].time * 1000, level: 'log', msg: l });
    act(res.a, warm - 1);
    for (let idx = warm; idx < data.length; idx++) {
      if (Date.now() - t0 > 30000) { stopped = 'Тест прерван: превышено время 30 секунд'; break; }
      const b = data[idx], h = half(b.close), t = b.time;
      for (const o of [...ord]) {
        if (o.exp && o.exp <= t) { ord.splice(ord.indexOf(o), 1); continue; }
        const buy = o.type.startsWith('buy');
        if (o.type.endsWith('stop_limit')) { if (buy ? b.high + h >= o.price : b.low - h <= o.price) { o.type = buy ? 'buy_limit' : 'sell_limit'; o.price = o.stoplimit; } else continue; }
        let px = null;
        if (o.type === 'buy_limit' && b.low + h <= o.price) px = Math.min(o.price, b.open + h);
        if (o.type === 'sell_limit' && b.high - h >= o.price) px = Math.max(o.price, b.open - h);
        if (o.type === 'buy_stop' && b.high + h >= o.price) px = Math.max(o.price, b.open + h);
        if (o.type === 'sell_stop' && b.low - h <= o.price) px = Math.min(o.price, b.open - h);
        if (px !== null) { ord.splice(ord.indexOf(o), 1); try { open(buy ? 'buy' : 'sell', o.lots, px, o, t); } catch (e) { logs.push({ t: t * 1000, level: 'warn', msg: 'Ордер отклонён: ' + e.message }); } }
      }
      for (const p of [...pos]) {
        if (p.side === 'buy') {
          if (p.sl && b.low - h <= p.sl) closeP(p, Math.min(p.sl, b.open - h), 'sl', t);
          else if (p.tp && b.high - h >= p.tp) closeP(p, Math.max(p.tp, b.open - h), 'tp', t);
        } else {
          if (p.sl && b.high + h >= p.sl) closeP(p, Math.max(p.sl, b.open + h), 'sl', t);
          else if (p.tp && b.low + h <= p.tp) closeP(p, Math.min(p.tp, b.open + h), 'tp', t);
        }
      }
      for (const p of pos) if (p.trail > 0) { const px = p.side === 'buy' ? b.close - h : b.close + h, ns = p.side === 'buy' ? px - p.trail : px + p.trail;
        if ((p.side === 'buy' ? px - p.entry : p.entry - px) >= p.trail && (!p.sl || (p.side === 'buy' ? ns > p.sl : ns < p.sl))) p.sl = rd(ns); }
      for (let g = 0; g < 50 && pos.length; g++) { const mu = marginUsed(), eq = equityAt(b.close); if (eq / mu * 100 > so) break;
        const w = pos.map(p => [p, pnl(p, p.side === 'buy' ? b.close - h : b.close + h)]).sort((x, y) => x[1] - y[1])[0][0]; closeP(w, w.side === 'buy' ? b.close - h : b.close + h, 'stopout', t); }
      const eq = equityAt(b.close);
      if (eq > peak) peak = eq; if (peak - eq > maxDD) { maxDD = peak - eq; maxDDp = maxDD / peak * 100; }
      curve.push({ time: t, value: Math.round(eq * 100) / 100 });
      const dk = dayKey(t);
      if (L.maxDailyLoss > 0 && (daily[dk] || 0) + pos.reduce((s, p) => s + pnl(p, b.close), 0) <= -L.maxDailyLoss) { stopped = `Робот остановлен лимитом дневного убытка ${new Date(t * 1000).toLocaleDateString('ru-RU')}`; break; }
      if (L.maxDrawdownPct > 0 && eq <= deposit * (1 - L.maxDrawdownPct / 100)) { stopped = `Робот остановлен лимитом просадки ${L.maxDrawdownPct}%`; break; }
      res = r.call('onBar', { idx, hist: H, ...ctxData(idx) }, 250);
      for (const l of res.l) if (logs.length < 300) logs.push({ t: t * 1000, level: 'log', msg: l });
      act(res.a, idx);
    }
  } catch (e) { stopped = 'Ошибка в коде: ' + errText(e); }
  finally { r.dispose(); }
  const lastBar = data[Math.min(data.length - 1, curve.length + warm - 1)] || data[data.length - 1];
  for (const p of [...pos]) closeP(p, p.side === 'buy' ? lastBar.close - half(lastBar.close) : lastBar.close + half(lastBar.close), 'end', lastBar.time);
  const net = deals.map(d => d.pnl - d.comm), wins = net.filter(v => v > 0), losses = net.filter(v => v <= 0);
  const gp = wins.reduce((s, v) => s + v, 0), gl = -losses.reduce((s, v) => s + v, 0);
  return {
    symbol, tf, from: data[warm].time, to: lastBar.time, bars: data.length, deposit, leverage: lev, final: bal, net: bal - deposit,
    trades: deals.length, wins: wins.length, winRate: deals.length ? wins.length / deals.length * 100 : 0, grossProfit: gp, grossLoss: gl,
    profitFactor: gl > 0 ? gp / gl : (gp > 0 ? null : 0), avgTrade: deals.length ? (bal - deposit) / deals.length : 0, maxDD, maxDDp,
    best: net.length ? Math.max(...net) : 0, worst: net.length ? Math.min(...net) : 0, stopped, curve, deals: deals.slice(-500).reverse(), logs: logs.slice(0, 300),
    src: M.historySrc(symbol) || 'sim',
  };
}

module.exports = { inspect, start, stop, stopAllFor, stopAll, resumeAll, reloadLimits, backtest, cleanLimits, DEF_LIMITS, RUN, log };
