'use strict';
{
  let me, INS = [], BY = {}, QT = {}, sel = null, acc = null, tab = 'pos', editing = null, journal = [], hist = null, histMode = 'deals';
  let cat = store.get('cat', 'all'), favs = new Set(store.get('favs', [])), tf = store.get('tf', 'M15'), ctype = store.get('ctype', 'candle'), histFrom = store.get('histFrom', 'week');
  const IND_DEF = { sma: { on: false, n: 20 }, ema: { on: true, n: 50 }, bb: { on: false, n: 20, k: 2 }, vol: { on: true }, rsi: { on: false, n: 14 }, macd: { on: false, f: 12, s: 26, g: 9 } };
  let inds = { ...IND_DEF, ...store.get('inds', {}) };
  let DATA = [], chart = null, main = null, volS = null, IS = {}, plines = [], hlMode = false, lastShown = 0;
  const TZ = -new Date().getTimezoneOffset() * 60, T = b => b.time + TZ;
  const dig = s => BY[s]?.digits ?? 2;
  const fp = (v, s = sel) => v === null || v === undefined || v === '' ? '—' : num(v, dig(s));
  const jlog = (m, type = '') => { journal.unshift({ t: Date.now(), m, type }); journal.length = Math.min(journal.length, 300); if (tab === 'journal') renderTab(); };
  const rate = ccy => { if (!ccy || ccy === 'USD') return 1; const d = QT[ccy + 'USD']; if (d) return (d[0] + d[1]) / 2; const r = QT['USD' + ccy]; if (r) return 2 / (r[0] + r[1]); return { EUR: 1.05, GBP: 1.26, JPY: 1 / 154, CHF: 1 / .88, CAD: 1 / 1.4 }[ccy] || 1; };

  // --- индикаторы ---
  const ta = {
    sma(a, n) { const o = new Array(a.length).fill(NaN); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; },
    ema(a, n) { const o = new Array(a.length).fill(NaN), k = 2 / (n + 1); let e; for (let i = n - 1; i < a.length; i++) { if (e === undefined) { let s = 0; for (let j = i - n + 1; j <= i; j++) s += a[j]; e = s / n; } else e = a[i] * k + e * (1 - k); o[i] = e; } return o; },
    rsi(a, n) { const o = new Array(a.length).fill(NaN); let g = 0, l = 0; for (let i = 1; i < a.length; i++) { const d = a[i] - a[i - 1], u = Math.max(d, 0), w = Math.max(-d, 0);
      if (i <= n) { g += u; l += w; if (i === n) { g /= n; l /= n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } else { g = (g * (n - 1) + u) / n; l = (l * (n - 1) + w) / n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } return o; },
    bb(a, n, k) { const m = ta.sma(a, n), u = [], d = []; for (let i = 0; i < a.length; i++) { if (isNaN(m[i])) { u.push(NaN); d.push(NaN); continue; } let s = 0; for (let j = i - n + 1; j <= i; j++) s += (a[j] - m[i]) ** 2; const sd = Math.sqrt(s / n); u.push(m[i] + k * sd); d.push(m[i] - k * sd); } return [u, m, d]; },
    macd(a, f, s, g) { const ef = ta.ema(a, f), es = ta.ema(a, s), m = a.map((_, i) => ef[i] - es[i]), sg = new Array(a.length).fill(NaN), st = m.findIndex(x => !isNaN(x)); if (st >= 0) ta.ema(m.slice(st), g).forEach((v, i) => { sg[st + i] = v; }); return [m, sg, m.map((x, i) => x - sg[i])]; },
  };

  // --- график ---
  function build() {
    if (chart) { chart.remove(); plines = []; }
    const LW = LightweightCharts, d = dig(sel), pf = { type: 'price', precision: d, minMove: 1 / 10 ** d };
    chart = LW.createChart($('#chart'), {
      autoSize: true, localization: { locale: 'ru-RU' },
      layout: { background: { color: 'transparent' }, textColor: '#8b95a5', fontFamily: 'Manrope, system-ui, sans-serif', panes: { separatorColor: '#242c37', separatorHoverColor: '#2f3a48' } },
      grid: { vertLines: { color: '#151a21' }, horzLines: { color: '#151a21' } },
      rightPriceScale: { borderColor: '#242c37' }, timeScale: { borderColor: '#242c37', timeVisible: true, secondsVisible: false, rightOffset: 8 }, crosshair: { mode: 0 },
    });
    if (ctype === 'line') main = chart.addSeries(LW.LineSeries, { color: '#4f8cff', lineWidth: 2, priceFormat: pf });
    else if (ctype === 'bar') main = chart.addSeries(LW.BarSeries, { upColor: '#1fc27e', downColor: '#f04b5c', priceFormat: pf });
    else main = chart.addSeries(LW.CandlestickSeries, { upColor: '#1fc27e', downColor: '#f04b5c', wickUpColor: '#1fc27e', wickDownColor: '#f04b5c', borderVisible: false, priceFormat: pf });
    volS = null; IS = {};
    if (inds.vol.on) { volS = chart.addSeries(LW.HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false }); chart.priceScale('vol').applyOptions({ scaleMargins: { top: .82, bottom: 0 } }); }
    const line = (color, pane = 0, w = 1.5, fmt = pf) => chart.addSeries(LW.LineSeries, { color, lineWidth: w, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: fmt }, pane);
    if (inds.sma.on) IS.sma = line('#f2b134');
    if (inds.ema.on) IS.ema = line('#b06bff');
    if (inds.bb.on) { IS.bbu = line('#5aa9e6', 0, 1); IS.bbm = line('#5aa9e688', 0, 1); IS.bbl = line('#5aa9e6', 0, 1); }
    let pane = 1;
    if (inds.rsi.on) {
      IS.rsi = line('#c792ea', pane, 1.5, { type: 'price', precision: 1, minMove: .1 }); IS.rsi.applyOptions({ lastValueVisible: true });
      for (const p of [70, 30]) IS.rsi.createPriceLine({ price: p, color: '#4a5260', lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
      pane++;
    }
    if (inds.macd.on) {
      const mp = { type: 'price', precision: Math.min(8, d + 1), minMove: 1 / 10 ** Math.min(8, d + 1) };
      IS.mh = chart.addSeries(LW.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: mp }, pane);
      IS.mm = line('#4f8cff', pane, 1.5, mp); IS.ms = line('#f2b134', pane, 1.5, mp); pane++;
    }
    const panes = chart.panes(); if (panes.length > 1) { panes[0].setStretchFactor(3); for (let k = 1; k < panes.length; k++) panes[k].setStretchFactor(1); }
    chart.subscribeCrosshairMove(legend);
    chart.subscribeClick(p => {
      if (!hlMode || !p.point) return;
      const price = main.coordinateToPrice(p.point.y); if (price === null) return;
      const a = store.get('hl:' + sel, []); a.push(+price.toFixed(dig(sel))); store.set('hl:' + sel, a);
      hlMode = false; $('#hlBtn').classList.remove('hl-on'); drawLines();
    });
  }
  const barOf = b => ctype === 'line' ? { time: T(b), value: b.close } : { time: T(b), open: b.open, high: b.high, low: b.low, close: b.close };
  const volOf = b => ({ time: T(b), value: b.volume || 0, color: b.close >= b.open ? '#1fc27e40' : '#f04b5c40' });
  function setAll() { main.setData(DATA.map(barOf)); if (volS) volS.setData(DATA.map(volOf)); setInds(); lastShown = DATA.length ? DATA[DATA.length - 1].time : 0; }
  function setInds() {
    const c = DATA.map(b => b.close), ts = DATA.map(T);
    const put = (s, arr, col) => s && s.setData(arr.map((v, i) => isNaN(v) ? { time: ts[i] } : col ? { time: ts[i], value: v, color: col(v) } : { time: ts[i], value: v }));
    if (IS.sma) put(IS.sma, ta.sma(c, inds.sma.n));
    if (IS.ema) put(IS.ema, ta.ema(c, inds.ema.n));
    if (IS.bbu) { const [u, m, l] = ta.bb(c, inds.bb.n, inds.bb.k); put(IS.bbu, u); put(IS.bbm, m); put(IS.bbl, l); }
    if (IS.rsi) put(IS.rsi, ta.rsi(c, inds.rsi.n));
    if (IS.mm) { const [m, s, h] = ta.macd(c, inds.macd.f, inds.macd.s, inds.macd.g); put(IS.mm, m); put(IS.ms, s); put(IS.mh, h, v => v >= 0 ? '#1fc27e88' : '#f04b5c88'); }
  }
  function legend(p) {
    const b = p?.time !== undefined ? p.seriesData.get(main) : null, L = DATA[DATA.length - 1]; if (!L) return;
    const o = b ? (b.open !== undefined ? b : { open: b.value, high: b.value, low: b.value, close: b.value }) : L;
    const ch = o.close - o.open;
    $('#legend').innerHTML = `<span>${esc(sel)} · ${tf}</span><span>O <b>${fp(o.open)}</b></span><span>H <b>${fp(o.high)}</b></span><span>L <b>${fp(o.low)}</b></span><span>C <b class="${cls(ch)}">${fp(o.close)}</b></span>`;
  }
  async function loadChart() {
    const s = sel, t = tf;
    build();
    try { DATA = await api(`/api/candles/${encodeURIComponent(s)}?tf=${t}&limit=1500`); } catch (e) { toast(e.message, 'err'); DATA = []; }
    if (s !== sel || t !== tf) return;
    setAll(); chart.timeScale().scrollToRealTime(); legend(); drawLines();
  }
  async function pullBars() {
    if (!sel || !DATA.length) return; const s = sel, t = tf;
    let a; try { a = await api(`/api/candles/${encodeURIComponent(s)}?tf=${t}&limit=3`); } catch { return; }
    if (s !== sel || t !== tf || !DATA.length) return;
    let changed = false;
    for (const b of a) {
      const L = DATA[DATA.length - 1];
      if (b.time === L.time) DATA[DATA.length - 1] = b; else if (b.time > L.time) { DATA.push(b); changed = true; } else { const k = DATA.findIndex(x => x.time === b.time); if (k >= 0) DATA[k] = b; }
      if (b.time >= lastShown) { try { main.update(barOf(b)); volS?.update(volOf(b)); lastShown = b.time; } catch {} }
    }
    if (DATA.length > 3000) DATA = DATA.slice(-2500);
    setInds(); legend(); if (changed) drawLines();
  }
  function drawLines() {
    if (!main) return;
    plines.forEach(l => { try { main.removePriceLine(l); } catch {} }); plines = [];
    const add = (price, color, title, style = 0) => plines.push(main.createPriceLine({ price, color, title, lineWidth: 1, lineStyle: style, axisLabelVisible: true }));
    for (const h of store.get('hl:' + sel, [])) add(h, '#8b95a5', '', 0);
    if (!acc) return;
    for (const p of acc.positions.filter(p => p.symbol === sel)) {
      add(p.entry, p.side === 'buy' ? '#4f8cff' : '#f04b5c', `#${p.id} ${p.side === 'buy' ? 'BUY' : 'SELL'} ${lotsFmt(p.lots)}`, 2);
      if (p.sl) add(p.sl, '#f04b5c', 'SL #' + p.id, 1);
      if (p.tp) add(p.tp, '#1fc27e', 'TP #' + p.id, 1);
    }
    for (const o of acc.orders.filter(o => o.symbol === sel)) add(o.price, '#f2b134', `${OTYPE[o.type]} ${lotsFmt(o.lots)}`, 3);
  }

  // --- обзор рынка ---
  function renderCats() { $('#cats').innerHTML = CATS.map(([k, n]) => `<button data-c="${k}" class="${k === cat ? 'on' : ''}" title="${k === 'fav' ? 'Избранное' : ''}">${n}</button>`).join(''); }
  function renderWatch() {
    const q = $('#q').value.trim().toLowerCase();
    const list = INS.filter(i => (cat === 'all' || (cat === 'fav' ? favs.has(i.sym) : i.cat === cat)) && (!q || i.sym.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)));
    $('#items').innerHTML = list.map(i => `<div class="wr ${i.sym === sel ? 'on' : ''}" data-s="${esc(i.sym)}" role="button" tabindex="0">
      <button class="star ${favs.has(i.sym) ? 'on' : ''}" data-fav="${esc(i.sym)}" aria-label="В избранное">★</button>
      <span><span class="s"><span class="dot" data-d="${esc(i.sym)}"></span><b>${esc(i.sym)}</b><span data-b="${esc(i.sym)}"></span></span><span class="n">${esc(i.name)}</span></span>
      <span class="p" data-bid="${esc(i.sym)}">—</span><span class="p a" data-ask="${esc(i.sym)}">—</span><span class="c" data-c="${esc(i.sym)}"></span></div>`).join('')
      || `<div class="empty">${cat === 'fav' ? 'Отметьте инструменты звёздочкой, чтобы они появились здесь' : 'Ничего не найдено'}</div>`;
    paintWatch(true);
  }
  const prev = {};
  function paintWatch(force) {
    for (const el of $$('#items .wr')) {
      const s = el.dataset.s, q = QT[s]; if (!q) continue;
      const b = el.querySelector('[data-bid]'), a = el.querySelector('[data-ask]'), c = el.querySelector('[data-c]'), d = el.querySelector('[data-d]'), bg = el.querySelector('[data-b]');
      const pv = prev[s];
      b.textContent = fp(q[0], s); a.textContent = fp(q[1], s);
      if (pv && !force && q[0] !== pv) { const up = q[0] > pv; b.classList.add(up ? 'flash-up' : 'flash-dn'); a.classList.add(up ? 'flash-up' : 'flash-dn'); setTimeout(() => { b.classList.remove('flash-up', 'flash-dn'); a.classList.remove('flash-up', 'flash-dn'); }, 450); }
      c.textContent = pct(q[2]); c.className = 'c ' + cls(q[2]);
      d.className = 'dot' + (q[3] ? '' : ' off'); d.title = q[3] ? 'Рынок открыт' : 'Рынок закрыт';
      const badge = q[4] === 'sim' ? '<span class="badge sim" title="Симуляция: реальный источник недоступен">SIM</span>' : q[4] === 'yahoo' ? '<span class="badge dl" title="Данные Yahoo, могут идти с задержкой">D</span>' : '';
      if (bg.innerHTML !== badge) bg.innerHTML = badge;
      prev[s] = q[0];
    }
  }

  // --- тикет ---
  const lotsKey = s => 'lots:' + s;
  function setLots(v) { const i = BY[sel]; v = Math.max(i.minLot, Math.min(i.maxLot, Math.round(v / i.lotStep) * i.lotStep)); $('#lots').value = +v.toFixed(8); store.set(lotsKey(sel), +v.toFixed(8)); paintTicket(); }
  function ticketFor() {
    const i = BY[sel];
    $('#tSym').textContent = i.sym; $('#tName').textContent = i.name; $('#tSess').textContent = i.sessionName;
    $('#lots').step = i.lotStep; $('#lots').min = i.minLot; $('#lots').value = store.get(lotsKey(sel), i.minLot);
    for (const id of ['#osl', '#otp', '#oprice', '#ostop', '#otr']) { $(id).value = ''; $(id).step = 1 / 10 ** i.digits; }
    paintTicket();
  }
  function paintTicket() {
    const i = BY[sel], q = QT[sel]; if (!i) return;
    const type = $('#otype').value, pend = type !== 'market';
    $('#pendBox').hidden = !pend; $('#slBox').hidden = !type.endsWith('stop_limit'); $('#opLbl').textContent = type.endsWith('stop_limit') ? 'Стоп-цена' : 'Цена';
    $('#oexpd').hidden = $('#oexp').value !== 'date';
    $('#oc').hidden = pend; $('#place').hidden = !pend;
    if (pend) $('#place').textContent = 'Выставить ' + OTYPE[type];
    const lev = Math.min(me.leverage, i.maxLev), lots = +$('#lots').value || 0;
    if (q) {
      $('#bidP').textContent = fp(q[0]); $('#askP').textContent = fp(q[1]);
      const pts = Math.round((q[1] - q[0]) * 10 ** i.digits);
      $('#spr').textContent = `Спред ${pts} пт · ${SRC[q[4]] || q[4]}`;
      $('#tDot').className = 'dot' + (q[3] ? '' : ' off');
      $('#bSell').disabled = $('#bBuy').disabled = !q[3];
      $('#closedMsg').hidden = !!q[3]; $('#closedMsg').textContent = 'Рынок закрыт. Можно выставить отложенный ордер, он сработает после открытия.';
      const px = q[1], notional = lots * i.contract * px * rate(i.ccy), point = 1 / 10 ** i.digits;
      $('#info').innerHTML = [
        ['Маржа', usd(notional / lev)], ['Свободная маржа', acc ? usd(acc.free) : '—'], ['Стоимость пункта', usd(lots * i.contract * point * rate(i.ccy), point < .01 ? 4 : 2)],
        ['Комиссия', i.comm ? usd(notional * i.comm / 100) + ` (${num(i.comm, 2)}%)` : 'нет'], ['Объём контракта', usd(notional, 0)],
        ['Размер лота', `${num(i.contract, i.contract < 1 ? 4 : 0)} ${i.cat === 'futures' ? i.ccy + ' за пункт' : 'ед.'}`], ['Плечо', `1:${lev}${lev < me.leverage ? ' (макс. для инструмента)' : ''}`],
        ['Мин. / шаг / макс.', `${lotsFmt(i.minLot)} / ${lotsFmt(i.lotStep)} / ${lotsFmt(i.maxLot)}`],
      ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    }
  }
  const val = id => $(id).value === '' ? null : +$(id).value;
  async function market(side) {
    const b = side === 'buy' ? $('#bBuy') : $('#bSell'); b.disabled = true;
    try {
      const r = await api('/api/trade/market', { symbol: sel, side, lots: +$('#lots').value, sl: val('#osl'), tp: val('#otp'), trail: val('#otr') });
      const m = `${side === 'buy' ? 'Покупка' : 'Продажа'} ${lotsFmt(r.lots)} ${sel} по ${fp(r.price)}, позиция #${r.id}`;
      toast(m, 'ok'); jlog(m, 'ok'); $('#osl').value = $('#otp').value = $('#otr').value = ''; refreshAccount();
    } catch (e) { toast(e.message, 'err'); jlog(e.message, 'err'); } finally { b.disabled = false; paintTicket(); }
  }
  async function placePending() {
    const type = $('#otype').value; let expires = null;
    if ($('#oexp').value === 'today') { const d = new Date(); d.setHours(23, 59, 59, 0); expires = d.toISOString(); }
    if ($('#oexp').value === 'date') { if (!$('#oexpd').value) return toast('Укажите дату истечения', 'err'); expires = new Date($('#oexpd').value).toISOString(); }
    try {
      const r = await api('/api/trade/pending', { symbol: sel, type, lots: +$('#lots').value, price: val('#oprice'), stoplimit: val('#ostop'), sl: val('#osl'), tp: val('#otp'), trail: val('#otr'), expires });
      const m = `${OTYPE[type]} ${lotsFmt($('#lots').value)} ${sel} по ${fp(val('#oprice'))} выставлен, ордер #${r.id}`; toast(m, 'ok'); jlog(m, 'ok'); refreshAccount();
    } catch (e) { toast(e.message, 'err'); jlog(e.message, 'err'); }
  }

  // --- счёт и таблицы ---
  async function refreshAccount() {
    try { acc = await api('/api/account'); } catch { return; }
    $('#mBal').textContent = usd(acc.balance); $('#mEq').textContent = usd(acc.equity); $('#mMar').textContent = usd(acc.margin); $('#mFree').textContent = usd(acc.free);
    $('#mLvl').textContent = acc.level === null ? '—' : num(acc.level, 0) + '%'; $('#mLvl').className = acc.level !== null && acc.marginCall ? 'down' : '';
    $('#mFl').textContent = sgn(acc.floating); $('#mFl').className = cls(acc.floating);
    $('#mcall').hidden = !acc.marginCall;
    $('#nPos').textContent = acc.positions.length ? `(${acc.positions.length})` : ''; $('#nOrd').textContent = acc.orders.length ? `(${acc.orders.length})` : '';
    if (tab === 'pos' || tab === 'ord') renderTab();
    drawLines(); paintTicket();
  }
  const sideLbl = s => `<span class="${s === 'buy' ? 'up' : 'down'}">${s === 'buy' ? 'Buy' : 'Sell'}</span>`;
  const who = x => x.bot_id ? `<span class="badge role" title="Робот">${esc(x.comment || 'Робот #' + x.bot_id)}</span>` : esc(x.comment || '');
  function renderTab() {
    if (editing) return;
    let h = '', tools = '', sum = '';
    if (tab === 'pos') {
      tools = `<div class="menu"><button class="btn sm" id="caBtn">Закрыть…</button><div id="caMenu" hidden><button data-ca="all">Все позиции</button><button data-ca="profit">Прибыльные</button><button data-ca="loss">Убыточные</button><button data-ca="sym">Все по ${esc(sel)}</button></div></div>`;
      h = acc.positions.length ? `<table><thead><tr><th>Позиция</th><th>Символ</th><th>Тип</th><th class="r">Объём</th><th class="r">Открытие</th><th class="r">Текущая</th><th class="r">S/L</th><th class="r">T/P</th><th class="r">Трейл</th><th class="r">Комиссия</th><th class="r">Прибыль</th><th>Комментарий</th><th></th></tr></thead><tbody>` +
        acc.positions.map(p => `<tr><td class="mute">#${p.id}</td><td><b>${esc(p.symbol)}</b></td><td>${sideLbl(p.side)}</td><td class="r">${lotsFmt(p.lots)}</td><td class="r">${fp(p.entry, p.symbol)}</td><td class="r">${fp(p.price, p.symbol)}</td>
          <td class="r">${fp(p.sl, p.symbol)}</td><td class="r">${fp(p.tp, p.symbol)}</td><td class="r">${p.trail ? fp(p.trail, p.symbol) : '—'}</td><td class="r mute">${usd(p.comm)}</td>
          <td class="r ${cls(p.pnl)}"><b>${sgn(p.pnl)}</b></td><td>${who(p)}</td>
          <td><div class="acts"><button class="btn sm" data-edit="${p.id}" title="Изменить SL/TP/трейлинг">SL/TP</button><button class="btn sm" data-part="${p.id}" title="Закрыть часть">Часть</button><button class="btn sm" data-rev="${p.id}" title="Развернуть">⇄</button><button class="btn sm" data-close="${p.id}" title="Закрыть" ${p.open ? '' : 'disabled'}>✕</button></div></td></tr>`).join('') + '</tbody></table>'
        : '<div class="empty">Открытых позиций нет</div>';
      sum = `<span>Баланс:</span><b>${usd(acc.balance)}</b><span>Эквити:</span><b>${usd(acc.equity)}</b><span>Маржа:</span><b>${usd(acc.margin)}</b><span>Свободная:</span><b>${usd(acc.free)}</b><span>Уровень:</span><b>${acc.level === null ? '—' : num(acc.level, 2) + '%'}</b><span>Стоп-аут:</span><b>${acc.stopOut}%</b>`;
    } else if (tab === 'ord') {
      h = acc.orders.length ? `<table><thead><tr><th>Ордер</th><th>Символ</th><th>Тип</th><th class="r">Объём</th><th class="r">Цена</th><th class="r">Стоп-лимит</th><th class="r">S/L</th><th class="r">T/P</th><th class="r">Текущая</th><th>Истекает</th><th>Комментарий</th><th></th></tr></thead><tbody>` +
        acc.orders.map(o => { const q = QT[o.symbol], cur = q ? (o.type.startsWith('buy') ? q[1] : q[0]) : null; return `<tr><td class="mute">#${o.id}</td><td><b>${esc(o.symbol)}</b></td><td class="${o.type.startsWith('buy') ? 'up' : 'down'}">${OTYPE[o.type]}</td><td class="r">${lotsFmt(o.lots)}</td>
          <td class="r">${fp(o.price, o.symbol)}</td><td class="r">${fp(o.stoplimit, o.symbol)}</td><td class="r">${fp(o.sl, o.symbol)}</td><td class="r">${fp(o.tp, o.symbol)}</td><td class="r">${fp(cur, o.symbol)}</td>
          <td class="mute">${o.expires_at ? dt(o.expires_at) : 'до отмены'}</td><td>${who(o)}</td><td><div class="acts"><button class="btn sm" data-oedit="${o.id}">Изменить</button><button class="btn sm" data-ocancel="${o.id}">Отменить</button></div></td></tr>`; }).join('') + '</tbody></table>'
        : '<div class="empty">Отложенных ордеров нет</div>';
    } else if (tab === 'hist') {
      tools = `<select class="sm" id="hFrom"><option value="day">Сегодня</option><option value="week">Неделя</option><option value="month">Месяц</option><option value="all">Всё время</option></select>
        <div class="seg"><button data-hm="deals" class="${histMode === 'deals' ? 'on' : ''}">Сделки</button><button data-hm="orders" class="${histMode === 'orders' ? 'on' : ''}">Ордера</button></div><button class="btn sm" id="hRef">Обновить</button>`;
      if (!hist) h = '<div class="empty">Загрузка…</div>';
      else if (histMode === 'deals') {
        const d = hist.deals; const p = d.reduce((s, x) => s + x.pnl, 0), c = d.reduce((s, x) => s + x.comm, 0), w = d.filter(x => x.pnl - x.comm > 0).length;
        h = d.length ? `<table><thead><tr><th>Закрыта</th><th>Позиция</th><th>Символ</th><th>Тип</th><th class="r">Объём</th><th class="r">Открытие</th><th class="r">Закрытие</th><th class="r">Комиссия</th><th class="r">Прибыль</th><th>Причина</th><th>Робот</th></tr></thead><tbody>` +
          d.map(x => `<tr><td class="mute">${dt(x.closed_at)}</td><td class="mute">#${x.position_id}</td><td><b>${esc(x.symbol)}</b></td><td>${sideLbl(x.side)}</td><td class="r">${lotsFmt(x.lots)}</td><td class="r">${fp(x.entry, x.symbol)}</td><td class="r">${fp(x.exit, x.symbol)}</td>
            <td class="r mute">${usd(x.comm)}</td><td class="r ${cls(x.pnl)}"><b>${sgn(x.pnl)}</b></td><td>${esc(REASON[x.reason] || x.reason || '')}</td><td>${x.bot_id ? '#' + x.bot_id : ''}</td></tr>`).join('') + '</tbody></table>' : '<div class="empty">За этот период сделок нет</div>';
        sum = `<span>Сделок:</span><b>${d.length}</b><span>Прибыльных:</span><b>${d.length ? Math.round(w / d.length * 100) + '%' : '—'}</b><span>Прибыль:</span><b class="${cls(p)}">${sgn(p)}</b><span>Комиссии:</span><b>${usd(c)}</b><span>Итого:</span><b class="${cls(p - c)}">${sgn(p - c)}</b>`;
      } else {
        h = hist.orders.length ? `<table><thead><tr><th>Создан</th><th>Ордер</th><th>Символ</th><th>Тип</th><th class="r">Объём</th><th class="r">Цена</th><th>Статус</th><th>Когда</th><th>Примечание</th></tr></thead><tbody>` +
          hist.orders.map(o => `<tr><td class="mute">${dt(o.created_at)}</td><td class="mute">#${o.id}</td><td><b>${esc(o.symbol)}</b></td><td>${OTYPE[o.type] || o.type}</td><td class="r">${lotsFmt(o.lots)}</td><td class="r">${fp(o.price, o.symbol)}</td><td>${OSTATUS[o.status] || o.status}</td><td class="mute">${dt(o.done_at)}</td><td>${esc(o.note || '')}</td></tr>`).join('') + '</tbody></table>' : '<div class="empty">Истории ордеров нет</div>';
      }
    } else if (tab === 'ledger') {
      h = hist?.ledger ? `<table><thead><tr><th>Дата</th><th>Тип</th><th class="r">Сумма</th><th>Комментарий</th><th>Кто</th></tr></thead><tbody>` +
        hist.ledger.map(l => `<tr><td class="mute">${dt(l.created_at)}</td><td>${esc(LTYPE[l.type] || l.type)}</td><td class="r ${cls(l.amount)}">${sgn(l.amount)}</td><td>${esc(l.comment)}</td><td class="mute">${esc(l.by_name || 'система')}</td></tr>`).join('') + '</tbody></table>' : '<div class="empty">Загрузка…</div>';
    } else {
      h = journal.length ? `<table><tbody>${journal.map(j => `<tr><td class="mute" style="width:150px">${dt(j.t)}</td><td class="${j.type === 'err' ? 'down' : ''}">${esc(j.m)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Здесь появятся ваши действия и ошибки за эту сессию</div>';
    }
    $('#tbl').innerHTML = h; $('#tabTools').innerHTML = tools; $('#sumrow').innerHTML = sum; $('#sumrow').hidden = !sum;
    const hf = $('#hFrom'); if (hf) { hf.value = histFrom; hf.onchange = () => { histFrom = hf.value; store.set('histFrom', histFrom); loadHist(); }; }
  }
  async function loadHist() {
    const now = Date.now(), from = { day: new Date().setHours(0, 0, 0, 0), week: now - 7 * 864e5, month: now - 30 * 864e5, all: 0 }[histFrom];
    try { const [h, l] = await Promise.all([api('/api/history?from=' + from), api('/api/ledger')]); hist = { ...h, ledger: l }; } catch (e) { toast(e.message, 'err'); }
    renderTab();
  }

  // --- события ---
  async function select(sym) {
    if (!BY[sym]) return;
    sel = sym; store.set('sel', sym);
    $$('#items .wr').forEach(el => el.classList.toggle('on', el.dataset.s === sym));
    $('#cSym').textContent = sym; document.title = sym + ' · ' + me.platform + ' (демо)';
    $('#srcInfo').textContent = 'Источник: ' + (SRC[QT[sym]?.[4]] || SRC[BY[sym].src] || '—');
    ticketFor(); await loadChart();
  }
  $('#cats').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; cat = b.dataset.c; store.set('cat', cat); renderCats(); renderWatch(); };
  $('#q').oninput = renderWatch;
  $('#items').onclick = e => {
    const f = e.target.closest('[data-fav]');
    if (f) { const s = f.dataset.fav; favs.has(s) ? favs.delete(s) : favs.add(s); store.set('favs', [...favs]); f.classList.toggle('on', favs.has(s)); if (cat === 'fav') renderWatch(); return; }
    const r = e.target.closest('.wr'); if (r) select(r.dataset.s);
  };
  $('#items').onkeydown = e => { if (e.key === 'Enter') { const r = e.target.closest('.wr'); if (r) select(r.dataset.s); } };
  $('#tfs').innerHTML = TFS.map(t => `<button data-tf="${t}">${t}</button>`).join('');
  const paintSeg = () => { $$('#tfs button').forEach(b => b.classList.toggle('on', b.dataset.tf === tf)); $$('#ctype button').forEach(b => b.classList.toggle('on', b.dataset.t === ctype)); };
  $('#tfs').onclick = e => { const b = e.target.closest('[data-tf]'); if (!b) return; tf = b.dataset.tf; store.set('tf', tf); paintSeg(); loadChart(); };
  $('#ctype').onclick = e => { const b = e.target.closest('[data-t]'); if (!b) return; ctype = b.dataset.t; store.set('ctype', ctype); paintSeg(); build(); setAll(); legend(); drawLines(); };
  function renderInd() {
    const r = (k, label, fields = []) => `<label><input type="checkbox" data-ind="${k}" ${inds[k].on ? 'checked' : ''}>${label}${fields.map(([f, t]) => `<input type="number" min="1" max="500" step="${f === 'k' ? .1 : 1}" data-ind="${k}" data-f="${f}" value="${inds[k][f]}" title="${t}">`).join('')}</label>`;
    $('#indMenu').innerHTML = r('sma', 'SMA', [['n', 'Период']]) + r('ema', 'EMA', [['n', 'Период']]) + r('bb', 'Bollinger', [['n', 'Период'], ['k', 'Отклонения']]) + r('vol', 'Объём') + r('rsi', 'RSI', [['n', 'Период']]) + r('macd', 'MACD', [['f', 'Быстрая'], ['s', 'Медленная'], ['g', 'Сигнальная']]);
  }
  $('#indBtn').onclick = e => { e.stopPropagation(); renderInd(); $('#indMenu').hidden = !$('#indMenu').hidden; };
  $('#indMenu').onclick = e => e.stopPropagation();
  $('#indMenu').onchange = e => {
    const el = e.target, k = el.dataset.ind; if (!k) return;
    if (el.dataset.f) { const v = +el.value; if (v > 0) inds[k] = { ...inds[k], [el.dataset.f]: v }; } else inds[k] = { ...inds[k], on: el.checked };
    store.set('inds', inds); build(); setAll(); legend(); drawLines();
  };
  document.addEventListener('click', () => { $('#indMenu').hidden = true; const m = $('#caMenu'); if (m) m.hidden = true; });
  $('#hlBtn').onclick = () => { hlMode = !hlMode; $('#hlBtn').classList.toggle('hl-on', hlMode); if (hlMode) toast('Кликните по графику, чтобы поставить уровень'); };
  $('#hlClr').onclick = () => { store.set('hl:' + sel, []); drawLines(); };
  $('#otype').onchange = paintTicket; $('#oexp').onchange = paintTicket;
  $('#lots').oninput = () => { store.set(lotsKey(sel), +$('#lots').value); paintTicket(); };
  $('#lm').onclick = () => setLots(+$('#lots').value - BY[sel].lotStep); $('#lp').onclick = () => setLots(+$('#lots').value + BY[sel].lotStep);
  $('#bSell').onclick = () => market('sell'); $('#bBuy').onclick = () => market('buy'); $('#place').onclick = placePending;
  $('#btabs').onclick = e => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    tab = b.dataset.t; editing = null; $$('#btabs [data-t]').forEach(x => x.classList.toggle('on', x === b));
    if (tab === 'hist' || tab === 'ledger') loadHist(); else renderTab();
  };
  $('#tabTools').onclick = async e => {
    if (e.target.id === 'caBtn') { e.stopPropagation(); $('#caMenu').hidden = !$('#caMenu').hidden; return; }
    const ca = e.target.closest('[data-ca]');
    if (ca) { const f = ca.dataset.ca; try { const r = await api('/api/trade/close-all', { filter: f === 'sym' ? 'all' : f, symbol: f === 'sym' ? sel : undefined }); const m = `Закрыто позиций: ${r.closed}, результат ${sgn(r.pnl)}${r.skipped ? `. Не закрыто (рынок закрыт): ${r.skipped}` : ''}`; toast(m, 'ok'); jlog(m); refreshAccount(); } catch (x) { toast(x.message, 'err'); } }
    const hm = e.target.closest('[data-hm]'); if (hm) { histMode = hm.dataset.hm; renderTab(); }
    if (e.target.id === 'hRef') loadHist();
  };
  $('#tbl').onclick = async e => {
    const g = a => e.target.closest('[data-' + a + ']')?.dataset[a];
    const run = async (url, body, okMsg) => { try { const r = await api(url, body); const m = typeof okMsg === 'function' ? okMsg(r) : okMsg; toast(m, 'ok'); jlog(m); editing = null; refreshAccount(); } catch (x) { toast(x.message, 'err'); jlog(x.message, 'err'); } };
    let id;
    if ((id = g('close'))) return run('/api/trade/close', { id: +id }, r => `Позиция #${id} закрыта по ${fp(r.price)}: ${sgn(r.pnl)}`);
    if ((id = g('rev'))) return run('/api/trade/reverse', { id: +id }, r => `Позиция #${id} развёрнута, новая #${r.id}`);
    if ((id = g('ocancel'))) return run('/api/trade/cancel', { id: +id }, `Ордер #${id} отменён`);
    if ((id = g('edit'))) { const p = acc.positions.find(x => x.id === +id); editing = 'p' + id;
      e.target.closest('td').innerHTML = `<div class="ie"><input id="eSl" type="number" step="any" placeholder="S/L" value="${p.sl ?? ''}"><input id="eTp" type="number" step="any" placeholder="T/P" value="${p.tp ?? ''}"><input id="eTr" type="number" step="any" placeholder="Трейл" value="${p.trail ?? ''}"><button class="btn sm pri" data-esave="${id}">OK</button><button class="btn sm" data-ecancel>✕</button></div>`; return; }
    if ((id = g('esave'))) return run('/api/trade/modify', { id: +id, sl: val('#eSl'), tp: val('#eTp'), trail: val('#eTr') }, `Позиция #${id} изменена`);
    if ((id = g('part'))) { const p = acc.positions.find(x => x.id === +id); editing = 'p' + id;
      e.target.closest('td').innerHTML = `<div class="ie"><input id="pLots" type="number" step="any" value="${+(p.lots / 2).toFixed(8)}" title="Сколько закрыть"><button class="btn sm pri" data-psave="${id}">Закрыть часть</button><button class="btn sm" data-ecancel>✕</button></div>`; return; }
    if ((id = g('psave'))) return run('/api/trade/close', { id: +id, lots: val('#pLots') }, r => `Закрыто ${lotsFmt(r.lots)} по позиции #${id}: ${sgn(r.pnl)}`);
    if ((id = g('oedit'))) { const o = acc.orders.find(x => x.id === +id); editing = 'o' + id;
      e.target.closest('td').innerHTML = `<div class="ie"><input id="oP" type="number" step="any" placeholder="Цена" value="${o.price}"><input id="oSl" type="number" step="any" placeholder="S/L" value="${o.sl ?? ''}"><input id="oTp" type="number" step="any" placeholder="T/P" value="${o.tp ?? ''}"><button class="btn sm pri" data-osave="${id}">OK</button><button class="btn sm" data-ecancel>✕</button></div>`; return; }
    if ((id = g('osave'))) return run('/api/trade/order-modify', { id: +id, price: val('#oP'), sl: val('#oSl'), tp: val('#oTp') }, `Ордер #${id} изменён`);
    if (e.target.closest('[data-ecancel]')) { editing = null; renderTab(); }
  };
  $('#lev').onchange = async () => { try { await api('/api/me/leverage', { leverage: +$('#lev').value }); me.leverage = +$('#lev').value; toast('Плечо счёта 1:' + me.leverage, 'ok'); paintTicket(); } catch (x) { toast(x.message, 'err'); $('#lev').value = me.leverage; } };

  (async () => {
    const [m, cfg] = await Promise.all([api('/api/me'), api('/api/config')]);
    me = { ...m, platform: cfg.name };
    $('#pname').textContent = cfg.name; $('#uName').textContent = me.name;
    if (me.role !== 'student') $('#staff').hidden = false;
    if (!cfg.botsEnabled) $('#botsLink').hidden = true;
    $('#lev').innerHTML = me.leverages.map(l => `<option value="${l}" ${l === me.leverage ? 'selected' : ''}>1:${l}</option>`).join('');
    INS = await api('/api/instruments'); BY = Object.fromEntries(INS.map(i => [i.sym, i]));
    QT = await api('/api/quotes');
    renderCats(); renderWatch(); paintSeg();
    const s = store.get('sel', 'BTCUSD'); await select(BY[s] ? s : INS[0].sym);
    await refreshAccount();
    setInterval(async () => { try { QT = await api('/api/quotes'); paintWatch(); paintTicket(); } catch {} pullBars(); }, 1000);
    setInterval(refreshAccount, 1500);
  })().catch(x => toast(x.message, 'err'));
}
