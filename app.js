'use strict';
// 의사 이력 — 의사별 경력·전문분야·병원 공개 실적 + 소속 병원 공공데이터(심평원)를 한 화면에.
// 데이터는 이 기기의 localStorage 에만 저장된다. 백업은 설정 > 내보내기.

const API = 'https://apis.data.go.kr/B551182';
const KEY_DOCS = 'dp.doctors';
const KEY_API = 'dp.apikey';
const THIS_YEAR = new Date().getFullYear();

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');

// ---------- 저장 ----------
function load(k, fallback) {
  try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); }
  catch { return fallback; }
}
function save(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch { toast('저장하지 못했어요 (브라우저 저장소 사용 불가)'); return false; }
}
let doctors = load(KEY_DOCS, []);
const persist = () => save(KEY_DOCS, doctors);
const getDoc = id => doctors.find(d => d.id === id);

// ---------- 유틸 ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lines = s => String(s || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
const fmtNum = n => Number(n).toLocaleString('ko-KR');
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

// 전문의 취득 연도: 직접 입력 > 학력·경력 중 '전문의'가 들어간 줄의 연도
function specialistYear(d) {
  if (d.specialistYear) return Number(d.specialistYear);
  for (const l of [...(d.education || []), ...(d.career || [])]) {
    if (/전문의/.test(l)) { const m = l.match(/(19[5-9]\d|20[0-4]\d)/); if (m) return Number(m[1]); }
  }
  return null;
}

// ---------- 의료진 소개 글 자동 분류 ----------
const SECTION_MAP = [
  [/^(학력|학위)$/, 'education'],
  [/^(경력|약력|주요경력|현직|전직|이력)$/, 'career'],
  [/^(학회|학회활동|학회및대외활동|대외활동|사회활동|수상|수상경력|논문|저서|연구|연구실적|주요논문)$/, 'societies'],
  [/^(진료분야|전문분야|진료과목|전문진료분야|주요진료분야|진료영역|전문진료)$/, 'specialties'],
];
function sectionOf(header) {
  const h = header.replace(/[\s\[\]【】■●◆◇▶▷·•*\-:：<>]/g, '');
  for (const [re, key] of SECTION_MAP) if (re.test(h)) return key;
  return null;
}
function classifyLine(l) {
  if (/(대학교|의과대학|의학과|대학원|졸업|학사|석사|박사|의학전문대학원)/.test(l) && !/(교수|임상강사|전임의|과장|원장)/.test(l)) return 'education';
  if (/(학회|정회원|평생회원|이사|위원|수상|논문|저널|Journal|SCI)/i.test(l)) return 'societies';
  return 'career';
}
const STAT_RE = /([가-힣A-Za-z][가-힣A-Za-z0-9·\/ ]{0,24}?) *(?:누적 *|총 *|약 *)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?) *(만)? *(례|건|케이스|명|회)/g;
function parseStats(text) {
  const out = [];
  for (const m of lines(text).flatMap(l => [...l.replace(/	/g, ' ').matchAll(STAT_RE)])) {
    let label = m[1].replace(/\s+/g, ' ').trim().replace(/^(누적|총|약|연간)\s*/, '');
    if (/^제$|제$/.test(label) && m[4] === '회') continue;           // "제12회 학술대회" 같은 것 제외
    let v = parseFloat(m[2].replace(/,/g, '')) * (m[3] ? 10000 : 1);
    if (!label || v < 10) continue;
    if (m[4] === '회' && v < 100) continue;
    if (out.some(s => s.label === label && s.value === v)) continue;
    out.push({ label, value: Math.round(v), unit: m[4] });
  }
  return out;
}
function parseProfile(text) {
  const r = { education: [], career: [], societies: [], specialties: [], stats: parseStats(text) };
  let cur = null;
  for (const raw of lines(text)) {
    const l = raw.replace(/^[\s•·\-*▪■□●○◆◇▶▷]+/, '').trim();
    if (!l) continue;
    // "진료분야: 무릎, 어깨" 처럼 한 줄에 제목+내용
    const inline = l.match(/^([^:：]{2,12})\s*[:：]\s*(.+)$/);
    if (inline && sectionOf(inline[1])) {
      const key = sectionOf(inline[1]);
      if (key === 'specialties') r.specialties.push(...inline[2].split(/[,，、·\/]/).map(x => x.trim()).filter(Boolean));
      else r[key].push(inline[2].trim());
      cur = key; continue;
    }
    if (l.length <= 14 && sectionOf(l)) { cur = sectionOf(l); continue; }
    if (cur === 'specialties') { r.specialties.push(...l.split(/[,，、·\/]/).map(x => x.trim()).filter(Boolean)); continue; }
    if (parseStats(l).length) { r.career.push(l); continue; }   // 실적 문장은 경력으로
    (cur ? r[cur] : r[classifyLine(l)]).push(l);
  }
  r.specialties = [...new Set(r.specialties)];
  return r;
}

