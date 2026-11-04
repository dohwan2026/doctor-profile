'use strict';
// 의사 이력 — 병원 홈페이지 의료진 소개를 미리 모아 둔 데이터를 검색해서 보는 앱.
// doctors_index.js = 검색용 목록(처음에 받음), detail/<병원코드>.js = 학력·경력·논문 등 상세(의사를 열 때 받음).
// 데이터는 crawl/*.py 로 갱신한다. 이 기기에는 '관심 의사'와 '내 메모'만 저장된다.

const KEY_NOTES = 'dp.notes';
const THIS_YEAR = new Date().getFullYear();
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');

// ---------- 데이터 ----------
const HOSPITALS = (window.DOCTOR_INDEX || []).slice().sort((a, b) => a.hospital.localeCompare(b.hospital, 'ko'));
const DOCTORS = HOSPITALS.flatMap(h => h.doctors.map(d => ({ ...d, hospital: h.hospital, code: h.code, collectedAt: h.collectedAt })));
const BY_ID = new Map(DOCTORS.map(d => [d.id, d]));
// 검색용 문자열 미리 만들기
for (const d of DOCTORS) {
  d._name = d.name.toLowerCase();
  d._main = [d.name, d.hospital, ...(d.depts || [d.dept]), ...(d.specialties || [])].join(' ').toLowerCase();
}

// 상세(학력·경력·논문)는 병원 단위로 필요할 때 <script> 로 받는다 (file:// 에서도 동작)
const DETAIL = {};
const detailWait = {};
window.DOCTOR_DETAIL = (code, data) => {
  DETAIL[code] = data;
  (detailWait[code] || []).forEach(f => f.res(data));
  delete detailWait[code];
};
function loadDetail(code) {
  if (DETAIL[code]) return Promise.resolve(DETAIL[code]);
  return new Promise((res, rej) => {
    const first = !detailWait[code];
    (detailWait[code] = detailWait[code] || []).push({ res, rej });
    if (!first) return;
    const sc = document.createElement('script');
    sc.src = `detail/${code}.js`;
    sc.onerror = () => { (detailWait[code] || []).forEach(f => f.rej()); delete detailWait[code]; sc.remove(); };
    document.head.appendChild(sc);
  });
}

// ---------- 내 메모·관심 (이 기기에만) ----------
function loadNotes() { try { return JSON.parse(localStorage.getItem(KEY_NOTES)) || {}; } catch { return {}; } }
let notes = loadNotes();
function saveNotes() { try { localStorage.setItem(KEY_NOTES, JSON.stringify(notes)); } catch { toast('메모를 저장하지 못했어요'); } }
const noteOf = id => notes[id] || {};
function setNote(id, patch) {
  const n = { ...noteOf(id), ...patch };
  if (!n.memo && !n.fav) delete notes[id]; else notes[id] = n;
  saveNotes();
}

// ---------- 병원 필터 (이 기기에 기억) ----------
const KEY_HOSP = 'dp.hosp';
let hospFilter = (() => { try { return localStorage.getItem(KEY_HOSP) || ''; } catch { return ''; } })();
if (hospFilter && !HOSPITALS.some(h => h.hospital === hospFilter)) hospFilter = '';
function setHospFilter(v) { hospFilter = v; try { localStorage.setItem(KEY_HOSP, v); } catch {} }
const inHosp = d => !hospFilter || d.hospital === hospFilter;

// ---------- 유틸 ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2400);
}
const careerYears = d => (d.specialistYear ? THIS_YEAR - d.specialistYear : null);
const isCurrent = l => /현재|現/.test(l);

function search(q) {
  const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  const out = [];
  for (const d of DOCTORS) {
    if (!inHosp(d)) continue;
    let score = 0, ok = true;
    for (const t of toks) {
      if (d._name === t) score += 100;
      else if (d._name.startsWith(t)) score += 60;
      else if (d._main.includes(t)) score += 20;
      else { ok = false; break; }
    }
    if (ok) out.push([score, d]);
  }
  // 점수(이름 일치 > 진료과·분야 일치) 다음엔 경력 긴 순
  return out.sort((a, b) => b[0] - a[0] || (careerYears(b[1]) ?? -1) - (careerYears(a[1]) ?? -1) || a[1].name.localeCompare(b[1].name, 'ko')).map(x => x[1]);
}

