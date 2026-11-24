'use strict';
/* Каталог инструментов по умолчанию. Админ может менять и добавлять их в панели.
   contract — сколько единиц базового актива в 1 лоте (для фьючерсов: стоимость 1 пункта цены),
   spread/comm — в процентах от цены/объёма, session — торговая сессия,
   bn/fh/yh/td — коды в Binance / Finnhub / Yahoo / Twelve Data, base/vol — для симуляции. */
const I = [];
const add = (cat, defs, common) => defs.forEach(d => I.push({ cat, ccy: 'USD', contract: 1, min_lot: 0.01, lot_step: 0.01, max_lot: 100, digits: 2, comm: 0, bn: null, fh: null, yh: null, td: null, ...common, ...d }));

// Акции США
add('stocks', [
  ['AAPL', 'Apple', 228], ['MSFT', 'Microsoft', 425], ['NVDA', 'NVIDIA', 140], ['TSLA', 'Tesla', 340], ['AMZN', 'Amazon', 205],
  ['GOOGL', 'Alphabet', 175], ['META', 'Meta Platforms', 580], ['NFLX', 'Netflix', 880], ['AMD', 'AMD', 135], ['INTC', 'Intel', 22],
  ['JPM', 'JPMorgan Chase', 245], ['BAC', 'Bank of America', 46], ['V', 'Visa', 310], ['MA', 'Mastercard', 520], ['KO', 'Coca-Cola', 64],
  ['PEP', 'PepsiCo', 160], ['DIS', 'Walt Disney', 115], ['NKE', 'Nike', 76], ['BA', 'Boeing', 155], ['XOM', 'Exxon Mobil', 120],
  ['PFE', 'Pfizer', 26], ['COIN', 'Coinbase', 290], ['PLTR', 'Palantir', 65], ['UBER', 'Uber', 70], ['BABA', 'Alibaba', 88],
].map(([s, n, b]) => ({ sym: s, name: n, base: b, fh: s, yh: s, td: s })), { max_lev: 20, spread: 0.02, comm: 0.02, max_lot: 10000, session: 'us', vol: 0.005 });
// Акции Европы
add('stocks', [
  ['SAP', 'SAP', 'SAP.DE', 'EUR', 230, 'eu'], ['SIE', 'Siemens', 'SIE.DE', 'EUR', 185, 'eu'], ['ASML', 'ASML', 'ASML.AS', 'EUR', 650, 'eu'],
  ['MC', 'LVMH', 'MC.PA', 'EUR', 620, 'eu'], ['VOW3', 'Volkswagen', 'VOW3.DE', 'EUR', 85, 'eu'],
].map(([s, n, y, c, b, ss]) => ({ sym: s, name: n, yh: y, ccy: c, base: b, session: ss })), { max_lev: 20, spread: 0.03, comm: 0.02, max_lot: 10000, vol: 0.005 });
// Индексы (CFD)
add('indices', [
  ['US500', 'S&P 500', '^GSPC', 'USD', 6000, 'us', 'SPX'], ['US100', 'Nasdaq 100', '^NDX', 'USD', 21000, 'us', 'NDX'],
  ['US30', 'Dow Jones 30', '^DJI', 'USD', 44000, 'us', 'DJI'], ['DE40', 'DAX 40', '^GDAXI', 'EUR', 19500, 'eu', null],
  ['UK100', 'FTSE 100', '^FTSE', 'GBP', 8200, 'uk', null], ['JP225', 'Nikkei 225', '^N225', 'JPY', 38500, 'jp', null],
].map(([s, n, y, c, b, ss, td]) => ({ sym: s, name: n, yh: y, ccy: c, base: b, session: ss, td })), { max_lev: 100, spread: 0.01, max_lot: 500, vol: 0.003 });
// Фьючерсы (contract = стоимость 1 пункта в валюте котировки)
add('futures', [
  ['ES', 'E-mini S&P 500', 'ES=F', 50, 6000, 2], ['NQ', 'E-mini Nasdaq 100', 'NQ=F', 20, 21000, 2], ['YM', 'E-mini Dow', 'YM=F', 5, 44000, 0],
  ['RTY', 'E-mini Russell 2000', 'RTY=F', 50, 2350, 1], ['CL', 'Нефть WTI', 'CL=F', 1000, 70, 2], ['BZ', 'Нефть Brent', 'BZ=F', 1000, 74, 2],
  ['NG', 'Природный газ', 'NG=F', 10000, 3.2, 3], ['GC', 'Золото', 'GC=F', 100, 2650, 1], ['SI', 'Серебро', 'SI=F', 5000, 31, 3],
  ['HG', 'Медь', 'HG=F', 25000, 4.1, 4], ['ZC', 'Кукуруза (центы)', 'ZC=F', 50, 430, 2], ['ZW', 'Пшеница (центы)', 'ZW=F', 50, 550, 2],
].map(([s, n, y, c, b, d]) => ({ sym: s, name: n, yh: y, contract: c, base: b, digits: d })), { max_lev: 50, spread: 0.01, max_lot: 50, session: 'cme', vol: 0.003 });
// Форекс и металлы
add('forex', [
  ['EURUSD', 'Евро / Доллар', 'OANDA:EUR_USD', 'EURUSD=X', 'EUR/USD', 'USD', 1.05, 5], ['GBPUSD', 'Фунт / Доллар', 'OANDA:GBP_USD', 'GBPUSD=X', 'GBP/USD', 'USD', 1.26, 5],
  ['USDJPY', 'Доллар / Иена', 'OANDA:USD_JPY', 'JPY=X', 'USD/JPY', 'JPY', 154, 3], ['USDCHF', 'Доллар / Франк', 'OANDA:USD_CHF', 'CHF=X', 'USD/CHF', 'CHF', 0.88, 5],
  ['AUDUSD', 'Австрал. доллар / Доллар', 'OANDA:AUD_USD', 'AUDUSD=X', 'AUD/USD', 'USD', 0.65, 5], ['USDCAD', 'Доллар / Канад. доллар', 'OANDA:USD_CAD', 'CAD=X', 'USD/CAD', 'CAD', 1.4, 5],
  ['NZDUSD', 'Новозел. доллар / Доллар', 'OANDA:NZD_USD', 'NZDUSD=X', 'NZD/USD', 'USD', 0.59, 5], ['EURGBP', 'Евро / Фунт', 'OANDA:EUR_GBP', 'EURGBP=X', 'EUR/GBP', 'GBP', 0.83, 5],
  ['EURJPY', 'Евро / Иена', 'OANDA:EUR_JPY', 'EURJPY=X', 'EUR/JPY', 'JPY', 162, 3], ['GBPJPY', 'Фунт / Иена', 'OANDA:GBP_JPY', 'GBPJPY=X', 'GBP/JPY', 'JPY', 194, 3],
].map(([s, n, f, y, t, c, b, d]) => ({ sym: s, name: n, fh: f, yh: y, td: t, ccy: c, base: b, digits: d })), { contract: 100000, max_lev: 500, spread: 0.008, max_lot: 100, session: 'fx', vol: 0.0012 });
add('forex', [
  { sym: 'XAUUSD', name: 'Золото спот', fh: 'OANDA:XAU_USD', yh: 'GC=F', td: 'XAU/USD', contract: 100, base: 2650, digits: 2, vol: 0.0025 },
  { sym: 'XAGUSD', name: 'Серебро спот', fh: 'OANDA:XAG_USD', yh: 'SI=F', td: 'XAG/USD', contract: 5000, base: 31, digits: 3, vol: 0.004 },
], { max_lev: 200, spread: 0.015, max_lot: 50, session: 'fx' });
// Криптовалюты
add('crypto', [
  ['BTCUSD', 'Bitcoin', 'BTCUSDT', 95000, 2], ['ETHUSD', 'Ethereum', 'ETHUSDT', 3400, 2], ['SOLUSD', 'Solana', 'SOLUSDT', 240, 3],
  ['BNBUSD', 'BNB', 'BNBUSDT', 650, 2], ['XRPUSD', 'XRP', 'XRPUSDT', 1.4, 4], ['ADAUSD', 'Cardano', 'ADAUSDT', 0.95, 4],
  ['DOGEUSD', 'Dogecoin', 'DOGEUSDT', 0.4, 5], ['TONUSD', 'Toncoin', 'TONUSDT', 5.5, 4], ['AVAXUSD', 'Avalanche', 'AVAXUSDT', 40, 3],
  ['DOTUSD', 'Polkadot', 'DOTUSDT', 8, 3], ['LINKUSD', 'Chainlink', 'LINKUSDT', 20, 3], ['LTCUSD', 'Litecoin', 'LTCUSDT', 100, 2],
  ['TRXUSD', 'TRON', 'TRXUSDT', 0.2, 5], ['SHIBUSD', 'Shiba Inu', 'SHIBUSDT', 0.000024, 8],
].map(([s, n, bn, b, d]) => ({ sym: s, name: n, bn, yh: s.replace('USD', '-USD'), td: s.replace('USD', '/USD'), base: b, digits: d })),
  { max_lev: 20, spread: 0.02, comm: 0.05, max_lot: 1e9, session: '24x7', vol: 0.008 });
