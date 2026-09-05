/* ═══════════════════════════════════════════════
   거만어 Quiz — App
   데이터: js/vocab-data.js 의 VOCAB (3,000단어)
   저장:   localStorage "gv.*" (기기 로컬, 로그인 없음)
   ═══════════════════════════════════════════════ */

"use strict";

/* ── 0. 유틸 ── */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const todayYmd = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const DAY_MS = 86400000;

function toast(msg, ms = 2200) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.remove("show"), ms);
}

/* ── 1. 저장소 ── */
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem("gv." + key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem("gv." + key, JSON.stringify(val)); }
    catch (e) { console.warn("storage full?", e); }
  },
};

// 단어별 기록: {cn: {s(een), o(k), n(g=틀림), b(ox 1~5), d(ue ts), t(last ts)}}
let WORDS = store.get("words", {});
let SESSIONS = store.get("sessions", []);
let STARS = new Set(store.get("stars", []));
let HEAT = store.get("heat", {});
let SETTINGS = Object.assign(
  { theme: null, days: [1], count: 20, dir: "e2k", autoSpeak: true },
  store.get("settings", {})
);

const saveWords = () => store.set("words", WORDS);
const saveSettings = () => store.set("settings", SETTINGS);

// Leitner 박스 → 다음 복습 간격(일)
const SRS_DAYS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 14 };

function wrec(cn) {
  return WORDS[cn] || { s: 0, o: 0, n: 0, b: 0, d: 0, t: 0 };
}

function record(cn, correct) {
  const w = wrec(cn);
  w.s += 1;
  if (correct) { w.o += 1; w.b = Math.min(5, (w.b || 0) + 1); }
  else { w.n += 1; w.b = 1; }
  w.d = Date.now() + SRS_DAYS[w.b] * DAY_MS;
  w.t = Date.now();
  WORDS[cn] = w;
  const ymd = todayYmd();
  HEAT[ymd] = (HEAT[ymd] || 0) + 1;
  commitRecords(); // 매 답변 즉시 저장 — 도중에 닫아도 기록 유지
}
function commitRecords() { saveWords(); store.set("heat", HEAT); }

function logSession(mode, rangeLabel, n, ok) {
  SESSIONS.unshift({ t: Date.now(), mode, range: rangeLabel, n, ok });
  if (SESSIONS.length > 100) SESSIONS.length = 100;
  store.set("sessions", SESSIONS);
}

/* ── 2. 데이터 인덱스 ── */
const BY_CN = new Map(VOCAB.map((w) => [w.cn, w]));
const KNOWN_KO_TERMS = new Set(
  VOCAB.flatMap((w) => KoGrader.parseMeaningUnits(w.meaning))
);
const BY_DAY = {};
VOCAB.forEach((w) => { (BY_DAY[w.ch] = BY_DAY[w.ch] || []).push(w); });
const ALL_DAYS = Object.keys(BY_DAY).map(Number).sort((a, b) => a - b);
const meaningText = (w) => w.meaning.replace(/<br>/g, " / ");

function wrongPool() {
  return VOCAB.filter((w) => { const r = WORDS[w.cn]; return r && r.n > 0 && r.b < 4; });
}
function duePool() {
  const now = Date.now();
  return VOCAB.filter((w) => { const r = WORDS[w.cn]; return r && r.s > 0 && r.d <= now; });
}

/* ── 3. 테마 ── */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  $("meta-theme").setAttribute("content", theme === "dark" ? "#262624" : "#faf9f5");
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme");
  SETTINGS.theme = cur === "dark" ? "light" : "dark";
  saveSettings();
  applyTheme(SETTINGS.theme);
}
applyTheme(SETTINGS.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));

/* ── 4. TTS (Web Speech API) ── */
const tts = {
  voice: null,
  pick() {
    const vs = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
    if (!vs.length) return null;
    const prefer = ["Samantha", "Ava", "Allison", "Google US English", "Karen", "Daniel"];
    for (const name of prefer) {
      const v = vs.find((x) => x.name.includes(name));
      if (v) return v;
    }
    return vs.find((v) => v.lang === "en-US") || vs[0];
  },
  speak(text, btn) {
    if (!("speechSynthesis" in window)) { toast("이 기기는 음성 합성을 지원하지 않아요"); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/~/g, ""));
    if (!this.voice) this.voice = this.pick();
    if (this.voice) u.voice = this.voice;
    u.lang = "en-US";
    u.rate = 0.92;
    if (btn) {
      btn.classList.add("playing");
      u.onend = u.onerror = () => btn.classList.remove("playing");
    }
    speechSynthesis.speak(u);
  },
};
if ("speechSynthesis" in window) {
  speechSynthesis.onvoiceschanged = () => { tts.voice = tts.pick(); };
}
function toggleAutoSpeak(el) {
  el.classList.toggle("on");
  SETTINGS.autoSpeak = el.classList.contains("on");
  saveSettings();
}

