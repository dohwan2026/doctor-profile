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
const GRADES = Object.fromEntries(HOSPITALS.map(h => [h.code, h.grades]));
const HOSP_INFO = Object.fromEntries(HOSPITALS.map(h => [h.code, h]));

// 심평원 병원평가 (병원 단위 등급). m = 이 의사와 관련 있는지 (진료과·진료분야 기준)
const ASM = [
  ['asmGrd13', '위암', /위암|위장관|위식도/],
  ['asmGrd12', '대장암', /대장|결장|직장|항문/],
  ['asmGrd14', '유방암', /유방/],
  ['asmGrd15', '폐암', /폐암|폐식도|흉강경|흉부외과/],
  ['asmGrd06', '관상동맥우회술 (심장 수술)', /심장혈관흉부|심장외과|흉부외과|관상동맥/],
  ['asmGrd01', '급성기 뇌졸중', /뇌졸중|뇌혈관|신경과|신경외과/],
  ['asmGrd21', '마취', /마취/],
  ['asmGrd05', '수술 감염 예방 (항생제)', null],
  ['asmGrd19', '중환자실', /중환자/],
];
function hospGrades(d) {
  const g = GRADES[d.code];
  if (!g) return null;
  const text = [d.dept, ...(d.depts || []), ...(d.specialties || [])].join(' ');
  const rows = ASM.filter(([k]) => g[k]).map(([k, label, re]) => ({ label, v: g[k], rel: re ? re.test(text) : !!d.surgery }));
  return { at: g.at, mine: rows.filter(r => r.rel), rest: rows.filter(r => !r.rel) };
}
const gradeChip = v => /^\d$/.test(v)
  ? `<span class="grade g${v}">${v}등급</span>` : `<span class="grade gx">등급 없음</span>`;
// 검색용 문자열 미리 만들기
// 진료과 묶음용 이름: "[ 소화기내과 (건강증진센터) ]" → "소화기내과", "외과(암센터)" → "외과"
const baseDept = n => String(n || '').replace(/^\[\s*|\s*\]$/g, '').replace(/\s*\([^()]*\)\s*$/, '').replace(/(과)분과$/, '$1').trim();
for (const d of DOCTORS) {
  d._dept = baseDept(d.dept);
  // 대표 진료과 + 함께 속한 진료과·센터 (목록 숫자와 진료과 화면이 같은 기준을 쓰도록)
  d._depts = [...new Set([d.dept, ...(d.depts || [])].map(baseDept).filter(Boolean))];
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
// '수술 분야만' 보기 (이 기기에 기억)
const KEY_SURG = 'dp.surg';
let surgOnly = (() => { try { return localStorage.getItem(KEY_SURG) === '1'; } catch { return false; } })();
function setSurgOnly(v) { surgOnly = v; try { localStorage.setItem(KEY_SURG, v ? '1' : ''); } catch {} }
const inHosp = d => (!hospFilter || d.hospital === hospFilter) && (!surgOnly || d.surgery);
const SURG_RE = /수술|시술|이식|절제|치환술|재건술|성형술|봉합술|접합술|중재술|스텐트|ESD|EMR|PCI|TAVI/;

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

// ---------- 홈 화면에 추가 안내 ----------
const UA = navigator.userAgent;
const IS_IOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_ANDROID = /Android/.test(UA);
const IN_APP = /KAKAOTALK|NAVER|Instagram|FBAN|FBAV|Line\//i.test(UA);   // 카톡 등 앱 안 브라우저
const IS_STANDALONE = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const KEY_INSTALL = 'dp.installHide';
let installPrompt = null;   // 안드로이드 Chrome 이 주는 설치 이벤트
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  if (!location.hash || location.hash === '#/' || location.hash === '#/info') render();
});
window.addEventListener('appinstalled', () => { installPrompt = null; toast('홈 화면에 추가했어요'); render(); });

