'use strict';
/* =====================================================================
   ERASMUS RUN – stavbárska denná hra (štýl Ponor / Krillion)
   Kolo = 5 výziev. Čím vzácnejšia správna odpoveď, tým hlbšie kopeš.
   ===================================================================== */
const RUN_TIER_M = [3, 8, 15];
const RUN_UNIQUE = 5;
const RUN_SECS = 20;
const TIER_NAME = ['Povrch', 'Základy', 'Skalné podložie'];
const TIER_DESC = ['bežná odpoveď', 'menej známa odpoveď', 'vzácna odpoveď 💎'];
const TIER_SQ = ['🟫', '🟧', '💎'];
const RUN_URL = APP_URL + '?run';

let RUN_EXTRA = {};
let runState = null;
let runMine = {};
let runAll = null;
let runView = 'home';
let runPoll = null, runTick = null;
let runNick = LS.get('erasmus.run.nick', '');
let runPid = LS.get('erasmus.run.pid', null);
if (!runPid) { runPid = (crypto.randomUUID ? crypto.randomUUID() : 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12)); LS.set('erasmus.run.pid', runPid); }

/* ---------------- Vyhodnocovanie odpovedí (bez AI) ---------------- */
function rn(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
const RIDX = [];
function ridx(pi) {
  if (RIDX[pi]) return RIDX[pi];
  const m = new Map(), P = window.RUN_PROMPTS && window.RUN_PROMPTS[pi];
  if (P) for (const a of P.a) {
    const v = { canon: a[0], tier: a[1] };
    [a[0], ...a.slice(2)].forEach(al => {
      const k = rn(al); if (!k) return;
      if (!m.has(k)) m.set(k, v);
      const k2 = k.replace(/ /g, ''); if (!m.has(k2)) m.set(k2, v);
    });
  }
  return (RIDX[pi] = m);
}
function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const v = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) v[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = v[0]; v[0] = i; let rowMin = v[0];
    for (let j = 1; j <= b.length; j++) {
      const t = v[j];
      v[j] = Math.min(v[j] + 1, v[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t; if (v[j] < rowMin) rowMin = v[j];
    }
    if (rowMin > max) return max + 1;
  }
  return v[b.length];
}
const SUFFIX = /(ami|ach|ovi|och|ych|ich|ym|om|ou|mi|ov|ej|eho|emu|ho|y|i|e|a|u|o)$/;
function stem(w) { return w.length > 4 ? w.replace(SUFFIX, '') : w; }
function stemPhrase(s) { return s.split(' ').map(stem).join(' '); }
function runJudge(pi, ans) {
  const raw = String(ans || '').trim();
  const n = rn(raw);
  if (!n) return { valid: false, blank: true, norm: '' };
  const m = ridx(pi), ex = RUN_EXTRA[pi] || {};
  const ok = v => ({ valid: true, canon: v.canon, tier: v.tier, norm: n });
  const exOk = (k) => ({ valid: true, canon: raw, tier: ex[k], norm: n, extra: true, key: k });
  // 1) presná zhoda (aj bez medzier) alebo uznaná odpoveď
  let h = m.get(n) || m.get(n.replace(/ /g, ''));
  if (h) return ok(h);
  if (ex[n] != null) return exOk(n);
  // 2) iný tvar slova (betónom = betón, mosty = most)
  const ns = stemPhrase(n);
  for (const [k, v] of m) if (stemPhrase(k) === ns) return ok(v);
  for (const k in ex) if (stemPhrase(k) === ns) return exOk(k);
  // 3) preklepy
  let best = null, bd = 9;
  if (n.length >= 4) for (const [k, v] of m) {
    if (k.length < 4) continue;
    const lim = k.length <= 5 ? 1 : k.length <= 9 ? 2 : 3;
    if (Math.abs(k.length - n.length) > lim) continue;
    const d = lev(n, k, lim);
    if (d <= lim && d < bd) { bd = d; best = v; }
  }
  if (best) return ok(best);
  // 4) viac slov – odpoveď obsahuje známy pojem („betónová miešačka“ → miešačka)
  let cand = null;
  const padded = ' ' + n + ' ', paddedS = ' ' + ns + ' ';
  for (const [k, v] of m) {
    if (k.length < 4) continue;
    if (padded.includes(' ' + k + ' ') || paddedS.includes(' ' + stemPhrase(k) + ' ')) { if (!cand || k.length > cand.k.length) cand = { k, v }; }
  }
  if (cand) return ok(cand.v);
  // 5) jednotlivé slová s preklepom
  for (const t of n.split(' ')) {
    if (t.length < 5) continue;
    for (const [k, v] of m) {
      if (k.includes(' ') || k.length < 5) continue;
      if (stem(k) === stem(t) || lev(t, k, 1) <= 1) return ok(v);
    }
  }
  // 6) skrátený tvar („Brooklyn“ → Brooklynský most)
  for (const t of n.split(' ')) {
    if (t.length < 5) continue;
    for (const [k, v] of m) {
      for (const kt of k.split(' ')) {
        if (kt.length >= 6 && kt !== t && kt.startsWith(t) && kt.length - t.length <= 4) return ok(v);
      }
    }
  }
  for (const k in ex) if (k.length >= 4 && lev(n, k, 1) <= 1) return exOk(k);
  return { valid: false, norm: n };
}
function runScore(rows) {
  const groups = {}, perQ = {};
  rows.forEach(r => {
    r._j = runJudge((r.round - 1) * 5 + r.q, r.answer);
    const gk = r.round + ':' + r.q;
    perQ[gk] = (perQ[gk] || 0) + 1;
    if (r._j.valid) { const g = (groups[gk] = groups[gk] || {}); const k = rn(r._j.canon); g[k] = (g[k] || 0) + 1; }
  });
  rows.forEach(r => {
    const j = r._j, gk = r.round + ':' + r.q;
    if (!j.valid) { r._pts = 0; r._uni = false; return; }
    const c = groups[gk][rn(j.canon)];
    r._uni = c === 1 && perQ[gk] > 1;
    r._pts = RUN_TIER_M[j.tier] + (r._uni ? RUN_UNIQUE : 0);
  });
  const P = {};
  rows.forEach(r => { const p = (P[r.player_id] = P[r.player_id] || { pid: r.player_id, nick: r.nickname, total: 0, n: 0 }); p.total += r._pts; p.n++; p.nick = r.nickname; });
  return Object.values(P).sort((a, b) => b.total - a.total || a.nick.localeCompare(b.nick));
}

/* ---------------- Dáta ---------------- */
async function runFetch(build) {
  let all = [], from = 0;
  for (;;) {
    let q = sb.from('erasmus_run_answers').select('round,q,player_id,nickname,answer,created_at').order('created_at').range(from, from + 999);
    if (build) q = build(q);
    const { data, error } = await q;
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return all;
}
async function runLoadExtra() {
  const { data } = await sb.from('erasmus_run_extra').select('pidx,answer_norm,tier');
  RUN_EXTRA = {}; (data || []).forEach(e => { (RUN_EXTRA[e.pidx] = RUN_EXTRA[e.pidx] || {})[e.answer_norm] = e.tier; });
}
async function runLoadState() {
  const { data } = await sb.from('erasmus_run_state').select('*').eq('id', 1).maybeSingle();
  if (data) runState = data;
  return runState;
}
async function runLoadMine() {
  const { data } = await sb.from('erasmus_run_answers').select('round,q,answer').eq('player_id', runPid);
  runMine = {}; (data || []).forEach(r => { (runMine[r.round] = runMine[r.round] || {})[r.q] = r.answer; });
}
function todayStr(d = new Date()) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function runUnlocked() {
  if (!runState || !runState.start_date) return 0;
  const a = new Date(runState.start_date + 'T00:00:00'), b = new Date(todayStr() + 'T00:00:00');
  return Math.max(0, Math.min(50, Math.round((b - a) / 864e5) + 1));
}
const liveOn = () => runState && runState.status && runState.status !== 'off';
const pidxOf = (r, q) => (r - 1) * 5 + q;
const promptOf = (r, q) => (window.RUN_PROMPTS[pidxOf(r, q)] || { p: '?' }).p;
const meters = n => `${n} m`;

/* ---------------- Otvorenie / zatvorenie ---------------- */
async function openRun() {
  closeSheet && closeSheet();
  $('#run').classList.add('show'); document.body.style.overflow = 'hidden';
  runView = 'home'; runAll = null;
  $('#run').innerHTML = `<div class="rw">${rhead()}<div class="crane">🏗️</div><p style="text-align:center;opacity:.7">Načítavam…</p></div>`; bindHead();
  try { await Promise.all([runLoadState(), runLoadExtra(), runLoadMine()]); } catch (_) { toast('Hra potrebuje internet'); }
  if (liveOn()) runView = 'live';
  drawRun();
  clearInterval(runPoll);
  runPoll = setInterval(async () => {
    if (document.hidden || !$('#run').classList.contains('show')) return;
    const key = s => s ? [s.status, s.round, s.q, s.started_at, s.start_date].join('|') : '';
    const before = key(runState); await runLoadState(); const after = key(runState);
    if (before !== after) {
      if (liveOn() && (runView === 'home' || runView === 'live')) { runView = 'live'; drawRun(); }
      else if (!liveOn() && runView === 'live') { runView = 'home'; runAll = null; await runLoadMine(); drawRun(); }
      else if (runView === 'home') drawRun();
    }
  }, 1500);
}
function closeRun() {
  $('#run').classList.remove('show'); document.body.style.overflow = '';
  clearInterval(runPoll); clearInterval(runTick); runPoll = runTick = null;
  if (/[?&]run/.test(location.search)) history.replaceState(null, '', APP_URL);
}
function rhead() {
  return `<div class="hz"></div><div class="rtop"><button class="x" id="rx">✕</button>
    <div class="rlogo">ERASMUS <em>RUN</em><small>Stavbárska denná hra</small></div>
    ${runNick ? `<button class="rnick" id="rnk">👷 ${esc(runNick)}</button>` : ''}</div>`;
}
function bindHead() {
  $('#rx').onclick = closeRun;
  const k = $('#rnk'); if (k) k.onclick = () => { const v = prompt('Nová prezývka:', runNick); if (v && v.trim()) { runNick = v.trim().slice(0, 20); LS.set('erasmus.run.nick', runNick); drawRun(); } };
}
function rulesHtml() {
  return `<div class="rcard"><h3>Ako sa hrá</h3>
    <p>Dostaneš výzvu, napríklad „Stavebný stroj“. Napíš odpoveď, ktorá k nej sedí. <b>Čím vzácnejšia odpoveď, tým hlbšie kopeš.</b> Keď tvoju odpoveď nenapíše nikto iný, dostaneš bonus. Každý deň sa odomkne nové kolo s 5 výzvami.</p>
    <div class="rules"><div class="t0"><b>${RUN_TIER_M[0]} m</b>bežná</div><div class="t1"><b>${RUN_TIER_M[1]} m</b>menej známa</div><div class="t2"><b>${RUN_TIER_M[2]} m</b>vzácna 💎</div></div>
    <p style="margin-top:10px;font-size:13px">⭐ +${RUN_UNIQUE} m, ak odpoveď máš len ty · ⏱ ${RUN_SECS} s na výzvu · preklepy a diakritika nevadia</p></div>`;
}
function drawRun() {
  clearInterval(runTick);
  if (!runNick) return drawNick();
  if (runView === 'play') return drawPlay();
  if (runView === 'sum') return drawSum();
  if (runView === 'live' && liveOn()) return drawLive();
  runView = 'home'; drawHome();
}

/* ---------------- Prezývka ---------------- */
function drawNick() {
  $('#run').innerHTML = `<div class="rw">${rhead()}<div class="crane">🏗️</div>
    <div class="rcard"><h3>Ako ťa máme volať?</h3><p>Prezývka sa zobrazí v rebríčku aj na projektore.</p>
    <input class="rinp" id="rnI" maxlength="20" placeholder="napr. Betónový Jano" autocomplete="off">
    <button class="rbtn" id="rnGo">Ide sa kopať ⛏</button></div>${rulesHtml()}</div>`;
  bindHead();
  const go = () => { const v = $('#rnI').value.trim(); if (!v) return toast('Napíš prezývku 🙂'); runNick = v.slice(0, 20); LS.set('erasmus.run.nick', runNick); if (liveOn()) runView = 'live'; drawRun(); };
  $('#rnGo').onclick = go; $('#rnI').onkeydown = e => { if (e.key === 'Enter') go(); };
}

/* ---------------- Domov hry ---------------- */
let lbTab = 'today';
async function drawHome() {
  const U = runUnlocked();
  const mineDone = r => Object.keys(runMine[r] || {}).length;
  let today = '';
  if (!U) {
    today = `<div class="rcard"><div class="crane">🚧</div><h3 style="text-align:center">Štartujeme spolu na Mini Erasme</h3>
      <p style="text-align:center">Prvé kolo zahráme naživo s projektorom. Potom sa ti každý deň odomkne nové kolo s 5 výzvami – spolu ich je 250.</p></div>`;
  } else {
    const d = mineDone(U);
    today = d < 5
      ? `<div class="rcard"><div class="kicker" style="color:#FFC400">Dnešné kolo</div><h3>Kolo ${U} · 5 výziev</h3><p>${d ? `Máš hotové ${d}/5 – pokračuj!` : `${RUN_SECS} sekúnd na každú výzvu. Kopeme!`}</p>
         <button class="rbtn" id="rPlay">${d ? 'Pokračovať' : 'Začať kopať'} ⛏</button></div>`
      : `<div class="rcard"><div class="kicker" style="color:#FFC400">Dnešné kolo hotové ✅</div><h3>Kolo ${U}</h3>
         <p>Ďalšie kolo sa odomkne o <b id="rNext">–</b></p><button class="rbtn alt" id="rSum">Pozrieť výsledky</button></div>`;
  }
  const maxShow = Math.min(50, Math.max(U + 4, 5));
  const grid = U ? `<div class="rcard"><h3>Kolá</h3><p>Zmeškané kolá si môžeš dohrať kedykoľvek.</p><div class="rounds">${Array.from({ length: maxShow }, (_, i) => {
    const r = i + 1, done = mineDone(r) >= 5, lock = r > U;
    return `<button data-r="${r}" class="${lock ? 'lock' : done ? 'done' : r === U ? 'today' : ''}" ${lock ? 'disabled' : ''}>${lock ? '🔒' : r}<small>${lock ? '' : done ? '✓' : r === U ? 'dnes' : ''}</small></button>`;
  }).join('')}</div></div>` : '';
  $('#run').innerHTML = `<div class="rw">${rhead()}
    ${liveOn() ? `<button class="live-b" id="rLive"><i></i><div><b>Hra naživo práve beží!</b><span>Ťukni a pripoj sa ku kolu ${runState.round}</span></div></button>` : ''}
    ${today}${grid}
    <div class="rcard"><h3>Rebríček</h3>
      <div class="rseg"><button data-lb="today" class="${lbTab === 'today' ? 'on' : ''}">${U ? 'Kolo ' + U : 'Dnes'}</button><button data-lb="all" class="${lbTab === 'all' ? 'on' : ''}">Celkovo</button></div>
      <div class="lb" id="rLb"><div style="opacity:.6">Načítavam…</div></div></div>
    ${rulesHtml()}</div>`;
  bindHead();
  const p = $('#rPlay'); if (p) p.onclick = () => startRound(U);
  const s = $('#rSum'); if (s) s.onclick = () => { runView = 'sum'; sumRound = U; drawRun(); };
  const l = $('#rLive'); if (l) l.onclick = () => { runView = 'live'; drawRun(); };
  document.querySelectorAll('#run [data-r]').forEach(b => b.onclick = () => {
    const r = +b.dataset.r; if (mineDone(r) >= 5) { runView = 'sum'; sumRound = r; drawRun(); } else startRound(r);
  });
  document.querySelectorAll('#run [data-lb]').forEach(b => b.onclick = () => { lbTab = b.dataset.lb; drawHome(); });
  const nx = $('#rNext');
  if (nx) { const t = () => { const d = new Date(); d.setHours(24, 0, 0, 0); let ms = d - Date.now(); const h = Math.floor(ms / 36e5); ms -= h * 36e5; const m = Math.floor(ms / 6e4); const s2 = Math.floor((ms - m * 6e4) / 1000); nx.textContent = `${h} h ${String(m).padStart(2, '0')} min ${String(s2).padStart(2, '0')} s`; }; t(); runTick = setInterval(t, 1000); }
  try {
    if (!runAll) { await runLoadExtra(); runAll = await runFetch(); }
    const rows = lbTab === 'today' && U ? runAll.filter(r => r.round === U) : runAll.slice();
    const board = runScore(rows.map(r => ({ ...r })));
    const box = $('#rLb'); if (!box) return;
    box.innerHTML = board.length ? board.slice(0, 15).map((p, i) => `<div class="${i < 3 ? 'p' + (i + 1) : ''} ${p.pid === runPid ? 'me' : ''}"><span class="n">${i + 1}</span><b>${esc(p.nick)}</b><em>${meters(p.total)}</em></div>`).join('')
      + (board.findIndex(p => p.pid === runPid) >= 15 ? `<div class="me"><span class="n">${board.findIndex(p => p.pid === runPid) + 1}</span><b>${esc(runNick)}</b><em>${meters(board.find(p => p.pid === runPid).total)}</em></div>` : '')
      : '<div style="opacity:.6">Zatiaľ nikto nekopal. Buď prvý! ⛏</div>';
  } catch (_) { const box = $('#rLb'); if (box) box.innerHTML = '<div style="opacity:.6">Rebríček potrebuje internet.</div>'; }
}

/* ---------------- Hranie kola ---------------- */
let playRound = 1, playQ = 0, playRes = null, playDeadline = 0, sumRound = 1;
function nextQ(r) { const m = runMine[r] || {}; for (let q = 0; q < 5; q++) if (!(q in m)) return q; return null; }
function startRound(r) {
  playRound = r; playQ = nextQ(r);
  if (playQ == null) { runView = 'sum'; sumRound = r; return drawRun(); }
  runView = 'play'; playRes = null; playDeadline = Date.now() + RUN_SECS * 1000; drawRun();
}
function digHtml(j, pts) {
  const pct = j.valid ? [24, 50, 86][j.tier] : 5;
  return `<div class="dig"><span class="lbl" style="top:2%">Povrch</span><span class="lbl" style="top:33%">Základy</span><span class="lbl" style="top:78%">Skalné podložie</span>
    <div class="shaft" data-h="${pct}"></div><div class="bit" data-t="${pct}">${j.valid ? (j.tier === 2 ? '💎' : '⛏️') : '🤷'}</div>
    <div class="m">${j.valid ? '−' + pts + ' m' : '0 m'}</div></div>`;
}
function animateDig() {
  requestAnimationFrame(() => setTimeout(() => {
    document.querySelectorAll('#run .shaft, #host .shaft').forEach(e => e.style.height = e.dataset.h + '%');
    document.querySelectorAll('#run .bit, #host .bit').forEach(e => e.style.top = e.dataset.t + '%');
  }, 60));
}
function verdictHtml(j) {
  if (j.blank) return `<div class="verdict-r">⏰ Čas vypršal<small>Za túto výzvu 0 m.</small></div>`;
  if (!j.valid) return `<div class="verdict-r">🤔 Túto odpoveď nepoznáme<small>Ak je správna, organizátor ju môže uznať a body sa ti pripočítajú.</small></div>`;
  return `<div class="verdict-r">${esc(j.canon)} · ${TIER_NAME[j.tier]}<small>${TIER_DESC[j.tier]} · ${RUN_TIER_M[j.tier]} m${j.tier === 2 ? ' – výborne!' : ''}</small></div>`;
}
function drawPlay() {
  const r = playRound, q = playQ, pi = pidxOf(r, q);
  const dots = Array.from({ length: 5 }, (_, i) => `<i style="flex:1;height:6px;border-radius:3px;background:${i < q || (i === q && playRes) ? '#FFC400' : 'rgba(255,255,255,.15)'}"></i>`).join('');
  $('#run').innerHTML = `<div class="rw">${rhead()}
    <div style="display:flex;gap:6px">${dots}</div>
    <div class="pq"><div class="k">KOLO ${r} · VÝZVA ${q + 1}/5</div><h2>${esc(promptOf(r, q))}</h2></div>
    ${playRes ? `${digHtml(playRes, playRes.valid ? RUN_TIER_M[playRes.tier] : 0)}${verdictHtml(playRes)}
      <button class="rbtn" id="rNextQ">${nextQ(r) == null ? 'Výsledky kola 🏁' : 'Ďalšia výzva →'}</button>`
    : `<input class="rinp" id="rAns" maxlength="60" placeholder="Tvoja odpoveď…" autocomplete="off" autocapitalize="off" enterkeyhint="go">
      <div class="tbar"><i id="rBar"></i></div><div class="tinfo"><span>Kopeš hlbšie so vzácnou odpoveďou</span><span id="rSec">${RUN_SECS} s</span></div>
      <button class="rbtn" id="rDig">Kopať ⛏</button>`}</div>`;
  bindHead();
  if (playRes) {
    animateDig();
    $('#rNextQ').onclick = () => { const nq = nextQ(r); if (nq == null) { runView = 'sum'; sumRound = r; runAll = null; drawRun(); } else { playQ = nq; playRes = null; playDeadline = Date.now() + RUN_SECS * 1000; drawRun(); } };
    return;
  }
  const inp = $('#rAns'); setTimeout(() => inp && inp.focus(), 50);
  let sent = false;
  const submit = async () => {
    if (sent) return; sent = true; clearInterval(runTick);
    const ans = (inp.value || '').trim().slice(0, 60);
    (runMine[r] = runMine[r] || {})[q] = ans;
    const { error } = await sb.from('erasmus_run_answers').insert({ round: r, q, player_id: runPid, nickname: runNick, answer: ans });
    if (error && error.code !== '23505') toast('Odpoveď sa nepodarilo uložiť – skontroluj internet', 3500);
    playRes = runJudge(pi, ans);
    if (navigator.vibrate) navigator.vibrate(playRes.valid ? (playRes.tier === 2 ? [30, 40, 30, 40, 60] : 30) : [60, 40, 60]);
    drawPlay();
  };
  $('#rDig').onclick = submit;
  inp.onkeydown = e => { if (e.key === 'Enter') submit(); };
  const bar = $('#rBar'), sec = $('#rSec');
  const t = () => {
    const left = Math.max(0, playDeadline - Date.now());
    bar.style.transform = `scaleX(${left / (RUN_SECS * 1000)})`; sec.textContent = Math.ceil(left / 1000) + ' s';
    if (!left) submit();
  };
  t(); runTick = setInterval(t, 100);
}

/* ---------------- Súhrn kola ---------------- */
async function drawSum() {
  const r = sumRound;
  $('#run').innerHTML = `<div class="rw">${rhead()}<div class="crane">🏗️</div><p style="text-align:center;opacity:.7">Počítam hĺbku…</p></div>`; bindHead();
  let rows = [];
  try { await runLoadExtra(); rows = await runFetch(q => q.eq('round', r)); } catch (_) {}
  const mine = rows.filter(x => x.player_id === runPid);
  if (!mine.length) Object.entries(runMine[r] || {}).forEach(([q, a]) => rows.push({ round: r, q: +q, player_id: runPid, nickname: runNick, answer: a }));
  const board = runScore(rows);
  const my = rows.filter(x => x.player_id === runPid).sort((a, b) => a.q - b.q);
  const total = my.reduce((s, x) => s + x._pts, 0);
  const place = board.findIndex(p => p.pid === runPid) + 1;
  const sq = my.map(x => x._j.valid ? TIER_SQ[x._j.tier] + (x._uni ? '⭐' : '') : '⬜').join(' ');
  $('#run').innerHTML = `<div class="rw">${rhead()}
    <div class="rcard" style="text-align:center"><div class="kicker" style="color:#FFC400">Kolo ${r} · výsledok</div>
      <div class="bigm">${total} m</div><p>${place ? `${place}. miesto z ${board.length}` : ''}</p>
      <div style="font-size:26px;margin-top:8px;letter-spacing:4px">${sq}</div>
      <button class="rbtn" id="rShare">📤 Zdieľať výsledok</button></div>
    <div class="rcard">${my.map(x => `<div class="sumrow"><span class="sq ${x._j.valid ? 't' + x._j.tier : 'inv'}">${x._j.valid ? (x._uni ? '⭐' : TIER_SQ[x._j.tier]) : '✕'}</span>
      <div class="tx"><span>${esc(promptOf(r, x.q))}</span><b>${esc(x.answer || '— (čas vypršal)')}</b></div><em>${x._pts} m</em></div>`).join('')}</div>
    <div class="rcard"><h3>Rebríček kola ${r}</h3><div class="lb">${board.slice(0, 15).map((p, i) => `<div class="${i < 3 ? 'p' + (i + 1) : ''} ${p.pid === runPid ? 'me' : ''}"><span class="n">${i + 1}</span><b>${esc(p.nick)}</b><em>${meters(p.total)}</em></div>`).join('')}</div></div>
    <button class="rbtn alt" id="rBack">← Späť</button></div>`;
  bindHead();
  if (total >= 40) confetti();
  $('#rBack').onclick = () => { runView = 'home'; runAll = null; drawRun(); };
  $('#rShare').onclick = async () => {
    const text = `Erasmus Run · Kolo ${r} ⛏ ${total} m\n${sq}\nZahraj si aj ty 👉 ${RUN_URL}`;
    if (navigator.share) { try { await navigator.share({ text }); } catch (_) {} }
    else { try { await navigator.clipboard.writeText(text); toast('Skopírované 📋'); } catch (_) {} }
  };
}

/* ---------------- Živá hra na mobile ---------------- */
const liveSeen = {};
async function drawLive() {
  const st = runState, r = st.round;
  if (!LS.get('erasmus.run.joined.' + r, false)) {
    LS.set('erasmus.run.joined.' + r, true);
    sb.from('erasmus_run_join').insert({ round: r, player_id: runPid, nickname: runNick }).then(() => {});
  }
  let body = '';
  const answered = runMine[r] && st.q in runMine[r];
  if (st.status === 'lobby') {
    body = `<div class="crane">🏗️</div><div class="rcard" style="text-align:center"><div class="kicker" style="color:#FFC400">Kolo ${r} · naživo</div>
      <h3>Si v hre ako ${esc(runNick)} 👷</h3><p>Pozri na projektor – hra sa začne každú chvíľu.</p></div>${rulesHtml()}`;
  } else if (st.status === 'question') {
    if (answered) {
      body = `<div class="pq"><div class="k">VÝZVA ${st.q + 1}/5</div><h2>${esc(promptOf(r, st.q))}</h2></div>
        <div class="rcard" style="text-align:center"><div style="font-size:48px">✅</div><h3>Odpoveď odoslaná</h3><p>„${esc(runMine[r][st.q] || '—')}“ · pozri na projektor 👀</p></div>`;
    } else {
      body = `<div class="pq"><div class="k">VÝZVA ${st.q + 1}/5 · NAŽIVO</div><h2>${esc(promptOf(r, st.q))}</h2></div>
        <input class="rinp" id="lAns" maxlength="60" placeholder="Tvoja odpoveď…" autocomplete="off" autocapitalize="off" enterkeyhint="go">
        <div class="tbar"><i id="lBar"></i></div><div class="tinfo"><span>Rýchlo, kým beží čas!</span><span id="lSec"></span></div>
        <button class="rbtn" id="lDig">Odoslať ⛏</button>`;
    }
  } else if (st.status === 'reveal' || st.status === 'board' || st.status === 'final') {
    let rows = []; try { await runLoadExtra(); rows = await runFetch(q => q.eq('round', r)); } catch (_) {}
    const board = runScore(rows);
    const mineQ = rows.find(x => x.player_id === runPid && x.q === st.q);
    const place = board.findIndex(p => p.pid === runPid) + 1, me = board.find(p => p.pid === runPid);
    if (st.status === 'final') {
      body = `<div class="rcard" style="text-align:center"><div class="kicker" style="color:#FFC400">Koniec kola ${r}</div>
        <div style="font-size:64px">${place === 1 ? '🏆' : place === 2 ? '🥈' : place === 3 ? '🥉' : '⛏️'}</div>
        <div class="bigm">${me ? me.total : 0} m</div><p>${place ? `${place}. miesto z ${board.length}` : 'Tentoraz bez odpovede'}</p></div>
        <div class="rcard"><p>Ďalšie kolá sa ti budú odomykať každý deň v tejto appke. Kopeme ďalej! 💪</p></div>`;
      if (place && place <= 3) confetti();
    } else {
      const j = mineQ ? mineQ._j : { valid: false, blank: true };
      body = `<div class="pq"><div class="k">VÝZVA ${st.q + 1}/5</div><h2>${esc(promptOf(r, st.q))}</h2></div>
        ${digHtml(j, mineQ ? mineQ._pts : 0)}${verdictHtml(j)}${mineQ && mineQ._uni ? '<p style="color:#FFC400;font-weight:800;margin-top:6px">⭐ Túto odpoveď máš len ty! +' + RUN_UNIQUE + ' m</p>' : ''}
        <div class="rcard" style="text-align:center"><p>Zatiaľ spolu</p><div class="bigm" style="font-size:44px">${me ? me.total : 0} m</div><p>${place ? `${place}. miesto` : ''}</p></div>`;
    }
  }
  $('#run').innerHTML = `<div class="rw">${rhead()}${body}</div>`;
  bindHead(); animateDig();
  const inp = $('#lAns');
  if (inp) {
    const key = r + ':' + st.q + ':' + st.started_at;
    if (!liveSeen[key]) liveSeen[key] = Date.now();
    const dur = (st.duration || 25) * 1000;
    let el = Date.now() - Date.parse(st.started_at || 0);
    if (!(el >= 0 && el < dur + 30000)) el = Date.now() - liveSeen[key];
    const deadline = Date.now() + Math.max(0, dur - el);
    let sent = false;
    const submit = async () => {
      if (sent) return; sent = true; clearInterval(runTick);
      const ans = (inp.value || '').trim().slice(0, 60);
      (runMine[r] = runMine[r] || {})[st.q] = ans;
      const { error } = await sb.from('erasmus_run_answers').insert({ round: r, q: st.q, player_id: runPid, nickname: runNick, answer: ans });
      if (error && error.code !== '23505') toast('Nepodarilo sa odoslať – skontroluj internet', 3500);
      drawLive();
    };
    $('#lDig').onclick = submit; inp.onkeydown = e => { if (e.key === 'Enter') submit(); };
    setTimeout(() => inp.focus(), 50);
    const bar = $('#lBar'), sec = $('#lSec');
    const t = () => { const left = Math.max(0, deadline - Date.now()); bar.style.transform = `scaleX(${left / dur})`; sec.textContent = Math.ceil(left / 1000) + ' s'; if (!left && inp.value.trim()) submit(); };
    t(); runTick = setInterval(t, 100);
  }
}

/* =====================================================================
   PROJEKTOR (ako Kahoot) – ovláda admin z počítača
   ===================================================================== */
let hostPoll = null, hostTickT = null, hostRows = [], hostJoins = [], hostAuto = '';
async function openHost() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { toast('Najprv sa prihlás ako admin', 3000); openAdmin(); return; }
  const { data: ok } = await sb.rpc('erasmus_is_admin');
  if (!ok) { toast('Projektor môže spustiť len admin', 3000); return; }
  closeFull && closeFull('#admin');
  $('#host').classList.add('show'); document.body.style.overflow = 'hidden';
  await Promise.all([runLoadState(), runLoadExtra()]);
  await hostRefresh(); drawHost();
  clearInterval(hostPoll);
  hostPoll = setInterval(async () => {
    const before = runState ? [runState.status, runState.q, runState.round].join() : '';
    const n = hostRows.length + ':' + hostJoins.length;
    await hostRefresh();
    const after = runState ? [runState.status, runState.q, runState.round].join() : '';
    if (before !== after || n !== hostRows.length + ':' + hostJoins.length) drawHost(true);
  }, 1200);
  if (!window.qrcode) { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js'; s.onload = () => drawHost(); document.head.appendChild(s); }
}
function closeHost() { $('#host').classList.remove('show'); document.body.style.overflow = ''; clearInterval(hostPoll); clearInterval(hostTickT); if (/[?&]host/.test(location.search)) history.replaceState(null, '', APP_URL); }
async function hostRefresh() {
  await runLoadState();
  if (!runState) return;
  try {
    const r = runState.round;
    hostRows = await runFetch(q => q.eq('round', r));
    const { data } = await sb.from('erasmus_run_join').select('player_id,nickname').eq('round', r).order('joined_at');
    hostJoins = data || [];
  } catch (_) {}
}
async function hostSet(patch) {
  const { error } = await sb.from('erasmus_run_state').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1);
  if (error) return toast('Chyba: ' + error.message, 4000);
  Object.assign(runState, patch); await hostRefresh(); drawHost();
}
function qrSvg(text) {
  if (!window.qrcode) return '<div style="color:#111;font-weight:800;text-align:center">QR sa načítava…</div>';
  const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
}
function hostPlayers() {
  const m = new Map(); hostJoins.forEach(j => m.set(j.player_id, j.nickname)); hostRows.forEach(r => m.set(r.player_id, r.nickname)); return m;
}
function drawHost(soft) {
  clearInterval(hostTickT);
  const st = runState || { status: 'off', round: 1, q: 0, duration: 25 };
  const r = st.round, q = st.q, players = hostPlayers();
  let main = '', foot = '';
  const header = `<div class="hhead"><button class="x" id="hx" style="width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.12)">✕</button>
    <div class="rlogo">ERASMUS <em>RUN</em></div><div class="hz"></div><div style="font-weight:800;font-size:1.6vw">Kolo ${r}</div></div>`;
  if (st.status === 'off') {
    main = `<div class="hq"><div class="k">STAVBÁRSKA HRA · SVF FUTURE</div><h1>Pripravení kopať? ⛏</h1>
      <p style="font-size:1.8vw;color:rgba(255,255,255,.75);margin-top:2vh">Vyber kolo a otvor lobby. Študenti sa pripoja cez QR kód.</p></div>`;
    foot = `<select id="hR">${Array.from({ length: 50 }, (_, i) => `<option value="${i + 1}" ${i + 1 === r ? 'selected' : ''}>Kolo ${i + 1}</option>`).join('')}</select>
      <select id="hD">${[15, 20, 25, 30, 40].map(d => `<option value="${d}" ${d === (st.duration || 25) ? 'selected' : ''}>${d} s na výzvu</option>`).join('')}</select>
      <button class="go" id="hLobby">Otvoriť lobby →</button>`;
  } else if (st.status === 'lobby') {
    main = `<div class="hlobby"><div class="hqr">${qrSvg(RUN_URL)}</div><div class="hjoin">
      <h1>Naskenuj a pridaj sa! 📱</h1><p>Otvor appku SvF Future → Erasmus Run</p><div class="url">${esc(RUN_URL.replace(/^https?:\/\//, ''))}</div>
      <p style="margin-top:3vh"><b style="color:#FFC400;font-size:3vw">${players.size}</b> pripojených</p>
      <div class="hnames">${[...players.values()].map(n => `<span>👷 ${esc(n)}</span>`).join('')}</div></div></div>`;
    foot = `<button class="danger" id="hOff">Zrušiť</button><button class="go" id="hStart">▶ Štart</button>`;
  } else if (st.status === 'question') {
    const answered = new Set(hostRows.filter(x => x.q === q).map(x => x.player_id)).size;
    main = `<div class="hq"><div class="k">VÝZVA ${q + 1} / 5</div><h1>${esc(promptOf(r, q))}</h1>
      <div class="hring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="8"/><circle id="hRing" cx="50" cy="50" r="44" fill="none" stroke="#FFC400" stroke-width="8" stroke-linecap="round" stroke-dasharray="276.5" stroke-dashoffset="0"/></svg><b id="hSec">${st.duration}</b></div>
      <div class="hcount">Odpovedalo <b style="color:#FFC400">${answered}</b> z ${players.size}</div></div>`;
    foot = `<button id="hEnd">Ukončiť skôr ⏭</button>`;
  } else if (st.status === 'reveal') {
    const qrows = hostRows.filter(x => x.q === q);
    runScore(hostRows);
    const groups = {};
    qrows.forEach(x => { if (!x._j.valid) return; const k = rn(x._j.canon); (groups[k] = groups[k] || { canon: x._j.canon, tier: x._j.tier, n: 0, pts: x._pts, uni: x._uni }).n++; });
    const tiles = Object.values(groups).sort((a, b) => b.tier - a.tier || a.n - b.n);
    const inv = {}; qrows.filter(x => !x._j.valid && !x._j.blank).forEach(x => { const k = x._j.norm; (inv[k] = inv[k] || { k, text: x.answer, n: 0 }).n++; });
    const gem = tiles.find(t => t.tier === 2);
    main = `<div class="hq"><div class="k">VÝZVA ${q + 1} / 5 · ODPOVEDE</div><h1 style="font-size:3.6vw">${esc(promptOf(r, q))}</h1></div>
      <div class="hrev">${tiles.map((t, i) => `<div class="htile t${t.tier} ${t.uni ? 'uni' : ''}" style="animation-delay:${i * 0.06}s"><b>${esc(t.canon)}</b><span>${t.n}× · ${RUN_TIER_M[t.tier]} m${t.uni ? ' +' + RUN_UNIQUE + ' ⭐' : ''}${t.tier === 2 ? ' 💎' : ''}</span></div>`).join('') || '<div style="font-size:2vw;opacity:.7">Žiadna správna odpoveď 😅</div>'}</div>
      ${Object.keys(inv).length ? `<div class="hinv"><div class="lab">NEUZNANÉ – KLIKNI A UZNAJ</div>${Object.values(inv).map(v => `<button data-acc="${esc(v.k)}">${esc(v.text)}${v.n > 1 ? ' ×' + v.n : ''}</button>`).join('')}</div>` : ''}
      ${gem ? `<div class="hcount">💎 Najhlbšie: <b style="color:#FFC400">${esc(gem.canon)}</b></div>` : ''}`;
    foot = `<button class="go" id="hBoard">Rebríček →</button>`;
  } else if (st.status === 'board' || st.status === 'final') {
    const upto = hostRows.filter(x => x.q <= q).map(x => ({ ...x }));
    const board = runScore(upto);
    const max = Math.max(1, ...board.map(b => b.total));
    if (st.status === 'board') {
      main = `<div class="hq"><div class="k">PO VÝZVE ${q + 1} / 5</div><h1 style="font-size:4vw">Kto kope najhlbšie? 🏗️</h1></div>
        <div class="hboard">${board.slice(0, 8).map((p, i) => `<div class="hrow"><span class="n">${i + 1}</span><span class="nm">${esc(p.nick)}</span><span class="bar2"><i data-w="${Math.round(p.total / max * 100)}"></i></span><em>${p.total} m</em></div>`).join('') || '<p style="text-align:center;opacity:.7">Zatiaľ bez odpovedí</p>'}</div>`;
      foot = q < 4 ? `<button class="go" id="hNext">Ďalšia výzva ▶</button>` : `<button class="go" id="hFinal">🏆 Finále</button>`;
    } else {
      const [a, b, c] = board;
      main = `<div class="hq"><div class="k">KOLO ${r} · KONIEC</div><h1 style="font-size:4.4vw">Víťazi Erasmus Run 🏆</h1></div>
        <div class="hpod">${b ? `<div class="g2"><b>${esc(b.nick)}</b><i>2</i><span>${b.total} m</span></div>` : '<div></div>'}
          ${a ? `<div class="g1"><b>${esc(a.nick)}</b><i>1</i><span>${a.total} m</span></div>` : ''}
          ${c ? `<div class="g3"><b>${esc(c.nick)}</b><i>3</i><span>${c.total} m</span></div>` : '<div></div>'}</div>`;
      foot = `<button class="danger" id="hOff">Ukončiť hru</button>`;
      if (!soft) setTimeout(confetti, 1600);
    }
  }
  $('#host').innerHTML = `<div class="hw">${header}<div class="hmain">${main}</div><div class="hfoot">${foot}</div></div>`;
  $('#hx').onclick = closeHost;
  const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
  on('#hLobby', () => hostSet({ status: 'lobby', round: +$('#hR').value, duration: +$('#hD').value, q: 0, started_at: null }));
  on('#hOff', () => { if (st.status === 'final' || confirm('Ukončiť živú hru?')) hostSet({ status: 'off' }); });
  on('#hStart', () => hostSet({ status: 'question', q: 0, started_at: new Date().toISOString() }));
  on('#hEnd', () => hostSet({ status: 'reveal' }));
  on('#hBoard', () => hostSet({ status: 'board' }));
  on('#hNext', () => hostSet({ status: 'question', q: q + 1, started_at: new Date().toISOString() }));
  on('#hFinal', () => hostSet({ status: 'final' }));
  document.querySelectorAll('#host [data-acc]').forEach(bt => bt.onclick = async () => {
    const { error } = await sb.from('erasmus_run_extra').insert({ pidx: pidxOf(r, q), answer_norm: bt.dataset.acc, tier: 1 });
    if (error && error.code !== '23505') return toast('Chyba: ' + error.message, 4000);
    await runLoadExtra(); drawHost(true); toast('Uznané ✅');
  });
  requestAnimationFrame(() => setTimeout(() => document.querySelectorAll('#host .bar2 i').forEach(i => i.style.width = i.dataset.w + '%'), 80));
  if (st.status === 'question') {
    const dur = (st.duration || 25) * 1000, t0 = Date.parse(st.started_at || new Date().toISOString());
    const tick = () => {
      const left = Math.max(0, dur - (Date.now() - t0));
      const ring = $('#hRing'), s = $('#hSec');
      if (ring) ring.style.strokeDashoffset = 276.5 * (1 - left / dur);
      if (s) s.textContent = Math.ceil(left / 1000);
      const key = r + ':' + q + ':' + st.started_at;
      if (!left && hostAuto !== key) { hostAuto = key; setTimeout(() => hostSet({ status: 'reveal' }), 1200); }
    };
    tick(); hostTickT = setInterval(tick, 200);
  }
}

/* =====================================================================
   ADMIN – záložka Erasmus Run
   ===================================================================== */
async function runAdminHtml() {
  await Promise.all([runLoadState(), runLoadExtra()]);
  let rows = []; try { rows = await runFetch(); } catch (_) {}
  runScore(rows);
  const unk = {};
  rows.forEach(x => { if (x._j.valid || x._j.blank) return; const pi = pidxOf(x.round, x.q), k = pi + '|' + x._j.norm; (unk[k] = unk[k] || { pi, norm: x._j.norm, text: x.answer, n: 0 }).n++; });
  const list = Object.values(unk).sort((a, b) => b.n - a.n).slice(0, 80);
  const players = new Set(rows.map(x => x.player_id)).size;
  const st = runState || {};
  return `<h2 style="margin-top:14px">🏃 Erasmus Run</h2>
    <p class="muted">250 výziev · 50 kôl · každý deň sa odomkne jedno. Kolo 1 je deň spoločnej hry.</p>
    <div class="card arow"><div class="th">📅</div><div><b>${st.start_date ? 'Štart: ' + new Date(st.start_date + 'T00:00').toLocaleDateString('sk-SK') : 'Hra ešte nie je spustená'}</b><span>Odomknuté kolá: ${runUnlocked()} · hráčov: ${players} · odpovedí: ${rows.length}</span></div></div>
    <label>Dátum kola 1 (deň spoločnej hry)</label><input type="date" id="rsD" value="${st.start_date || todayStr()}">
    <div class="two" style="margin-top:10px"><div><button class="btn ink full" id="rsSave">Uložiť dátum</button></div><div><button class="btn or full" id="rsHost">📺 Projektor</button></div></div>
    ${st.status && st.status !== 'off' ? `<button class="btn line full" id="rsStop" style="margin-top:10px">⏹ Ukončiť živú hru (${esc(st.status)})</button>` : ''}
    <h2 style="margin-top:22px;font-size:22px">Neuznané odpovede (${list.length})</h2>
    <p class="muted" style="font-size:13px">Odpovede, ktoré hra nepoznala. Ak sú správne, uznaj ich – body sa všetkým prepočítajú.</p>
    ${list.map(u => `<div class="card qcard"><div class="t">${esc(window.RUN_PROMPTS[u.pi].p)} · kolo ${Math.floor(u.pi / 5) + 1}</div><div class="q" style="font-size:17px;margin-top:4px">„${esc(u.text)}“ ${u.n > 1 ? `<span class="muted">×${u.n}</span>` : ''}</div>
      <div class="two" style="margin-top:8px"><div><button class="btn line full" data-ux="${u.pi}|${esc(u.norm)}|0">✓ Bežná</button></div><div><button class="btn line full" data-ux="${u.pi}|${esc(u.norm)}|1">✓ Menej známa</button></div><div><button class="btn line full" data-ux="${u.pi}|${esc(u.norm)}|2">💎 Vzácna</button></div></div></div>`).join('') || '<p class="muted">Všetko je vyhodnotené 👍</p>'}
    <button class="btn danger full" id="rsWipe" style="margin-top:28px">🗑 Vymazať všetky odpovede hry</button>`;
}
function runAdminBind() {
  const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
  on('#rsSave', async () => { const d = $('#rsD').value; const { error } = await sb.from('erasmus_run_state').update({ start_date: d || null, updated_at: new Date().toISOString() }).eq('id', 1); toast(error ? 'Chyba: ' + error.message : 'Uložené ✅'); admPanel(); });
  on('#rsHost', openHost);
  on('#rsStop', async () => { await sb.from('erasmus_run_state').update({ status: 'off', updated_at: new Date().toISOString() }).eq('id', 1); admPanel(); });
  on('#rsWipe', async () => {
    if (!confirm('Naozaj vymazať VŠETKY odpovede a rebríčky Erasmus Run?') || !confirm('Určite? Toto sa nedá vrátiť.')) return;
    await sb.from('erasmus_run_answers').delete().gte('round', 1); await sb.from('erasmus_run_join').delete().gte('round', 1);
    toast('Vymazané'); admPanel();
  });
  document.querySelectorAll('[data-ux]').forEach(b => b.onclick = async () => {
    const [pi, norm, tier] = b.dataset.ux.split('|');
    const { error } = await sb.from('erasmus_run_extra').upsert({ pidx: +pi, answer_norm: norm, tier: +tier });
    toast(error ? 'Chyba: ' + error.message : 'Uznané ✅'); admPanel();
  });
}