/* ── 5. 내비게이션 ── */
let currentView = "home";
function go(view) {
  if (session.active && view !== "session") endSessionUI();
  currentView = view;
  ["home", "browse", "wrong", "stats", "session"].forEach((v) => {
    const el = $("view-" + v);
    if (el) el.style.display = v === view ? "" : "none";
  });
  document.querySelectorAll(".nav-btn, .tab").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view));
  if (view === "home") renderHome();
  if (view === "browse") renderBrowse();
  if (view === "wrong") renderWrong();
  if (view === "stats") renderStats();
  window.scrollTo({ top: 0 });
}

/* ── 6. 홈 ── */
let selDays = new Set(SETTINGS.days || [1]);

function buildDayGrid() {
  const grid = $("day-grid");
  grid.innerHTML = "";
  ALL_DAYS.forEach((d) => {
    const c = document.createElement("button");
    c.className = "day-cell" + (selDays.has(d) ? " on" : "");
    c.textContent = d;
    c.dataset.day = d;
    c.addEventListener("click", () => { toggleDay(d, c); });
    c.addEventListener("mouseenter", (e) => {
      if (e.buttons === 1) toggleDay(d, c, true);
    });
    grid.appendChild(c);
  });
  updateRangeSummary();
}
function toggleDay(d, cell, dragOn) {
  if (dragOn) selDays.add(d);
  else if (selDays.has(d)) selDays.delete(d);
  else selDays.add(d);
  cell.classList.toggle("on", selDays.has(d));
  persistDays();
}
function setPreset(p) {
  if (p === "all") selDays = new Set(ALL_DAYS);
  else if (p === "none") selDays = new Set();
  else {
    const [a, b] = p.split("-").map(Number);
    selDays = new Set(ALL_DAYS.filter((d) => d >= a && d <= b));
  }
  document.querySelectorAll(".day-cell").forEach((c) =>
    c.classList.toggle("on", selDays.has(Number(c.dataset.day))));
  persistDays();
}
function persistDays() {
  SETTINGS.days = [...selDays].sort((a, b) => a - b);
  saveSettings();
  updateRangeSummary();
}
function rangeLabel() {
  const ds = [...selDays].sort((a, b) => a - b);
  if (!ds.length) return "—";
  if (ds.length === ALL_DAYS.length) return "전체";
  // 연속 구간 압축: 1,2,3,7 → "1–3·7"
  const parts = [];
  let s = ds[0], prev = ds[0];
  for (let i = 1; i <= ds.length; i++) {
    if (ds[i] === prev + 1) { prev = ds[i]; continue; }
    parts.push(s === prev ? `${s}` : `${s}–${prev}`);
    s = prev = ds[i];
  }
  return "Day " + parts.join("·");
}
function updateRangeSummary() {
  const n = [...selDays].reduce((acc, d) => acc + (BY_DAY[d]?.length || 0), 0);
  $("range-summary").textContent = selDays.size ? `${rangeLabel()} · ${n}단어` : "Day를 선택하세요";
}

function renderHome() {
  const h = new Date().getHours();
  const greet = h < 5 ? "새벽 공부, 대단해요" : h < 12 ? "좋은 아침이에요" : h < 18 ? "오후도 힘차게" : "오늘 마무리 한 판";
  const learned = Object.values(WORDS).filter((w) => w.s > 0).length;
  const todayN = HEAT[todayYmd()] || 0;
  const stk = calcStreak();
  $("hero-sub").textContent = learned
    ? `${greet} — 지금까지 ${learned.toLocaleString()}단어를 만났어요`
    : `${greet} — 3,000단어 · Day 1–30 · 발음과 함께`;
  $("hero-badges").innerHTML =
    `<span class="badge">🔥 연속 <strong>${stk}</strong>일</span>` +
    `<span class="badge">오늘 <strong>${todayN}</strong>문제</span>` +
    `<button class="badge badge-btn" onclick="openStarList()" title="내 단어장 보기">⭐ 내 단어장 <strong>${STARS.size}</strong></button>`;
  // 복습 배너
  const due = duePool();
  $("review-banner").style.display = due.length ? "flex" : "none";
  $("rb-count").textContent = due.length;
  updateRangeSummary();
}

function calcStreak() {
  let stk = 0;
  const d = new Date();
  if (!HEAT[todayYmd(d)]) d.setDate(d.getDate() - 1); // 오늘 아직 안 했으면 어제부터
  while (HEAT[todayYmd(d)]) { stk++; d.setDate(d.getDate() - 1); }
  return stk;
}

/* ── 7. 세션 엔진 ── */
const session = {
  active: false, mode: null, words: [], idx: 0,
  results: [], // {cn, correct}
  label: "", isReview: false,
};

function buildPool() {
  const wrongOnly = $("wrong-only").classList.contains("on");
  const starOnly = $("star-only").classList.contains("on");
  let pool = VOCAB.filter((w) => selDays.has(w.ch));
  if (wrongOnly) {
    const wset = new Set(wrongPool().map((w) => w.cn));
    pool = pool.filter((w) => wset.has(w.cn));
  }
  if (starOnly) pool = pool.filter((w) => STARS.has(w.cn));
  return pool;
}

