const test = require("node:test");
const assert = require("node:assert/strict");
const data = require("../js/ko-grading-data.js");
global.KO_GRADING_DATA = data;
const grader = require("../js/grader.js");
const cases = require("./fixtures/grading-cases.json");

test("accepts a guarded typo only after stronger matching fails", () => {
  const result = grader.checkAnswer(cases.typos[0].user, cases.typos[0].meaning, {
    knownTerms: ["퉁명스러운", "완곡한", "반복하다"]
  });
  assert.deepEqual(result, {
    match: true,
    method: "typo",
    matchedAnswer: "퉁명스러운",
    confidence: "guarded"
  });
});

test("rejects deny-listed pairs, short stems, and known corpus terms", () => {
  const knownTerms = ["완곡한", "반복하다", "가정하다"];
  for (const [meaning, user] of [
    ["완고한", "완곡한"],
    ["반박하다", "반복하다"],
    ["가장하다", "가정하다"],
    ["혐오", "협오"]
  ]) {
    assert.equal(grader.checkAnswer(user, meaning, { knownTerms }).match, false,
      `${user} must not be accepted for ${meaning}`);
  }
});

test("requires a unique closest typo candidate", () => {
  assert.equal(grader.checkAnswer("가나다마", "가나다라, 가나다바").match, false);
});

test("caches the normalized known-term index across grading calls", () => {
  let iterations = 0;
  const knownTerms = {
    *[Symbol.iterator]() {
      iterations++;
      yield "완곡한";
      yield "반복하다";
    }
  };
  grader.checkAnswer("퉁명스러윤", "퉁명스러운", { knownTerms });
  grader.checkAnswer("퉁명스러윤", "퉁명스러운", { knownTerms });
  assert.equal(iterations, 1);
});

test("fuzzy typo matching can be disabled by feature flag", () => {
  const original = data.flags.fuzzyTypo;
  data.flags.fuzzyTypo = false;
  try {
    assert.equal(grader.checkAnswer("퉁명스러윤", "퉁명스러운").match, false);
  } finally {
    data.flags.fuzzyTypo = original;
  }
});