'use strict';
/* Торговый движок в стиле MT5: лоты, bid/ask, маржа от кредитного плеча, отложенные ордера,
   SL/TP/трейлинг, частичное закрытие, стоп-аут по уровню маржи. Все средства виртуальные. */
const { db, setting, addLedger } = require('./db');
const { SESS } = require('./catalog');
const M = require('./market');

class TradeError extends Error {}
const fail = m => { throw new TradeError(m); };
const dir = side => side === 'buy' ? 1 : -1;
const usd = v => '$' + (Math.round(v * 100) / 100).toLocaleString('ru-RU');
const PENDING = ['buy_limit', 'sell_limit', 'buy_stop', 'sell_stop', 'buy_stop_limit', 'sell_stop_limit'];

function inst(sym) { const i = M.INS[sym]; if (!i || !i.enabled) fail('Инструмент недоступен: ' + sym); return i; }
function normLots(i, lots) {
  lots = +lots; if (!(lots > 0)) fail('Укажите объём');
  const v = +(Math.round(lots / i.lot_step) * i.lot_step).toFixed(8);
  if (Math.abs(v - lots) > i.lot_step * 1e-6) fail(`Объём должен быть кратен ${i.lot_step}`);
  if (v < i.min_lot) fail(`Минимальный объём ${i.min_lot}`);
  if (v > i.max_lot) fail(`Максимальный объём ${i.max_lot}`);
  return v;
}
function liveQuote(i) { const q = M.quote(i.sym); if (!q) fail('Нет котировки по ' + i.sym); return q; }
const num = (v, name) => { if (v === null || v === undefined || v === '' || v === 0) return null; v = +v; if (!isFinite(v) || v <= 0) fail('Неверное значение: ' + name); return v; };
const notional = (i, lots, price) => M.toUSD(lots * i.contract * price, i.ccy);
const effLev = (u, i, cap) => Math.max(1, Math.min(u.leverage, i.max_lev, cap || Infinity));
const pnlOf = (p, i, price) => M.toUSD(dir(p.side) * (price - p.entry) * p.lots * i.contract, i.ccy);
const closePx = (p, q) => p.side === 'buy' ? q.bid : q.ask;

function checkStops(side, sl, tp, ref, label = 'текущей цены') {
  if (side === 'buy') { if (sl && sl >= ref) fail('Стоп-лосс для покупки должен быть ниже ' + label); if (tp && tp <= ref) fail('Тейк-профит для покупки должен быть выше ' + label); }
  else { if (sl && sl <= ref) fail('Стоп-лосс для продажи должен быть выше ' + label); if (tp && tp >= ref) fail('Тейк-профит для продажи должен быть ниже ' + label); }
}

function account(uid) {
  const u = db.prepare('SELECT id,balance,leverage FROM users WHERE id=?').get(uid);
  if (!u) return null;
  let margin = 0, floating = 0;
  const positions = db.prepare('SELECT * FROM positions WHERE user_id=? ORDER BY id DESC').all(uid).map(p => {
    const i = M.INS[p.symbol], q = M.quote(p.symbol), px = q ? closePx(p, q) : p.entry, pl = i ? pnlOf(p, i, px) : 0;
    margin += p.margin; floating += pl;
    return { ...p, price: px, pnl: pl, digits: i?.digits ?? 2, open: !!q?.open };
  });
  const equity = u.balance + floating;
  const so = +setting('stop_out'), mc = +setting('margin_call');
  const level = margin > 0 ? equity / margin * 100 : null;
  return { balance: u.balance, equity, margin, free: equity - margin, level, floating, leverage: u.leverage, stopOut: so, marginCall: level !== null && level <= mc, positions };
}
const orders = uid => db.prepare("SELECT * FROM orders WHERE user_id=? AND status='pending' ORDER BY id DESC").all(uid).map(o => ({ ...o, digits: M.INS[o.symbol]?.digits ?? 2 }));