// ---------- 라우팅 ----------
const go = h => { location.hash = h; };
window.addEventListener('hashchange', render);
$('#backBtn').onclick = () => (history.length > 1 ? history.back() : go('#/'));
$('#settingsBtn').onclick = () => go('#/info');

function setChrome(title, back) {
  $('#title').textContent = title;
  $('#backBtn').hidden = !back;
  document.title = back ? `${title} · 의사 이력` : '의사 이력';
}
function render() {
  const h = decodeURIComponent(location.hash || '#/');
  let m;
  if ((m = h.match(/^#\/d\/(.+)$/))) return renderDetail(m[1]);
  if ((m = h.match(/^#\/dept\/(.+)$/))) return renderDept(m[1]);
  if (h === '#/info') return renderInfo();
  renderHome();
}

// ---------- 카드 ----------
function docCard(d) {
  const y = careerYears(d);
  const chips = [
    y != null ? `<span class="chip">전문의 ${y}년차</span>` : '',
    d.paperCount ? `<span class="chip">논문 ${d.paperCount}편</span>` : '',
    ...(d.specialties || []).slice(0, 3).map(s => `<span class="chip plain">${esc(s)}</span>`),
  ].join('');
  return `<button class="card doc-item" data-id="${esc(d.id)}">
    <div class="doc-row">
      ${d.photo ? `<img class="ph" src="${esc(d.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
      <div class="doc-txt">
        <div class="name">${esc(d.name)} <span class="sub">${esc(d.title || '')}${noteOf(d.id).fav ? ' ★' : ''}</span></div>
        <div class="sub">${esc(d.hospital)} · ${esc(d.dept)}</div>
      </div>
    </div>
    ${chips ? `<div class="chips">${chips}</div>` : ''}
  </button>`;
}
function bindCards(el) {
  el.addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b) go('#/d/' + encodeURIComponent(b.dataset.id)); });
}

// ---------- 홈: 검색 ----------
let query = '';
function renderHome() {
  setChrome('의사 이력', false);
  if (!DOCTORS.length) {
    view.innerHTML = `<div class="empty"><p><b>의료진 데이터가 없어요.</b></p><p>PC에서 <code>python crawl/snuh.py</code> 를 실행해 데이터를 받아 주세요.</p></div>`;
    return;
  }
  const hospChips = HOSPITALS.length > 1
    ? `<div class="chips hosp-chips">${['', ...HOSPITALS.map(h => h.hospital)].map(h =>
        `<button class="chip ${hospFilter === h ? '' : 'plain'}" data-h="${esc(h)}">${h ? esc(h) : '전체 병원'}</button>`).join('')}</div>` : '';
  view.innerHTML = `
    <input class="search" type="search" id="q" placeholder="의사 이름, 진료과, 질환 (예: 무릎, 갑상선)" value="${esc(query)}" autocomplete="off">
    ${hospChips}
    <div id="res"></div>`;
  const hc = $('.hosp-chips');
  if (hc) hc.onclick = e => { const b = e.target.closest('[data-h]'); if (b) { setHospFilter(b.dataset.h); renderHome(); } };
  const res = $('#res');
  bindCards(res);
  const draw = () => {
    const q = query.trim();
    if (q) {
      const list = search(q);
      res.innerHTML = list.length
        ? `<p class="note">${list.length}명</p>` + list.slice(0, 100).map(docCard).join('') + (list.length > 100 ? '<p class="note">100명까지만 보여요. 검색어를 더 넣어 보세요.</p>' : '')
        : '<p class="empty">찾는 의사가 없어요.<br>이름 일부나 다른 질환명으로 찾아보세요.</p>';
      return;
    }
    const favs = DOCTORS.filter(d => noteOf(d.id).fav);
    const depts = {};
    for (const d of DOCTORS) if (inHosp(d) && d.dept) depts[d.dept] = (depts[d.dept] || 0) + 1;
    const hosp = HOSPITALS.map(h => `${esc(h.hospital)} ${h.doctors.length}명`).join(', ');
    res.innerHTML = `
      ${favs.length ? `<h2 class="h2">관심 의사</h2>${favs.map(docCard).join('')}` : ''}
      <h2 class="h2">진료과로 찾기</h2>
      <div class="dept-grid">${Object.entries(depts).sort((a, b) => a[0].localeCompare(b[0], 'ko'))
        .map(([k, n]) => `<a class="dept" href="#/dept/${encodeURIComponent(k)}">${esc(k)}<small>${n}</small></a>`).join('')}</div>
      <p class="note">수록: ${hosp}</p>`;
  };
  draw();
  $('#q').oninput = e => { query = e.target.value; draw(); };
}

function renderDept(dept) {
  setChrome(dept, true);
  window.scrollTo(0, 0);
  const list = DOCTORS.filter(d => inHosp(d) && (d.dept === dept || (d.depts || []).includes(dept)))
    .sort((a, b) => (careerYears(b) ?? -1) - (careerYears(a) ?? -1));
  view.innerHTML = `<p class="note">${hospFilter ? esc(hospFilter) + ' · ' : ''}${list.length}명 · 경력 긴 순</p>` + list.map(docCard).join('');
  bindCards(view);
}

// ---------- 상세 ----------
function listSec(title, arr, open = true) {
  if (!arr || !arr.length) return '';
  return `<details class="card sec" ${open ? 'open' : ''}><summary><h2>${title} <small>${arr.length}</small></h2></summary>
    <ul>${arr.map(x => `<li class="${isCurrent(x) ? 'cur' : ''}">${esc(x)}</li>`).join('')}</ul></details>`;
}
function deptText(d) {
  const all = d.depts && d.depts.length ? d.depts : [d.dept].filter(Boolean);
  return all.length > 3 ? `${all.slice(0, 3).join(', ')} 외 ${all.length - 3}곳` : all.join(', ');
}
function renderDetail(id) {
  const base = BY_ID.get(id);
  if (!base) return go('#/');
  if (!DETAIL[base.code]) {
    setChrome(base.name, true);
    view.innerHTML = '<p class="empty">불러오는 중…</p>';
    const here = location.hash;
    loadDetail(base.code)
      .then(() => { if (location.hash === here) renderDetail(id); })
      .catch(() => { if (location.hash === here) view.innerHTML = '<p class="empty">상세 정보를 불러오지 못했어요.<br>인터넷 연결을 확인해 주세요.</p>'; });
    return;
  }
  const d = { ...base, ...(DETAIL[base.code][id] || {}) };
  setChrome(d.name, true);
  window.scrollTo(0, 0);
  const n = noteOf(id);
  const y = careerYears(d);
  const now = (d.career || []).filter(isCurrent);
  const tiles = [];
  if (y != null) tiles.push(`<div class="tile"><div class="v">${y}<small>년차</small></div><div class="l">전문의 (${d.specialistYear}년~)*</div></div>`);
  if (d.paperCount) tiles.push(`<div class="tile"><div class="v">${d.paperCount}<small>편</small></div><div class="l">등록 논문</div></div>`);
  if ((d.career || []).length) tiles.push(`<div class="tile"><div class="v">${d.career.length}<small>건</small></div><div class="l">경력 항목</div></div>`);
  const papers = (d.papers || []).map(p => `<li><a href="https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(p.title)}" target="_blank" rel="noopener">${esc(p.title)}</a>
    <div class="note" style="margin:0">${esc(p.journal)} · ${esc(p.date)}</div></li>`).join('');

  view.innerHTML = `
    <section class="hero">
      <div class="doc-row">
        ${d.photo ? `<img class="ph big" src="${esc(d.photo)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
        <div class="doc-txt">
          <p class="name">${esc(d.name)} <span class="sub" style="font-size:16px;font-weight:500">${esc(d.title || '')}</span></p>
          <div class="sub">${esc(d.hospital)} · ${esc(deptText(d))}</div>
        </div>
        <button class="icon-btn fav ${n.fav ? 'on' : ''}" id="favBtn" aria-label="관심 의사">${n.fav ? '★' : '☆'}</button>
      </div>
      ${(d.specialties || []).length ? `<div class="chips">${d.specialties.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>` : ''}
    </section>
    ${tiles.length ? `<div class="tiles">${tiles.join('')}</div>` : '<div style="height:12px"></div>'}
    ${now.length ? `<section class="card sec"><h2>현재 맡고 있는 일</h2><ul>${now.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}
    <section class="card sec"><h2>내 메모 · 물어볼 것</h2>
      <textarea id="memo" placeholder="진료 때 물어볼 것, 진료 받아본 느낌 등 (이 폰에만 저장)">${esc(n.memo || '')}</textarea></section>
    ${listSec('경력', d.career)}
    ${listSec('학력', d.education)}
    ${listSec('학회 · 활동', d.societies, false)}
    ${!papers && d.paperUrl ? `<section class="card sec"><h2>논문</h2><a class="btn" href="${esc(d.paperUrl)}" target="_blank" rel="noopener">병원 연구자 페이지에서 보기</a></section>` : ''}
    ${papers ? `<details class="card sec"><summary><h2>최근 논문 <small>${d.papers.length}${d.paperCount > d.papers.length ? ` / ${d.paperCount}` : ''}</small></h2></summary><ul class="papers">${papers}</ul></details>` : ''}
    <section class="card sec"><h2>출처</h2>
      <p style="margin:0 0 6px"><a href="${esc(d.sourceUrl)}" target="_blank" rel="noopener">${esc(d.hospital)} 의료진 소개 페이지</a></p>
      <p class="note" style="margin:0">수집일 ${esc(d.collectedAt)} · 병원 홈페이지에 공개된 내용 그대로예요.${y != null ? '<br>* 전문의 연차는 경력의 전공의 수련 종료 연도로 추정한 값이에요.' : ''}</p>
    </section>`;

  $('#favBtn').onclick = () => {
    setNote(id, { fav: !noteOf(id).fav });
    toast(noteOf(id).fav ? '관심 의사에 추가했어요' : '관심 의사에서 뺐어요');
    renderDetail(id);
  };
  let t;
  $('#memo').oninput = e => { clearTimeout(t); t = setTimeout(() => setNote(id, { memo: e.target.value.trim() }), 400); };
}

// ---------- 정보·백업 ----------
function renderInfo() {
  setChrome('정보', true);
  const memoCount = Object.keys(notes).length;
  view.innerHTML = `
    <section class="card sec"><h2>수록 데이터</h2>
      <dl class="kv">${HOSPITALS.map(h => `<dt>${esc(h.hospital)}</dt><dd>${h.doctors.length}명 · ${esc(h.collectedAt)} 수집</dd>`).join('')}</dl>
      <p class="note">병원 홈페이지의 의료진 소개(학력·경력·학회·논문)를 모은 것이에요. 의사 개인별 진료·수술 건수는 병원이 공개하지 않아 들어 있지 않아요.</p>
    </section>
    <section class="card sec"><h2>내 메모 백업</h2>
      <p class="note" style="margin:0 0 10px">관심 의사와 메모는 이 폰의 브라우저에만 저장돼요 (${memoCount}명).</p>
      <div class="row"><button class="btn" id="exportBtn">내보내기</button>
        <label class="btn">가져오기<input type="file" id="importFile" accept="application/json,.json" hidden></label></div>
    </section>`;
  $('#exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify({ app: 'doctor-profile', notes }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `의사이력-메모-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#importFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!j || typeof j.notes !== 'object') throw 0;
      notes = { ...notes, ...j.notes }; saveNotes();
      toast(`${Object.keys(j.notes).length}명 메모를 가져왔어요`); renderInfo();
    } catch { toast('백업 파일을 읽지 못했어요'); }
  };
}

render();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
