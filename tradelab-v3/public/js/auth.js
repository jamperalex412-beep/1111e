'use strict';
{
  const go = () => location.href = '/app';
  fetch('/api/me', { credentials: 'same-origin' }).then(r => { if (r.ok) document.body.classList.add('auth'); }).catch(() => {});

  const show = reg => { $('#fLogin').hidden = reg; $('#fReg').hidden = !reg; $('#tLogin').classList.toggle('on', !reg); $('#tReg').classList.toggle('on', reg); };
  $('#tLogin').onclick = () => show(false); $('#tReg').onclick = () => show(true);
  $$('[data-eye]').forEach(b => b.onclick = () => { const i = document.getElementById(b.dataset.eye); i.type = i.type === 'password' ? 'text' : 'password'; b.textContent = i.type === 'password' ? 'Показать' : 'Скрыть'; });

  const inv = new URLSearchParams(location.search).get('invite');
  if (inv) { $('#ri').value = inv.toUpperCase().slice(0, 16); show(true); setTimeout(() => $('#join')?.scrollIntoView(), 300); }

  api('/api/config').then(c => {
    document.title = c.name + ' · Учебная торговая платформа';
    $('#rStart').textContent = 'Стартовый виртуальный баланс: ' + usd(c.startBalance, 0);
    if (c.inviteRequired) $('#riOpt').textContent = '(обязательно)';
    if (!c.registrationOpen) { $('#fReg').innerHTML = '<p class="mute">Регистрация сейчас закрыта. Попросите ментора создать для вас аккаунт.</p>'; }
  }).catch(() => {});

  $('#rp').addEventListener('input', e => {
    const v = e.target.value; let s = 0;
    if (v.length >= 8) s++; if (v.length >= 12) s++; if (/\d/.test(v) && /[A-Za-zА-Яа-я]/.test(v)) s++; if (/[A-ZА-Я]/.test(v) && /[a-zа-я]/.test(v)) s++; if (/[^\w\s]/.test(v)) s++;
    const c = ['#f04b5c', '#f04b5c', '#f2b134', '#f2b134', '#1fc27e', '#1fc27e'][s];
    $('#pm').style.cssText = `width:${s * 20}%;background:${c}`;
    $('#ph').textContent = ['От 8 символов, буквы и цифры', 'Слабый', 'Средний', 'Хороший', 'Надёжный', 'Очень надёжный'][s];
  });
  $('#fLogin').onsubmit = async e => {
    e.preventDefault(); const b = e.submitter; b.disabled = true; $('#lErr').textContent = '';
    try { await api('/api/login', { email: $('#le').value, password: $('#lp').value }); go(); }
    catch (x) { $('#lErr').textContent = x.message; } finally { b.disabled = false; }
  };
  $('#fReg').onsubmit = async e => {
    e.preventDefault(); const er = $('#rErr'); er.textContent = '';
    if ($('#rp').value !== $('#rp2').value) return er.textContent = 'Пароли не совпадают';
    if (!$('#rt').checked) return er.textContent = 'Отметьте, что понимаете условия демо-счёта';
    const b = e.submitter; b.disabled = true;
    try { await api('/api/register', { name: $('#rn').value, email: $('#re').value, password: $('#rp').value, invite: $('#ri').value, terms: true }); go(); }
    catch (x) { er.textContent = x.message; } finally { b.disabled = false; }
  };
}
