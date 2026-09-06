const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("loads all v9 assets in grading dependency order", () => {
  const html = read("index.html");
  const expected = [
    "css/app.css?v=9",
    "js/vocab-data.js?v=9",
    "js/ko-grading-data.js?v=9",
    "js/grader.js?v=9",
    "js/app.js?v=9"
  ];
  for (const asset of expected) assert.match(html, new RegExp(asset.replace("?", "\\?")));
  const scripts = expected.slice(1).map((asset) => html.indexOf(asset));
  assert.deepEqual(scripts, [...scripts].sort((a, b) => a - b));
});

test("service worker caches both grading scripts under gv-v9", () => {
  const sw = read("sw.js");
  assert.match(sw, /CACHE_VERSION = "gv-v9"/);
  assert.match(sw, /"\.\/js\/ko-grading-data\.js\?v=9"/);
  assert.match(sw, /"\.\/js\/grader\.js\?v=9"/);
});

test("service worker precaches the exact versioned asset request keys", () => {
  const sw = read("sw.js");
  for (const asset of [
    "css/app.css?v=9",
    "js/vocab-data.js?v=9",
    "js/ko-grading-data.js?v=9",
    "js/grader.js?v=9",
    "js/app.js?v=9"
  ]) {
    assert.match(sw, new RegExp(`"\\./${asset.replace("?", "\\?")}"`));
  }
});

test("service worker deletes only stale gv caches", () => {
  const sw = read("sw.js");
  assert.match(sw, /keys\.filter\(\(k\)\s*=>\s*k\.startsWith\("gv-"\)\s*&&\s*k\s*!==\s*CACHE_VERSION\)/);
});

test("starting every session resets the quiz graded guard", () => {
  const app = read("js/app.js");
  const startSession = app.match(/function startSession\([\s\S]*?\n\}/)?.[0] || "";
  assert.match(startSession, /session\._graded\s*=\s*false/);
});

test("app delegates with C-N and corpus terms and renders all method tags", () => {
  const app = read("js/app.js");
  assert.match(app, /KoGrader\.checkAnswer\([\s\S]*?\{ cn: w\.cn, knownTerms: KNOWN_KO_TERMS \}/);
  assert.match(app, /variant[\s\S]*?표현 차이 ✓/);
  assert.match(app, /synonym[\s\S]*?유의어 ✓/);
  assert.match(app, /typo[\s\S]*?오타 인정 ✓/);
  assert.doesNotMatch(app, /const SYN_GROUPS/);
});

test("method tags have distinct variant, synonym, and typo styles", () => {
  const css = read("css/app.css");
  assert.match(css, /\.rv-tag\.variant/);
  assert.match(css, /\.rv-tag\.syn/);
  assert.match(css, /\.rv-tag\.typo/);
});

test("CommonJS grader loads its grading data without global setup", () => {
  const output = execFileSync(process.execPath, ["-e", [
    "const grader = require('./js/grader.js');",
    "process.stdout.write(grader.checkAnswer('완고한', '완강한').method);"
  ].join("\n")], { cwd: root, encoding: "utf8" });
  assert.equal(output, "synonym");
});