function openMarket(uid, o) {
  const i = inst(o.symbol);
  if (!['buy', 'sell'].includes(o.side)) fail('Неверное направление');
  const lots = normLots(i, o.lots), sl = num(o.sl, 'SL'), tp = num(o.tp, 'TP'), trail = num(o.trail, 'трейлинг');
  const q = liveQuote(i);
  if (!q.open) fail(`Рынок ${i.sym} закрыт (${SESS[i.session]?.name || i.session})`);
  const price = o.side === 'buy' ? q.ask : q.bid;
  checkStops(o.side, sl, tp, o.side === 'buy' ? q.bid : q.ask);
  return db.transaction(() => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
    const lev = effLev(u, i, o.levCap), margin = notional(i, lots, price) / lev, comm = notional(i, lots, price) * i.comm / 100;
    const acc = account(uid);
    if (acc.free - comm < margin) fail(`Недостаточно свободной маржи: нужно ${usd(margin + comm)}, свободно ${usd(acc.free)}`);
    db.prepare('UPDATE users SET balance=balance-? WHERE id=?').run(comm, uid);
    const r = db.prepare('INSERT INTO positions(user_id,bot_id,symbol,side,lots,entry,margin,leverage,sl,tp,trail,comm,comment,opened_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(uid, o.bot_id || null, i.sym, o.side, lots, price, margin, lev, sl, tp, trail, comm, String(o.comment || '').slice(0, 60) || null, Date.now());
    return { id: r.lastInsertRowid, price, margin, comm, lots, leverage: lev };
  })();
}