function startSession(mode, fixedPool, label) {
  const pool = fixedPool || buildPool();
  if (!pool.length) {
    toast(fixedPool ? "해당 단어가 없어요"
      : !fixedPool && $("star-only").classList.contains("on") ? "선택한 Day에 별표 단어가 없어요. 플래시카드에서 ★를 눌러 저장해 보세요."
      : "선택한 범위에 단어가 없어요. Day를 선택해 주세요.");
    return;
  }
  const cnt = fixedPool ? pool.length : Number($("count-sel").value) || pool.length;
  session.active = true;
  session.mode = mode;
  session.words = shuffle(pool).slice(0, cnt || pool.length);
  session.idx = 0;
  session.results = [];
  session._graded = false;
  session._mcqDone = false;
  session._spellDone = false;
  session.label = label || rangeLabel();
  session.isReview = !!fixedPool;
  ["home", "browse", "wrong", "stats"].forEach((v) => $("view-" + v).style.display = "none");
  $("view-session").style.display = "";
  window.scrollTo({ top: 0 });
  renderStep();
}
function startReview() {
  const due = shuffle(duePool()).slice(0, 60);
  startSession("flash", due, "오늘의 복습");
}
function startWrongSession(mode) {
  const pool = shuffle(wrongPool());
  if (!pool.length) { toast("오답노트가 비어 있어요 🎉"); return; }
  startSession(mode, pool.slice(0, 50), "오답노트");
}

function endSessionUI() {
  session.active = false;
  speechSynthesis?.cancel?.();
  $("view-session").style.display = "none";
}
function confirmExit() {
  endSessionUI();
  go("home");
}
function setProgress() {
  const total = session.words.length;
  const done = Math.min(session.idx, total);
  $("sp-fill").style.width = (total ? (done / total) * 100 : 0) + "%";
  $("session-count").textContent = `${Math.min(done + 1, total)}/${total}`;
}

function renderStep() {
  if (session.mode === "quiz") { renderQuizTable(); return; }
  if (session.idx >= session.words.length) { finishSession(); return; }
  setProgress();
  const w = session.words[session.idx];
  if (session.mode === "flash") renderFlash(w);
  else if (session.mode === "mcq") renderMcq(w);
  else if (session.mode === "spell") renderSpell(w);
}

/* ── 7a. 플래시카드 ── */
function renderFlash(w) {
  $("session-body").innerHTML = `
    <div class="flash-stage">
      <button class="fc-star ${STARS.has(w.cn) ? "on" : ""}" id="fc-star-btn" title="내 단어장에 저장"
        onclick="flashStar(${w.cn}, this)">★</button>
      <div class="flash-card" id="flash-card" onclick="flipFlash()">
        <div class="fc-face front">
          <div class="fc-label">영단어</div>
          <div class="fc-word serif">${esc(w.word)}</div>
          ${w.ipa ? `<div class="fc-ipa">${esc(w.ipa)}</div>` : ""}
          <button class="fc-speak" onclick="event.stopPropagation();tts.speak('${esc(w.word).replace(/'/g, "\\'")}', this)" title="발음 듣기">🔊</button>
          <div class="fc-tap-hint">카드를 탭하면 뜻이 보여요</div>
        </div>
        <div class="fc-face back">
          <div class="fc-back-word serif">${esc(w.word)}
            <button class="mini-speak" onclick="event.stopPropagation();tts.speak('${esc(w.word).replace(/'/g, "\\'")}')">🔊</button>
          </div>
          ${w.ipa ? `<div class="fc-ipa" style="font-size:16px;margin-top:4px">${esc(w.ipa)}</div>` : ""}
          <div class="fc-meaning fc-meaning-big">${w.meaning}</div>
        </div>
      </div>
    </div>
    <div class="fc-actions">
      <button class="btn btn-red btn-big" onclick="flashAnswer(false)">😅 몰라요</button>
      <button class="btn btn-green btn-big" onclick="flashAnswer(true)">😊 알아요</button>
    </div>
    <div class="fc-nav-row">
      <span><span class="kbd">Space</span> 뒤집기</span>
      <span><span class="kbd">1</span> 몰라요 · <span class="kbd">2</span> 알아요</span>
      <span><span class="kbd">P</span> 발음 · <span class="kbd">S</span> ★저장</span>
    </div>`;
  if (SETTINGS.autoSpeak) setTimeout(() => tts.speak(w.word), 250);
}
function flipFlash() { $("flash-card")?.classList.toggle("flipped"); }
function flashStar(cn, btn) {
  toggleStar(cn, btn);
  toast(STARS.has(cn) ? "⭐ 내 단어장에 저장했어요" : "내 단어장에서 뺐어요");
}
function flashAnswer(known) {
  const w = session.words[session.idx];
  record(w.cn, known);
  session.results.push({ cn: w.cn, correct: known });
  session.idx++;
  renderStep();
}

