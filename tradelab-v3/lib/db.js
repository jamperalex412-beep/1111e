'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { DEFAULT_INSTRUMENTS } = require('./catalog');

const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'platform.db');
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new Database(file);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 3000');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL COLLATE NOCASE, name TEXT NOT NULL, pass TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student', mentor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  invite_code TEXT UNIQUE, balance REAL NOT NULL DEFAULT 0, leverage INTEGER NOT NULL DEFAULT 100,
  blocked INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_login INTEGER);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS instruments(
  sym TEXT PRIMARY KEY, name TEXT NOT NULL, cat TEXT NOT NULL, ccy TEXT NOT NULL DEFAULT 'USD', contract REAL NOT NULL DEFAULT 1,
  min_lot REAL NOT NULL DEFAULT 0.01, lot_step REAL NOT NULL DEFAULT 0.01, max_lot REAL NOT NULL DEFAULT 100, digits INTEGER NOT NULL DEFAULT 2,
  max_lev INTEGER NOT NULL DEFAULT 100, spread REAL NOT NULL DEFAULT 0.02, comm REAL NOT NULL DEFAULT 0, session TEXT NOT NULL DEFAULT '24x7',
  bn TEXT, fh TEXT, yh TEXT, td TEXT, base REAL NOT NULL DEFAULT 100, vol REAL NOT NULL DEFAULT 0.005, enabled INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS positions(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, bot_id INTEGER, symbol TEXT NOT NULL,
  side TEXT NOT NULL, lots REAL NOT NULL, entry REAL NOT NULL, margin REAL NOT NULL, leverage INTEGER NOT NULL,
  sl REAL, tp REAL, trail REAL, comm REAL NOT NULL DEFAULT 0, comment TEXT, opened_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS pos_user ON positions(user_id);
CREATE TABLE IF NOT EXISTS deals(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, bot_id INTEGER, position_id INTEGER,
  symbol TEXT NOT NULL, side TEXT NOT NULL, lots REAL NOT NULL, entry REAL NOT NULL, exit REAL, pnl REAL NOT NULL, comm REAL NOT NULL DEFAULT 0,
  reason TEXT, opened_at INTEGER, closed_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS deal_user ON deals(user_id, closed_at);
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, bot_id INTEGER, symbol TEXT NOT NULL,
  type TEXT NOT NULL, lots REAL NOT NULL, price REAL NOT NULL, stoplimit REAL, sl REAL, tp REAL, trail REAL, expires_at INTEGER, lev_cap INTEGER,
  status TEXT NOT NULL DEFAULT 'pending', comment TEXT, note TEXT, created_at INTEGER NOT NULL, done_at INTEGER);
CREATE INDEX IF NOT EXISTS ord_status ON orders(status);
CREATE TABLE IF NOT EXISTS ledger(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, amount REAL NOT NULL,
  type TEXT NOT NULL, comment TEXT, by_user INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bots(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, code TEXT NOT NULL,
  symbol TEXT NOT NULL, tf TEXT NOT NULL DEFAULT 'M15', inputs TEXT NOT NULL DEFAULT '{}', limits TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'stopped', state TEXT NOT NULL DEFAULT '{}', start_equity REAL, started_at INTEGER, stop_reason TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bot_logs(id INTEGER PRIMARY KEY, bot_id INTEGER NOT NULL REFERENCES bots(id) ON DELETE CASCADE, level TEXT NOT NULL, msg TEXT NOT NULL, t INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS botlog ON bot_logs(bot_id, id);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

const DEFAULT_SETTINGS = {
  start_balance: '100000', registration_open: '1', invite_required: '0',
  default_leverage: '100', max_leverage: '500', stop_out: '50', margin_call: '100',
  bots_enabled: '1', max_bots: '5',
  feed_stocks: 'finnhub', feed_indices: 'yahoo', feed_futures: 'yahoo', feed_forex: 'finnhub', feed_crypto: 'binance',
  finnhub_key: '', twelvedata_key: '', td_poll_sec: '15', yahoo_poll_ms: '1200',
};
const insS = db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insS.run(k, v);
if (process.env.FINNHUB_KEY) db.prepare("UPDATE settings SET value=? WHERE key='finnhub_key' AND value=''").run(process.env.FINNHUB_KEY);
if (process.env.TWELVEDATA_KEY) db.prepare("UPDATE settings SET value=? WHERE key='twelvedata_key' AND value=''").run(process.env.TWELVEDATA_KEY);

if (!db.prepare('SELECT 1 FROM instruments LIMIT 1').get()) {
  const ins = db.prepare(`INSERT INTO instruments(sym,name,cat,ccy,contract,min_lot,lot_step,max_lot,digits,max_lev,spread,comm,session,bn,fh,yh,td,base,vol,sort)
    VALUES(@sym,@name,@cat,@ccy,@contract,@min_lot,@lot_step,@max_lot,@digits,@max_lev,@spread,@comm,@session,@bn,@fh,@yh,@td,@base,@vol,@sort)`);
  db.transaction(() => DEFAULT_INSTRUMENTS.forEach((i, k) => ins.run({ ...i, sort: k })))();
}

const setting = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value;
const setSetting = (k, v) => db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
const genCode = () => crypto.randomBytes(4).toString('hex').toUpperCase();
const ledgerSum = uid => db.prepare('SELECT COALESCE(SUM(amount),0) s FROM ledger WHERE user_id=?').get(uid).s;
const addLedger = (uid, amount, type, comment, by = null) =>
  db.prepare('INSERT INTO ledger(user_id,amount,type,comment,by_user,created_at) VALUES(?,?,?,?,?,?)').run(uid, amount, type, comment, by, Date.now());

const createUser = db.transaction(({ name, email, password, role = 'student', mentor_id = null }, by = null) => {
  const start = +setting('start_balance') || 0;
  const r = db.prepare('INSERT INTO users(email,name,pass,role,mentor_id,invite_code,balance,leverage,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(email, name, bcrypt.hashSync(password, 10), role, mentor_id, role === 'student' ? null : genCode(), start, +setting('default_leverage') || 100, Date.now());
  addLedger(r.lastInsertRowid, start, 'start', 'Стартовый виртуальный баланс', by);
  return r.lastInsertRowid;
});

module.exports = { db, setting, setSetting, genCode, ledgerSum, addLedger, createUser, DEFAULT_SETTINGS };