for (const i of I) if (i.sym === 'SHIBUSD') { i.min_lot = 1000; i.lot_step = 1000; }
for (const i of I) if (['XRPUSD', 'ADAUSD', 'DOGEUSD', 'TONUSD', 'TRXUSD'].includes(i.sym)) { i.min_lot = 1; i.lot_step = 1; }

// Торговые сессии
const SESS = {
  us: { tz: 'America/New_York', from: 570, to: 960, name: 'NYSE/Nasdaq 9:30–16:00 NY' },
  eu: { tz: 'Europe/Berlin', from: 540, to: 1050, name: 'Европа 9:00–17:30 CET' },
  uk: { tz: 'Europe/London', from: 480, to: 990, name: 'Лондон 8:00–16:30' },
  jp: { tz: 'Asia/Tokyo', from: 540, to: 900, name: 'Токио 9:00–15:00' },
  cme: { tz: 'America/New_York', name: 'CME вс 18:00 – пт 17:00 NY, перерыв 17–18' },
  fx: { tz: 'America/New_York', name: 'Форекс вс 17:00 – пт 17:00 NY' },
  '24x7': { name: 'Круглосуточно' },
};
const fmtCache = {};
function tzParts(d, tz) {
  const f = fmtCache[tz] ||= new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  return { wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), hm: +p.hour * 60 + +p.minute };
}
function isOpen(session, d = new Date()) {
  const s = SESS[session]; if (!s || session === '24x7') return true;
  const { wd, hm } = tzParts(d, s.tz);
  if (session === 'fx') return wd === 0 ? hm >= 1020 : wd === 5 ? hm < 1020 : wd >= 1 && wd <= 4;
  if (session === 'cme') { if (wd === 6) return false; if (wd === 0) return hm >= 1080; if (wd === 5) return hm < 1020; return hm < 1020 || hm >= 1080; }
  return wd >= 1 && wd <= 5 && hm >= s.from && hm < s.to;
}

module.exports = { DEFAULT_INSTRUMENTS: I, SESS, isOpen, tzParts };