/* ── 7b. 객관식 ── */
function renderMcq(w) {
  const dir = SETTINGS.dir = $("dir-sel") ? $("dir-sel").value : SETTINGS.dir;
  const sameDay = BY_DAY[w.ch].filter((x) => x.cn !== w.cn);
  const others = shuffle(sameDay.length >= 3 ? sameDay : VOCAB.filter((x) => x.cn !== w.cn)).slice(0, 3);
  const opts = shuffle([w, ...others]);
  const qHtml = dir === "e2k"
    ? `<div class="mcq-word serif">${esc(w.word)}</div>${w.ipa ? `<div class="mcq-ipa">${esc(w.ipa)}</div>` : ""}`
    : `<div class="mcq-meaning-q">${w.meaning}</div>`;
  $("session-body").innerHTML = `
    <div class="mcq-card">
      <div class="mcq-q">${qHtml}</div>
      <div class="mcq-opts">
        ${opts.map((o, i) => `
          <button class="mcq-opt" id="opt-${i}" data-cn="${o.cn}" onclick="mcqPick(${i}, ${o.cn === w.cn})">
            <span class="opt-key">${i + 1}</span>
            <span>${dir === "e2k" ? meaningText(o) : `<span class="serif">${esc(o.word)}</span>`}</span>
          </button>`).join("")}
      </div>
    </div>`;
  if (dir === "e2k" && SETTINGS.autoSpeak) setTimeout(() => tts.speak(w.word), 250);
  session._mcqDone = false;
}
function mcqPick(i, correct) {
  if (session._mcqDone) return;
  session._mcqDone = true;
  const w = session.words[session.idx];
  record(w.cn, correct);
  session.results.push({ cn: w.cn, correct });
  document.querySelectorAll(".mcq-opt").forEach((b) => {
    b.disabled = true;
    const isAnswer = Number(b.dataset.cn) === w.cn;
    if (isAnswer) b.classList.add("correct");
    else if (b.id === "opt-" + i) b.classList.add("wrong");
    else b.classList.add("dim");
  });
  if (!correct && navigator.vibrate) navigator.vibrate(80);
  setTimeout(() => { session.idx++; renderStep(); }, correct ? 650 : 1500);
}

/* ── 7c. 스펠링 ── */
function renderSpell(w) {
  const hint = w.word[0] + " " + "_ ".repeat(Math.max(0, w.word.length - 1)).trim();
  $("session-body").innerHTML = `
    <div class="spell-card">
      <div class="fc-label">한글 뜻</div>
      <div class="spell-meaning">${w.meaning}</div>
      <div class="spell-hint">${w.word.length}글자 · 첫 글자 <span class="kbd">${esc(w.word[0])}</span></div>
      <input class="spell-input serif" id="spell-input" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"
        placeholder="${esc(hint)}" onkeydown="if(event.key==='Enter')spellCheck()">
      <div class="spell-feedback" id="spell-feedback"></div>
      <div class="spell-btn-row">
        <button class="btn btn-accent btn-big" id="spell-submit" onclick="spellCheck()">확인</button>
      </div>
    </div>`;
  setTimeout(() => $("spell-input")?.focus(), 100);
  session._spellDone = false;
}
function spellCheck() {
  if (session._spellDone) return;
  const w = session.words[session.idx];
  const input = $("spell-input");
  const user = input.value.trim().toLowerCase();
  if (!user) { input.focus(); return; }
  session._spellDone = true;
  const answer = w.word.trim().toLowerCase();
  const correct = user === answer;
  record(w.cn, correct);
  session.results.push({ cn: w.cn, correct });
  input.disabled = true;
  input.classList.add(correct ? "ok" : "no");
  const fb = $("spell-feedback");
  if (correct) {
    fb.innerHTML = `<span style="color:var(--green);font-weight:800">정답! 🎉</span>`;
  } else {
    // 글자 diff 표시
    const diff = [...w.word].map((ch, i) =>
      user[i]?.toLowerCase() === ch.toLowerCase()
        ? `<span class="diff-ok">${esc(ch)}</span>` : `<span class="diff-no">${esc(ch)}</span>`).join("");
    fb.innerHTML = `<div style="color:var(--red);font-weight:700;margin-bottom:6px">아쉬워요</div>
      <div class="spell-answer serif">${diff}</div>`;
  }
  if (SETTINGS.autoSpeak) tts.speak(w.word);
  $("spell-submit").outerHTML = `<button class="btn btn-accent btn-big" onclick="session.idx++;renderStep()">다음 →</button>`;
}

