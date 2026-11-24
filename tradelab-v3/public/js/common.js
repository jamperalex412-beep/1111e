'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(url, body) {
  const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  let d = {}; try { d = await r.json(); } catch {}
  if (r.status === 401 && location.pathname !== '/') { location.href = '/'; throw new Error('Требуется вход'); }
  if (!r.ok) throw new Error(d.error || 'Ошибка ' + r.status);
  return d;
}
const nf = {}; const num = (v, d = 2) => (nf[d] ||= new Intl.NumberFormat('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d })).format(+v || 0);
const usd = (v, d = 2) => (v < 0 ? '−' : '') + '$' + num(Math.abs(v), d);
const sgn = (v, d = 2) => (v > 0 ? '+' : v < 0 ? '−' : '') + '$' + num(Math.abs(v), d);
const pct = v => (v > 0 ? '+' : v < 0 ? '−' : '') + num(Math.abs(v), 2) + '%';
const cls = v => v > 0 ? 'up' : v < 0 ? 'down' : '';
const lotsFmt = v => { const s = String(+(+v).toFixed(8)); return s.replace('.', ','); };
const dt = t => t ? new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const ROLE = { student: 'Ученик', mentor: 'Ментор', admin: 'Админ' };
const REASON = { manual: 'Вручную', sl: 'Стоп-лосс', tp: 'Тейк-профит', stopout: 'Стоп-аут', reset: 'Сброс счёта', reverse: 'Разворот', bot: 'Робот', bot_stop: 'Остановка робота', end: 'Конец теста' };
const LTYPE = { start: 'Старт', credit: 'Начисление', debit: 'Списание', reset: 'Сброс', nbp: 'Защита баланса' };
const OTYPE = { buy_limit: 'Buy Limit', sell_limit: 'Sell Limit', buy_stop: 'Buy Stop', sell_stop: 'Sell Stop', buy_stop_limit: 'Buy Stop Limit', sell_stop_limit: 'Sell Stop Limit' };
const OSTATUS = { pending: 'Ожидает', filled: 'Исполнен', cancelled: 'Отменён', expired: 'Истёк', rejected: 'Отклонён' };
const SRC = { binance: 'Binance', finnhub: 'Finnhub', yahoo: 'Yahoo (с задержкой)', twelvedata: 'Twelve Data', sim: 'Симуляция' };
const CATS = [['fav', '★'], ['all', 'Все'], ['stocks', 'Акции'], ['indices', 'Индексы'], ['futures', 'Фьючерсы'], ['forex', 'Форекс'], ['crypto', 'Крипта']];
const TFS = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
function toast(msg, type = '') {
  let w = $('#toasts'); if (!w) { w = document.createElement('div'); w.id = 'toasts'; document.body.append(w); }
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg; w.append(t);
  setTimeout(() => t.remove(), 4500);
}
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
async function logout() { try { await api('/api/logout', {}); } catch {} location.href = '/'; }
