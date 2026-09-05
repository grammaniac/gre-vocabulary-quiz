(function (root, factory) {
  const source = root.KO_GRADING_DATA ||
    (typeof module === "object" && module.exports ? require("./ko-grading-data.js") : {});
  const api = factory(source);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.KoGrader = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (data) {
  "use strict";

  function cleanUnit(value) {
    return String(value || "")
      .normalize("NFC")
      .replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]/g, " ")
      .replace(/[~·]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseMeaningUnits(value) {
    return String(value || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/(^|[\n])\s*\d+[.)]\s*/g, "$1")
      .split(/[\n,;\/]+/)
      .map(cleanUnit)
      .filter(Boolean);
  }

  function exactKey(value) {
    return cleanUnit(value).replace(/[\s.!?]+/g, "");
  }

  function normalizeKoV2(value) {
    const normalized = cleanUnit(value)
      // 조사 뒤에 실제 띄어쓰기가 있을 때만 조사로 본다.
      // 공백을 먼저 지우면 "회의적인"의 어휘 내부 "의"까지 사라진다.
      .replace(/([가-힣]+)(은|는|이|가|을|를|의)\s+([가-힣])/g, "$1$3")
      .replace(/[\s.!?]+/g, "");
    const endings = [
      [/(스럽다|스러운|스런|스러워|스럽게|스레)$/, "스럽"],
      [/(롭다|로운|로워|롭게)$/, "롭"],
      [/(적이다|적인|적으로)$/, "적"],
      [/(시키다|시키고|시켜서|시켰다|시키는|시키게|시킴|시켜|시킨)$/, "시키"],
      [/(되다|되고|되어|돼서|됐다|되는|되게|됨|돼|된)$/, "되"],
      [/(하다|하고|하여|해서|했다|하는|하게|함|할|해|한)$/, ""],
      [/(이다|이고|이어|였다)$/, ""]
    ];
    for (const [pattern, replacement] of endings) {
      if (pattern.test(normalized)) return normalized.replace(pattern, replacement);
    }
    return normalized;
  }

  function copulaBase(value) {
    const key = exactKey(value);
    if (key.endsWith("이다")) return key.slice(0, -2);
    if (key.endsWith("인")) return key.slice(0, -1);
    return null;
  }

  function isCopulaVariant(left, right) {
    const leftBase = copulaBase(left);
    const rightBase = copulaBase(right);
    return leftBase !== null && rightBase !== null && leftBase.length >= 2 && leftBase === rightBase;
  }

  function noMatch() {
    return { match: false, method: "", matchedAnswer: "", confidence: "" };
  }

  const synonymIndex = new Map();
  (data.synonymGroups || []).forEach((group, groupIndex) => {
    group.forEach((term) => {
      const key = normalizeKoV2(term);
      if (!synonymIndex.has(key)) synonymIndex.set(key, new Set());
      synonymIndex.get(key).add(groupIndex);
    });
  });

  function sharesExplicitGroup(left, right) {
    const leftGroups = synonymIndex.get(normalizeKoV2(left));
    const rightGroups = synonymIndex.get(normalizeKoV2(right));
    if (!leftGroups || !rightGroups) return false;
    for (const group of leftGroups) if (rightGroups.has(group)) return true;
    return false;
  }

  function pairMatches(left, right, pairs) {
    const leftKey = exactKey(left);
    const rightKey = exactKey(right);
    return (pairs || []).some(([a, b]) => {
      const aKey = exactKey(a);
      const bKey = exactKey(b);
      return (leftKey === aKey && rightKey === bKey) ||
        (leftKey === bKey && rightKey === aKey);
    });
  }

  function hasNegativePrefixConflict(left, right) {
    const leftStem = normalizeKoV2(left);
    const rightStem = normalizeKoV2(right);
    return ["불", "부", "비", "무", "미"].some((prefix) =>
      leftStem === prefix + rightStem || rightStem === prefix + leftStem
    );
  }

  function checkPolarity(left, right) {
    return !pairMatches(left, right, data.antonymPairs) &&
      !hasNegativePrefixConflict(left, right);
  }

  function firstInitial(value) {
    for (const char of exactKey(value)) {
      const code = char.charCodeAt(0);
      if (code >= 0xac00 && code <= 0xd7a3) return Math.floor((code - 0xac00) / 588);
    }
    return -1;
  }

  function decomposeHangul(value) {
    const result = [];
    for (const char of exactKey(value)) {
      const code = char.charCodeAt(0);
      if (code < 0xac00 || code > 0xd7a3) {
        result.push(char);
        continue;
      }
      const offset = code - 0xac00;
      result.push(`c${Math.floor(offset / 588)}`);
      result.push(`v${Math.floor((offset % 588) / 28)}`);
      const final = offset % 28;
      if (final) result.push(`f${final}`);
    }
    return result;
  }

  function editDistance(left, right) {
    const a = decomposeHangul(left);
    const b = decomposeHangul(right);
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const current = [i];
      for (let j = 1; j <= b.length; j++) {
        current[j] = Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      previous = current;
    }
    return previous[b.length];
  }

  function syllableLength(value) {
    return (normalizeKoV2(value).match(/[가-힣]/g) || []).length;
  }

  const knownTermIndexCache = new WeakMap();

  function getKnownTermIndex(knownTerms) {
    if (knownTerms && (typeof knownTerms === "object" || typeof knownTerms === "function")) {
      const cached = knownTermIndexCache.get(knownTerms);
      if (cached) return cached;
    }
    const terms = Array.from(knownTerms || []);
    const index = {
      exact: new Set(terms.map(exactKey)),
      stems: new Set(terms.map(normalizeKoV2))
    };
    if (knownTerms && (typeof knownTerms === "object" || typeof knownTerms === "function")) {
      knownTermIndexCache.set(knownTerms, index);
    }
    return index;
  }

  function isKnownTerm(user, knownTerms) {
    if (!knownTerms) return false;
    const index = getKnownTermIndex(knownTerms);
    return index.exact.has(exactKey(user)) || index.stems.has(normalizeKoV2(user));
  }

  function typoMatch(user, answerUnits, options) {
    if (!data.flags || !data.flags.fuzzyTypo) return null;
    if (syllableLength(user) < 3 || isKnownTerm(user, options.knownTerms)) return null;

    const candidates = answerUnits
      .filter((answer) => syllableLength(answer) >= 3)
      .filter((answer) => firstInitial(user) === firstInitial(answer))
      .filter((answer) => !pairMatches(user, answer, data.typoDenyPairs))
      .map((answer) => ({
        answer,
        distance: Math.min(
          editDistance(user, answer),
          editDistance(normalizeKoV2(user), normalizeKoV2(answer))
        )
      }))
      .filter(({ answer, distance }) => distance <= (syllableLength(answer) >= 5 ? 2 : 1));
    if (!candidates.length) return null;
    const closest = Math.min(...candidates.map(({ distance }) => distance));
    const nearest = candidates.filter(({ distance }) => distance === closest);
    return nearest.length === 1 ? nearest[0].answer : null;
  }

  function checkAnswer(userRaw, meaningRaw, options = {}) {
    const userUnits = parseMeaningUnits(userRaw);
    const answerUnits = parseMeaningUnits(meaningRaw);
    for (const user of userUnits) {
      for (const answer of answerUnits) {
        if (!checkPolarity(user, answer)) return noMatch();
      }
    }
    for (const user of userUnits) {
      for (const answer of answerUnits) {
        if (exactKey(user) === exactKey(answer)) {
          return { match: true, method: "exact", matchedAnswer: answer, confidence: "high" };
        }
        const userStem = normalizeKoV2(user);
        const answerStem = normalizeKoV2(answer);
        if ((userStem.length >= 2 && userStem === answerStem) || isCopulaVariant(user, answer)) {
          return { match: true, method: "variant", matchedAnswer: answer, confidence: "high" };
        }
      }
    }
    for (const user of userUnits) {
      for (const answer of answerUnits) {
        if (sharesExplicitGroup(user, answer)) {
          return { match: true, method: "synonym", matchedAnswer: answer, confidence: "high" };
        }
      }
    }
    const aliases = (data.entryAliases && data.entryAliases[String(options.cn)]) || [];
    for (const user of userUnits) {
      if (aliases.some((alias) => exactKey(alias) === exactKey(user) ||
        normalizeKoV2(alias) === normalizeKoV2(user))) {
        return {
          match: true,
          method: "synonym",
          matchedAnswer: answerUnits[0] || "",
          confidence: "high"
        };
      }
    }
    for (const user of userUnits) {
      const answer = typoMatch(user, answerUnits, options);
      if (answer) {
        return { match: true, method: "typo", matchedAnswer: answer, confidence: "guarded" };
      }
    }
    return noMatch();
  }

  return {
    parseMeaningUnits,
    normalizeKoV2,
    checkPolarity,
    sharesExplicitGroup,
    checkAnswer
  };
});