/* ── 7d. 주관식 퀴즈 (테이블 + 채점 + 인쇄) ── */
function renderQuizTable() {
  setProgress();
  $("sp-fill").style.width = "100%";
  $("session-count").textContent = `${session.words.length}문제`;
  $("session-body").innerHTML = `
    <div class="quiz-table">
      <div class="qt-head"><span>No.</span><span>영단어</span><span>한글 의미 쓰기</span></div>
      ${session.words.map((w, i) => `
        <div class="qt-row">
          <div class="qt-num">${i + 1}</div>
          <div class="qt-word serif">${esc(w.word)}
            <button class="mini-speak" onclick="tts.speak('${esc(w.word).replace(/'/g, "\\'")}')" title="발음">🔊</button>
          </div>
          <div class="qt-ans">
            <input class="qt-input" id="qt-${i}" placeholder="뜻 입력…" autocomplete="off"
              onkeydown="if(event.key==='Enter'){document.getElementById('qt-${i + 1}')?.focus()}">
            <div class="qt-reveal" id="qtr-${i}" style="display:none"></div>
          </div>
        </div>`).join("")}
    </div>
    <div class="quiz-actions">
      <button class="btn btn-accent" id="grade-btn" onclick="gradeQuizTable()">✓ 채점하기</button>
      <button class="btn btn-ghost" onclick="printQuiz()">🖨 시험지 출력</button>
      <button class="btn btn-ghost" onclick="confirmExit()">↩ 그만하기</button>
    </div>
    <div id="quiz-result"></div>`;
  $("qt-0")?.focus();
}

function gradeQuizTable() {
  if (session._graded) return;
  session._graded = true;
  $("grade-btn").disabled = true;
  let correct = 0;
  const methodLabels = {
    variant: "표현 차이 ✓",
    synonym: "유의어 ✓",
    typo: "오타 인정 ✓",
  };
  session.words.forEach((w, i) => {
    const input = $("qt-" + i);
    const { match, method } = KoGrader.checkAnswer(
      input.value || "",
      w.meaning,
      { cn: w.cn, knownTerms: KNOWN_KO_TERMS }
    );
    input.disabled = true;
    input.classList.add(match ? "correct" : "wrong");
    if (match) correct++;
    record(w.cn, match);
    session.results.push({ cn: w.cn, correct: match });
    const rv = $("qtr-" + i);
    rv.style.display = "";
    rv.innerHTML =
      `<span class="rv-tag ${match ? "ok" : "no"}">${match ? "✓" : "✗"}</span>` +
      (methodLabels[method] ? `<span class="rv-tag ${method === "synonym" ? "syn" : method}">${methodLabels[method]}</span>` : "") +
      `<span class="rv-meaning">${w.meaning}</span>`;
  });
  commitRecords();
  logSession("주관식", session.label, session.words.length, correct);
  $("quiz-result").innerHTML = resultHtml(correct, session.words.length);
  drawScoreRing(correct, session.words.length);
  setTimeout(() => $("quiz-result").scrollIntoView({ behavior: "smooth", block: "start" }), 150);
}

/* ── 7e. 결과 ── */
const MODE_KO = { flash: "플래시카드", mcq: "객관식", spell: "스펠링", quiz: "주관식" };
function finishSession() {
  const n = session.results.length;
  const ok = session.results.filter((r) => r.correct).length;
  commitRecords();
  logSession(MODE_KO[session.mode], session.label, n, ok);
  $("sp-fill").style.width = "100%";
  $("session-body").innerHTML = resultHtml(ok, n);
  drawScoreRing(ok, n);
}
function resultHtml(ok, n) {
  const pct = n ? Math.round((ok / n) * 100) : 0;
  const grades = [
    [90, "🏆 Perfect!", "완벽해요! 모든 단어를 마스터했어요."],
    [80, "🎉 Excellent!", "훌륭해요! 거의 다 맞혔어요."],
    [70, "👍 Good Job!", "잘했어요! 조금만 더 연습하면 완벽해요."],
    [60, "📚 Keep Going!", "틀린 단어는 오답노트에서 기다리고 있어요."],
    [0, "💪 Try Again!", "반복이 실력을 만들어요. 오답노트로 복습해요!"],
  ];
  const [, grade, msg] = grades.find(([m]) => pct >= m);
  const wrongs = session.results.filter((r) => !r.correct).map((r) => BY_CN.get(r.cn));
  return `
    <div class="result-panel" style="margin-top:18px">
      <div class="score-ring">
        <svg width="130" height="130">
          <circle cx="65" cy="65" r="56" fill="none" stroke="var(--surface3)" stroke-width="9"/>
          <circle cx="65" cy="65" r="56" fill="none" stroke="var(--accent)" stroke-width="9"
            stroke-dasharray="351.9" stroke-dashoffset="351.9" stroke-linecap="round" id="score-circle"/>
        </svg>
        <div><div class="score-num">${ok}</div><div class="score-denom">/ ${n}</div></div>
      </div>
      <div class="result-grade">${grade}</div>
      <div class="result-msg">${msg}</div>
      <div class="result-chips">
        <div class="stat-chip"><div class="v" style="color:var(--green)">${ok}</div><div class="l">정답</div></div>
        <div class="stat-chip"><div class="v" style="color:var(--red)">${n - ok}</div><div class="l">오답</div></div>
        <div class="stat-chip"><div class="v" style="color:var(--accent2)">${pct}%</div><div class="l">정답률</div></div>
      </div>
      <div class="result-actions">
        ${wrongs.length ? `<button class="btn btn-red" onclick="retryWrongs()">✍️ 틀린 것만 다시 (${wrongs.length})</button>` : ""}
        <button class="btn btn-accent" onclick="restartSession()">🔀 새로 시작</button>
        <button class="btn btn-ghost" onclick="confirmExit()">↩ 홈으로</button>
      </div>
      ${wrongs.length ? `
        <div class="result-wrong-list">
          <div class="rw-title">틀린 단어 — 오답노트에 저장됐어요</div>
          <div class="word-list">${wrongs.map(wordRowHtml).join("")}</div>
        </div>` : ""}
    </div>`;
}
function drawScoreRing(ok, n) {
  const c = $("score-circle");
  if (!c) return;
  const circ = 2 * Math.PI * 56;
  const pct = n ? ok / n : 0;
  c.style.stroke = pct >= 0.8 ? "var(--green)" : pct >= 0.6 ? "var(--yellow)" : "var(--red)";
  setTimeout(() => {
    c.style.transition = "stroke-dashoffset 1s ease";
    c.style.strokeDashoffset = circ * (1 - pct);
  }, 120);
}
function retryWrongs() {
  const pool = session.results.filter((r) => !r.correct).map((r) => BY_CN.get(r.cn));
  const mode = session.mode === "quiz" ? "quiz" : session.mode;
  session._graded = false;
  startSession(mode, shuffle(pool), session.label + " 재도전");
}
function restartSession() {
  session._graded = false;
  if (session.isReview) { confirmExit(); return; }
  startSession(session.mode);
}

