'use strict';
/* Шаблоны роботов. Код исполняется на сервере в песочнице; см. справку в редакторе. */
const BOT_TEMPLATES = [
{ name: 'Пересечение скользящих средних', code: `// Покупка, когда быстрая MA пересекает медленную снизу вверх; продажа — наоборот.
// Одна позиция за раз, стоп-лосс и тейк-профит по ATR.
const fast  = input('fast', 10, 'Быстрая MA');
const slow  = input('slow', 30, 'Медленная MA');
const lots  = input('lots', 0.1, 'Объём, лотов');
const slAtr = input('slAtr', 2, 'Стоп-лосс, ATR');
const tpAtr = input('tpAtr', 3, 'Тейк-профит, ATR');

function onInit() {
  log('Старт', symbol, timeframe, 'MA', fast, '/', slow);
}

function onBar() {
  const c = closes();
  const f = ta.ema(c, fast), s = ta.ema(c, slow), atr = last(ta.atr(bars, 14));
  if (isNaN(last(s)) || isNaN(atr)) return;

  if (ta.crossOver(f, s)) {
    const p = position('sell'); if (p) close(p.id);
    if (!position('buy')) buy(lots, { sl: roundPrice(ask - atr * slAtr), tp: roundPrice(ask + atr * tpAtr) });
  }
  if (ta.crossUnder(f, s)) {
    const p = position('buy'); if (p) close(p.id);
    if (!position('sell')) sell(lots, { sl: roundPrice(bid + atr * slAtr), tp: roundPrice(bid - atr * tpAtr) });
  }
}
` },
{ name: 'RSI: возврат из перекупленности', code: `// Покупка при выходе RSI из зоны перепроданности, продажа — из перекупленности.
// Позиция закрывается при возврате RSI к 50. Трейлинг-стоп защищает прибыль.
const period = input('period', 14, 'Период RSI');
const low    = input('low', 30, 'Перепроданность');
const high   = input('high', 70, 'Перекупленность');
const lots   = input('lots', 0.1, 'Объём, лотов');
const slPct  = input('slPct', 1.5, 'Стоп-лосс, % от цены');
const trailPct = input('trailPct', 0.8, 'Трейлинг, % от цены');

function onBar() {
  const r = ta.rsi(closes(), period);
  const now = last(r), prev = last(r, 1);
  if (isNaN(prev)) return;
  const p = position();

  if (p && ((p.side === 'buy' && now >= 50) || (p.side === 'sell' && now <= 50))) {
    close(p.id);
    log('Выход по RSI', now.toFixed(1));
    return;
  }
  if (p) return;
  if (prev < low && now >= low)
    buy(lots, { sl: roundPrice(ask * (1 - slPct / 100)), trail: roundPrice(ask * trailPct / 100) });
  if (prev > high && now <= high)
    sell(lots, { sl: roundPrice(bid * (1 + slPct / 100)), trail: roundPrice(bid * trailPct / 100) });
}
` },
{ name: 'Пробой канала (отложенные ордера)', code: `// На каждом новом баре переставляет Buy Stop над максимумом и Sell Stop под минимумом
// последних N баров. Когда один срабатывает, второй отменяется.
const n    = input('channel', 20, 'Ширина канала, баров');
const lots = input('lots', 0.1, 'Объём, лотов');
const rr   = input('rr', 2, 'Тейк к стопу');

function onBar() {
  if (bars.length < n + 1) return;
  if (position()) { cancelAll(); return; }
  cancelAll();
  const hi = ta.highest(highs(), n), lo = ta.lowest(lows(), n), range = hi - lo;
  if (range <= 0) return;
  const pad = point * 10;
  if (ask < hi) buyStop(roundPrice(hi + pad), lots, { sl: roundPrice(lo), tp: roundPrice(hi + range * rr) });
  if (bid > lo) sellStop(roundPrice(lo - pad), lots, { sl: roundPrice(hi), tp: roundPrice(lo - range * rr) });
}
` },
{ name: 'Пустой шаблон со справкой', code: `// Параметры: input(имя, значение по умолчанию, подпись) — их можно менять в настройках робота.
const lots = input('lots', 0.1, 'Объём, лотов');

// Вызывается один раз при запуске
function onInit() {
  log('Робот запущен на', symbol, timeframe);
}

// Вызывается при открытии нового бара. bars — закрытые бары (последний — только что закрытый)
function onBar() {
  const c = closes();
  // пример: if (!position() && last(c) > last(c, 1)) buy(lots, { sl: roundPrice(bid * 0.99) });
}

// Вызывается при каждом изменении цены (примерно раз в секунду)
function onTick() {
}

// Вызывается при остановке
function onStop() {
  log('Остановлен');
}

// state — объект, который сохраняется между перезапусками: state.count = (state.count || 0) + 1;
` },
];
