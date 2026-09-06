const test = require("node:test");
const assert = require("node:assert/strict");
const cases = require("./fixtures/grading-cases.json");
global.KO_GRADING_DATA = require("../js/ko-grading-data.js");
const grader = require("../js/grader.js");

test("matches complete normalized meaning units exactly", () => {
  for (const item of cases.exact) {
    const result = grader.checkAnswer(item.user, item.meaning);
    assert.equal(result.match, true, `${item.user} ← ${item.meaning}`);
    assert.equal(result.method, item.method);
    assert.equal(result.matchedAnswer, item.user);
    assert.equal(result.confidence, "high");
  }
});

test("matches reviewed Korean inflection and spacing variants", () => {
  for (const item of cases.variants) {
    const result = grader.checkAnswer(item.user, item.meaning);
    assert.equal(result.match, true, `${item.user} ← ${item.meaning}`);
    assert.equal(result.method, item.method, `${item.user} ← ${item.meaning}`);
    assert.equal(result.confidence, "high");
  }
});

test("matches only members of the same explicit synonym group", () => {
  for (const item of cases.synonyms) {
    const result = grader.checkAnswer(item.user, item.meaning);
    assert.equal(result.match, true, `${item.user} ← ${item.meaning}`);
    assert.equal(result.method, item.method);
  }

  assert.equal(grader.checkAnswer("간추리다", "약해지다").match, false,
    "shared bridge term 줄이다 must not create transitive synonym closure");
  assert.equal(grader.checkAnswer("예의", "편의시설").match, false,
    "polysemous amenity senses must not become global synonyms");
  assert.equal(grader.checkAnswer("동일한", "유사한").match, false,
    "similar must not be promoted to identical");
  assert.equal(grader.checkAnswer("저주", "불쾌한").match, false,
    "separate senses of anathema must not become global synonyms");
});

test("accepts mindful without the textbook placeholder particle", () => {
  const result = grader.checkAnswer("유념하는", "인식하는, 알고있는, ~에 유념하는", { cn: 18015 });
  assert.equal(result.match, true);
  assert.equal(result.method, "synonym");
});

test("accepts the reviewed temporal wording for nascent", () => {
  const result = grader.checkAnswer("이제 막 생겨난", "지금 막 생겨난", { cn: 18070 });
  assert.equal(result.match, true);
  assert.equal(result.method, "synonym");
});

test("limits entry aliases to their configured C-N", () => {
  global.KO_GRADING_DATA.entryAliases["test-cn"] = ["집요한"];
  try {
    assert.equal(grader.checkAnswer("집요한", "완고한", { cn: "test-cn" }).method, "synonym");
    assert.equal(grader.checkAnswer("집요한", "완고한", { cn: "other-cn" }).match, false);
  } finally {
    delete global.KO_GRADING_DATA.entryAliases["test-cn"];
  }
});

test("removes spaced particles without deleting lexical syllables", () => {
  assert.equal(grader.normalizeKoV2("고집이 센"), "고집센");
  assert.equal(grader.normalizeKoV2("회의적인"), "회의적");
  assert.notEqual(grader.normalizeKoV2("회의적인"), grader.normalizeKoV2("회적인"));
  assert.equal(grader.checkAnswer("회적인", "회의적인").match, false);
  assert.equal(grader.checkAnswer("유명인", "유명한").match, false);
});

test("vetoes polarity conflicts and generic short fragments", () => {
  assert.equal(grader.checkPolarity("명확한", "불명확한"), false);
  assert.equal(grader.checkPolarity("적절한", "부적절한"), false);
  assert.equal(grader.checkPolarity("성실한", "불성실한"), false);
  assert.equal(grader.checkPolarity("도덕적인", "비도덕적인"), false);
  assert.equal(grader.checkPolarity("명확한", "명확한"), true);
  for (const item of cases.negatives) {
    assert.equal(grader.checkAnswer(item.user, item.meaning).match, false,
      `${item.user} must not match ${item.meaning}`);
  }
});