/* ── 8. 채점 엔진은 DOM-free js/grader.js에 정의 ── */

/* ── 9. 인쇄 (주관식 시험지 + 정답지) ── */
function printQuiz() {
  const words = session.words;
  const today = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
  const sub = `${esc(session.label)} · ${today}`;
  const rows = (key) => words.map((w, i) => `
    <tr>
      <td class="pt-num">${i + 1}</td>
      <td class="pt-word">${esc(w.word)}</td>
      <td class="pt-ans">${key ? `<div class="pt-key">${meaningText(w)}</div>` : `<div class="pt-line"></div>`}</td>
    </tr>`).join("");
  const head = `<tr><th style="width:40px">No.</th><th>영단어</th><th style="width:45%">한글 의미</th></tr>`;
  $("print-root").innerHTML = `
    <div class="print-sheet">
      <div class="print-header">
        <div class="print-title-row">
          <div><span class="print-title">거 만 어  Q u i z</span><span class="print-badge">시 험 지</span></div>
          <span class="print-subtitle">${sub}</span>
        </div>
        <div class="print-info-row">
          <div class="print-field"><span class="print-field-label">이름</span><div class="print-field-line wide"></div></div>
          <div class="print-field"><span class="print-field-label">날짜</span><div class="print-field-line"></div></div>
          <div class="print-field"><span class="print-field-label">문제 수</span><span style="font-weight:700;font-size:11pt">${words.length}문제</span></div>
        </div>
      </div>
      <table class="print-table"><thead>${head}</thead><tbody>${rows(false)}</tbody></table>
      <div class="print-score-box">
        <span class="print-score-label">점수</span><span class="print-score-line"></span>
        <span class="print-score-total">/ ${words.length}점</span>
      </div>
      <div class="print-note">※ 단어 의미의 핵심 키워드를 포함하면 정답으로 인정됩니다.</div>
    </div>
    <div class="print-sheet">
      <div class="print-header">
        <div class="print-title-row">
          <div><span class="print-title">거 만 어  Q u i z</span><span class="print-badge ans">정 답 지</span></div>
          <span class="print-subtitle">${sub}</span>
        </div>
      </div>
      <table class="print-table"><thead>${head}</thead><tbody>${rows(true)}</tbody></table>
    </div>`;
  window.print();
}

