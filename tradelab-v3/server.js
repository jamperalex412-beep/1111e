'use strict';
/* TradeLab — учебная демо-платформа. Все средства виртуальные, реальные деньги не принимаются и не выплачиваются. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
try {
  for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, setting, setSetting, genCode, ledgerSum, addLedger, createUser } = require('./lib/db');
const E = process.env;

// --- CLI: node server.js create-admin email пароль "Имя" ---
if (process.argv[2] === 'create-admin') {
  const [, , , email, password, name = 'Администратор'] = process.argv;
  if (!email || !password || password.length < 8) { console.log('Использование: node server.js create-admin email пароль(от 8 символов) "Имя"'); process.exit(1); }
  const ex = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (ex) { db.prepare("UPDATE users SET role='admin', pass=?, invite_code=COALESCE(invite_code,?) WHERE id=?").run(bcrypt.hashSync(password, 10), genCode(), ex.id); console.log('Пользователь повышен до админа, пароль обновлён'); }
  else { createUser({ name, email, password, role: 'admin' }); console.log('Админ создан:', email); }
  process.exit(0);
}
if (E.ADMIN_EMAIL && E.ADMIN_PASSWORD && !db.prepare("SELECT 1 FROM users WHERE role='admin'").get()) {
  createUser({ name: 'Администратор', email: E.ADMIN_EMAIL, password: E.ADMIN_PASSWORD, role: 'admin' });
  console.log('Создан админ из .env:', E.ADMIN_EMAIL);
}

const M = require('./lib/market');
const feeds = require('./lib/feeds');
const T = require('./lib/engine');
const B = require('./lib/bots');
const { SESS, isOpen } = require('./lib/catalog');
feeds.apply();
setTimeout(() => B.resumeAll(), 8000);

const CFG = { port: +E.PORT || 3000, host: E.HOST || '127.0.0.1', name: E.PLATFORM_NAME || 'TradeLab', secure: E.COOKIE_SECURE === '1' };
const SESSION_DAYS = 14;
const LEVERAGES = [1, 2, 5, 10, 20, 30, 50, 100, 200, 300, 400, 500, 1000];

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => { res.set({ 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' }); next(); });
app.use(express.json({ limit: '300kb' }));
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path.startsWith('/api/') && !req.is('application/json')) return res.status(415).json({ error: 'Неверный формат запроса' });
  next();
});

const hits = new Map();
function limited(key, max, ms) { const now = Date.now(); let h = hits.get(key); if (!h || h.reset < now) { h = { n: 0, reset: now + ms }; hits.set(key, h); } return ++h.n > max; }
setInterval(() => { const n = Date.now(); for (const [k, h] of hits) if (h.reset < n) hits.delete(k); db.prepare('DELETE FROM sessions WHERE expires<?').run(n); }, 600000);
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const getCookie = (req, n) => { const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + n + '=([^;]+)')); return m ? decodeURIComponent(m[1]) : null; };
function startSession(res, uid) {
  const t = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(t), uid, Date.now() + SESSION_DAYS * 864e5);
  db.prepare('UPDATE users SET last_login=? WHERE id=?').run(Date.now(), uid);
  res.setHeader('Set-Cookie', `sid=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${CFG.secure ? '; Secure' : ''}`);
}
function auth(req, res, next) {
  const t = getCookie(req, 'sid');
  const u = t && db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(sha(t), Date.now());
  if (!u) return res.status(401).json({ error: 'Требуется вход' });
  if (u.blocked) return res.status(403).json({ error: 'Аккаунт заблокирован. Обратитесь к ментору или администратору.' });
  req.user = u; next();
}
const role = (...r) => (req, res, next) => r.includes(req.user.role) ? next() : res.status(403).json({ error: 'Недостаточно прав' });
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const wrap = fn => (req, res) => { try { const r = fn(req, res); if (r instanceof Promise) r.then(v => v !== undefined && !res.headersSent && res.json(v)).catch(e => bad(res, e.message)); else if (r !== undefined && !res.headersSent) res.json(r); } catch (e) { if (!(e instanceof T.TradeError)) console.error(e); bad(res, e.message); } };
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const meOut = u => {
  const m = u.mentor_id ? db.prepare('SELECT name FROM users WHERE id=?').get(u.mentor_id) : null;
  return { id: u.id, name: u.name, email: u.email, role: u.role, leverage: u.leverage, mentor: m?.name || null, invite_code: u.role === 'student' ? null : u.invite_code };
};

// --- Аккаунт ---
app.get('/api/config', (req, res) => res.json({ name: CFG.name, company: { name: E.COMPANY_NAME || '', reg: E.COMPANY_REG || '', address: E.COMPANY_ADDRESS || '', email: E.COMPANY_EMAIL || '' }, registrationOpen: setting('registration_open') === '1', inviteRequired: setting('invite_required') === '1', startBalance: +setting('start_balance'), botsEnabled: setting('bots_enabled') === '1' }));
app.post('/api/register', (req, res) => {
  if (limited('reg:' + req.ip, 10, 3600e3)) return bad(res, 'Слишком много попыток, попробуйте позже', 429);
  if (setting('registration_open') !== '1') return bad(res, 'Регистрация закрыта. Попросите ментора создать вам аккаунт.', 403);
  let { name, email, password, invite, terms } = req.body || {};
  name = String(name || '').trim(); email = String(email || '').trim().toLowerCase(); password = String(password || ''); invite = String(invite || '').trim().toUpperCase();
  if (name.length < 2 || name.length > 40) return bad(res, 'Имя — от 2 до 40 символов');
  if (!EMAIL.test(email)) return bad(res, 'Проверьте email');
  if (password.length < 8 || !/[A-Za-zА-Яа-я]/.test(password) || !/\d/.test(password)) return bad(res, 'Пароль — от 8 символов, буквы и цифры');
  if (!terms) return bad(res, 'Подтвердите, что понимаете: счёт учебный, средства виртуальные');
  let mentor = null;
  if (invite) { mentor = db.prepare("SELECT id FROM users WHERE invite_code=? AND role IN ('mentor','admin') AND blocked=0").get(invite); if (!mentor) return bad(res, 'Код ментора не найден'); }
  else if (setting('invite_required') === '1') return bad(res, 'Нужен код ментора');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return bad(res, 'Этот email уже зарегистрирован', 409);
  const id = createUser({ name, email, password, mentor_id: mentor?.id ?? null });
  startSession(res, id);
  res.json(meOut(db.prepare('SELECT * FROM users WHERE id=?').get(id)));
});
app.post('/api/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase(), password = String(req.body?.password || '');
  if (limited('login:' + req.ip, 20, 600e3) || limited('login:' + email, 8, 600e3)) return bad(res, 'Слишком много попыток, подождите 10 минут', 429);
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!u || !bcrypt.compareSync(password, u.pass)) return bad(res, 'Неверный email или пароль', 401);
  if (u.blocked) return bad(res, 'Аккаунт заблокирован', 403);
  startSession(res, u.id); res.json(meOut(u));
});
app.post('/api/logout', (req, res) => { const t = getCookie(req, 'sid'); if (t) db.prepare('DELETE FROM sessions WHERE token=?').run(sha(t)); res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0'); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json({ ...meOut(req.user), maxLeverage: +setting('max_leverage'), leverages: LEVERAGES.filter(l => l <= +setting('max_leverage')) }));
app.post('/api/me/password', auth, (req, res) => {
  const { current, password } = req.body || {};
  if (!bcrypt.compareSync(String(current || ''), req.user.pass)) return bad(res, 'Текущий пароль неверный');
  if (String(password || '').length < 8) return bad(res, 'Новый пароль — от 8 символов');
  db.prepare('UPDATE users SET pass=? WHERE id=?').run(bcrypt.hashSync(String(password), 10), req.user.id); res.json({ ok: true });
});
app.post('/api/me/leverage', auth, (req, res) => {
  const l = +req.body?.leverage;
  if (!LEVERAGES.includes(l) || l > +setting('max_leverage')) return bad(res, 'Недопустимое плечо');
  db.prepare('UPDATE users SET leverage=? WHERE id=?').run(l, req.user.id); res.json({ ok: true });
});

// --- Публичная лента для главной страницы ---
const TICKER = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'AAPL', 'NVDA', 'TSLA', 'MSFT', 'US500', 'US100', 'DE40', 'EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'CL', 'GC'];
let tickCache = { t: 0, data: null };
app.get('/api/public/ticker', async (req, res) => {
  if (Date.now() - tickCache.t < 2000 && tickCache.data) return res.json(tickCache.data);
  const out = [];
  for (const s of TICKER) {
    const i = M.INS[s], q = M.Q.get(s); if (!i || !i.enabled || !q) continue;
    let spark = [];
    try { spark = (await M.candles(s, 'M15', 48)).map(b => +b.close.toFixed(i.digits)); } catch {}
    out.push({ sym: s, name: i.name, cat: i.cat, digits: i.digits, last: q.last, chg: q.ref ? (q.last / q.ref - 1) * 100 : 0, open: isOpen(i.session), spark });
  }
  tickCache = { t: Date.now(), data: out }; res.json(out);
});

// --- Рынок ---
const instOut = i => ({ sym: i.sym, name: i.name, cat: i.cat, ccy: i.ccy, contract: i.contract, minLot: i.min_lot, lotStep: i.lot_step, maxLot: i.max_lot, digits: i.digits,
  maxLev: i.max_lev, spread: i.spread, comm: i.comm, session: i.session, sessionName: SESS[i.session]?.name || i.session, src: M.ASSIGN[i.sym] || 'sim' });
app.get('/api/instruments', auth, (req, res) => res.json(M.LIST.filter(i => i.enabled).map(instOut)));
app.get('/api/quotes', auth, (req, res) => {
  const o = {};
  for (const i of M.LIST) { if (!i.enabled) continue; const q = M.Q.get(i.sym); if (!q) continue;
    o[i.sym] = [q.bid, q.ask, q.ref ? (q.last / q.ref - 1) * 100 : 0, isOpen(i.session) ? 1 : 0, M.SIMFB.has(i.sym) ? 'sim' : q.src, q.t]; }
  res.json(o);
});
app.get('/api/candles/:sym', auth, wrap(async req => {
  if (!M.INS[req.params.sym]) throw new Error('Нет такого инструмента');
  const tf = M.TF[req.query.tf] ? req.query.tf : 'M15';
  return await M.candles(req.params.sym, tf, Math.min(5000, Math.max(1, +req.query.limit || 600)));
}));

// --- Торговля ---
app.get('/api/account', auth, (req, res) => res.json({ ...T.account(req.user.id), orders: T.orders(req.user.id) }));
app.get('/api/history', auth, (req, res) => {
  const from = Math.max(0, +req.query.from || 0);
  res.json({ deals: T.deals(req.user.id, from, 1000), orders: T.orderHistory(req.user.id, 300) });
});
app.get('/api/ledger', auth, (req, res) => res.json(db.prepare('SELECT l.*, b.name by_name FROM ledger l LEFT JOIN users b ON b.id=l.by_user WHERE l.user_id=? ORDER BY l.id DESC LIMIT 200').all(req.user.id)));
const tradeLimit = (req, res, next) => limited('trade:' + req.user.id, 30, 10000) ? bad(res, 'Слишком много запросов', 429) : next();
app.post('/api/trade/market', auth, tradeLimit, wrap(req => T.openMarket(req.user.id, { ...pick(req.body, ['symbol', 'side', 'lots', 'sl', 'tp', 'trail', 'comment']) })));
app.post('/api/trade/pending', auth, tradeLimit, wrap(req => T.placePending(req.user.id, pick(req.body, ['symbol', 'type', 'lots', 'price', 'stoplimit', 'sl', 'tp', 'trail', 'expires', 'comment']))));
app.post('/api/trade/close', auth, tradeLimit, wrap(req => T.closePosition(req.user.id, req.body?.id, req.body?.lots)));
app.post('/api/trade/close-all', auth, tradeLimit, wrap(req => T.closeAll(req.user.id, { filter: req.body?.filter, symbol: req.body?.symbol || undefined })));
app.post('/api/trade/modify', auth, tradeLimit, wrap(req => T.modifyPosition(req.user.id, req.body?.id, pick(req.body, ['sl', 'tp', 'trail']))));
app.post('/api/trade/reverse', auth, tradeLimit, wrap(req => T.reverse(req.user.id, req.body?.id)));
app.post('/api/trade/cancel', auth, tradeLimit, wrap(req => T.cancelOrder(req.user.id, req.body?.id)));
app.post('/api/trade/order-modify', auth, tradeLimit, wrap(req => T.modifyOrder(req.user.id, req.body?.id, pick(req.body, ['price', 'stoplimit', 'sl', 'tp', 'trail', 'expires']))));
function pick(o, keys) { const r = {}; for (const k of keys) if (o && k in o) r[k] = o[k]; return r; }

// --- Роботы ---
const botsOn = (req, res, next) => setting('bots_enabled') === '1' || req.user.role === 'admin' ? next() : bad(res, 'Роботы отключены администратором', 403);
function botStats(b) {
  const L = B.cleanLimits(JSON.parse(b.limits || '{}'));
  const total = db.prepare('SELECT COALESCE(SUM(pnl-comm),0) s, COUNT(*) n FROM deals WHERE bot_id=?').get(b.id);
  const open = db.prepare('SELECT COUNT(*) n FROM positions WHERE bot_id=?').get(b.id).n;
  return { ...b, inputs: JSON.parse(b.inputs || '{}'), limits: L, state: undefined, total: total.s, deals: total.n, open, running: B.RUN.has(b.id) };
}
app.get('/api/bots', auth, botsOn, (req, res) => res.json(db.prepare('SELECT * FROM bots WHERE user_id=? ORDER BY id DESC').all(req.user.id).map(botStats)));
app.get('/api/bots/defaults', auth, (req, res) => res.json({ limits: B.DEF_LIMITS, maxBots: +setting('max_bots') }));
app.post('/api/bots/inspect', auth, botsOn, (req, res) => { if (limited('insp:' + req.user.id, 60, 60000)) return bad(res, 'Слишком часто', 429); res.json(B.inspect(String(req.body?.code || ''))); });
app.post('/api/bots/save', auth, botsOn, wrap(req => {
  const b = req.body || {}, uid = req.user.id;
  const name = String(b.name || '').trim().slice(0, 60) || 'Робот', code = String(b.code || '');
  if (code.length > 100000) throw new Error('Код длиннее 100 000 символов');
  if (!M.INS[b.symbol]) throw new Error('Выберите инструмент');
  if (!M.TF[b.tf]) throw new Error('Выберите таймфрейм');
  const inputs = JSON.stringify(b.inputs && typeof b.inputs === 'object' ? b.inputs : {}).slice(0, 20000);
  const limits = JSON.stringify(B.cleanLimits(b.limits));
  if (b.id) {
    const ex = db.prepare('SELECT * FROM bots WHERE id=? AND user_id=?').get(+b.id, uid); if (!ex) throw new Error('Робот не найден');
    if (B.RUN.has(ex.id) && (ex.code !== code || ex.symbol !== b.symbol || ex.tf !== b.tf || ex.inputs !== inputs)) throw new Error('Остановите робота, чтобы менять код, инструмент, таймфрейм или параметры. Лимиты можно менять на ходу.');
    db.prepare('UPDATE bots SET name=?, code=?, symbol=?, tf=?, inputs=?, limits=?, updated_at=? WHERE id=?').run(name, code, b.symbol, b.tf, inputs, limits, Date.now(), ex.id);
    B.reloadLimits(ex.id);
    return { id: ex.id };
  }
  if (db.prepare('SELECT COUNT(*) n FROM bots WHERE user_id=?').get(uid).n >= +setting('max_bots')) throw new Error(`Не больше ${setting('max_bots')} роботов на аккаунт`);
  const r = db.prepare('INSERT INTO bots(user_id,name,code,symbol,tf,inputs,limits,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(uid, name, code, b.symbol, b.tf, inputs, limits, Date.now(), Date.now());
  return { id: r.lastInsertRowid };
}));
const myBot = req => { const b = db.prepare('SELECT * FROM bots WHERE id=? AND user_id=?').get(+req.params.id, req.user.id); if (!b) throw new Error('Робот не найден'); return b; };
app.post('/api/bots/:id/start', auth, botsOn, wrap(req => { const b = myBot(req); B.start(b.id); return { ok: true }; }));
app.post('/api/bots/:id/stop', auth, wrap(req => { const b = myBot(req); B.stop(b.id); return { ok: true }; }));
app.post('/api/bots/:id/delete', auth, wrap(req => { const b = myBot(req); if (B.RUN.has(b.id)) B.stop(b.id, 'Робот удалён'); db.prepare('DELETE FROM bots WHERE id=?').run(b.id); return { ok: true }; }));
app.post('/api/bots/:id/clear-state', auth, wrap(req => { const b = myBot(req); if (B.RUN.has(b.id)) throw new Error('Сначала остановите робота'); db.prepare("UPDATE bots SET state='{}' WHERE id=?").run(b.id); return { ok: true }; }));
app.get('/api/bots/:id/logs', auth, wrap(req => { const b = myBot(req); return db.prepare('SELECT * FROM bot_logs WHERE bot_id=? AND id>? ORDER BY id DESC LIMIT 300').all(b.id, +req.query.after || 0).reverse(); }));
const btBusy = new Set();
app.post('/api/bots/backtest', auth, botsOn, wrap(async req => {
  if (btBusy.has(req.user.id)) throw new Error('Тест уже идёт, дождитесь результата');
  if (limited('bt:' + req.user.id, 30, 3600e3)) throw new Error('Не больше 30 тестов в час');
  btBusy.add(req.user.id);
  try { return await B.backtest(pick(req.body, ['code', 'inputs', 'symbol', 'tf', 'bars', 'deposit', 'leverage', 'limits'])); }
  finally { btBusy.delete(req.user.id); }
}));

// --- Менторы и админ ---
function canSee(req, uid) { const u = db.prepare('SELECT * FROM users WHERE id=?').get(uid); if (!u) return null; return req.user.role === 'admin' || u.mentor_id === req.user.id ? u : null; }
app.get('/api/staff/users', auth, role('admin', 'mentor'), (req, res) => {
  const q = '%' + String(req.query.q || '').trim() + '%';
  const rows = req.user.role === 'admin'
    ? db.prepare('SELECT u.*, m.name mentor_name FROM users u LEFT JOIN users m ON m.id=u.mentor_id WHERE (u.name LIKE ? OR u.email LIKE ?) ORDER BY u.id DESC LIMIT 1000').all(q, q)
    : db.prepare('SELECT u.*, m.name mentor_name FROM users u LEFT JOIN users m ON m.id=u.mentor_id WHERE u.mentor_id=? AND (u.name LIKE ? OR u.email LIKE ?) ORDER BY u.id DESC').all(req.user.id, q, q);
  const dep = Object.fromEntries(db.prepare('SELECT user_id, SUM(amount) s FROM ledger GROUP BY user_id').all().map(r => [r.user_id, r.s]));
  const trades = Object.fromEntries(db.prepare('SELECT user_id, COUNT(DISTINCT position_id) n FROM deals GROUP BY user_id').all().map(r => [r.user_id, r.n]));
  const bots = Object.fromEntries(db.prepare("SELECT user_id, COUNT(*) n FROM bots WHERE status='running' GROUP BY user_id").all().map(r => [r.user_id, r.n]));
  res.json(rows.map(u => { const a = T.account(u.id);
    return { id: u.id, name: u.name, email: u.email, role: u.role, mentor_id: u.mentor_id, mentor_name: u.mentor_name, blocked: u.blocked, created_at: u.created_at, last_login: u.last_login, invite_code: u.invite_code, leverage: u.leverage,
      balance: a.balance, equity: a.equity, result: a.equity - (dep[u.id] || 0), open: a.positions.length, trades: trades[u.id] || 0, bots: bots[u.id] || 0, level: a.level }; }));
});
app.get('/api/staff/users/:id', auth, role('admin', 'mentor'), (req, res) => {
  const u = canSee(req, +req.params.id); if (!u) return bad(res, 'Нет доступа', 404);
  const { pass, ...pub } = u;
  res.json({ user: { ...pub, mentor_name: u.mentor_id ? db.prepare('SELECT name FROM users WHERE id=?').get(u.mentor_id)?.name : null },
    account: T.account(u.id), deposits: ledgerSum(u.id), orders: T.orders(u.id), deals: T.deals(u.id, 0, 300),
    ledger: db.prepare('SELECT l.*, b.name by_name FROM ledger l LEFT JOIN users b ON b.id=l.by_user WHERE l.user_id=? ORDER BY l.id DESC LIMIT 200').all(u.id),
    bots: db.prepare('SELECT * FROM bots WHERE user_id=? ORDER BY id DESC').all(u.id).map(botStats) });
});
app.get('/api/staff/bots/:id', auth, role('admin', 'mentor'), (req, res) => {
  const b = db.prepare('SELECT * FROM bots WHERE id=?').get(+req.params.id); if (!b || !canSee(req, b.user_id)) return bad(res, 'Нет доступа', 404);
  res.json({ bot: botStats(b), logs: db.prepare('SELECT * FROM bot_logs WHERE bot_id=? ORDER BY id DESC LIMIT 300').all(b.id).reverse() });
});
app.post('/api/staff/bots/:id/stop', auth, role('admin', 'mentor'), wrap(req => {
  const b = db.prepare('SELECT * FROM bots WHERE id=?').get(+req.params.id); if (!b || !canSee(req, b.user_id)) throw new Error('Нет доступа');
  B.stop(b.id, 'Остановлен ' + (req.user.role === 'admin' ? 'администратором' : 'ментором') + ' ' + req.user.name); return { ok: true };
}));
app.post('/api/staff/users/:id/reset', auth, role('admin', 'mentor'), wrap(req => {
  const u = canSee(req, +req.params.id); if (!u) throw new Error('Нет доступа');
  B.stopAllFor(u.id, 'Сброс счёта');
  const start = +setting('start_balance') || 0;
  db.transaction(() => {
    for (const p of db.prepare('SELECT * FROM positions WHERE user_id=?').all(u.id))
      db.prepare("INSERT INTO deals(user_id,bot_id,position_id,symbol,side,lots,entry,exit,pnl,comm,reason,opened_at,closed_at) VALUES(?,?,?,?,?,?,?,NULL,0,0,'reset',?,?)").run(u.id, p.bot_id, p.id, p.symbol, p.side, p.lots, p.entry, p.opened_at, Date.now());
    db.prepare('DELETE FROM positions WHERE user_id=?').run(u.id);
    db.prepare("UPDATE orders SET status='cancelled', done_at=?, note='Сброс счёта' WHERE user_id=? AND status='pending'").run(Date.now(), u.id);
    addLedger(u.id, start - ledgerSum(u.id), 'reset', 'Сброс счёта до стартового баланса', req.user.id);
    db.prepare('UPDATE users SET balance=? WHERE id=?').run(start, u.id);
  })();
  return { ok: true };
}));
app.post('/api/admin/users/:id/adjust', auth, role('admin'), wrap(req => {
  const amount = Math.round(+req.body?.amount * 100) / 100, comment = String(req.body?.comment || '').trim().slice(0, 200);
  if (!amount || !isFinite(amount) || Math.abs(amount) > 1e9) throw new Error('Укажите сумму');
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(+req.params.id); if (!u) throw new Error('Пользователь не найден');
  if (amount < 0 && T.account(u.id).free + amount < 0) throw new Error('Списание больше свободной маржи');
  db.transaction(() => { db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(amount, u.id);
    addLedger(u.id, amount, amount > 0 ? 'credit' : 'debit', comment || (amount > 0 ? 'Начисление виртуальных средств' : 'Списание виртуальных средств'), req.user.id); })();
  return { ok: true };
}));
app.post('/api/admin/users/:id/update', auth, role('admin'), wrap(req => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(+req.params.id); if (!u) throw new Error('Пользователь не найден');
  const b = req.body || {};
  const name = b.name !== undefined ? String(b.name).trim() : u.name, r = b.role ?? u.role, blocked = b.blocked !== undefined ? (b.blocked ? 1 : 0) : u.blocked;
  const mentor = b.mentor_id !== undefined ? (b.mentor_id ? +b.mentor_id : null) : u.mentor_id, lev = b.leverage !== undefined ? +b.leverage : u.leverage;
  if (name.length < 2 || name.length > 40) throw new Error('Имя — от 2 до 40 символов');
  if (!['student', 'mentor', 'admin'].includes(r)) throw new Error('Неверная роль');
  if (!LEVERAGES.includes(lev)) throw new Error('Недопустимое плечо');
  if (u.id === req.user.id && (r !== 'admin' || blocked)) throw new Error('Нельзя снять права или заблокировать самого себя');
  if (mentor && (mentor === u.id || !db.prepare("SELECT 1 FROM users WHERE id=? AND role IN ('mentor','admin')").get(mentor))) throw new Error('Неверный ментор');
  if (b.password && String(b.password).length < 8) throw new Error('Пароль — от 8 символов');
  db.transaction(() => {
    db.prepare('UPDATE users SET name=?, role=?, blocked=?, mentor_id=?, leverage=?, invite_code=? WHERE id=?').run(name, r, blocked, mentor, lev, r === 'student' ? null : (u.invite_code || genCode()), u.id);
    if (b.password) db.prepare('UPDATE users SET pass=? WHERE id=?').run(bcrypt.hashSync(String(b.password), 10), u.id);
    if (blocked || b.password) db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  })();
  if (blocked) B.stopAllFor(u.id, 'Аккаунт заблокирован');
  return { ok: true };
}));
app.post('/api/admin/users/:id/invite', auth, role('admin'), wrap(req => {
  const u = db.prepare("SELECT id FROM users WHERE id=? AND role!='student'").get(+req.params.id); if (!u) throw new Error('Код есть только у менторов и админов');
  const c = genCode(); db.prepare('UPDATE users SET invite_code=? WHERE id=?').run(c, u.id); return { invite_code: c };
}));
app.post('/api/admin/users', auth, role('admin'), wrap(req => {
  let { name, email, password, role: r = 'student', mentor_id } = req.body || {};
  name = String(name || '').trim(); email = String(email || '').trim().toLowerCase(); password = String(password || '');
  if (name.length < 2 || name.length > 40) throw new Error('Имя — от 2 до 40 символов');
  if (!EMAIL.test(email)) throw new Error('Проверьте email');
  if (password.length < 8) throw new Error('Пароль — от 8 символов');
  if (!['student', 'mentor', 'admin'].includes(r)) throw new Error('Неверная роль');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw new Error('Email уже занят');
  if (mentor_id && !db.prepare("SELECT 1 FROM users WHERE id=? AND role IN ('mentor','admin')").get(+mentor_id)) throw new Error('Неверный ментор');
  return { id: createUser({ name, email, password, role: r, mentor_id: mentor_id ? +mentor_id : null }, req.user.id) };
}));
app.get('/api/admin/ledger', auth, role('admin'), (req, res) => res.json(db.prepare(
  'SELECT l.*, u.name user_name, u.email user_email, b.name by_name FROM ledger l JOIN users u ON u.id=l.user_id LEFT JOIN users b ON b.id=l.by_user ORDER BY l.id DESC LIMIT 500').all()));
const SETTING_KEYS = { start_balance: [0, 1e9], default_leverage: 'lev', max_leverage: 'lev', stop_out: [0, 100], margin_call: [0, 1000], max_bots: [0, 100], registration_open: 'bool', invite_required: 'bool', bots_enabled: 'bool' };
app.get('/api/admin/settings', auth, role('admin'), (req, res) => res.json(Object.fromEntries(Object.keys(SETTING_KEYS).map(k => [k, setting(k)]))));
app.post('/api/admin/settings', auth, role('admin'), wrap(req => {
  for (const [k, rule] of Object.entries(SETTING_KEYS)) {
    if (req.body?.[k] === undefined) continue; let v = req.body[k];
    if (rule === 'bool') v = v ? '1' : '0';
    else if (rule === 'lev') { if (!LEVERAGES.includes(+v)) throw new Error('Недопустимое плечо'); }
    else { v = +v; if (!(v >= rule[0] && v <= rule[1])) throw new Error(`${k}: от ${rule[0]} до ${rule[1]}`); }
    setSetting(k, v);
  }
  if (+setting('default_leverage') > +setting('max_leverage')) setSetting('default_leverage', setting('max_leverage'));
  if (setting('bots_enabled') !== '1') B.stopAll('Роботы отключены администратором');
  return { ok: true };
}));
// Инструменты
const INST_FIELDS = { name: 's', cat: ['stocks', 'indices', 'futures', 'forex', 'crypto'], ccy: 's', contract: [1e-9, 1e9], min_lot: [1e-9, 1e9], lot_step: [1e-9, 1e9], max_lot: [1e-9, 1e12],
  digits: [0, 10], max_lev: [1, 1000], spread: [0, 10], comm: [0, 10], session: Object.keys(SESS), bn: 'o', fh: 'o', yh: 'o', td: 'o', base: [1e-12, 1e12], vol: [0, 1], enabled: 'b' };
app.get('/api/admin/instruments', auth, role('admin'), (req, res) => res.json(M.LIST.map(i => { const q = M.Q.get(i.sym); return { ...i, assigned: M.ASSIGN[i.sym] || null, fallback: M.SIMFB.has(i.sym), last: q?.last ?? null, at: q?.at ?? null, src: q?.src ?? null }; })));
app.post('/api/admin/instruments', auth, role('admin'), wrap(req => {
  const b = req.body || {}, sym = String(b.sym || '').trim().toUpperCase();
  if (!/^[A-Z0-9._-]{1,20}$/.test(sym)) throw new Error('Тикер: латиница, цифры, до 20 символов');
  const ex = db.prepare('SELECT * FROM instruments WHERE sym=?').get(sym), row = { ...(ex || { name: sym, cat: 'stocks', ccy: 'USD', contract: 1, min_lot: 0.01, lot_step: 0.01, max_lot: 100, digits: 2, max_lev: 20, spread: 0.02, comm: 0, session: 'us', base: 100, vol: 0.005, enabled: 1, sort: 999 }) };
  for (const [k, rule] of Object.entries(INST_FIELDS)) {
    if (!(k in b)) continue; let v = b[k];
    if (rule === 's') { v = String(v).trim().slice(0, 60); if (!v) throw new Error('Пустое поле ' + k); }
    else if (rule === 'o') v = String(v || '').trim().slice(0, 40) || null;
    else if (rule === 'b') v = v ? 1 : 0;
    else if (Array.isArray(rule) && typeof rule[0] === 'string') { if (!rule.includes(v)) throw new Error('Неверное значение ' + k); }
    else { v = +v; if (!(v >= rule[0] && v <= rule[1])) throw new Error(`${k}: от ${rule[0]} до ${rule[1]}`); }
    row[k] = v;
  }
  row.ccy = String(row.ccy).toUpperCase().slice(0, 3);
  db.prepare(`INSERT INTO instruments(sym,name,cat,ccy,contract,min_lot,lot_step,max_lot,digits,max_lev,spread,comm,session,bn,fh,yh,td,base,vol,enabled,sort)
    VALUES(@sym,@name,@cat,@ccy,@contract,@min_lot,@lot_step,@max_lot,@digits,@max_lev,@spread,@comm,@session,@bn,@fh,@yh,@td,@base,@vol,@enabled,@sort)
    ON CONFLICT(sym) DO UPDATE SET name=@name,cat=@cat,ccy=@ccy,contract=@contract,min_lot=@min_lot,lot_step=@lot_step,max_lot=@max_lot,digits=@digits,max_lev=@max_lev,spread=@spread,comm=@comm,session=@session,bn=@bn,fh=@fh,yh=@yh,td=@td,base=@base,vol=@vol,enabled=@enabled`).run({ ...row, sym });
  M.loadInstruments(); M.clearHistory(sym); feeds.apply();
  return { ok: true };
}));
// Источники котировок
const FEED_KEYS = ['feed_stocks', 'feed_indices', 'feed_futures', 'feed_forex', 'feed_crypto', 'finnhub_key', 'twelvedata_key', 'td_poll_sec', 'yahoo_poll_ms'];
const mask = k => k ? k.slice(0, 3) + '•••' + k.slice(-2) : '';
app.get('/api/admin/feeds', auth, role('admin'), (req, res) => res.json({
  settings: Object.fromEntries(FEED_KEYS.map(k => [k, /_key$/.test(k) ? mask(setting(k)) : setting(k)])), options: feeds.CAT_OPTIONS, status: feeds.statusAll(),
}));
app.post('/api/admin/feeds', auth, role('admin'), wrap(req => {
  const b = req.body || {};
  for (const [cat, opts] of Object.entries(feeds.CAT_OPTIONS)) if (b['feed_' + cat] !== undefined) { if (!opts.includes(b['feed_' + cat])) throw new Error('Неверный источник'); setSetting('feed_' + cat, b['feed_' + cat]); }
  for (const k of ['finnhub_key', 'twelvedata_key']) if (typeof b[k] === 'string' && !b[k].includes('•')) setSetting(k, b[k].trim().slice(0, 200));
  if (b.td_poll_sec !== undefined) { const v = +b.td_poll_sec; if (!(v >= 5 && v <= 600)) throw new Error('Опрос Twelve Data: 5–600 сек'); setSetting('td_poll_sec', v); }
  if (b.yahoo_poll_ms !== undefined) { const v = +b.yahoo_poll_ms; if (!(v >= 500 && v <= 60000)) throw new Error('Опрос Yahoo: 500–60000 мс'); setSetting('yahoo_poll_ms', v); }
  feeds.reset();
  return { ok: true };
}));
app.get('/api/staff/bots', auth, role('admin', 'mentor'), (req, res) => {
  const rows = req.user.role === 'admin'
    ? db.prepare('SELECT b.*, u.name user_name, u.email user_email FROM bots b JOIN users u ON u.id=b.user_id ORDER BY b.status=\'running\' DESC, b.id DESC LIMIT 1000').all()
    : db.prepare('SELECT b.*, u.name user_name, u.email user_email FROM bots b JOIN users u ON u.id=b.user_id WHERE u.mentor_id=? ORDER BY b.id DESC').all(req.user.id);
  res.json(rows.map(b => ({ ...botStats(b), code: undefined, user_name: b.user_name, user_email: b.user_email })));
});

// --- Страницы ---
const pub = path.join(__dirname, 'public'), nm = path.join(__dirname, 'node_modules');
for (const [r, f] of [['/', 'index.html'], ['/app', 'app.html'], ['/admin', 'admin.html'], ['/bots', 'bots.html']]) app.get(r, (req, res) => res.sendFile(path.join(pub, f)));
app.use('/vendor/lwc', express.static(path.join(nm, 'lightweight-charts', 'dist'), { maxAge: '7d' }));
app.use('/vendor/cm', express.static(path.join(nm, 'codemirror'), { maxAge: '7d' }));
app.use(express.static(pub, { index: false, maxAge: '10m' }));
app.use('/api', (req, res) => bad(res, 'Не найдено', 404));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Ошибка сервера' }); });
app.listen(CFG.port, CFG.host, () => console.log(`${CFG.name} (ДЕМО) запущен: http://${CFG.host}:${CFG.port}`));
process.on('SIGTERM', () => process.exit(0));
