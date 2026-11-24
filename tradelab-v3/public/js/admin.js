'use strict';
{
  let me, users = [], tab = 'users', q = '', cur = null, cfg, leverages = [];
  const isAdmin = () => me.role === 'admin';
  const roleSel = (v, id) => `<select id="${id}">${Object.entries(ROLE).map(([k, n]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
  const mentorSel = (v, id, exclude) => `<select id="${id}"><option value="">— без ментора —</option>${users.filter(u => u.role !== 'student' && u.id !== exclude).map(u => `<option value="${u.id}" ${u.id === v ? 'selected' : ''}>${esc(u.name)} (${esc(u.email)})</option>`).join('')}</select>`;
  const levSel = (v, id) => `<select id="${id}">${leverages.map(l => `<option value="${l}" ${l === v ? 'selected' : ''}>1:${l}</option>`).join('')}</select>`;
  const sideLbl = s => `<span class="${s === 'buy' ? 'up' : 'down'}">${s === 'buy' ? 'Buy' : 'Sell'}</span>`;
  const fpx = (v, d) => v === null || v === undefined ? '—' : num(v, d ?? 2);
  const ago = t => { if (!t) return '—'; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? s + ' с назад' : s < 3600 ? Math.round(s / 60) + ' мин назад' : Math.round(s / 3600) + ' ч назад'; };

  function renderTabs() {
    const t = isAdmin() ? [['users', 'Пользователи'], ['bots', 'Роботы'], ['instruments', 'Инструменты'], ['feeds', 'Котировки'], ['ledger', 'Журнал операций'], ['create', 'Новый пользователь'], ['settings', 'Настройки']]
      : [['users', 'Мои ученики'], ['bots', 'Роботы учеников']];
    $('#tabs').innerHTML = t.map(([k, n]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${n}</button>`).join('');
  }
  function renderStats() {
    const st = users.filter(u => u.role === 'student'), base = isAdmin() ? users : st;
    const avg = base.length ? base.reduce((s, u) => s + u.result, 0) / base.length : 0;
    const best = base.reduce((b, u) => !b || u.result > b.result ? u : b, null);
    $('#stats').innerHTML = [
      [isAdmin() ? 'Пользователей' : 'Учеников', base.length + (isAdmin() ? ` <small>(учеников ${st.length})</small>` : '')],
      ['Открытых позиций', base.reduce((s, u) => s + u.open, 0)], ['Роботов работает', base.reduce((s, u) => s + u.bots, 0)],
      ['Средний результат', `<span class="${cls(avg)}">${sgn(avg)}</span>`],
      ['Лучший', best ? `<span class="${cls(best.result)}">${sgn(best.result)}</span> <small>${esc(best.name)}</small>` : '—'],
    ].map(([k, v]) => `<div class="box"><small>${k}</small><b>${v}</b></div>`).join('');
  }
  function renderInvite() {
    if (!me.invite_code) return;
    const link = location.origin + '/?invite=' + me.invite_code;
    $('#myInvite').innerHTML = `<span class="mute">Ваш код ментора:</span><code>${esc(me.invite_code)}</code><button class="btn sm" id="cpy">Скопировать ссылку</button>`;
    $('#cpy').onclick = () => navigator.clipboard.writeText(link).then(() => toast('Ссылка скопирована: ' + link, 'ok'), () => toast(link));
  }

  async function loadUsers() { users = await api('/api/staff/users'); renderStats(); if (tab === 'users') renderUsers(); }
  function renderUsers() {
    const list = users.filter(u => !q || (u.name + ' ' + u.email).toLowerCase().includes(q));
    $('#view').innerHTML = `<div class="toolbar"><input id="q" placeholder="Поиск по имени или email" value="${esc(q)}"><button class="btn" id="rf">Обновить</button></div>` +
      (list.length ? `<div class="scroll"><table><thead><tr><th>Имя</th><th>Email</th><th>Роль</th>${isAdmin() ? '<th>Ментор</th>' : ''}<th class="r">Баланс</th><th class="r">Эквити</th><th class="r">Результат</th><th class="r">Позиций</th><th class="r">Сделок</th><th class="r">Роботов</th><th class="r">Плечо</th><th>Был</th><th></th></tr></thead><tbody>` +
        list.map(u => `<tr class="click" data-u="${u.id}"><td><b>${esc(u.name)}</b></td><td class="mute">${esc(u.email)}</td><td>${ROLE[u.role]}</td>${isAdmin() ? `<td class="mute">${esc(u.mentor_name || '—')}</td>` : ''}
          <td class="r">${usd(u.balance)}</td><td class="r">${usd(u.equity)}</td><td class="r ${cls(u.result)}">${sgn(u.result)}</td><td class="r">${u.open}</td><td class="r">${u.trades}</td><td class="r">${u.bots || ''}</td><td class="r">1:${u.leverage}</td>
          <td class="mute">${dt(u.last_login)}</td><td>${u.blocked ? '<span class="pill blk">заблокирован</span>' : ''}</td></tr>`).join('') + '</tbody></table></div>'
        : `<div class="empty">${isAdmin() ? 'Пользователей не найдено' : 'У вас пока нет учеников. Отправьте им ссылку с вашим кодом ментора, она вверху страницы.'}</div>`);
    const qi = $('#q'); qi.oninput = () => { q = qi.value.trim().toLowerCase(); renderUsers(); const n = $('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    $('#rf').onclick = loadUsers;
  }

  async function renderBots() {
    $('#view').innerHTML = '<div class="empty">Загрузка…</div>';
    const list = await api('/api/staff/bots');
    $('#view').innerHTML = list.length ? `<div class="scroll"><table><thead><tr><th>Робот</th><th>Владелец</th><th>Инструмент</th><th>Статус</th><th class="r">Результат</th><th class="r">Сделок</th><th class="r">Открыто</th><th>Лимиты</th><th></th></tr></thead><tbody>` +
      list.map(b => `<tr><td><b>${esc(b.name)}</b></td><td>${esc(b.user_name)} <span class="mute">${esc(b.user_email)}</span></td><td>${esc(b.symbol)} · ${b.tf}</td>
        <td class="${b.status === 'running' ? 'up' : b.status === 'error' ? 'down' : 'mute'}" title="${esc(b.stop_reason || '')}">${{ running: 'работает', stopped: 'остановлен', error: 'ошибка' }[b.status]}</td>
        <td class="r ${cls(b.total)}">${sgn(b.total)}</td><td class="r">${b.deals}</td><td class="r">${b.open}</td>
        <td class="mute" style="white-space:normal;font-size:12px">до ${lotsFmt(b.limits.maxLots)} лот, ${b.limits.maxPositions} поз., убыток/день ${usd(b.limits.maxDailyLoss, 0)}, просадка ${b.limits.maxDrawdownPct}%${b.limits.requireSL ? ', SL обяз.' : ''}</td>
        <td><div class="row"><button class="btn sm" data-blog="${b.id}">Журнал</button>${b.status === 'running' ? `<button class="btn sm down" data-bstop="${b.id}">Стоп</button>` : ''}</div></td></tr>`).join('') + '</tbody></table></div>'
      : '<div class="empty">Роботов нет</div>';
  }
  async function botLog(id) {
    $('#modal').hidden = false; $('#mbody').innerHTML = '<div class="empty">Загрузка…</div>';
    const d = await api('/api/staff/bots/' + id), b = d.bot;
    $('#mbody').innerHTML = `<div class="mhead"><div><h2>${esc(b.name)}</h2><div class="mute">${esc(b.symbol)} · ${b.tf} · ${{ running: 'работает', stopped: 'остановлен', error: 'ошибка' }[b.status]}${b.stop_reason ? ' — ' + esc(b.stop_reason) : ''}</div></div><button class="btn" id="mx">Закрыть</button></div>
      <div class="grid2"><div class="box"><h3>Параметры</h3><pre class="mono" style="white-space:pre-wrap;margin:0">${esc(JSON.stringify(b.inputs, null, 2))}</pre></div><div class="box"><h3>Лимиты</h3><pre class="mono" style="white-space:pre-wrap;margin:0">${esc(JSON.stringify(b.limits, null, 2))}</pre></div></div>
      <div class="sec"><h3>Код</h3><pre class="mono box" style="max-height:300px;overflow:auto;white-space:pre">${esc(b.code)}</pre></div>
      <div class="sec"><h3>Журнал</h3><div class="scroll" style="max-height:340px"><table><tbody>${d.logs.slice().reverse().map(l => `<tr><td class="mute" style="width:140px">${dt(l.t)}</td><td class="${l.level === 'error' ? 'down' : l.level === 'warn' ? 'mute' : ''}" style="white-space:normal">${esc(l.msg)}</td></tr>`).join('') || '<tr><td class="mute">Пусто</td></tr>'}</tbody></table></div></div>`;
    $('#mx').onclick = closeModal;
  }

  async function renderInstruments() {
    $('#view').innerHTML = '<div class="empty">Загрузка…</div>';
    const list = await api('/api/admin/instruments');
    const CATN = { stocks: 'Акции', indices: 'Индексы', futures: 'Фьючерсы', forex: 'Форекс', crypto: 'Крипта' };
    $('#view').innerHTML = `<div class="toolbar"><button class="btn pri" id="iNew">Добавить инструмент</button><span class="mute" style="font-size:13px">Нажмите на строку, чтобы изменить спецификацию, коды источников или выключить инструмент.</span></div>
      <div class="scroll"><table><thead><tr><th>Тикер</th><th>Название</th><th>Категория</th><th class="r">Контракт</th><th class="r">Мин. лот</th><th class="r">Плечо</th><th class="r">Спред %</th><th class="r">Комиссия %</th><th>Сессия</th><th>Источник</th><th class="r">Цена</th><th>Обновлено</th><th></th></tr></thead><tbody>` +
      list.map(i => `<tr class="click" data-i="${esc(i.sym)}"><td><b>${esc(i.sym)}</b></td><td>${esc(i.name)}</td><td>${CATN[i.cat]}</td><td class="r">${num(i.contract, i.contract < 1 ? 4 : 0)}</td><td class="r">${lotsFmt(i.min_lot)}</td><td class="r">1:${i.max_lev}</td>
        <td class="r">${num(i.spread, 3)}</td><td class="r">${num(i.comm, 3)}</td><td class="mute">${esc(i.session)}</td>
        <td>${i.enabled ? (i.fallback ? '<span class="badge sim">симуляция</span>' : esc(SRC[i.src || i.assigned] || i.assigned || '—')) : '<span class="mute">выключен</span>'}</td>
        <td class="r">${i.last !== null ? num(i.last, i.digits) : '—'}</td><td class="mute">${ago(i.at)}</td><td></td></tr>`).join('') + '</tbody></table></div>';
    $('#iNew').onclick = () => editInst(null);
    $('#view').onclick = e => { const r = e.target.closest('[data-i]'); if (r) editInst(list.find(x => x.sym === r.dataset.i)); else viewClick(e); };
  }
  function editInst(i) {
    const n = !i; i = i || { sym: '', name: '', cat: 'stocks', ccy: 'USD', contract: 1, min_lot: 0.01, lot_step: 0.01, max_lot: 100, digits: 2, max_lev: 20, spread: 0.02, comm: 0, session: 'us', bn: '', fh: '', yh: '', td: '', base: 100, vol: 0.005, enabled: 1 };
    const f = (k, label, type = 'number', hint = '') => `<div><label for="f_${k}">${label}</label><input id="f_${k}" data-f="${k}" type="${type}" step="any" value="${esc(i[k] ?? '')}" ${k === 'sym' && !n ? 'disabled' : ''}>${hint ? `<div class="hint mute" style="font-size:12px">${hint}</div>` : ''}</div>`;
    const s = (k, label, opts) => `<div><label for="f_${k}">${label}</label><select id="f_${k}" data-f="${k}">${opts.map(([v, t]) => `<option value="${v}" ${v === i[k] ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
    $('#modal').hidden = false;
    $('#mbody').innerHTML = `<div class="mhead"><h2>${n ? 'Новый инструмент' : esc(i.sym)}</h2><button class="btn" id="mx">Закрыть</button></div>
      <div class="grid2" style="gap:4px 16px">${f('sym', 'Тикер', 'text')}${f('name', 'Название', 'text')}
      ${s('cat', 'Категория', [['stocks', 'Акции'], ['indices', 'Индексы'], ['futures', 'Фьючерсы'], ['forex', 'Форекс и металлы'], ['crypto', 'Криптовалюты']])}
      ${s('session', 'Торговая сессия', [['us', 'США 9:30–16:00 NY'], ['eu', 'Европа 9:00–17:30'], ['uk', 'Лондон 8:00–16:30'], ['jp', 'Токио 9:00–15:00'], ['cme', 'CME почти круглосуточно'], ['fx', 'Форекс 24/5'], ['24x7', 'Круглосуточно']])}
      ${f('ccy', 'Валюта котировки', 'text', 'USD, EUR, GBP, JPY… прибыль пересчитывается в USD')}${f('contract', 'Размер контракта', 'number', 'Единиц в 1 лоте; для фьючерсов — стоимость 1 пункта')}
      ${f('min_lot', 'Мин. лот')}${f('lot_step', 'Шаг лота')}${f('max_lot', 'Макс. лот')}${f('digits', 'Знаков после запятой')}${f('max_lev', 'Макс. плечо')}
      ${f('spread', 'Спред, % от цены', 'number', 'Если источник не даёт bid/ask')}${f('comm', 'Комиссия, % от объёма')}
      ${f('bn', 'Код Binance', 'text', 'например BTCUSDT')}${f('fh', 'Код Finnhub', 'text', 'AAPL или OANDA:EUR_USD')}${f('yh', 'Код Yahoo', 'text', 'AAPL, ES=F, EURUSD=X, ^GSPC')}${f('td', 'Код Twelve Data', 'text', 'AAPL, EUR/USD')}
      ${f('base', 'Базовая цена для симуляции')}${f('vol', 'Волатильность симуляции, за час', 'number', '0.005 = 0,5%')}</div>
      <label class="check"><input type="checkbox" id="f_enabled" ${i.enabled ? 'checked' : ''}><span>Инструмент включён и доступен для торговли</span></label>
      <button class="btn pri" id="iSave">Сохранить</button>`;
    $('#mx').onclick = closeModal;
    $('#iSave').onclick = async () => {
      const b = { sym: n ? $('#f_sym').value : i.sym, enabled: $('#f_enabled').checked };
      for (const el of $$('[data-f]')) if (el.dataset.f !== 'sym') b[el.dataset.f] = el.value;
      try { await api('/api/admin/instruments', b); toast('Сохранено', 'ok'); closeModal(); renderInstruments(); } catch (x) { toast(x.message, 'err'); }
    };
  }

  async function renderFeeds() {
    $('#view').innerHTML = '<div class="empty">Загрузка…</div>';
    const d = await api('/api/admin/feeds'), s = d.settings;
    const CATN = { stocks: 'Акции', indices: 'Индексы', futures: 'Фьючерсы', forex: 'Форекс и металлы', crypto: 'Криптовалюты' };
    $('#view').innerHTML = `<div style="padding:16px">
      <h3 style="margin:0 0 6px">Источники по категориям</h3>
      <p class="mute" style="font-size:13px;margin:0 0 10px">Если выбранный источник недоступен, нет ключа или по инструменту три минуты нет цены, инструмент автоматически переходит на Yahoo, а затем на симуляцию. Раз в час система снова пробует основной источник.</p>
      <div class="grid2" style="gap:4px 16px">${Object.entries(d.options).map(([c, opts]) => `<div><label for="fd_${c}">${CATN[c]}</label><select id="fd_${c}" data-feed="${c}">${opts.map(o => `<option value="${o}" ${s['feed_' + c] === o ? 'selected' : ''}>${SRC[o] || o}</option>`).join('')}</select></div>`).join('')}</div>
      <h3 style="margin:22px 0 6px">Ключи API</h3>
      <div class="grid2" style="gap:4px 16px">
        <div><label for="k_fh">Finnhub (бесплатный ключ на finnhub.io)</label><input id="k_fh" value="${esc(s.finnhub_key)}" placeholder="вставьте ключ" autocomplete="off"><div class="mute" style="font-size:12px;margin-top:4px">Акции США и форекс в реальном времени, до 50 символов в потоке</div></div>
        <div><label for="k_td">Twelve Data (платный тариф)</label><input id="k_td" value="${esc(s.twelvedata_key)}" placeholder="вставьте ключ" autocomplete="off"><div class="mute" style="font-size:12px;margin-top:4px">Все рынки одним ключом; WebSocket на тарифах Pro и выше</div></div>
        <div><label for="k_tdp">Опрос Twelve Data, сек</label><input id="k_tdp" type="number" min="5" value="${esc(s.td_poll_sec)}"></div>
        <div><label for="k_yp">Интервал запросов к Yahoo, мс</label><input id="k_yp" type="number" min="500" value="${esc(s.yahoo_poll_ms)}"></div>
      </div>
      <button class="btn pri" id="fSave" style="margin-top:14px">Сохранить и переподключить</button>
      <h3 style="margin:26px 0 6px">Состояние</h3>
      <table><thead><tr><th>Источник</th><th>Связь</th><th class="r">Инструментов</th><th>Последние данные</th><th>Ошибка / примечание</th></tr></thead><tbody>
      ${d.status.map(x => `<tr><td><b>${esc(x.name)}</b></td><td class="${x.connected ? 'up' : x.assigned ? 'down' : 'mute'}">${x.assigned ? (x.connected ? 'есть' : 'нет') : '—'}</td><td class="r">${x.assigned}</td><td class="mute">${x.id === 'sim' ? '—' : ago(x.lastMsg)}</td><td style="white-space:normal">${esc([x.error, x.note].filter(Boolean).join(' · '))}</td></tr>`).join('')}
      </tbody></table></div>`;
    $('#fSave').onclick = async () => {
      const b = { finnhub_key: $('#k_fh').value, twelvedata_key: $('#k_td').value, td_poll_sec: +$('#k_tdp').value, yahoo_poll_ms: +$('#k_yp').value };
      for (const el of $$('[data-feed]')) b['feed_' + el.dataset.feed] = el.value;
      try { await api('/api/admin/feeds', b); toast('Сохранено, источники переподключаются', 'ok'); setTimeout(renderFeeds, 3000); } catch (x) { toast(x.message, 'err'); }
    };
  }

  async function renderLedger() {
    $('#view').innerHTML = '<div class="empty">Загрузка…</div>';
    const l = await api('/api/admin/ledger');
    $('#view').innerHTML = `<div class="scroll"><table><thead><tr><th>Дата</th><th>Пользователь</th><th>Тип</th><th class="r">Сумма</th><th>Комментарий</th><th>Кто</th></tr></thead><tbody>` +
      l.map(x => `<tr><td class="mute">${dt(x.created_at)}</td><td>${esc(x.user_name)} <span class="mute">${esc(x.user_email)}</span></td><td>${esc(LTYPE[x.type] || x.type)}</td><td class="r ${cls(x.amount)}">${sgn(x.amount)}</td><td>${esc(x.comment)}</td><td class="mute">${esc(x.by_name || 'система')}</td></tr>`).join('') + '</tbody></table></div>';
  }
  function renderCreate() {
    $('#view').innerHTML = `<form id="fc" style="padding:16px;max-width:520px" novalidate>
      <label for="cn">Имя</label><input id="cn" maxlength="40"><label for="ce">Email</label><input id="ce" type="email">
      <label for="cp">Пароль (от 8 символов)</label><input id="cp" type="text" autocomplete="off">
      <div class="grid2" style="gap:8px"><div><label for="cr">Роль</label>${roleSel('student', 'cr')}</div><div><label for="cm">Ментор</label>${mentorSel(null, 'cm')}</div></div>
      <p class="mute" style="font-size:13px">Пользователь получит стартовый виртуальный баланс ${usd(+cfg.start_balance, 0)} и плечо 1:${cfg.default_leverage}.</p>
      <button class="btn pri">Создать</button></form>`;
    $('#fc').onsubmit = async e => {
      e.preventDefault();
      try { await api('/api/admin/users', { name: $('#cn').value, email: $('#ce').value, password: $('#cp').value, role: $('#cr').value, mentor_id: $('#cm').value || null }); toast('Пользователь создан', 'ok'); e.target.reset(); loadUsers(); } catch (x) { toast(x.message, 'err'); }
    };
  }
  function renderSettings() {
    $('#view').innerHTML = `<form id="fs" style="padding:16px;max-width:640px">
      <h3 style="margin:0">Счета</h3>
      <label for="sb">Стартовый виртуальный баланс (новые счета и сброс), $</label><input id="sb" type="number" min="0" step="1" value="${esc(cfg.start_balance)}">
      <div class="grid2" style="gap:8px"><div><label for="sdl">Плечо по умолчанию</label>${levSel(+cfg.default_leverage, 'sdl')}</div><div><label for="sml">Максимальное плечо для пользователей</label>${levSel(+cfg.max_leverage, 'sml')}</div>
      <div><label for="smc">Маржин-колл, % уровня маржи</label><input id="smc" type="number" min="0" value="${esc(cfg.margin_call)}"></div><div><label for="sso">Стоп-аут, % уровня маржи</label><input id="sso" type="number" min="0" max="100" value="${esc(cfg.stop_out)}"></div></div>
      <h3 style="margin:22px 0 0">Регистрация</h3>
      <label class="check"><input type="checkbox" id="so" ${cfg.registration_open === '1' ? 'checked' : ''}><span>Открытая регистрация на сайте</span></label>
      <label class="check"><input type="checkbox" id="si" ${cfg.invite_required === '1' ? 'checked' : ''}><span>Регистрация только по коду ментора</span></label>
      <h3 style="margin:22px 0 0">Роботы</h3>
      <label class="check"><input type="checkbox" id="sbe" ${cfg.bots_enabled === '1' ? 'checked' : ''}><span>Роботы включены (при выключении все работающие роботы остановятся)</span></label>
      <label for="smb">Макс. роботов на пользователя</label><input id="smb" type="number" min="0" max="100" value="${esc(cfg.max_bots)}">
      <button class="btn pri" style="margin-top:16px">Сохранить</button></form>`;
    $('#fs').onsubmit = async e => {
      e.preventDefault();
      try { await api('/api/admin/settings', { start_balance: +$('#sb').value, default_leverage: +$('#sdl').value, max_leverage: +$('#sml').value, margin_call: +$('#smc').value, stop_out: +$('#sso').value,
        registration_open: $('#so').checked, invite_required: $('#si').checked, bots_enabled: $('#sbe').checked, max_bots: +$('#smb').value });
        cfg = await api('/api/admin/settings'); toast('Настройки сохранены', 'ok'); } catch (x) { toast(x.message, 'err'); }
    };
  }
  function show() {
    renderTabs(); $('#title').textContent = isAdmin() ? 'Управление платформой' : 'Мои ученики';
    const run = { users: renderUsers, bots: renderBots, instruments: renderInstruments, feeds: renderFeeds, ledger: renderLedger, create: renderCreate, settings: renderSettings }[tab];
    $('#view').onclick = viewClick;
    Promise.resolve(run()).catch(x => toast(x.message, 'err'));
  }
  async function viewClick(e) {
    const r = e.target.closest('[data-u]'); if (r) return openUser(+r.dataset.u);
    const l = e.target.closest('[data-blog]'); if (l) return botLog(+l.dataset.blog).catch(x => toast(x.message, 'err'));
    const s = e.target.closest('[data-bstop]'); if (s) { try { await api(`/api/staff/bots/${s.dataset.bstop}/stop`, {}); toast('Робот остановлен', 'ok'); if (cur) openUser(cur); else renderBots(); } catch (x) { toast(x.message, 'err'); } }
  }

  // --- карточка пользователя ---
  async function openUser(id) {
    cur = id; $('#modal').hidden = false; $('#mbody').innerHTML = '<div class="empty">Загрузка…</div>';
    try { renderUser(await api('/api/staff/users/' + id)); } catch (x) { toast(x.message, 'err'); closeModal(); }
  }
  const closeModal = () => { $('#modal').hidden = true; cur = null; };
  function renderUser(d) {
    const u = d.user, a = d.account, result = a.equity - d.deposits;
    const posT = a.positions.length ? `<div class="scroll"><table><thead><tr><th>#</th><th>Символ</th><th>Тип</th><th class="r">Объём</th><th class="r">Открытие</th><th class="r">Текущая</th><th class="r">S/L</th><th class="r">T/P</th><th class="r">Прибыль</th><th>Робот</th></tr></thead><tbody>` +
      a.positions.map(p => `<tr><td class="mute">${p.id}</td><td><b>${esc(p.symbol)}</b></td><td>${sideLbl(p.side)}</td><td class="r">${lotsFmt(p.lots)}</td><td class="r">${fpx(p.entry, p.digits)}</td><td class="r">${fpx(p.price, p.digits)}</td><td class="r">${fpx(p.sl, p.digits)}</td><td class="r">${fpx(p.tp, p.digits)}</td><td class="r ${cls(p.pnl)}">${sgn(p.pnl)}</td><td>${p.bot_id ? esc(p.comment || '#' + p.bot_id) : ''}</td></tr>`).join('') + '</tbody></table></div>' : '<p class="mute">Нет открытых позиций</p>';
    const ordT = d.orders.length ? `<div class="scroll"><table><thead><tr><th>#</th><th>Символ</th><th>Тип</th><th class="r">Объём</th><th class="r">Цена</th><th class="r">S/L</th><th class="r">T/P</th></tr></thead><tbody>` +
      d.orders.map(o => `<tr><td class="mute">${o.id}</td><td><b>${esc(o.symbol)}</b></td><td>${OTYPE[o.type]}</td><td class="r">${lotsFmt(o.lots)}</td><td class="r">${fpx(o.price, o.digits)}</td><td class="r">${fpx(o.sl, o.digits)}</td><td class="r">${fpx(o.tp, o.digits)}</td></tr>`).join('') + '</tbody></table></div>' : '<p class="mute">Нет ордеров</p>';
    const real = d.deals.filter(x => x.reason !== 'reset'), wins = real.filter(x => x.pnl - x.comm > 0).length;
    const dealT = d.deals.length ? `<div class="scroll" style="max-height:280px"><table><thead><tr><th>Закрыта</th><th>Символ</th><th>Тип</th><th class="r">Объём</th><th class="r">Открытие</th><th class="r">Закрытие</th><th class="r">Прибыль</th><th>Причина</th></tr></thead><tbody>` +
      d.deals.map(x => `<tr><td class="mute">${dt(x.closed_at)}</td><td><b>${esc(x.symbol)}</b></td><td>${sideLbl(x.side)}</td><td class="r">${lotsFmt(x.lots)}</td><td class="r">${fpx(x.entry, x.digits)}</td><td class="r">${fpx(x.exit, x.digits)}</td><td class="r ${cls(x.pnl - x.comm)}">${sgn(x.pnl - x.comm)}</td><td>${esc(REASON[x.reason] || x.reason || '')}</td></tr>`).join('') + '</tbody></table></div>' : '<p class="mute">Сделок пока нет</p>';
    const botT = d.bots.length ? `<table><thead><tr><th>Робот</th><th>Инструмент</th><th>Статус</th><th class="r">Результат</th><th class="r">Сделок</th><th></th></tr></thead><tbody>` +
      d.bots.map(b => `<tr><td><b>${esc(b.name)}</b></td><td>${esc(b.symbol)} · ${b.tf}</td><td class="${b.status === 'running' ? 'up' : b.status === 'error' ? 'down' : 'mute'}">${{ running: 'работает', stopped: 'остановлен', error: 'ошибка' }[b.status]}</td><td class="r ${cls(b.total)}">${sgn(b.total)}</td><td class="r">${b.deals}</td>
        <td><div class="row"><button class="btn sm" data-blog="${b.id}">Журнал и код</button>${b.status === 'running' ? `<button class="btn sm down" data-bstop="${b.id}">Стоп</button>` : ''}</div></td></tr>`).join('') + '</tbody></table>' : '<p class="mute">Роботов нет</p>';
    const ledT = `<div class="scroll" style="max-height:220px"><table><thead><tr><th>Дата</th><th>Тип</th><th class="r">Сумма</th><th>Комментарий</th><th>Кто</th></tr></thead><tbody>` +
      d.ledger.map(l => `<tr><td class="mute">${dt(l.created_at)}</td><td>${esc(LTYPE[l.type] || l.type)}</td><td class="r ${cls(l.amount)}">${sgn(l.amount)}</td><td>${esc(l.comment)}</td><td class="mute">${esc(l.by_name || 'система')}</td></tr>`).join('') + '</tbody></table></div>';

    $('#mbody').innerHTML = `
      <div class="mhead"><div><h2>${esc(u.name)} ${u.blocked ? '<span class="pill blk">заблокирован</span>' : ''}</h2><div class="mute">${esc(u.email)} · ${ROLE[u.role]} · ментор: ${esc(u.mentor_name || '—')} · плечо 1:${u.leverage} · с ${dt(u.created_at)}</div></div><button class="btn" id="mx">Закрыть</button></div>
      <div class="stats">
        <div class="box"><small>Баланс</small><b>${usd(a.balance)}</b></div><div class="box"><small>Эквити</small><b>${usd(a.equity)}</b></div>
        <div class="box"><small>Уровень маржи</small><b>${a.level === null ? '—' : num(a.level, 0) + '%'}</b></div>
        <div class="box"><small>Результат торговли</small><b class="${cls(result)}">${sgn(result)}</b></div>
        <div class="box"><small>Прибыльных сделок</small><b>${real.length ? Math.round(wins / real.length * 100) + '%' : '—'}</b><small>${wins} из ${real.length}</small></div>
      </div>
      <div class="grid2">
        ${isAdmin() ? `<div class="box"><h3>Виртуальный баланс</h3><p class="mute" style="margin:0 0 8px;font-size:13px">Начисление или списание учебных средств. Каждая операция видна ученику и не считается прибылью от торговли.</p>
          <div class="adj"><input id="aa" type="number" step="any" placeholder="Сумма, $" inputmode="decimal"><input id="ac" maxlength="200" placeholder="Комментарий (виден ученику)"></div>
          <div class="presets">${[1000, 5000, 10000, 50000].map(v => `<button class="btn sm" data-pre="${v}">${num(v, 0)}</button>`).join('')}</div>
          <div class="row" style="margin-top:10px"><button class="btn up" id="aPlus">Начислить</button><button class="btn down" id="aMinus">Списать</button></div></div>` : ''}
        <div class="box"><h3>Сброс счёта</h3><p class="mute" style="margin:0 0 8px;font-size:13px">Останавливает роботов, снимает позиции и ордера без результата, возвращает баланс к стартовому ${usd(+(cfg?.start_balance ?? 0), 0)}. История сохраняется.</p>
          <button class="btn" id="rs">Сбросить счёт</button><div id="rsc"></div></div>
        ${isAdmin() ? `<div class="box"><h3>Профиль и доступ</h3>
          <label for="un">Имя</label><input id="un" value="${esc(u.name)}" maxlength="40">
          <div class="grid2" style="gap:8px"><div><label for="ur">Роль</label>${roleSel(u.role, 'ur')}</div><div><label for="ul">Плечо</label>${levSel(u.leverage, 'ul')}</div></div>
          <label for="um">Ментор</label>${mentorSel(u.mentor_id, 'um', u.id)}
          <label for="up">Новый пароль <span class="mute">(пусто — не менять)</span></label><input id="up" type="text" autocomplete="off">
          <label class="check"><input type="checkbox" id="ub" ${u.blocked ? 'checked' : ''}><span>Заблокировать вход (роботы остановятся)</span></label>
          <button class="btn pri" id="us">Сохранить</button>
          ${u.role !== 'student' ? `<div class="invite" style="margin-top:12px"><span class="mute">Код ментора:</span><code>${esc(u.invite_code || '—')}</code><button class="btn sm" id="ui">Новый код</button></div>` : ''}</div>` : ''}
      </div>
      <div class="sec"><h3>Открытые позиции</h3>${posT}</div>
      <div class="sec"><h3>Отложенные ордера</h3>${ordT}</div>
      <div class="sec"><h3>Роботы</h3>${botT}</div>
      <div class="sec"><h3>История сделок</h3>${dealT}</div>
      <div class="sec"><h3>Операции по счёту</h3>${ledT}</div>`;
    $('#mx').onclick = closeModal;
    $('#mbody').onclick = viewClick;
    $('#rs').onclick = () => {
      $('#rsc').innerHTML = `<div class="confirm">Сбросить счёт ${esc(u.name)}? <button class="btn sm down" id="rsy">Да, сбросить</button><button class="btn sm" id="rsn">Отмена</button></div>`;
      $('#rsn').onclick = () => $('#rsc').innerHTML = '';
      $('#rsy').onclick = async () => { try { await api(`/api/staff/users/${u.id}/reset`, {}); toast('Счёт сброшен', 'ok'); refreshAll(); } catch (x) { toast(x.message, 'err'); } };
    };
    if (!isAdmin()) return;
    $$('[data-pre]').forEach(b => b.onclick = () => $('#aa').value = b.dataset.pre);
    const adj = async s => {
      const v = Math.abs(+$('#aa').value); if (!v) return toast('Укажите сумму', 'err');
      try { await api(`/api/admin/users/${u.id}/adjust`, { amount: s * v, comment: $('#ac').value }); toast((s > 0 ? 'Начислено ' : 'Списано ') + usd(v), 'ok'); refreshAll(); } catch (x) { toast(x.message, 'err'); }
    };
    $('#aPlus').onclick = () => adj(1); $('#aMinus').onclick = () => adj(-1);
    $('#us').onclick = async () => {
      try { await api(`/api/admin/users/${u.id}/update`, { name: $('#un').value, role: $('#ur').value, leverage: +$('#ul').value, mentor_id: $('#um').value || null, blocked: $('#ub').checked, password: $('#up').value || undefined });
        toast('Сохранено', 'ok'); refreshAll(); } catch (x) { toast(x.message, 'err'); }
    };
    const ui = $('#ui'); if (ui) ui.onclick = async () => { try { await api(`/api/admin/users/${u.id}/invite`, {}); toast('Код обновлён', 'ok'); refreshAll(); } catch (x) { toast(x.message, 'err'); } };
  }
  async function refreshAll() { await loadUsers(); if (cur) openUser(cur); }

  $('#tabs').onclick = e => { const b = e.target.closest('[data-t]'); if (b) { tab = b.dataset.t; show(); } };
  $('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

  (async () => {
    me = await api('/api/me');
    if (me.role === 'student') { location.href = '/app'; return; }
    leverages = [1, 2, 5, 10, 20, 30, 50, 100, 200, 300, 400, 500, 1000];
    const c = await api('/api/config'); $('#pname').textContent = c.name; document.title = c.name + ' · Панель (демо)';
    cfg = isAdmin() ? await api('/api/admin/settings') : { start_balance: c.startBalance };
    $('#uName').textContent = me.name; $('#uRole').textContent = ROLE[me.role];
    renderInvite(); await loadUsers(); show();
    setInterval(() => { if (tab === 'users' && document.activeElement?.id !== 'q' && $('#modal').hidden) loadUsers().catch(() => {}); }, 10000);
  })().catch(x => toast(x.message, 'err'));
}