/* ── 10. 단어장 (Browse) ── */
let browseLimit = 100;
function initBrowseDaySel() {
  const sel = $("browse-day");
  sel.innerHTML = `<option value="0">전체 Day</option>` +
    ALL_DAYS.map((d) => `<option value="${d}">Day ${d}</option>`).join("");
}
function browseFiltered() {
  const q = ($("search-input").value || "").trim().toLowerCase();
  const day = Number($("browse-day").value);
  const starOnly = $("star-filter").classList.contains("on");
  return VOCAB.filter((w) => {
    if (day && w.ch !== day) return false;
    if (starOnly && !STARS.has(w.cn)) return false;
    if (q && !w.word.toLowerCase().includes(q) && !meaningText(w).toLowerCase().includes(q)) return false;
    return true;
  });
}
function wordRowHtml(w) {
  const r = WORDS[w.cn];
  const stat = r && r.s
    ? (r.b >= 4 ? `<span class="wr-stat good">마스터 ✓</span>` : r.n > 0 ? `<span class="wr-stat bad">✗ ${r.n}회</span>` : `<span class="wr-stat good">✓ ${r.o}회</span>`)
    : "";
  return `
    <div class="word-row" onclick="openModal(${w.cn})">
      <button class="wr-star ${STARS.has(w.cn) ? "on" : ""}" onclick="event.stopPropagation();toggleStar(${w.cn}, this)">★</button>
      <div class="wr-main">
        <div class="wr-word serif">${esc(w.word)} ${w.ipa ? `<span class="wr-ipa">${esc(w.ipa)}</span>` : ""}</div>
        <div class="wr-meaning">${meaningText(w)}</div>
      </div>
      <div class="wr-meta"><span class="wr-day">D${w.ch}</span>${stat}</div>
      <button class="wr-speak" onclick="event.stopPropagation();tts.speak('${esc(w.word).replace(/'/g, "\\'")}')" title="발음">🔊</button>
    </div>`;
}
function renderBrowse() {
  browseLimit = 100;
  drawBrowse();
}
function drawBrowse() {
  const list = browseFiltered();
  $("browse-count").textContent = `${list.length.toLocaleString()}단어`;
  $("word-list").innerHTML = list.slice(0, browseLimit).map(wordRowHtml).join("");
  $("browse-more").style.display = list.length > browseLimit ? "" : "none";
}
function browseMore() { browseLimit += 200; drawBrowse(); }
function openStarList() {
  go("browse");
  $("star-filter").classList.add("on");
  $("browse-day").value = "0";
  $("search-input").value = "";
  renderBrowse();
}
function toggleStar(cn, btn) {
  if (STARS.has(cn)) STARS.delete(cn); else STARS.add(cn);
  btn?.classList.toggle("on", STARS.has(cn));
  store.set("stars", [...STARS]);
}

/* ── 11. 단어 상세 모달 ── */
function openModal(cn) {
  const w = BY_CN.get(cn);
  if (!w) return;
  const r = WORDS[cn];
  $("word-modal").innerHTML = `
    <div class="md-head">
      <div style="flex:1">
        <div class="md-word serif">${esc(w.word)}</div>
        ${w.ipa ? `<div class="md-ipa">${esc(w.ipa)}</div>` : ""}
      </div>
      <button class="wr-star ${STARS.has(cn) ? "on" : ""}" style="font-size:22px" onclick="toggleStar(${cn}, this)">★</button>
      <button class="fc-speak" style="width:44px;height:44px;margin:0;font-size:18px" onclick="tts.speak('${esc(w.word).replace(/'/g, "\\'")}', this)">🔊</button>
    </div>
    <div class="md-meaning">${w.meaning}</div>
    <div class="md-stat-row">
      <span class="badge">Day ${w.ch} · CN ${w.cn}</span>
      ${r && r.s ? `<span class="badge">✓ <strong>${r.o}</strong> · ✗ <strong style="color:var(--red)">${r.n}</strong></span>
      <span class="badge">복습 단계 <strong>${r.b}/5</strong></span>` : `<span class="badge">아직 학습 전</span>`}
    </div>`;
  $("modal-scrim").classList.add("open");
  document.body.style.overflow = "hidden";
}
function closeModal() {
  $("modal-scrim").classList.remove("open");
  document.body.style.overflow = "";
}

/* ── 12. 오답노트 ── */
function renderWrong() {
  const pool = wrongPool().sort((a, b) => (WORDS[b.cn]?.n || 0) - (WORDS[a.cn]?.n || 0));
  $("wrong-summary").textContent = pool.length ? `${pool.length}단어` : "";
  $("wrong-actions").style.display = pool.length ? "" : "none";
  $("wrong-list").innerHTML = pool.length
    ? pool.map(wordRowHtml).join("")
    : `<div style="text-align:center;padding:36px 0;color:var(--text3)">
        <div style="font-size:40px;margin-bottom:10px">🎉</div>
        아직 틀린 단어가 없어요.<br>퀴즈를 풀면 틀린 단어가 여기에 모여요.</div>`;
}