// ---------- 심평원 공공데이터 ----------
function apiKey() { return load(KEY_API, ''); }
async function callApi(path, params) {
  const key = apiKey();
  if (!key) throw new Error('설정에서 공공데이터포털 인증키를 먼저 넣어 주세요.');
  const k = key.includes('%') ? key : encodeURIComponent(key);
  const qs = Object.entries({ ...params, _type: 'json' }).map(([a, b]) => `${a}=${encodeURIComponent(b)}`).join('&');
  let res;
  try { res = await fetch(`${API}/${path}?serviceKey=${k}&${qs}`); }
  catch { throw new Error('공공데이터 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.'); }
  const text = await res.text();
  let items = [], err = null;
  if (text.trim().startsWith('{')) {
    const j = JSON.parse(text);
    const h = j.OpenAPI_ServiceResponse?.cmmMsgHeader;
    if (h) err = `${h.returnAuthMsg || h.errMsg} (${h.returnReasonCode})`;
    else if (j.response?.header?.resultCode && j.response.header.resultCode !== '00') err = j.response.header.resultMsg;
    else { const it = j.response?.body?.items?.item; items = it ? (Array.isArray(it) ? it : [it]) : []; }
  } else {
    const x = new DOMParser().parseFromString(text, 'text/xml');
    const auth = x.querySelector('returnAuthMsg');
    const code = x.querySelector('resultCode');
    if (auth) err = auth.textContent;
    else if (code && code.textContent !== '00') err = x.querySelector('resultMsg')?.textContent || '오류';
    else items = [...x.querySelectorAll('item')].map(n => Object.fromEntries([...n.children].map(c => [c.tagName, c.textContent])));
  }
  if (err) {
    if (/SERVICE_KEY|서비스키|인증/.test(err)) err += ' — 키가 맞는지, 활용신청 승인이 났는지 확인해 주세요 (승인 후 반영까지 1~2시간 걸릴 수 있어요).';
    throw new Error(err);
  }
  return items;
}
const searchHospitals = name => callApi('hospInfoServicev2/getHospBasisList', { yadmNm: name, pageNo: 1, numOfRows: 20 });
const fetchDepts = ykiho => callApi('MadmDtlInfoService2.8/getDgsbjtInfo2.8', { ykiho, pageNo: 1, numOfRows: 100 });

