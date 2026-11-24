'use strict';
{
  let me, INS = [], BY = {}, bots = [], cur = null, tab = 'code', editor = null, defs = [], logs = [], logAfter = 0, DEF = null, bt = null, eqChart = null;
  const TZONES = ['Europe/Kaliningrad', 'Europe/Moscow', 'Europe/Kyiv', 'Europe/Minsk', 'Europe/Berlin', 'Europe/London', 'Asia/Almaty', 'Asia/Tashkent', 'Asia/Dubai', 'America/New_York', 'UTC'];
  const myTz = Intl.DateTimeFormat().resolvedOptions().timeZone; if (!TZONES.includes(myTz)) TZONES.unshift(myTz);
  const DAYS = [[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [0, 'Вс']];
  const STATUS = { running: 'Работает', stopped: 'Остановлен', error: 'Ошибка' };
  const CATN = { stocks: 'Акции', indices: 'Индексы', futures: 'Фьючерсы', forex: 'Форекс и металлы', crypto: 'Криптовалюты' };

  async function loadList() {
    bots = await api('/api/bots');
    $('#blist').innerHTML = bots.length ? bots.map(b => `<button class="bi ${cur?.id === b.id ? 'on' : ''}" data-id="${b.id}">
      <b><span class="dot ${b.status === 'running' ? 'run' : b.status === 'error' ? 'err' : 'off'}"></span>${esc(b.name)}</b>
      <small><span>${esc(b.symbol)} · ${b.tf}</span><span class="${cls(b.total)}">${sgn(b.total)}</span></small></button>`).join('') : '<div class="empty">Роботов пока нет</div>';
    if (cur?.id) { const b = bots.find(x => x.id === cur.id); if (b) { cur.status = b.status; cur.stop_reason = b.stop_reason; cur.total = b.total; cur.open = b.open; paintBar(); } }
  }
  const fresh = (t) => ({ id: null, name: t.name, code: t.code, symbol: BY.BTCUSD ? 'BTCUSD' : INS[0].sym, tf: 'M15', inputs: {}, limits: { ...DEF.limits, tz: myTz }, status: 'stopped', dirty: true });
  function open(b) {
    cur = { ...b, limits: { ...DEF.limits, ...b.limits }, inputs: { ...b.inputs }, dirty: false };
    tab = 'code'; logs = []; logAfter = 0; bt = null; defs = [];
    renderMain(); loadList(); inspect(true);
  }
  function renderMain() {
    if (!cur) { $('#main').innerHTML = '<div class="empty-big">Выберите робота слева или создайте нового из шаблона.</div>'; return; }
    const groups = {}; for (const i of INS) (groups[i.cat] ||= []).push(i);
    $('#main').innerHTML = `<div class="bar">
      <input id="bName" maxlength="60" value="${esc(cur.name)}" aria-label="Название робота">
      <select id="bSym" aria-label="Инструмент">${Object.entries(groups).map(([c, l]) => `<optgroup label="${CATN[c] || c}">${l.map(i => `<option value="${esc(i.sym)}" ${i.sym === cur.symbol ? 'selected' : ''}>${esc(i.sym)} — ${esc(i.name)}</option>`).join('')}</optgroup>`).join('')}</select>
      <select id="bTf" aria-label="Таймфрейм">${TFS.map(t => `<option ${t === cur.tf ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <span class="st" id="bSt"></span>
      <span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap"><button class="btn" id="bSave">Сохранить</button><button class="btn" id="bRun"></button><button class="btn" id="bDel">Удалить</button></span>
      <div id="delC" style="width:100%"></div></div>
      <div class="tabs" id="tabs">${[['code', 'Код'], ['params', 'Параметры и лимиты'], ['test', 'Тестер'], ['log', 'Журнал'], ['ref', 'Справка']].map(([k, n]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="pane" id="pane"></div>`;
    $('#bName').oninput = e => { cur.name = e.target.value; dirty(); };
    $('#bSym').onchange = e => { cur.symbol = e.target.value; dirty(); };
    $('#bTf').onchange = e => { cur.tf = e.target.value; dirty(); };
    $('#bSave').onclick = () => save().catch(x => toast(x.message, 'err'));
    $('#bRun').onclick = runStop;
    $('#bDel').onclick = () => {
      if (!cur.id) { cur = null; renderMain(); return; }
      $('#delC').innerHTML = `<div class="row" style="color:var(--demo);font-size:13px;margin-top:8px">Удалить робота «${esc(cur.name)}»? Журнал тоже удалится. <button class="btn sm down" id="dY">Удалить</button><button class="btn sm" id="dN">Отмена</button></div>`;
      $('#dN').onclick = () => $('#delC').innerHTML = '';
      $('#dY').onclick = async () => { try { await api(`/api/bots/${cur.id}/delete`, {}); cur = null; renderMain(); loadList(); toast('Робот удалён', 'ok'); } catch (x) { toast(x.message, 'err'); } };
    };
    $('#tabs').onclick = e => { const b = e.target.closest('[data-t]'); if (!b) return; syncEditor(); tab = b.dataset.t; $$('#tabs button').forEach(x => x.classList.toggle('on', x === b)); renderPane(); };
    paintBar(); renderPane();
  }
  function paintBar() {
    if (!$('#bSt')) return;
    const st = cur.status || 'stopped';
    $('#bSt').className = 'st ' + st; $('#bSt').textContent = STATUS[st] + (st !== 'running' && cur.stop_reason ? ': ' + cur.stop_reason : '');
    $('#bSt').title = cur.stop_reason || '';
    $('#bRun').textContent = st === 'running' ? 'Остановить' : 'Запустить'; $('#bRun').className = 'btn ' + (st === 'running' ? 'down' : 'up');
    $('#bSave').textContent = cur.dirty ? 'Сохранить •' : 'Сохранить';
    const lock = st === 'running'; for (const id of ['#bSym', '#bTf']) $(id).disabled = lock;
    editor?.setOption('readOnly', lock);
  }
  const dirty = () => { cur.dirty = true; paintBar(); };
  const syncEditor = () => { if (editor) cur.code = editor.getValue(); };

  function renderPane() {
    editor = null; if (eqChart) { eqChart.remove(); eqChart = null; }
    const p = $('#pane');
    if (tab === 'code') {
      p.innerHTML = `<textarea id="code"></textarea><div class="row chk"><button class="btn sm" id="chk">Проверить код</button><span id="chkR" class="mute">Ctrl+S — сохранить, Ctrl+/ — закомментировать строку</span></div>`;
      editor = CodeMirror.fromTextArea($('#code'), { mode: 'javascript', theme: 'material-darker', lineNumbers: true, matchBrackets: true, autoCloseBrackets: true, indentUnit: 2, tabSize: 2, readOnly: cur.status === 'running',
        extraKeys: { 'Ctrl-S': () => save().catch(x => toast(x.message, 'err')), 'Cmd-S': () => save().catch(x => toast(x.message, 'err')), 'Ctrl-/': 'toggleComment', 'Cmd-/': 'toggleComment' } });
      editor.setValue(cur.code); editor.on('change', () => { if (cur.code !== editor.getValue()) { cur.code = editor.getValue(); dirty(); } });
      $('#chk').onclick = () => inspect(false);
    } else if (tab === 'params') renderParams();
    else if (tab === 'test') renderTest();
    else if (tab === 'log') { renderLogs(); pullLogs(); }
    else p.innerHTML = REF;
  }
  async function inspect(silent) {
    syncEditor();
    const r = await api('/api/bots/inspect', { code: cur.code }).catch(x => ({ ok: false, error: x.message }));
    if (r.ok) defs = r.inputs;
    const el = $('#chkR');
    if (el && !silent) { el.className = r.ok ? 'up' : 'down'; el.textContent = r.ok ? `Код в порядке. Параметров: ${r.inputs.length}` : r.error; }
    return r;
  }

  function renderParams() {
    const L = cur.limits;
    const inp = defs.length ? defs.map(d => { const v = cur.inputs[d.name] ?? d.def; const id = 'in_' + d.name;
      return d.type === 'boolean' ? `<label class="check" style="margin-top:28px"><input type="checkbox" data-in="${esc(d.name)}" ${v === true || v === 'true' ? 'checked' : ''}><span>${esc(d.label)}</span></label>`
        : `<div><label for="${esc(id)}">${esc(d.label)} <span class="mute">(${esc(d.name)}, по умолчанию ${esc(d.def)})</span></label><input id="${esc(id)}" data-in="${esc(d.name)}" type="${d.type === 'number' ? 'number' : 'text'}" step="any" value="${esc(v)}"></div>`; }).join('')
      : '<p class="mute wide">В коде нет параметров. Добавьте их через input(имя, значение, подпись).</p>';
    const n = (k, label, hint, step = 'any') => `<div><label for="L_${k}">${label}</label><input id="L_${k}" data-l="${k}" type="number" step="${step}" min="0" value="${esc(L[k])}"><div class="hint">${hint}</div></div>`;
    $('#pane').innerHTML = `<h3 class="sec">Параметры робота</h3><div class="hint">Значения из input() в коде. Чтобы изменить их, остановите робота.</div>
      <div class="form">${inp}${defs.length ? '<div class="wide"><button class="btn sm" id="inReset">Вернуть значения по умолчанию</button></div>' : ''}</div>
      <h3 class="sec">Лимиты</h3><div class="hint">Сервер проверяет каждое действие робота. Если действие выходит за лимит, оно отклоняется и попадает в журнал. Лимиты можно менять на ходу.</div>
      <div class="form">
        ${n('maxLots', 'Макс. объём одной сделки, лотов', 'Больше — отклоняется')}
        ${n('maxPositions', 'Макс. позиций и ордеров одновременно', 'Считаются только сделки этого робота', 1)}
        ${n('maxTotalLots', 'Макс. общий объём, лотов', 'Сумма по открытым позициям и ордерам')}
        ${n('maxDailyLoss', 'Дневной лимит убытка, $', 'Достигнут — робот останавливается. 0 — без лимита')}
        ${n('maxDrawdownPct', 'Макс. просадка счёта, %', 'От эквити на момент запуска. 0 — без лимита')}
        ${n('maxTradesPerDay', 'Макс. сделок в день', 'Рыночные и отложенные ордера', 1)}
        ${n('maxLeverage', 'Макс. плечо для робота', 'Не выше плеча счёта и инструмента', 1)}
        ${n('history', 'Баров истории в bars', '50–1000', 1)}
        <div><label for="L_hoursFrom">Торговать с</label><input id="L_hoursFrom" data-l="hoursFrom" type="time" value="${esc(L.hoursFrom === '24:00' ? '23:59' : L.hoursFrom)}"></div>
        <div><label for="L_hoursTo">до</label><input id="L_hoursTo" data-l="hoursTo" type="time" value="${esc(L.hoursTo === '24:00' ? '23:59' : L.hoursTo)}"><div class="hint">«00:00 – 23:59» — весь день</div></div>
        <div><label for="L_tz">Часовой пояс</label><select id="L_tz" data-l="tz">${TZONES.map(z => `<option ${z === L.tz ? 'selected' : ''}>${z}</option>`).join('')}</select></div>
        <div class="wide"><label>Дни торговли</label><div class="days">${DAYS.map(([d, n]) => `<label><input type="checkbox" data-day="${d}" ${L.days.includes(d) ? 'checked' : ''}>${n}</label>`).join('')}</div></div>
        <label class="check wide"><input type="checkbox" data-l="requireSL" ${L.requireSL ? 'checked' : ''}><span>Обязательный стоп-лосс: сделки без SL отклоняются</span></label>
        <label class="check wide"><input type="checkbox" data-l="closeOnStop" ${L.closeOnStop ? 'checked' : ''}><span>При остановке закрывать позиции и снимать ордера робота</span></label>
      </div><button class="btn pri" id="pSave" style="margin-top:12px">Сохранить</button>`;
    const p = $('#pane');
    p.oninput = p.onchange = e => {
      const el = e.target;
      if (el.dataset.in) { cur.inputs[el.dataset.in] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? '' : +el.value) : el.value; dirty(); }
      else if (el.dataset.l) { const k = el.dataset.l; cur.limits[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : (k === 'hoursTo' && el.value === '23:59' ? '24:00' : el.value); dirty(); }
      else if (el.dataset.day) { cur.limits.days = $$('[data-day]').filter(x => x.checked).map(x => +x.dataset.day); dirty(); }
    };
    const r = $('#inReset'); if (r) r.onclick = () => { cur.inputs = {}; dirty(); renderParams(); };
    $('#pSave').onclick = () => save().catch(x => toast(x.message, 'err'));
  }

  function renderTest() {
    const s = store.get('bt', { bars: 1000, deposit: 10000, leverage: 100 });
    $('#pane').innerHTML = `<div class="hint">Робот прогоняется по истории ${esc(cur.symbol)} ${cur.tf} с вашими параметрами и лимитами. Сделки исполняются по закрытию бара с учётом спреда и комиссии; стопы проверяются по максимуму и минимуму бара.</div>
      <div class="row" style="align-items:flex-end">
        <div><label for="tBars">Баров</label><select id="tBars">${[500, 1000, 2000, 5000].map(v => `<option ${v === s.bars ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div><label for="tDep">Депозит, $</label><input id="tDep" type="number" min="100" value="${s.deposit}" style="width:140px"></div>
        <div><label for="tLev">Плечо</label><select id="tLev">${[1, 5, 10, 20, 50, 100, 200, 500].map(v => `<option value="${v}" ${v === s.leverage ? 'selected' : ''}>1:${v}</option>`).join('')}</select></div>
        <button class="btn pri" id="tRun">Запустить тест</button></div>
      <div id="tRes">${bt ? '' : '<div class="empty">Результаты появятся здесь</div>'}</div>`;
    $('#tRun').onclick = runTest;
    if (bt) paintTest();
  }
  async function runTest() {
    syncEditor();
    const s = { bars: +$('#tBars').value, deposit: +$('#tDep').value, leverage: +$('#tLev').value }; store.set('bt', s);
    const b = $('#tRun'); b.disabled = true; b.textContent = 'Тестирую…'; $('#tRes').innerHTML = '<div class="empty">Идёт тест…</div>';
    try { bt = await api('/api/bots/backtest', { code: cur.code, inputs: cur.inputs, symbol: cur.symbol, tf: cur.tf, limits: cur.limits, ...s }); paintTest(); }
    catch (x) { $('#tRes').innerHTML = `<div class="empty down">${esc(x.message)}</div>`; }
    finally { b.disabled = false; b.textContent = 'Запустить тест'; }
  }
  function paintTest() {
    const r = bt, d = new Date(r.from * 1000).toLocaleDateString('ru-RU'), d2 = new Date(r.to * 1000).toLocaleDateString('ru-RU');
    $('#tRes').innerHTML = `${r.stopped ? `<p class="down">${esc(r.stopped)}</p>` : ''}
      <p class="mute" style="margin:12px 0 0">${esc(r.symbol)} ${r.tf}, ${d} — ${d2}, баров: ${r.bars}. История: ${esc(SRC[r.src] || r.src)}.${r.src === 'sim' ? ' Это смоделированные данные, результат не отражает реальный рынок.' : ''}</p>
      <div class="stats">${[
        ['Чистая прибыль', `<span class="${cls(r.net)}">${sgn(r.net)}</span>`], ['Итоговый баланс', usd(r.final)], ['Сделок', r.trades], ['Прибыльных', num(r.winRate, 1) + '%'],
        ['Профит-фактор', r.profitFactor === null ? '∞' : num(r.profitFactor, 2)], ['Макс. просадка', `${usd(r.maxDD)} <small>${num(r.maxDDp, 1)}%</small>`], ['Средняя сделка', sgn(r.avgTrade)], ['Лучшая / худшая', `${sgn(r.best)} / ${sgn(r.worst)}`],
      ].map(([k, v]) => `<div class="box"><small>${k}</small><b>${v}</b></div>`).join('')}</div>
      <div id="eq"></div>
      <h3 class="sec">Сделки</h3>${r.deals.length ? `<div class="scroll" style="max-height:340px"><table><thead><tr><th>Открыта</th><th>Закрыта</th><th>Тип</th><th class="r">Объём</th><th class="r">Вход</th><th class="r">Выход</th><th class="r">Прибыль</th><th>Причина</th></tr></thead><tbody>
        ${r.deals.slice(0, 300).map(x => `<tr><td class="mute">${dt(x.opened * 1000)}</td><td class="mute">${dt(x.closed * 1000)}</td><td class="${x.side === 'buy' ? 'up' : 'down'}">${x.side === 'buy' ? 'Buy' : 'Sell'}</td><td class="r">${lotsFmt(x.lots)}</td><td class="r">${num(x.entry, BY[r.symbol]?.digits)}</td><td class="r">${num(x.exit, BY[r.symbol]?.digits)}</td><td class="r ${cls(x.pnl - x.comm)}">${sgn(x.pnl - x.comm)}</td><td>${esc(REASON[x.reason] || x.reason)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mute">Робот не совершил ни одной сделки.</p>'}
      ${r.logs.length ? `<h3 class="sec">Журнал теста</h3><div class="scroll logs" style="max-height:240px"><table><tbody>${r.logs.map(l => `<tr><td class="mute" style="width:130px">${dt(l.t)}</td><td class="lv-${l.level}">${esc(l.msg)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
    const el = $('#eq');
    eqChart = LightweightCharts.createChart(el, { autoSize: true, layout: { background: { color: 'transparent' }, textColor: '#8b95a5' }, grid: { vertLines: { color: '#151a21' }, horzLines: { color: '#151a21' } }, timeScale: { timeVisible: true, borderColor: '#242c37' }, rightPriceScale: { borderColor: '#242c37' } });
    const s = eqChart.addSeries(LightweightCharts.AreaSeries, { lineColor: r.net >= 0 ? '#1fc27e' : '#f04b5c', topColor: r.net >= 0 ? '#1fc27e33' : '#f04b5c33', bottomColor: 'transparent', lineWidth: 2 });
    s.setData(r.curve); s.createPriceLine({ price: r.deposit, color: '#4a5260', lineStyle: 2, lineWidth: 1, title: 'Депозит' }); eqChart.timeScale().fitContent();
  }

  function renderLogs() {
    if (tab !== 'log') return;
    $('#pane').innerHTML = !cur.id ? '<div class="empty">Сохраните и запустите робота, чтобы появился журнал</div>' : logs.length ? `<div class="logs"><table><tbody>${logs.slice().reverse().map(l => `<tr><td class="mute" style="width:150px">${dt(l.t)}</td><td class="lv-${l.level}">${esc(l.msg)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Записей пока нет</div>';
  }
  async function pullLogs() {
    if (!cur?.id) return renderLogs();
    try { const a = await api(`/api/bots/${cur.id}/logs?after=${logAfter}`); if (a.length) { logs.push(...a); logs = logs.slice(-1000); logAfter = a[a.length - 1].id; } } catch {}
    renderLogs();
  }

  async function save() {
    syncEditor();
    const r = await api('/api/bots/save', { id: cur.id, name: cur.name, code: cur.code, symbol: cur.symbol, tf: cur.tf, inputs: cur.inputs, limits: cur.limits });
    cur.id = r.id; cur.dirty = false; paintBar(); toast('Сохранено', 'ok'); await loadList();
    inspect(true);
  }
  async function runStop() {
    const b = $('#bRun'); b.disabled = true;
    try {
      if (cur.status === 'running') { await api(`/api/bots/${cur.id}/stop`, {}); toast('Робот остановлен', 'ok'); }
      else {
        const chk = await inspect(true); if (!chk.ok) { tab = 'code'; renderMain(); $('#chkR').className = 'down'; $('#chkR').textContent = chk.error; throw new Error('Исправьте ошибку в коде'); }
        if (cur.dirty || !cur.id) await save();
        await api(`/api/bots/${cur.id}/start`, {}); toast('Робот запущен', 'ok');
      }
      await loadList(); if (tab === 'log') pullLogs();
    } catch (x) { toast(x.message, 'err'); } finally { b.disabled = false; }
  }

  $('#blist').onclick = e => { const b = e.target.closest('[data-id]'); if (!b) return; const x = bots.find(y => y.id === +b.dataset.id); if (cur?.dirty && cur.id !== x.id && !confirmLeave()) return; open(x); };
  const confirmLeave = () => { toast('Есть несохранённые изменения. Сохраните или нажмите ещё раз, чтобы выйти без сохранения.'); if (cur._warned) return true; cur._warned = true; return false; };
  $('#newBtn').onclick = e => { e.stopPropagation(); $('#newMenu').innerHTML = BOT_TEMPLATES.map((t, k) => `<button data-tpl="${k}">${esc(t.name)}</button>`).join(''); $('#newMenu').hidden = !$('#newMenu').hidden; };
  $('#newMenu').onclick = e => { const b = e.target.closest('[data-tpl]'); if (!b) return; cur = fresh(BOT_TEMPLATES[+b.dataset.tpl]); tab = 'code'; logs = []; bt = null; renderMain(); inspect(true); $('#newMenu').hidden = true; };
  document.addEventListener('click', () => { $('#newMenu').hidden = true; });
  window.addEventListener('beforeunload', e => { if (cur?.dirty) { e.preventDefault(); e.returnValue = ''; } });

  const REF = `<div class="ref">
    <p>Робот — это JavaScript-код, который сервер вызывает по событиям. Он работает в изолированной среде: без доступа к сети, файлам и чужим счетам, с лимитом 32 МБ памяти и 250 мс на вызов. Робот торгует только своим инструментом и видит только свои позиции.</p>
    <h4>События</h4><table><tbody>
      <tr><td><code>onInit()</code></td><td>Один раз при запуске.</td></tr>
      <tr><td><code>onBar()</code></td><td>При открытии нового бара. В <code>bars</code> — закрытые бары, последний только что закрылся.</td></tr>
      <tr><td><code>onTick()</code></td><td>При изменении цены, не чаще раза в секунду. Текущий незакрытый бар — <code>current</code>.</td></tr>
      <tr><td><code>onStop()</code></td><td>При остановке.</td></tr></tbody></table>
    <h4>Данные</h4><table><tbody>
      <tr><td><code>symbol, timeframe</code></td><td>Инструмент и таймфрейм робота.</td></tr>
      <tr><td><code>bars</code></td><td>Массив <code>{time, open, high, low, close, volume}</code>, время в секундах UTC.</td></tr>
      <tr><td><code>bid, ask</code></td><td>Текущие цены продажи и покупки.</td></tr>
      <tr><td><code>digits, point, minLot, lotStep, contract</code></td><td>Знаков после запятой, размер пункта, мин. объём, шаг объёма, размер контракта.</td></tr>
      <tr><td><code>account</code></td><td><code>{balance, equity, margin, free, level, leverage}</code>.</td></tr>
      <tr><td><code>positions, orders</code></td><td>Позиции и ордера этого робота. Позиция: <code>{id, side, lots, entry, sl, tp, trail, pnl, openedAt}</code>.</td></tr>
      <tr><td><code>state</code></td><td>Объект, который сохраняется между перезапусками робота.</td></tr>
      <tr><td><code>time</code></td><td>Текущее время, мс.</td></tr></tbody></table>
    <h4>Торговля</h4><table><tbody>
      <tr><td><code>buy(lots, {sl, tp, trail, comment})</code><br><code>sell(lots, {...})</code></td><td>Рыночная сделка. SL/TP — цены, trail — расстояние трейлинг-стопа в цене.</td></tr>
      <tr><td><code>buyLimit(price, lots, {...})</code>, <code>sellLimit</code><br><code>buyStop(price, lots, {...})</code>, <code>sellStop</code></td><td>Отложенные ордера. В параметрах можно указать <code>expires</code> (дата/время).</td></tr>
      <tr><td><code>buyStopLimit(stop, limit, lots, {...})</code>, <code>sellStopLimit</code></td><td>Стоп-лимит: при достижении стоп-цены выставляется лимитный ордер.</td></tr>
      <tr><td><code>close(id, lots?)</code>, <code>closeAll()</code></td><td>Закрыть позицию целиком или частично, закрыть все позиции робота.</td></tr>
      <tr><td><code>modify(id, {sl, tp, trail})</code></td><td>Изменить стопы позиции.</td></tr>
      <tr><td><code>cancel(id)</code>, <code>cancelAll()</code></td><td>Снять отложенный ордер или все ордера робота.</td></tr>
      <tr><td><code>position(side?)</code></td><td>Первая открытая позиция робота (можно указать <code>'buy'</code> или <code>'sell'</code>) или <code>null</code>.</td></tr></tbody></table>
    <h4>Индикаторы и помощники</h4><table><tbody>
      <tr><td><code>closes(), opens(), highs(), lows(), volumes()</code></td><td>Массивы значений из <code>bars</code>.</td></tr>
      <tr><td><code>last(arr, k = 0)</code></td><td>Значение с конца: <code>last(a)</code> — последнее, <code>last(a, 1)</code> — предпоследнее.</td></tr>
      <tr><td><code>ta.sma(a, n), ta.ema(a, n), ta.rsi(a, n), ta.stdev(a, n)</code></td><td>Возвращают массив той же длины (в начале NaN).</td></tr>
      <tr><td><code>ta.macd(a, 12, 26, 9)</code></td><td><code>{macd, signal, hist}</code></td></tr>
      <tr><td><code>ta.bb(a, 20, 2)</code></td><td>Полосы Боллинджера <code>{upper, middle, lower}</code></td></tr>
      <tr><td><code>ta.atr(bars, 14)</code></td><td>Средний истинный диапазон</td></tr>
      <tr><td><code>ta.highest(a, n), ta.lowest(a, n)</code></td><td>Максимум и минимум за последние n значений</td></tr>
      <tr><td><code>ta.crossOver(a, b), ta.crossUnder(a, b)</code></td><td>Пересечение на последнем баре; <code>b</code> — массив или число</td></tr>
      <tr><td><code>roundPrice(v), normalizeLots(v)</code></td><td>Округлить цену до digits, объём — до шага лота</td></tr>
      <tr><td><code>input(name, def, label)</code></td><td>Параметр, который можно менять в настройках без правки кода</td></tr>
      <tr><td><code>log(...)</code></td><td>Запись в журнал робота</td></tr></tbody></table>
    <h4>Лимиты</h4><p>Каждое действие робота сервер проверяет по лимитам из вкладки «Параметры и лимиты». Нарушение — действие отклоняется с записью в журнал. Дневной убыток или просадка выше лимита — робот останавливается. Робот также останавливается после 5 ошибок подряд.</p></div>`;

  (async () => {
    const [m, cfg, d] = await Promise.all([api('/api/me'), api('/api/config'), api('/api/bots/defaults')]);
    me = m; DEF = d;
    $('#pname').textContent = cfg.name; $('#uName').textContent = me.name; if (me.role !== 'student') $('#staff').hidden = false;
    if (!cfg.botsEnabled && me.role !== 'admin') { $('.wrap').innerHTML = '<div class="empty-big">Роботы отключены администратором.</div>'; return; }
    INS = await api('/api/instruments'); BY = Object.fromEntries(INS.map(i => [i.sym, i]));
    await loadList();
    const id = +location.hash.slice(1); const b = bots.find(x => x.id === id) || bots[0]; if (b) open(b);
    setInterval(() => { loadList().catch(() => {}); if (tab === 'log') pullLogs(); }, 3000);
  })().catch(x => toast(x.message, 'err'));
}