function placePending(uid, o) {
  const i = inst(o.symbol);
  if (!PENDING.includes(o.type)) fail('Неверный тип ордера');
  const lots = normLots(i, o.lots), price = num(o.price, 'цена');
  if (!price) fail('Укажите цену ордера');
  const sl = num(o.sl, 'SL'), tp = num(o.tp, 'TP'), trail = num(o.trail, 'трейлинг');
  let stoplimit = null;
  const q = liveQuote(i), buy = o.type.startsWith('buy');
  if (o.type === 'buy_limit' && price >= q.ask) fail('Buy Limit ставится ниже текущей цены Ask');
  if (o.type === 'sell_limit' && price <= q.bid) fail('Sell Limit ставится выше текущей цены Bid');
  if (/^buy_stop/.test(o.type) && price <= q.ask) fail('Buy Stop ставится выше текущей цены Ask');
  if (/^sell_stop/.test(o.type) && price >= q.bid) fail('Sell Stop ставится ниже текущей цены Bid');
  if (o.type.endsWith('stop_limit')) {
    stoplimit = num(o.stoplimit, 'лимитная цена'); if (!stoplimit) fail('Укажите лимитную цену (Stop Limit)');
    if (buy && stoplimit > price) fail('Для Buy Stop Limit лимитная цена не выше стоп-цены');
    if (!buy && stoplimit < price) fail('Для Sell Stop Limit лимитная цена не ниже стоп-цены');
  }
  checkStops(buy ? 'buy' : 'sell', sl, tp, stoplimit || price, 'цены ордера');
  let exp = null;
  if (o.expires) { exp = +new Date(o.expires); if (!(exp > Date.now())) fail('Срок истечения должен быть в будущем'); }
  if (db.prepare("SELECT COUNT(*) n FROM orders WHERE user_id=? AND status='pending'").get(uid).n >= 200) fail('Не больше 200 отложенных ордеров');
  const r = db.prepare('INSERT INTO orders(user_id,bot_id,symbol,type,lots,price,stoplimit,sl,tp,trail,expires_at,lev_cap,comment,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(uid, o.bot_id || null, i.sym, o.type, lots, price, stoplimit, sl, tp, trail, exp, o.levCap || null, String(o.comment || '').slice(0, 60) || null, Date.now());
  return { id: r.lastInsertRowid };
}

function closePosition(uid, id, lots, reason = 'manual', force = false) {
  const p = db.prepare('SELECT * FROM positions WHERE id=? AND user_id=?').get(+id, uid);
  if (!p) fail('Позиция не найдена');
  const i = M.INS[p.symbol]; if (!i) fail('Инструмент удалён');
  const q = liveQuote(i);
  if (!q.open && !force) fail(`Рынок ${i.sym} закрыт`);
  let cl = p.lots;
  if (lots !== undefined && lots !== null && lots !== '') { cl = normLotsClose(i, lots); if (cl > p.lots + 1e-9) fail('Объём больше открытой позиции'); }
  const full = cl >= p.lots - 1e-9;
  if (full) cl = p.lots;
  const px = closePx(p, q);
  return db.transaction(() => {
    const pnl = pnlOf({ ...p, lots: cl }, i, px), part = cl / p.lots, comm = p.comm * part;
    db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(pnl, uid);
    db.prepare('INSERT INTO deals(user_id,bot_id,position_id,symbol,side,lots,entry,exit,pnl,comm,reason,opened_at,closed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(uid, p.bot_id, p.id, p.symbol, p.side, cl, p.entry, px, pnl, comm, reason, p.opened_at, Date.now());
    if (full) db.prepare('DELETE FROM positions WHERE id=?').run(p.id);
    else db.prepare('UPDATE positions SET lots=?, margin=margin*?, comm=comm-? WHERE id=?').run(+(p.lots - cl).toFixed(8), 1 - part, comm, p.id);
    return { pnl, price: px, lots: cl, full };
  })();
}
function normLotsClose(i, lots) { lots = +lots; if (!(lots > 0)) fail('Укажите объём'); const v = +(Math.round(lots / i.lot_step) * i.lot_step).toFixed(8); if (v < i.lot_step) fail('Слишком маленький объём'); return v; }

function modifyPosition(uid, id, o) {
  const p = db.prepare('SELECT * FROM positions WHERE id=? AND user_id=?').get(+id, uid);
  if (!p) fail('Позиция не найдена');
  const i = inst(p.symbol), q = liveQuote(i);
  const sl = 'sl' in o ? num(o.sl, 'SL') : p.sl, tp = 'tp' in o ? num(o.tp, 'TP') : p.tp, trail = 'trail' in o ? num(o.trail, 'трейлинг') : p.trail;
  checkStops(p.side, sl, tp, closePx(p, q));
  db.prepare('UPDATE positions SET sl=?, tp=?, trail=? WHERE id=?').run(sl, tp, trail, p.id);
  return { ok: true };
}
function reverse(uid, id) {
  const p = db.prepare('SELECT * FROM positions WHERE id=? AND user_id=?').get(+id, uid);
  if (!p) fail('Позиция не найдена');
  closePosition(uid, id, null, 'reverse');
  return openMarket(uid, { symbol: p.symbol, side: p.side === 'buy' ? 'sell' : 'buy', lots: p.lots, bot_id: p.bot_id, comment: 'Разворот #' + p.id });
}
function closeAll(uid, { filter = 'all', symbol, bot_id } = {}, reason = 'manual') {
  const acc = account(uid); let n = 0, skipped = 0, pnl = 0;
  for (const p of acc.positions) {
    if (symbol && p.symbol !== symbol) continue;
    if (bot_id !== undefined && p.bot_id !== bot_id) continue;
    if (filter === 'profit' && p.pnl <= 0 || filter === 'loss' && p.pnl >= 0) continue;
    if (!p.open) { skipped++; continue; }
    try { pnl += closePosition(uid, p.id, null, reason).pnl; n++; } catch { skipped++; }
  }
  return { closed: n, skipped, pnl };
}
function cancelOrder(uid, id, note = 'Отменён') {
  const r = db.prepare("UPDATE orders SET status='cancelled', done_at=?, note=? WHERE id=? AND user_id=? AND status='pending'").run(Date.now(), note, +id, uid);
  if (!r.changes) fail('Ордер не найден');
  return { ok: true };
}
function modifyOrder(uid, id, o) {
  const x = db.prepare("SELECT * FROM orders WHERE id=? AND user_id=? AND status='pending'").get(+id, uid);
  if (!x) fail('Ордер не найден');
  db.transaction(() => {
    db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(x.id);
    const r = placePending(uid, { symbol: x.symbol, type: x.type, lots: x.lots, price: 'price' in o ? o.price : x.price, stoplimit: 'stoplimit' in o ? o.stoplimit : x.stoplimit,
      sl: 'sl' in o ? o.sl : x.sl, tp: 'tp' in o ? o.tp : x.tp, trail: 'trail' in o ? o.trail : x.trail, expires: 'expires' in o ? o.expires : x.expires_at, comment: x.comment, bot_id: x.bot_id, levCap: x.lev_cap });
    db.prepare('UPDATE orders SET id=? WHERE id=?').run(-x.id, x.id); // освобождаем номер
    db.prepare('UPDATE orders SET id=? WHERE id=?').run(x.id, r.id);
    db.prepare('DELETE FROM orders WHERE id=?').run(-x.id);
  })();
  return { ok: true };
}

// --- Контроль рисков: срабатывание ордеров, SL/TP, трейлинг, стоп-аут ---
const listeners = [];
function riskLoop() {
  const now = Date.now();
  for (const o of db.prepare("SELECT * FROM orders WHERE status='pending'").all()) {
    if (o.expires_at && o.expires_at <= now) { db.prepare("UPDATE orders SET status='expired', done_at=? WHERE id=?").run(now, o.id); continue; }
    const q = M.quote(o.symbol); if (!q || !q.open) continue;
    let hit = false;
    switch (o.type) {
      case 'buy_limit': hit = q.ask <= o.price; break;
      case 'sell_limit': hit = q.bid >= o.price; break;
      case 'buy_stop': hit = q.ask >= o.price; break;
      case 'sell_stop': hit = q.bid <= o.price; break;
      case 'buy_stop_limit': if (q.ask >= o.price) db.prepare("UPDATE orders SET type='buy_limit', price=stoplimit, stoplimit=NULL, note='Стоп сработал' WHERE id=?").run(o.id); continue;
      case 'sell_stop_limit': if (q.bid <= o.price) db.prepare("UPDATE orders SET type='sell_limit', price=stoplimit, stoplimit=NULL, note='Стоп сработал' WHERE id=?").run(o.id); continue;
    }
    if (!hit) continue;
    try {
      const r = openMarket(o.user_id, { symbol: o.symbol, side: o.type.startsWith('buy') ? 'buy' : 'sell', lots: o.lots, sl: o.sl, tp: o.tp, trail: o.trail, comment: o.comment || ('Ордер #' + o.id), bot_id: o.bot_id, levCap: o.lev_cap });
      db.prepare("UPDATE orders SET status='filled', done_at=?, note=? WHERE id=?").run(now, 'Позиция #' + r.id + ' по ' + r.price, o.id);
    } catch (e) { db.prepare("UPDATE orders SET status='rejected', done_at=?, note=? WHERE id=?").run(now, e.message, o.id); }
  }
  const byUser = new Map();
  for (const p of db.prepare('SELECT * FROM positions').all()) {
    const i = M.INS[p.symbol], q = M.quote(p.symbol);
    if (!byUser.has(p.user_id)) byUser.set(p.user_id, true);
    if (!i || !q || !q.open) continue;
    const px = closePx(p, q);
    if (p.trail > 0) {
      const ns = p.side === 'buy' ? px - p.trail : px + p.trail;
      const inProfit = dir(p.side) * (px - p.entry) >= p.trail;
      if (inProfit && (!p.sl || (p.side === 'buy' ? ns > p.sl : ns < p.sl))) { p.sl = M.round(ns, i.digits); db.prepare('UPDATE positions SET sl=? WHERE id=?').run(p.sl, p.id); }
    }
    let why = null;
    if (p.sl && (p.side === 'buy' ? px <= p.sl : px >= p.sl)) why = 'sl';
    else if (p.tp && (p.side === 'buy' ? px >= p.tp : px <= p.tp)) why = 'tp';
    if (why) try { closePosition(p.user_id, p.id, null, why); } catch {}
  }
  const so = +setting('stop_out') || 50;
  for (const uid of byUser.keys()) {
    for (let guard = 0; guard < 50; guard++) {
      const a = account(uid);
      if (!a.positions.length) { if (a.balance < 0) { db.prepare('UPDATE users SET balance=0 WHERE id=?').run(uid); addLedger(uid, -a.balance, 'nbp', 'Защита от отрицательного баланса'); } break; }
      if (a.level === null || a.level > so) break;
      const worst = a.positions.filter(p => p.open).sort((x, y) => x.pnl - y.pnl)[0];
      if (!worst) break;
      try { closePosition(uid, worst.id, null, 'stopout'); } catch { break; }
    }
  }
  for (const f of listeners) try { f(); } catch {}
}
setInterval(() => { try { riskLoop(); } catch (e) { console.error('risk', e); } }, 500);

const deals = (uid, from = 0, limit = 500) => db.prepare('SELECT * FROM deals WHERE user_id=? AND closed_at>=? ORDER BY id DESC LIMIT ?').all(uid, from, limit).map(d => ({ ...d, digits: M.INS[d.symbol]?.digits ?? 2 }));
const orderHistory = (uid, limit = 200) => db.prepare("SELECT * FROM orders WHERE user_id=? AND status!='pending' ORDER BY id DESC LIMIT ?").all(uid, limit).map(o => ({ ...o, digits: M.INS[o.symbol]?.digits ?? 2 }));

module.exports = { TradeError, account, orders, deals, orderHistory, openMarket, placePending, closePosition, modifyPosition, reverse, closeAll, cancelOrder, modifyOrder, onLoop: f => listeners.push(f), PENDING, notional, pnlOf, effLev };