function hospFromItem(it) {
  return {
    ykiho: it.ykiho, name: it.yadmNm, kind: it.clCdNm, addr: it.addr, tel: it.telno,
    url: it.hospUrl, estb: it.estbDd, drTotal: num(it.drTotCnt), sdrTotal: num(it.mdeptSdrCnt),
    region: [it.sidoCdNm, it.sgguCdNm].filter(Boolean).join(' '),
  };
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
async function refreshHospital(hosp) {
  const [basis] = await searchHospitals(hosp.name).then(list => list.filter(i => i.ykiho === hosp.ykiho));
  const base = basis ? hospFromItem(basis) : hosp;
  let depts = hosp.depts || [];
  try {
    depts = (await fetchDepts(hosp.ykiho)).map(d => ({ name: d.dgsbjtCdNm, sdr: num(d.dgsbjtPrSdrCnt), dr: num(d.cdiagDrCnt) }))
      .filter(d => d.name);
  } catch (e) { if (!depts.length) toast('진료과 정보: ' + e.message); }
  return { ...base, depts, fetchedAt: today() };
}

// ---------- 라우팅 ----------
function go(hash) { location.hash = hash; }
window.addEventListener('hashchange', render);
$('#backBtn').onclick = () => (history.length > 1 ? history.back() : go('#/'));
$('#settingsBtn').onclick = () => go('#/settings');
$('#addBtn').onclick = () => go('#/new');

function setChrome(title, back, fab) {
  $('#title').textContent = title;
  $('#backBtn').hidden = !back;
  $('#addBtn').hidden = !fab;
  document.title = title === '의사 이력' ? title : `${title} · 의사 이력`;
  window.scrollTo(0, 0);
}
function render() {
  const h = location.hash || '#/';
  let m;
  if ((m = h.match(/^#\/d\/(.+)$/))) return renderDetail(m[1]);
  if ((m = h.match(/^#\/e\/(.+)$/))) return renderEdit(m[1]);
  if (h === '#/new') return renderEdit(null);
  if (h === '#/settings') return renderSettings();
  renderList();
}

// ---------- 목록 ----------
let query = '';
function renderList() {
  setChrome('의사 이력', false, true);
  if (!doctors.length) {
    view.innerHTML = `<div class="empty">
      <p><b>아직 등록한 의사가 없어요.</b></p>
      <p>오른쪽 아래 <b>＋</b>를 눌러 추가하세요.<br>병원 홈페이지 의료진 소개 글을 복사해 붙여 넣으면 학력·경력·실적이 자동으로 나뉘어요.</p>
      ${apiKey() ? '' : '<p class="note">소속 병원 공공데이터(의사 수·전문의 수)를 붙이려면 <a href="#/settings">설정</a>에서 인증키를 넣어 주세요.</p>'}
    </div>`;
    return;
  }
  view.innerHTML = `<input class="search" type="search" placeholder="이름·병원·진료과·전문분야 검색" value="${esc(query)}" id="q"><div id="list"></div>`;
  const draw = () => {
    const q = query.trim().toLowerCase();
    const list = doctors
      .filter(d => !q || [d.name, d.hospital, d.dept, ...(d.specialties || [])].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    $('#list').innerHTML = list.map(d => {
      const y = specialistYear(d);
      const top = (d.stats || []).slice(0, 2).map(s => `<span class="chip">${esc(s.label)} ${fmtNum(s.value)}${esc(s.unit)}</span>`).join('');
      const yrs = y ? `<span class="chip">전문의 ${THIS_YEAR - y}년</span>` : '';
      const sp = (d.specialties || []).slice(0, 4).map(s => `<span class="chip plain">${esc(s)}</span>`).join('');
      return `<button class="card doc-item" data-id="${esc(d.id)}">
        <div class="name">${esc(d.name)} <span class="sub">${esc(d.title || '')}</span></div>
        <div class="sub">${esc([d.hospital, d.dept].filter(Boolean).join(' · '))}</div>
        ${top || yrs || sp ? `<div class="chips">${yrs}${top}${sp}</div>` : ''}
      </button>`;
    }).join('') || '<p class="empty">검색 결과가 없어요.</p>';
  };
  draw();
  $('#q').oninput = e => { query = e.target.value; draw(); };
  $('#list').onclick = e => { const b = e.target.closest('[data-id]'); if (b) go('#/d/' + b.dataset.id); };
}

// ---------- 상세 ----------
function listSec(title, arr) {
  if (!arr || !arr.length) return '';
  return `<section class="card sec"><h2>${title}</h2><ul>${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>`;
}
function hospSec(d) {
  const h = d.hosp;
  if (!h) {
    return `<section class="card sec"><h2>소속 병원 공공데이터</h2>
      <p class="note" style="margin:0">아직 연결 안 됨. <a href="#/e/${esc(d.id)}">수정</a>에서 병원을 검색해 연결하면 의사 수·진료과별 전문의 수를 심평원 자료로 보여줘요.</p></section>`;
  }
  const dept = d.dept ? (h.depts || []).find(x => x.name && (x.name.includes(d.dept) || d.dept.includes(x.name))) : null;
  const estb = h.estb && /^\d{8}$/.test(h.estb) ? `${h.estb.slice(0, 4)}.${h.estb.slice(4, 6)}.${h.estb.slice(6)}` : h.estb;
  const rows = [
    ['병원명', esc(h.name)],
    ['종별', esc(h.kind)],
    ['의사 수', h.drTotal != null ? `${fmtNum(h.drTotal)}명` : ''],
    ['전문의 수', h.sdrTotal != null ? `${fmtNum(h.sdrTotal)}명` : ''],
    dept ? [`${esc(dept.name)} 전문의`, dept.sdr != null ? `${fmtNum(dept.sdr)}명` : ''] : null,
    ['개설일', esc(estb)],
    ['주소', esc(h.addr)],
    ['전화', h.tel ? `<a href="tel:${esc(h.tel)}">${esc(h.tel)}</a>` : ''],
  ].filter(r => r && r[1]);
  const deptChips = (h.depts || []).filter(x => x.sdr).sort((a, b) => b.sdr - a.sdr)
    .map(x => `<span class="chip ${dept && x.name === dept.name ? '' : 'plain'}">${esc(x.name)} ${x.sdr}</span>`).join('');
  return `<section class="card sec"><h2>소속 병원 공공데이터 (심평원)</h2>
    <dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    ${deptChips ? `<div class="note">진료과별 전문의 수</div><div class="chips">${deptChips}</div>` : ''}
    <div class="row" style="margin-top:10px">
      <button class="btn" id="refreshHosp">새로고침</button>
      ${h.url ? `<a class="btn" href="${esc(h.url.startsWith('http') ? h.url : 'http://' + h.url)}" target="_blank" rel="noopener">병원 홈페이지</a>` : ''}
    </div>
    <p class="note">기준일 ${esc(h.fetchedAt || '-')} · 병원 단위 자료예요. 의사 개인별 수술 건수는 공공데이터로 공개되지 않아요.</p>
  </section>`;
}
function renderDetail(id) {
  const d = getDoc(id);
  if (!d) return go('#/');
  setChrome(d.name, true, false);
  const y = specialistYear(d);
  const tiles = [];
  if (y) tiles.push(`<div class="tile"><div class="v">${THIS_YEAR - y}<small>년</small></div><div class="l">전문의 경력 (${y}년 취득)</div></div>`);
  for (const s of d.stats || []) tiles.push(`<div class="tile"><div class="v">${fmtNum(s.value)}<small>${esc(s.unit)}</small></div><div class="l">${esc(s.label)}</div></div>`);
  if (d.hosp?.drTotal) tiles.push(`<div class="tile"><div class="v">${fmtNum(d.hosp.drTotal)}<small>명</small></div><div class="l">소속 병원 의사 수</div></div>`);
  const search = encodeURIComponent([d.hospital, d.name, d.dept].filter(Boolean).join(' '));
  view.innerHTML = `
    <section class="hero">
      <p class="name">${esc(d.name)} <span class="sub" style="font-size:16px;font-weight:500">${esc(d.title || '')}</span></p>
      <div class="sub">${esc([d.hospital, d.dept].filter(Boolean).join(' · '))}</div>
      ${(d.specialties || []).length ? `<div class="chips">${d.specialties.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>` : ''}
    </section>
    ${tiles.length ? `<div class="tiles">${tiles.join('')}</div>` : '<div style="height:12px"></div>'}
    ${(d.stats || []).length ? '<p class="note" style="margin-top:-4px">실적 숫자는 병원·의사가 직접 공개한 내용이에요.</p>' : ''}
    ${d.memo ? `<section class="card sec"><h2>진료 메모 · 물어볼 것</h2><div class="memo">${esc(d.memo)}</div></section>` : ''}
    ${listSec('경력', d.career)}
    ${listSec('학력', d.education)}
    ${listSec('학회 · 활동', d.societies)}
    ${hospSec(d)}
    <section class="card sec"><h2>출처</h2>
      ${d.sourceUrl ? `<p style="margin:0 0 6px;word-break:break-all"><a href="${esc(d.sourceUrl)}" target="_blank" rel="noopener">${esc(d.sourceUrl)}</a></p>` : ''}
      <p class="note" style="margin:0 0 10px">마지막 확인 ${esc(d.checkedAt || d.updatedAt || '-')}</p>
      <a class="btn" href="https://search.naver.com/search.naver?query=${search}" target="_blank" rel="noopener">인터넷에서 더 찾아보기</a>
    </section>
    <div class="row"><button class="btn primary" id="editBtn" style="flex:1">수정</button><button class="btn danger" id="delBtn">삭제</button></div>`;
  $('#editBtn').onclick = () => go('#/e/' + id);
  $('#delBtn').onclick = () => {
    if (!confirm(`${d.name} 기록을 삭제할까요?`)) return;
    doctors = doctors.filter(x => x.id !== id); persist(); go('#/');
  };
  const rb = $('#refreshHosp');
  if (rb) rb.onclick = async () => {
    rb.disabled = true; rb.textContent = '불러오는 중…';
    try { d.hosp = await refreshHospital(d.hosp); persist(); toast('병원 정보를 새로 받았어요'); renderDetail(id); }
    catch (e) { toast(e.message); rb.disabled = false; rb.textContent = '새로고침'; }
  };
}

// ---------- 추가/수정 ----------
function renderEdit(id) {
  const src = id ? getDoc(id) : null;
  if (id && !src) return go('#/');
  const d = src ? structuredClone(src) : { id: uid(), stats: [], specialties: [], education: [], career: [], societies: [] };
  setChrome(src ? '수정' : '의사 추가', true, false);
  view.innerHTML = `
    <section class="card">
      <label class="f"><span>의료진 소개 붙여넣기 (선택)</span>
        <textarea id="paste" class="big" placeholder="병원 홈페이지 의료진 소개에서 학력·경력·진료분야 부분을 복사해 붙여 넣으세요."></textarea>
        <em>‘자동 채우기’를 누르면 아래 칸에 나눠 들어가요. 들어간 뒤 직접 고치면 돼요.</em></label>
      <button class="btn full" id="parseBtn">자동 채우기</button>
    </section>
    <section class="card">
      <div class="grid2">
        <label class="f"><span>이름 *</span><input type="text" id="name" value="${esc(d.name)}"></label>
        <label class="f"><span>직함</span><input type="text" id="title" value="${esc(d.title)}" placeholder="교수, 원장 등"></label>
        <label class="f"><span>병원</span><input type="text" id="hospital" value="${esc(d.hospital)}"></label>
        <label class="f"><span>진료과</span><input type="text" id="dept" value="${esc(d.dept)}" placeholder="정형외과"></label>
      </div>
      <label class="f"><span>전문분야</span><input type="text" id="specialties" value="${esc((d.specialties || []).join(', '))}" placeholder="쉼표로 구분: 무릎 인공관절, 연골"></label>
      <label class="f"><span>전문의 취득 연도</span><input type="number" id="specialistYear" inputmode="numeric" min="1950" max="${THIS_YEAR}" value="${esc(d.specialistYear || '')}">
        <em>비워 두면 학력·경력에서 ‘전문의’가 들어간 줄의 연도를 씁니다.</em></label>
    </section>
    <section class="card">
      <label class="f" style="margin-bottom:6px"><span>공개된 실적</span><em>예: 인공관절 수술 3,000례 — 병원·의사가 공개한 숫자</em></label>
      <div id="stats"></div>
      <button class="btn" id="addStat">＋ 실적 추가</button>
    </section>
    <section class="card">
      <label class="f"><span>경력</span><textarea id="career" placeholder="한 줄에 하나씩">${esc((d.career || []).join('\n'))}</textarea></label>
      <label class="f"><span>학력</span><textarea id="education">${esc((d.education || []).join('\n'))}</textarea></label>
      <label class="f"><span>학회 · 활동</span><textarea id="societies">${esc((d.societies || []).join('\n'))}</textarea></label>
    </section>
    <section class="card">
      <label class="f" style="margin-bottom:6px"><span>소속 병원 공공데이터 연결</span></label>
      <div id="hospLinked"></div>
      <div class="row"><input type="search" id="hospQ" placeholder="병원 이름으로 검색" style="flex:1" value="${esc(d.hosp?.name || d.hospital || '')}"><button class="btn" id="hospSearch">검색</button></div>
      <div id="hospResults"></div>
    </section>
    <section class="card">
      <label class="f"><span>진료 메모 · 물어볼 것</span><textarea id="memo" placeholder="다음 진료 때 물어볼 것, 진료 받아본 느낌 등">${esc(d.memo)}</textarea></label>
      <label class="f"><span>출처 주소</span><input type="url" id="sourceUrl" value="${esc(d.sourceUrl)}" placeholder="의료진 소개 페이지 주소"></label>
      <label class="f"><span>마지막 확인일</span><input type="text" id="checkedAt" value="${esc(d.checkedAt || today())}"></label>
    </section>
    <button class="btn primary full" id="saveBtn">저장</button>`;

  const statsEl = $('#stats');
  const drawStats = () => {
    statsEl.innerHTML = d.stats.map((s, i) => `<div class="stat-row" data-i="${i}">
      <input type="text" data-k="label" value="${esc(s.label)}" placeholder="항목">
      <input type="number" data-k="value" inputmode="numeric" value="${esc(s.value)}" placeholder="숫자">
      <input type="text" data-k="unit" value="${esc(s.unit)}" placeholder="단위">
      <button class="icon-btn" data-del="${i}" aria-label="삭제" style="width:32px;font-size:18px">✕</button></div>`).join('');
  };
  drawStats();
  statsEl.oninput = e => {
    const row = e.target.closest('[data-i]'); if (!row) return;
    const s = d.stats[row.dataset.i]; const k = e.target.dataset.k;
    s[k] = k === 'value' ? Number(e.target.value) : e.target.value;
  };
  statsEl.onclick = e => { const b = e.target.closest('[data-del]'); if (b) { d.stats.splice(+b.dataset.del, 1); drawStats(); } };
  $('#addStat').onclick = () => { d.stats.push({ label: '', value: '', unit: '례' }); drawStats(); };

  $('#parseBtn').onclick = () => {
    const text = $('#paste').value;
    if (!text.trim()) return toast('먼저 소개 글을 붙여 넣어 주세요');
    const r = parseProfile(text);
    const merge = (elId, arr) => {
      if (!arr.length) return;
      const cur = lines($(elId).value);
      $(elId).value = [...new Set([...cur, ...arr])].join('\n');
    };
    merge('#career', r.career); merge('#education', r.education); merge('#societies', r.societies);
    if (r.specialties.length) {
      const cur = $('#specialties').value.split(',').map(x => x.trim()).filter(Boolean);
      $('#specialties').value = [...new Set([...cur, ...r.specialties])].join(', ');
    }
    for (const s of r.stats) if (!d.stats.some(x => x.label === s.label && Number(x.value) === s.value)) d.stats.push(s);
    drawStats();
    toast(`경력 ${r.career.length} · 학력 ${r.education.length} · 활동 ${r.societies.length} · 실적 ${r.stats.length}줄을 채웠어요`);
  };

  const drawLinked = () => {
    $('#hospLinked').innerHTML = d.hosp
      ? `<p style="margin:0 0 8px">연결됨: <b>${esc(d.hosp.name)}</b> <span class="note">${esc(d.hosp.kind || '')} · ${esc(d.hosp.region || d.hosp.addr || '')}</span>
         <button class="btn" id="unlink" style="padding:4px 10px;font-size:13px;margin-left:4px">해제</button></p>`
      : (apiKey() ? '' : '<p class="note warn" style="margin:0 0 8px">설정에서 공공데이터포털 인증키를 넣어야 검색할 수 있어요.</p>');
    const u = $('#unlink'); if (u) u.onclick = () => { d.hosp = null; drawLinked(); };
  };
  drawLinked();
  let results = [];
  $('#hospSearch').onclick = async () => {
    const q = $('#hospQ').value.trim(); if (!q) return;
    const out = $('#hospResults'); out.innerHTML = '<p class="note">검색 중…</p>';
    try {
      results = (await searchHospitals(q)).map(hospFromItem);
      out.innerHTML = results.length
        ? results.map((h, i) => `<button class="btn hosp-result" data-h="${i}">${esc(h.name)}<div class="sub">${esc(h.kind || '')} · ${esc(h.addr || '')}</div></button>`).join('')
        : '<p class="note">검색 결과가 없어요. 병원 정식 이름 일부로 다시 찾아보세요.</p>';
    } catch (e) { out.innerHTML = `<p class="note err">${esc(e.message)}</p>`; }
  };
  $('#hospQ').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('#hospSearch').click(); } };
  $('#hospResults').onclick = async e => {
    const b = e.target.closest('[data-h]'); if (!b) return;
    const h = results[b.dataset.h];
    $('#hospResults').innerHTML = '<p class="note">진료과 정보 받는 중…</p>';
    let depts = [];
    try { depts = (await fetchDepts(h.ykiho)).map(x => ({ name: x.dgsbjtCdNm, sdr: num(x.dgsbjtPrSdrCnt), dr: num(x.cdiagDrCnt) })).filter(x => x.name); }
    catch (err) { toast('진료과 정보: ' + err.message); }
    d.hosp = { ...h, depts, fetchedAt: today() };
    if (!$('#hospital').value.trim()) $('#hospital').value = h.name;
    $('#hospResults').innerHTML = '';
    drawLinked();
  };

  $('#saveBtn').onclick = () => {
    const name = $('#name').value.trim();
    if (!name) { toast('이름을 입력해 주세요'); $('#name').focus(); return; }
    Object.assign(d, {
      name, title: $('#title').value.trim(), hospital: $('#hospital').value.trim(), dept: $('#dept').value.trim(),
      specialties: $('#specialties').value.split(/[,，]/).map(x => x.trim()).filter(Boolean),
      specialistYear: $('#specialistYear').value ? Number($('#specialistYear').value) : null,
      career: lines($('#career').value), education: lines($('#education').value), societies: lines($('#societies').value),
      stats: d.stats.filter(s => s.label && Number(s.value) > 0).map(s => ({ ...s, value: Number(s.value) })),
      memo: $('#memo').value.trim(), sourceUrl: $('#sourceUrl').value.trim(), checkedAt: $('#checkedAt').value.trim(),
      updatedAt: new Date().toISOString(),
    });
    const i = doctors.findIndex(x => x.id === d.id);
    if (i >= 0) doctors[i] = d; else doctors.push(d);
    if (persist()) { toast('저장했어요'); location.replace('#/d/' + d.id); }
  };
}

// ---------- 설정 ----------
function renderSettings() {
  setChrome('설정', true, false);
  view.innerHTML = `
    <section class="card">
      <label class="f"><span>공공데이터포털 인증키</span>
        <input type="text" id="key" value="${esc(apiKey())}" placeholder="일반 인증키 (Decoding 또는 Encoding)" autocomplete="off">
        <em>data.go.kr에서 아래 두 API를 <b>활용신청</b>한 뒤 마이페이지의 인증키를 붙여 넣으세요 (무료, 보통 자동 승인).<br>
        · 건강보험심사평가원_병원정보서비스<br>· 건강보험심사평가원_의료기관별상세정보서비스</em></label>
      <div class="row"><button class="btn primary" id="saveKey">저장</button><button class="btn" id="testKey">연결 테스트</button></div>
      <p class="note" id="keyMsg"></p>
    </section>
    <section class="card">
      <h2 style="font-size:15px;margin:0 0 6px">백업</h2>
      <p class="note" style="margin:0 0 10px">기록은 이 기기의 브라우저에만 저장돼요. 폰을 바꾸거나 앱을 지우기 전에 내보내 두세요.</p>
      <div class="row"><button class="btn" id="exportBtn">내보내기 (${doctors.length}명)</button>
        <label class="btn">가져오기<input type="file" id="importFile" accept="application/json,.json" hidden></label></div>
    </section>
    <p class="note">의사 개인별 진료·수술 건수는 국내 공공데이터로 공개되지 않아요. 이 앱의 실적 숫자는 병원·의사가 직접 공개한 내용이고, 공공데이터는 병원 단위 정보예요.</p>`;
  $('#saveKey').onclick = () => { save(KEY_API, $('#key').value.trim()); toast('인증키를 저장했어요'); };
  $('#testKey').onclick = async () => {
    save(KEY_API, $('#key').value.trim());
    const msg = $('#keyMsg'); msg.className = 'note'; msg.textContent = '확인 중…';
    try {
      const r = await searchHospitals('서울대학교병원');
      if (!r.length) throw new Error('응답은 왔지만 결과가 비어 있어요.');
      try { await fetchDepts(r[0].ykiho); msg.textContent = '✓ 두 API 모두 정상이에요.'; }
      catch (e) { msg.className = 'note warn'; msg.textContent = '병원정보는 정상, 상세정보서비스 오류: ' + e.message; }
    } catch (e) { msg.className = 'note err'; msg.textContent = e.message; }
  };
  $('#exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify({ app: 'doctor-profile', version: 1, exportedAt: new Date().toISOString(), doctors }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `의사이력-${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#importFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const list = Array.isArray(j) ? j : j.doctors;
      if (!Array.isArray(list)) throw 0;
      let added = 0, updated = 0;
      for (const d of list) {
        if (!d || !d.id || !d.name) continue;
        const i = doctors.findIndex(x => x.id === d.id);
        if (i >= 0) { doctors[i] = d; updated++; } else { doctors.push(d); added++; }
      }
      persist(); toast(`추가 ${added}명, 갱신 ${updated}명`); renderSettings();
    } catch { toast('백업 파일을 읽지 못했어요'); }
  };
}

// ---------- 시작 ----------
if (typeof module !== 'undefined') module.exports = { parseProfile, parseStats, specialistYear };
else {
  render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
}