/* ── 13. 통계 ── */
function renderStats() {
  const recs = Object.values(WORDS);
  const learned = recs.filter((w) => w.s > 0).length;
  const mastered = recs.filter((w) => w.b >= 4).length;
  const totalAns = recs.reduce((a, w) => a + w.s, 0);
  const totalOk = recs.reduce((a, w) => a + w.o, 0);
  const acc = totalAns ? Math.round((totalOk / totalAns) * 100) : 0;
  $("stats-top").innerHTML = `
    <div class="stat-chip"><div class="v" style="color:var(--accent2)">${learned.toLocaleString()}</div><div class="l">학습한 단어</div></div>
    <div class="stat-chip"><div class="v" style="color:var(--green)">${mastered.toLocaleString()}</div><div class="l">마스터</div></div>
    <div class="stat-chip"><div class="v">${acc}%</div><div class="l">누적 정답률</div></div>
    <div class="stat-chip"><div class="v" style="color:var(--yellow)">🔥${calcStreak()}</div><div class="l">연속 학습일</div></div>`;

  // 히트맵 (12주)
  const heat = $("heatmap");
  heat.innerHTML = "";
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - (7 * 12 - 1) - end.getDay());
  const d = new Date(start);
  while (d <= end) {
    const n = HEAT[todayYmd(d)] || 0;
    const lv = n === 0 ? 0 : n < 10 ? 1 : n < 30 ? 2 : n < 60 ? 3 : 4;
    const cell = document.createElement("div");
    cell.className = "heat-cell";
    cell.dataset.lv = lv;
    cell.title = `${todayYmd(d)} · ${n}문제`;
    heat.appendChild(cell);
    d.setDate(d.getDate() + 1);
  }

  // Day별 진도
  $("day-progress").innerHTML = ALL_DAYS.map((day) => {
    const words = BY_DAY[day];
    const seen = words.filter((w) => WORDS[w.cn]?.s > 0).length;
    const mast = words.filter((w) => (WORDS[w.cn]?.b || 0) >= 4).length;
    const pct = Math.round((mast / words.length) * 100);
    return `
      <div class="dp-row">
        <span class="dp-label">Day ${day}</span>
        <div class="dp-bar"><div class="dp-fill" style="width:${pct}%"></div></div>
        <span class="dp-pct">${mast}✓ · ${seen}/${words.length}</span>
      </div>`;
  }).join("");

  // 세션 목록
  $("session-list").innerHTML = SESSIONS.length
    ? SESSIONS.slice(0, 20).map((s) => {
        const dt = new Date(s.t);
        const when = `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
        const pct = s.n ? Math.round((s.ok / s.n) * 100) : 0;
        return `<div class="sl-row">
          <span class="sl-mode">${esc(s.mode)}</span>
          <span class="sl-range">${esc(s.range)} · ${when}</span>
          <span class="sl-score" style="color:${pct >= 80 ? "var(--green)" : pct >= 60 ? "var(--yellow)" : "var(--red)"}">${s.ok}/${s.n}</span>
        </div>`;
      }).join("")
    : `<div style="color:var(--text3);font-size:13px;padding:8px 0">아직 기록이 없어요.</div>`;
}

/* ── 14. 백업 ── */
function exportData() {
  const payload = {
    app: "gumaneo-quiz", v: 1, exported: new Date().toISOString(),
    words: WORDS, sessions: SESSIONS, stars: [...STARS], heat: HEAT, settings: SETTINGS,
  };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `거만어학습기록_${todayYmd()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("학습 데이터를 내보냈어요 ⬇");
}
function importData(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.app !== "gumaneo-quiz" || !data.words) throw new Error("format");
      WORDS = data.words; SESSIONS = data.sessions || []; STARS = new Set(data.stars || []);
      HEAT = data.heat || {}; SETTINGS = Object.assign(SETTINGS, data.settings || {});
      saveWords(); store.set("sessions", SESSIONS); store.set("stars", [...STARS]);
      store.set("heat", HEAT); saveSettings();
      toast("학습 데이터를 불러왔어요 ✓");
      renderStats(); renderHome();
    } catch {
      toast("파일 형식이 올바르지 않아요");
    }
    input.value = "";
  };
  reader.readAsText(file);
}

/* ── 15. 키보드 ── */
document.addEventListener("keydown", (e) => {
  if (!session.active) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (session.mode === "flash") {
    if (e.key === " ") { e.preventDefault(); flipFlash(); }
    else if (e.key === "1") flashAnswer(false);
    else if (e.key === "2") flashAnswer(true);
    else if (e.key === "p" || e.key === "P") tts.speak(session.words[session.idx]?.word || "");
    else if (e.key === "s" || e.key === "S") {
      const w = session.words[session.idx];
      if (w) flashStar(w.cn, $("fc-star-btn"));
    }
    else if (e.key === "ArrowRight") flashAnswer(true);
    else if (e.key === "ArrowLeft") flashAnswer(false);
  } else if (session.mode === "mcq" && !session._mcqDone) {
    const n = Number(e.key);
    if (n >= 1 && n <= 4) $("opt-" + (n - 1))?.click();
  }
});

/* ── 16. 초기화 ── */
function init() {
  buildDayGrid();
  initBrowseDaySel();
  $("count-sel").value = String(SETTINGS.count ?? 20);
  $("count-sel").addEventListener("change", (e) => { SETTINGS.count = Number(e.target.value); saveSettings(); });
  $("dir-sel").value = SETTINGS.dir || "e2k";
  $("dir-sel").addEventListener("change", (e) => { SETTINGS.dir = e.target.value; saveSettings(); });
  $("auto-speak").classList.toggle("on", SETTINGS.autoSpeak !== false);
  renderHome();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
init();
