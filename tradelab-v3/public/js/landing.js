'use strict';
{
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  let DATA = [], prevPx = {};
  const fmt = (v, d) => num(v, d);

  // --- камера въезжает в табло ---
  const zoom = $('#zoom'), cam = $('#cam'), scenes = $$('.scene'), dots = $$('#prog i'), bo = $('#blackout'), hint = $('#hint');
  let P = 0, lastY = scrollY, vel = 0;
  function onScroll() {
    const r = zoom.getBoundingClientRect(), total = zoom.offsetHeight - innerHeight;
    P = clamp(-r.top / total);
    vel = Math.min(60, Math.abs(scrollY - lastY)); lastY = scrollY;
    if (RM) { scenes.forEach((s, i) => { s.style.opacity = i === 0 ? 1 : 0; s.classList.toggle('on', i === 0); }); return; }
    const e = ease(P);
    cam.style.transform = `scale(${1 + e * 3.4}) translateY(${e * 2}%)`;
    cam.style.filter = `brightness(${.72 + e * .35}) saturate(${1 + e * .3}) blur(${Math.max(0, (P - .82) * 22)}px)`;
    const s = P * 4;
    scenes.forEach((el, i) => {
      const l = s - i;
      let o = i === 0 ? clamp(1 - (l - .55) / .3) : l < 0 ? 0 : l < .25 ? l / .25 : l < .7 ? 1 : clamp(1 - (l - .7) / .25);
      if (i === 3 && l >= .7) o = clamp(1 - (P - .9) / .08);
      el.style.opacity = o; el.classList.toggle('on', o > .5);
      el.style.transform = `translateY(${(i === 0 ? -l : .4 - l) * 50}px) scale(${.96 + o * .04})`;
    });
    bo.style.opacity = clamp((P - .94) / .06);
    dots.forEach((d, i) => d.classList.toggle('on', Math.min(3, Math.floor(s)) === i));
    hint.style.opacity = clamp(1 - P * 25);
  }
  addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onScroll); onScroll();

  // --- летящие навстречу котировки ---
  const cv = $('#fx'), cx = cv.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  const resize = () => { DPR = Math.min(2, devicePixelRatio || 1); W = cv.clientWidth; H = cv.clientHeight; cv.width = W * DPR; cv.height = H * DPR; cx.setTransform(DPR, 0, 0, DPR, 0, 0); };
  new ResizeObserver(resize).observe(cv); resize();
  const SAMPLE = ['BTC 95 214.80 +1.24%', 'AAPL 228.41 −0.31%', 'EURUSD 1.05012', 'NVDA 141.07 +2.10%', 'XAU 2 651.3', 'US500 6 012.4 +0.42%', 'ETH 3 402.15', 'TSLA 341.9 −1.05%'];
  const label = () => { if (!DATA.length) return [SAMPLE[Math.random() * SAMPLE.length | 0], Math.random() > .45]; const d = DATA[Math.random() * DATA.length | 0]; return [`${d.sym} ${fmt(d.last, d.digits)} ${pct(d.chg)}`, d.chg >= 0]; };
  const parts = Array.from({ length: 46 }, () => spawn(true));
  function spawn(init) { const [t, up] = label(); return { x: (Math.random() - .5) * 2.4, y: (Math.random() - .5) * 1.5, z: init ? .15 + Math.random() * 1.2 : 1.35, t, up }; }
  function frame() {
    cx.clearRect(0, 0, W, H);
    if (P < .99) {
      const sp = .0016 + vel * .00045 + P * .0035; vel *= .92;
      const fade = clamp(1 - (P - .85) / .12);
      for (let k = 0; k < parts.length; k++) {
        const p = parts[k]; p.z -= sp * (RM ? 0 : 1);
        if (p.z < .06) { parts[k] = spawn(false); continue; }
        const sx = W / 2 + p.x / p.z * W * .32, sy = H / 2 + p.y / p.z * H * .32;
        if (sx < -300 || sx > W + 300 || sy < -100 || sy > H + 100) { parts[k] = spawn(false); continue; }
        const dx = (sx - W / 2) / W, dy = (sy - H / 2) / H, mask = clamp((Math.hypot(dx, dy * 1.4) - .12) / .3);
        const a = clamp((1.35 - p.z) * 1.1) * clamp(p.z * 4) * .6 * fade * mask, size = clamp(10 / p.z, 9, 44);
        cx.font = `600 ${size}px "JetBrains Mono", monospace`;
        cx.fillStyle = p.up ? `rgba(80,230,170,${a})` : `rgba(255,140,90,${a})`;
        cx.shadowColor = p.up ? 'rgba(31,194,126,.6)' : 'rgba(240,120,60,.6)'; cx.shadowBlur = size * .5;
        cx.fillText(p.t, sx, sy);
      }
      cx.shadowBlur = 0;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // --- живые данные ---
  const CAT = { stocks: 'Акции', indices: 'Индекс', futures: 'Фьючерс', forex: 'Форекс', crypto: 'Крипта' };
  const sparkPath = (a, w = 240, h = 54) => { if (a.length < 2) return ''; const mn = Math.min(...a), mx = Math.max(...a), r = mx - mn || 1;
    return a.map((v, i) => `${i ? 'L' : 'M'}${(i / (a.length - 1) * w).toFixed(1)},${(h - 4 - (v - mn) / r * (h - 8)).toFixed(1)}`).join(''); };
  const pillCls = v => v > .005 ? 'up' : v < -.005 ? 'down' : 'flat';
  function buildCards() {
    $('#cards').innerHTML = DATA.map(d => `<a class="mk" href="${document.body.classList.contains('auth') ? '/app' : '#join'}" data-s="${esc(d.sym)}">
      <div class="mtop"><div><div class="sym">${esc(d.sym)}</div><div class="nm">${esc(d.name)}</div></div><span class="pill" data-c></span></div>
      <div class="px" data-p></div><div class="st"><span class="dot ${d.open ? '' : 'off'}"></span>${CAT[d.cat] || ''} · ${d.open ? 'рынок открыт' : 'рынок закрыт'}</div>
      <svg viewBox="0 0 240 54" preserveAspectRatio="none"><defs><linearGradient id="g${esc(d.sym)}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-opacity=".35"/><stop offset="1" stop-opacity="0"/></linearGradient></defs><path data-a fill="url(#g${esc(d.sym)})"/><path data-l fill="none" stroke-width="1.6"/></svg></a>`).join('');
    const ch = DATA.slice(0, 10).map(d => `<span class="chip"><b>${esc(d.sym)}</b><span data-cc="${esc(d.sym)}"></span></span>`).join('');
    $('#chips').innerHTML = ch; $('#chips2').innerHTML = ch;
    const t = DATA.map(d => `<span><b>${esc(d.sym)}</b><span data-tp="${esc(d.sym)}"></span> <span data-tc="${esc(d.sym)}"></span></span>`).join('');
    $('#tape').innerHTML = t + t;
  }
  function paint() {
    for (const d of DATA) {
      const card = document.querySelector(`.mk[data-s="${CSS.escape(d.sym)}"]`);
      const col = d.chg >= 0 ? '#1fc27e' : '#f04b5c', p = pillCls(d.chg);
      if (card) {
        const px = card.querySelector('[data-p]'), pv = prevPx[d.sym];
        px.textContent = fmt(d.last, d.digits);
        if (pv !== undefined && pv !== d.last) { px.classList.remove('fu', 'fd'); void px.offsetWidth; px.classList.add(d.last > pv ? 'fu' : 'fd'); setTimeout(() => px.classList.remove('fu', 'fd'), 700); }
        const c = card.querySelector('[data-c]'); c.textContent = pct(d.chg); c.className = 'pill ' + p;
        const path = sparkPath(d.spark.length ? d.spark : [d.last, d.last]);
        card.querySelector('[data-l]').setAttribute('d', path); card.querySelector('[data-l]').setAttribute('stroke', col);
        card.querySelector('[data-a]').setAttribute('d', path ? path + 'L240,54L0,54Z' : '');
        card.querySelectorAll('stop').forEach(s => s.setAttribute('stop-color', col));
      }
      for (const el of $$(`[data-cc="${CSS.escape(d.sym)}"]`)) { el.textContent = pct(d.chg); el.className = cls(d.chg); }
      for (const el of $$(`[data-tp="${CSS.escape(d.sym)}"]`)) el.textContent = fmt(d.last, d.digits);
      for (const el of $$(`[data-tc="${CSS.escape(d.sym)}"]`)) { el.textContent = pct(d.chg); el.className = cls(d.chg); }
      prevPx[d.sym] = d.last;
    }
  }
  async function pull() {
    try { const a = await api('/api/public/ticker'); const first = !DATA.length || a.length !== DATA.length; DATA = a; if (first) buildCards(); paint(); } catch {}
  }
  pull(); setInterval(pull, 2500);
  $('#cards').addEventListener('click', e => { const c = e.target.closest('.mk'); if (c && document.body.classList.contains('auth')) store.set('sel', c.dataset.s); });

  // --- параллакс фоновой полосы ---
  const bg = $('#bandBg');
  addEventListener('scroll', () => { if (RM) return; const r = bg.parentElement.getBoundingClientRect(); bg.style.transform = `translateY(${(r.top + r.height / 2 - innerHeight / 2) * -.12}px) scale(1.08)`; }, { passive: true });

  // --- вкладки входа и данные компании ---
  for (const a of $$('[data-tab]')) a.addEventListener('click', () => { const reg = a.dataset.tab === 'reg'; setTimeout(() => (reg ? $('#tReg') : $('#tLogin'))?.click(), 50); });
  api('/api/config').then(c => {
    $$('.pname').forEach(e => e.textContent = c.name);
    $('#rStartBig').textContent = usd(c.startBalance, 0);
    const co = c.company || {}, li = [];
    if (co.name) li.push(`<li style="color:#c9d2df;font-weight:600">${esc(co.name)}</li>`);
    if (co.reg) li.push(`<li>Регистрационный код: ${esc(co.reg)}</li>`);
    if (co.address) li.push(`<li>${esc(co.address)}</li>`);
    if (co.email) li.push(`<li><a href="mailto:${esc(co.email)}">${esc(co.email)}</a></li>`);
    if (li.length) $('#coInfo').innerHTML = li.join('');
  }).catch(() => {});
}