function installSteps() {
  if (IN_APP) {
    return IS_IOS
      ? '카카오톡 등 앱 안에서는 홈 화면에 추가할 수 없어요. 오른쪽 아래 <b>⋯</b> 또는 공유 버튼 → <b>Safari로 열기</b> 후 다시 해 주세요.'
      : '카카오톡 등 앱 안에서는 홈 화면에 추가할 수 없어요. 오른쪽 위 <b>⋮</b> → <b>다른 브라우저로 열기</b>(Chrome) 후 다시 해 주세요.';
  }
  if (IS_IOS) return 'Safari 아래쪽 <b>공유 버튼(□↑)</b> → <b>홈 화면에 추가</b> → <b>추가</b>를 누르세요.';
  if (IS_ANDROID) return 'Chrome 오른쪽 위 <b>⋮</b> → <b>홈 화면에 추가</b> 또는 <b>앱 설치</b> → <b>설치</b>를 누르세요.';
  return '폰에서 이 주소를 열어 홈 화면에 추가하면 앱처럼 쓸 수 있어요.';
}
function installBanner(force = false) {
  if (IS_STANDALONE) return force ? '<p class="note" style="margin:0">지금 홈 화면 앱으로 쓰고 있어요.</p>' : '';
  if (!force) {
    let hidden = false;
    try { hidden = localStorage.getItem(KEY_INSTALL) === '1'; } catch {}
    if (hidden || !(IS_IOS || IS_ANDROID)) return '';
  }
  const btn = installPrompt && !IN_APP ? '<button class="btn primary" id="installBtn">앱으로 설치</button>' : '';
  return `<div class="${force ? '' : 'card install'}">
    ${force ? '' : '<button class="icon-btn install-x" id="installX" aria-label="닫기">✕</button><b>홈 화면에 추가하면 앱처럼 쓸 수 있어요</b>'}
    ${btn ? `<div style="margin:8px 0">${btn}</div><p class="note" style="margin:0">버튼이 안 되면: ${installSteps()}</p>` : `<p class="note" style="margin:6px 0 0">${installSteps()}</p>`}
  </div>`;
}
function bindInstall() {
  const b = $('#installBtn');
  if (b) b.onclick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    render();
  };
  const x = $('#installX');
  if (x) x.onclick = () => { try { localStorage.setItem(KEY_INSTALL, '1'); } catch {} x.closest('.install').remove(); };
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
    d.surgery ? '<span class="chip surg">수술 분야</span>' : '',
    d.lead ? `<span class="chip lead">${esc(d.lead[0])}</span>` : '',
    ...(d.specialties || []).slice(0, 3).map(s => `<span class="chip plain ${SURG_RE.test(s) ? 'surg-t' : ''}">${esc(s)}</span>`),
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
  const surgChip = `<div class="chips filter-row"><button class="chip ${surgOnly ? 'surg' : 'plain'}" id="surgBtn" aria-pressed="${surgOnly}">${surgOnly ? '✓ ' : ''}수술·시술 분야 의사만</button></div>`;
  view.innerHTML = `
    ${installBanner()}
    <input class="search" type="search" id="q" placeholder="의사 이름, 진료과, 질환 (예: 무릎, 갑상선)" value="${esc(query)}" autocomplete="off">
    ${hospChips}
    ${surgChip}
    <div id="res"></div>`;
  $('#surgBtn').onclick = () => { setSurgOnly(!surgOnly); renderHome(); };
  const hc = $('.hosp-chips');
  if (hc) hc.onclick = e => { const b = e.target.closest('[data-h]'); if (b) { setHospFilter(b.dataset.h); renderHome(); } };
  const res = $('#res');
  bindCards(res);
  bindInstall();
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
    for (const d of DOCTORS) if (inHosp(d)) for (const k of d._depts) depts[k] = (depts[k] || 0) + 1;
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
  const list = DOCTORS.filter(d => inHosp(d) && d._depts.includes(dept))
    .sort((a, b) => (careerYears(b) ?? -1) - (careerYears(a) ?? -1));
  view.innerHTML = `<div class="chips filter-row"><button class="chip ${surgOnly ? 'surg' : 'plain'}" id="surgBtn" aria-pressed="${surgOnly}">${surgOnly ? '✓ ' : ''}수술·시술 분야 의사만</button></div>
    <p class="note">${hospFilter ? esc(hospFilter) + ' · ' : ''}${list.length}명 · 경력 긴 순</p>` + list.map(docCard).join('');
  $('#surgBtn').onclick = () => { setSurgOnly(!surgOnly); renderDept(dept); };
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
function gradeSec(d) {
  const g = hospGrades(d);
  if (!g || !(g.mine.length + g.rest.length)) return '';
  const li = r => `<li class="grade-row"><span>${esc(r.label)}</span>${gradeChip(r.v)}</li>`;
  return `<section class="card sec"><h2>${esc(d.hospital)} 평가 등급 <small>심평원</small></h2>
    ${g.mine.length ? `<ul class="grades">${g.mine.map(li).join('')}</ul>` : '<p class="note" style="margin:0">이 의사 진료과와 직접 관련된 평가 항목은 없어요.</p>'}
    ${g.rest.length ? `<details><summary class="note" style="margin:8px 0 0;cursor:pointer">이 병원의 다른 평가 ${g.rest.length}개</summary><ul class="grades">${g.rest.map(li).join('')}</ul></details>` : ''}
    <p class="note" style="margin:8px 0 0">의사 개인이 아닌 <b>병원 전체</b> 평가예요 (1등급이 가장 좋음). 건강보험심사평가원 적정성 평가 최근 결과 · ${esc(g.at)} 확인</p>
  </section>`;
}
function bookSec(d) {
  const h = HOSP_INFO[d.code] || {};
  const b = h.book || {};
  const who = `${d.dept ? d.dept + ' ' : ''}${d.name}${d.title ? ' ' + d.title : ''}`;
  const btns = [
    b.url ? `<a class="btn primary" href="${esc(b.url)}" target="_blank" rel="noopener">온라인 진료예약</a>`
      : `<a class="btn primary" href="${esc(d.sourceUrl)}" target="_blank" rel="noopener">병원 의료진 페이지에서 예약</a>`,
    b.tel ? `<a class="btn" href="tel:${esc(b.tel.replace(/[^0-9]/g, ''))}">예약 전화 ${esc(b.tel)}</a>` : '',
    b.kakao ? `<a class="btn" href="${esc(b.kakao)}" target="_blank" rel="noopener">카카오톡으로 예약</a>` : '',
  ].filter(Boolean).join('');
  return `<section class="card sec"><h2>진료 예약</h2>
    <div class="book-btns">${btns}</div>
    <p class="note" style="margin:10px 0 0">예약 화면에서 <b>${esc(who)}</b>를 고르세요.
      <button class="linkish" id="copyWho" type="button">이름 복사</button></p>
    ${h.type === '상급종합' ? `<details class="note" style="margin:8px 0 0"><summary style="cursor:pointer">처음 진료라면 <b>진료의뢰서</b>를 준비하세요</summary>
      <p style="margin:6px 0 0">${esc(d.hospital)}은 상급종합병원이라, 처음 진료받을 때 동네 병·의원에서 받은 진료의뢰서가 있어야 건강보험이 적용돼요.
      응급, 분만, 치과, 가정의학과, 장애인의 재활의학과 진료, 혈우병은 의뢰서 없이도 돼요. 의뢰서는 가까운 의원에서 진료를 받고 요청하면 발급해 줘요.</p></details>` : ''}
    <p class="note" style="margin:8px 0 0">이 앱은 예약을 대신 해 주지 않아요. 병원 홈페이지·전화로 직접 예약해요. 진료 일정은 병원 사정에 따라 바뀔 수 있어요.</p>
  </section>`;
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
  const top = (d.roles || []).filter(r => r.r === 3).length;
  if (top) tiles.push(`<div class="tile"><div class="v">${top}<small>곳</small></div><div class="l">학회 회장·이사장</div></div>`);
  else if ((d.career || []).length) tiles.push(`<div class="tile"><div class="v">${d.career.length}<small>건</small></div><div class="l">경력 항목</div></div>`);
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
      ${(d.specialties || []).length ? `<div class="chips">${d.specialties.map(s => `<span class="chip ${SURG_RE.test(s) ? 'surg' : ''}">${esc(s)}</span>`).join('')}</div>` : ''}
      ${(d.specialties || []).some(x => SURG_RE.test(x)) ? '<p class="note" style="margin:8px 0 0">주황색 = 진료분야에 적힌 수술·시술 (병원이 수술 건수는 공개하지 않아요)</p>' : ''}
    </section>
    ${tiles.length ? `<div class="tiles">${tiles.join('')}</div>` : '<div style="height:12px"></div>'}
    ${bookSec(d)}
    ${gradeSec(d)}
    ${now.length ? `<section class="card sec"><h2>현재 맡고 있는 일</h2><ul>${now.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}
    ${(d.roles || []).length ? `<section class="card sec"><h2>학회 주요 직책 <small>${d.roles.length}</small></h2>
      <p class="note" style="margin:0 0 6px">그 분야 학회에서 회장·이사 등을 맡았다는 건 동료 의사들에게 인정받는다는 간접 지표예요.</p>
      <ul>${d.roles.map(r => `<li class="${r.now ? 'cur' : ''}">${r.r === 3 ? '<b>' : ''}${esc(r.t)}${r.r === 3 ? '</b>' : ''}</li>`).join('')}</ul></section>` : ''}
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
  $('#copyWho').onclick = () => {
    const txt = d.name;
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject())
      .then(() => toast(`'${txt}' 복사했어요`), () => toast('복사하지 못했어요'));
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
      <p class="note">병원 평가 등급 출처: 건강보험심사평가원 병원평가정보서비스 (공공데이터포털, 공공누리 제1유형).</p>
    </section>
    <section class="card sec"><h2>홈 화면에 추가</h2>${installBanner(true)}</section>
    <section class="card sec"><h2>내 메모 백업</h2>
      <p class="note" style="margin:0 0 10px">관심 의사와 메모는 이 폰의 브라우저에만 저장돼요 (${memoCount}명).</p>
      <div class="row"><button class="btn" id="exportBtn">내보내기</button>
        <label class="btn">가져오기<input type="file" id="importFile" accept="application/json,.json" hidden></label></div>
    </section>`;
  bindInstall();
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
