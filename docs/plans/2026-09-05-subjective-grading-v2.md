# 주관식 의미 기반 채점 v2 Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 주관식에서 한글 뜻의 글자 그대로 일치뿐 아니라 타당한 유의어·준말·활용형·제한적인 오타/어법 차이를 정답으로 인정하면서, 반의어와 우연한 부분 문자열은 오답으로 유지한다.

**Architecture:** DOM과 분리된 순수 채점 엔진이 입력과 정답을 의미 단위로 파싱한 뒤, 안전한 단계별 판정(`정확 일치 → 형태 변형 → 검수 유의어 → 제한적 오타`)을 수행한다. 유의어는 자동 전이시키지 않은 검수 데이터로 관리하고, 오타는 기존 의미 사전 단어와 충돌하지 않는 유일 후보일 때만 허용한다.

**Tech Stack:** Vanilla JavaScript, Node.js 내장 `node:test`, GitHub Pages, Service Worker/PWA

---

## 1. 확인된 현상과 원인

### 학생 실사례

1. 정답 `퉁명스런`, 입력 `퉁명스러운`
   - 의미는 같지만 현재 `normalizeKo()`는 `-스러운`만 `-스럽`으로 줄이고 `-스런`은 처리하지 않는다.
2. 정답 `완강한`, 입력 `완고한`
   - 의미상 타당한 유의어지만 현재 `SYN_GROUPS`에 이 개념군이 없다.
3. `퉁명스러윤` 같은 가벼운 오타 또는 자연스럽지 않은 활용형
   - 현재는 철자 차이를 전혀 허용하지 않는다.

### 구조적 원인

- `js/app.js:600-723`에 UI, 형태 정규화, 유의어 데이터, 판정이 한 덩어리로 있다.
- 수동 `SYN_GROUPS`는 약 60여 개 개념군뿐이라 3,000개 표제어와 약 6,225개의 한국어 의미 표현을 충분히 덮지 못한다.
- 현재 `user.includes(answer) || answer.includes(user)` 방식은 한편으로는 표현 차이를 놓치고, 다른 한편으로는 짧은 일반어를 우연히 정답 처리할 수 있다.
- 형태 정규화가 문자열 끝의 일부 어미만 처리하며 준말, 관형형, 명사형, 띄어쓰기 변형을 체계적으로 다루지 않는다.
- 편집거리만 단순 도입하면 `완고한/완곡한`, `반박하다/반복하다`, `가장하다/가정하다` 같은 한 글자 차이의 다른 정상 단어를 오답인데도 맞게 처리할 수 있다.

## 2. 채점 계약

### 2.1 결과 형식

`checkAnswer()`는 boolean 대신 다음 구조를 반환한다.

```js
{
  match: true,
  method: "exact" | "variant" | "synonym" | "typo",
  matchedAnswer: "퉁명스런",
  confidence: "high" | "guarded"
}
```

- `exact`, `variant`, `synonym`: `high`
- `typo`: `guarded`; 화면에 `오타 인정 ✓` 표시
- 어떤 단계에서도 반의어/부정 극성 충돌이 확인되면 즉시 오답

### 2.2 판정 우선순위

1. **의미 단위 파싱**
   - `<br>`, 번호, 쉼표, 세미콜론, 슬래시를 기준으로 정답 표현을 분리한다.
   - 괄호의 품사·상황 힌트는 채점 대상에서 제외하되 괄호 뒤 본뜻은 유지한다.
   - 입력도 쉼표 등으로 나누고, 입력 표현 중 하나라도 안전하게 맞으면 정답이다.
2. **정확 일치**
   - Unicode NFC, 공백/문장부호 정리 후 의미 단위 전체가 같을 때.
3. **형태 변형 일치**
   - 각 의미 단위별로 어미를 정규화한다.
   - `-하다/-한/-하는/-하게/-함/-해`, `-이다/-인`, `-스럽다/-스러운/-스런/-스레`, `-롭다/-로운`, `-적이다/-적인/-적으로`를 같은 내용 어간으로 본다.
   - 조사·띄어쓰기 차이는 허용하되, 내용 어간 자체는 남겨야 한다.
4. **검수된 유의어 일치**
   - 정답 의미 단위와 입력 의미 단위가 같은 명시적 개념군에 속할 때.
   - 그룹 간 연결을 통한 전이 추론은 금지한다. A-B, B-C가 있어도 A-C를 자동 인정하지 않는다.
   - 전역적으로 안전하지 않은 대체어는 C-N별 별칭으로 제한한다.
5. **제한적 오타 일치**
   - 위 1~4가 모두 실패했을 때만 적용한다.
   - 정규화된 내용 어간이 최소 3음절 이상이어야 한다.
   - 3~4음절은 자모 기반 편집거리 1, 5음절 이상은 최대 2를 허용한다.
   - 첫 음절 초성이 같아야 한다.
   - 사용자 입력이 3,000개 정답 의미 사전에 존재하는 정상 표현이면 오타로 취급하지 않는다.
   - 현재 문제의 허용 답 중 최근접 후보가 하나뿐일 때만 인정한다.
   - `TYPO_DENY_PAIRS` 및 반의어/부정 극성 가드를 먼저 적용한다.
   - 기능 플래그로 즉시 끌 수 있게 한다.

### 2.3 반드시 막아야 하는 오인정

- 부정 극성: `명확한 ↔ 불명확한`, `적절한 ↔ 부적절한`, `가능한 ↔ 가능하지 않은`
- 근접 철자지만 다른 단어: `완고한 ↔ 완곡한`, `반박하다 ↔ 반복하다`, `가장하다 ↔ 가정하다`
- 지나치게 짧은 입력: `하다`, `있는`, `좋은`, 한두 음절 파편
- 접두사만 제거해서 뜻이 뒤집히는 경우: `불/부/비/무/미`는 일반 삭제 금지
- 한 단어의 서로 다른 sense를 유의어 그룹의 연결고리로 사용한 자동 전이

## 3. 데이터 구조

### `js/ko-grading-data.js` 신규

```js
const KO_GRADING_DATA = {
  synonymGroups: [
    ["퉁명스런", "퉁명스러운", "퉁명스럽다"],
    ["완강한", "완고한", "고집센", "고집스러운"]
  ],
  entryAliases: {
    // 전역 치환이 위험할 때만 C-N별 허용 표현
    // "28004": ["집요한"]
  },
  antonymPairs: [
    ["명확한", "불명확한"],
    ["적절한", "부적절한"]
  ],
  typoDenyPairs: [
    ["완고한", "완곡한"],
    ["반박하다", "반복하다"],
    ["가장하다", "가정하다"]
  ],
  flags: { fuzzyTypo: true }
};
```

원칙:

- 기존 `SYN_GROUPS`를 이 파일로 옮기되 의미를 재검토하고 중복 그룹을 합치지 않는다.
- 추가 유의어의 출처는 `scripts/legacy_vocab.json`의 공개 한글 뜻, 교사 검수, 학생 제보로 한정한다.
- Vault의 영어 정의·예문·Synonym·어원은 읽거나 웹 자산에 넣지 않는다.
- `js/vocab-data.js`에는 어떤 필드도 추가하지 않고 직접 수정하지 않는다.
- 유의어 후보 생성은 로컬 보조 도구일 뿐이며 자동 승인하지 않는다.

## 4. 파일별 구현 계획

### Task 1: 현재 판정을 테스트로 동결

**Objective:** 개선 전 동작과 알려진 문제를 재현하는 안전망을 만든다.

**Files:**
- Create: `tests/grader.test.js`
- Create: `tests/fixtures/grading-cases.json`
- Create: `tests/helpers/load-current-grader.js`

**Steps:**

1. `node:test`로 현재 `normalizeKo`, `tokenizeKo`, `checkAnswer`의 대표 동작을 고정한다.
2. 학생 사례 2개와 오타 사례를 `expected: false`인 RED 테스트로 추가한다.
3. 반의어·근접철자·짧은 부분문자열을 반드시 오답으로 요구하는 테스트를 추가한다.
4. 실행:

```bash
node --test tests/grader.test.js
```

Expected: 기존 회귀 케이스는 PASS, 신규 학생 사례는 의도대로 FAIL.

### Task 2: DOM 없는 순수 채점 엔진 분리

**Objective:** 브라우저와 Node에서 같은 로직을 테스트할 수 있게 한다.

**Files:**
- Create: `js/grader.js`
- Modify: `js/app.js:499-518,600-723`
- Modify: `index.html:234-235`

**Steps:**

1. `js/grader.js`에 `parseMeaningUnits`, `normalizeKoV2`, `checkPolarity`, `checkAnswer`를 구현한다.
2. 브라우저에서는 `window.KoGrader`, Node에서는 `module.exports`로 같은 함수를 노출한다.
3. `app.js`의 기존 §8을 제거하고 `KoGrader.checkAnswer(input, meaning, { cn })`만 호출한다.
4. 기존 직접 일치 회귀 테스트가 모두 PASS인지 확인한다.

### Task 3: 한국어 형태 변형 정규화 v2

**Objective:** 준말·활용형·띄어쓰기/어법 차이를 안전하게 인정한다.

**Files:**
- Modify: `js/grader.js`
- Modify: `tests/fixtures/grading-cases.json`
- Modify: `tests/grader.test.js`

**Positive tests:**

- `퉁명스런 ← 퉁명스러운`
- `퉁명스런 ← 퉁명스럽게`
- `완고한 ← 완고하다`
- `고집센 ← 고집이 센`
- `직설적인 ← 직설적으로`

**Negative tests:**

- `명확한 ← 불명확한`
- `적절한 ← 부적절한`
- `약한 ← 미약한`은 자동 규칙이 아니라 검수 예외로만 허용
- `하다`, `있는` 같은 불용 표현 단독 입력

### Task 4: 검수된 유의어 계층 추가

**Objective:** 형태가 다른 실제 유의어를 정답으로 인정한다.

**Files:**
- Create: `js/ko-grading-data.js`
- Modify: `js/grader.js`
- Modify: `tests/fixtures/grading-cases.json`
- Create: `scripts/syn_candidates.py`

**Steps:**

1. 기존 `SYN_GROUPS`를 새 데이터 파일로 옮기고 중복/충돌을 리포트한다.
2. `완강한/완고한/고집센` 개념군을 추가한다.
3. `scripts/syn_candidates.py`는 legacy 한글 뜻의 반복·동시 출현을 후보로만 출력한다.
4. 후보는 사람이 승인한 뒤에만 `synonymGroups` 또는 `entryAliases`에 들어간다.
5. 동일 표현이 여러 그룹을 연결해 자동으로 의미가 확장되지 않도록 `sharesExplicitGroup()`만 사용한다.
6. 실행:

```bash
python3 scripts/syn_candidates.py --report
node --test tests/grader.test.js
```

Expected: 실사례 PASS, 반의어/다의어 경계 사례 PASS.

### Task 5: 안전한 오타 허용

**Objective:** 명백한 한글 오타를 인정하면서 정상적인 다른 단어는 보호한다.

**Files:**
- Modify: `js/grader.js`
- Modify: `js/ko-grading-data.js`
- Create: `tests/typo-collision.test.js`

**Steps:**

1. 한글 음절을 초성·중성·종성으로 분해하는 편집거리 함수를 구현한다.
2. 전체 legacy meaning에서 정상화된 의미 어간 사전을 앱 시작 시 한 번 생성한다.
3. 최소 길이, 첫 초성, 거리, 유일 최근접, 정상 표현 충돌 veto를 모두 통과할 때만 `method: "typo"`를 반환한다.
4. corpus 안에서 가까운 정상 표현 쌍을 자동 수집해 충돌 회귀 테스트로 고정한다.
5. 테스트:
   - PASS: `퉁명스러운 ← 퉁명스러윤`
   - FAIL: `완고한 ← 완곡한`
   - FAIL: `반박하다 ← 반복하다`
   - FAIL: `혐오 ← 협오`(짧은 어간)
6. `KO_GRADING_DATA.flags.fuzzyTypo = false`일 때 모든 fuzzy 판정이 꺼지는지 확인한다.

### Task 6: 학생에게 판정 근거 표시

**Objective:** 관대한 판정이 학습을 흐리지 않도록 무엇이 인정됐는지 보여준다.

**Files:**
- Modify: `js/app.js:499-518`
- Modify: `css/app.css`

**Steps:**

1. `variant`이면 `표현 차이 ✓`, `synonym`이면 `유의어 ✓`, `typo`이면 `오타 인정 ✓` 태그를 표시한다.
2. 원래 교재 뜻은 항상 함께 표시한다.
3. 오타 인정은 점수에는 포함하되 학생이 정확한 표기를 확인할 수 있게 색상과 문구를 유의어와 구분한다.
4. 모바일 폭에서 태그와 뜻이 잘리거나 중복되지 않는지 렌더링 확인한다.

### Task 7: PWA 캐시와 배포 검증

**Objective:** 새 엔진이 온라인/오프라인에서 모두 동일하게 로드되게 한다.

**Files:**
- Modify: `index.html:234-235`
- Modify: `sw.js:8-18`

**Steps:**

1. `index.html` 스크립트 순서를 `vocab-data → ko-grading-data → grader → app`으로 둔다.
2. 모든 변경 자산 쿼리를 현재 `?v=6`에서 같은 새 번호로 올린다.
3. `sw.js`의 `CACHE_VERSION`을 현재 `gv-v6`에서 같은 새 번호로 올린다.
4. `APP_SHELL`에 `js/ko-grading-data.js`, `js/grader.js`를 추가한다.
5. 로컬 HTTP 서버에서 온라인·오프라인 새로고침을 모두 시험한다.
6. 배포 후 실제 프로덕션 URL에서 학생 실사례를 직접 입력해 확인한다.
7. DevTools/Application에서 새 cache 이름과 새 버전 쿼리를 확인한다.

## 5. 전체 테스트 표본

| 분류 | 정답 뜻 | 사용자 입력 | 기대 |
|---|---|---|---|
| 준말 | 퉁명스런 | 퉁명스러운 | 정답/variant |
| 활용 | 퉁명스런 | 퉁명스럽게 | 정답/variant |
| 유의어 | 완강한 | 완고한 | 정답/synonym |
| 유의어 | 고집센 | 고집이 센 | 정답/variant 또는 synonym |
| 오타 | 퉁명스러운 | 퉁명스러윤 | 정답/typo |
| 반의어 | 명확한 | 불명확한 | 오답 |
| 부정 | 가능한 | 가능하지 않은 | 오답 |
| 근접 정상어 | 완고한 | 완곡한 | 오답 |
| 근접 정상어 | 반박하다 | 반복하다 | 오답 |
| 짧은 파편 | 향상시키다 | 하다 | 오답 |
| 짧은 오타 | 혐오 | 협오 | 오답 |
| 다의어 경계 | 줄이다 | 줄다 | 교사 결정 전 오답 유지 |

## 6. 단계적 출시

### Phase 1 — 즉시 체감, 최고 안전성

- 순수 엔진 분리
- 형태 정규화 v2
- `퉁명스런/퉁명스러운`, `완강한/완고한` 포함 검수 유의어
- 반의어/부정/짧은 부분문자열 방어
- 오타 기능은 코드와 테스트를 만들되 기본 OFF

### Phase 2 — 유의어 폭 확대

- 3,000개 legacy 한글 뜻에서 후보 보고서 생성
- 빈도가 높고 학생 오답을 많이 만드는 개념군부터 교사 검수
- 승인된 그룹만 작은 배치로 추가하고 매번 전체 회귀 테스트

### Phase 3 — 오타 허용 ON

- 충돌 테스트를 통과한 뒤 제한적 fuzzy를 ON
- 화면에 `오타 인정`을 명시
- 학생 제보로 false positive/negative를 수집해 `typoDenyPairs`와 별칭을 보정

## 7. 완료 기준

- 학생 실사례 두 개가 정답 처리된다.
- 대표 오타는 정답 처리되며, `완고한/완곡한` 같은 정상 단어 충돌은 오답이다.
- 반의어와 부정 표현이 부분 문자열 때문에 정답 처리되지 않는다.
- 기존 확실한 정답 판정은 의도되지 않은 변화가 없다.
- `node --test tests/*.test.js`가 전부 통과한다.
- `js/vocab-data.js`, `scripts/legacy_vocab.json`, `scripts/build_data.py`는 변경되지 않는다.
- 공개 `VOCAB` 레코드는 계속 `word/ipa/meaning` 및 기존 식별 필드만 포함한다.
- `index.html` 자산 버전과 `sw.js` 캐시 버전이 함께 갱신된다.
- 로컬 렌더링, 오프라인 PWA, 프로덕션 URL에서 실제 입력 QA를 통과한다.
- 배포는 John의 최종 확인 후에만 진행한다.

## 8. 주요 위험과 대응

1. **관대함이 오인정으로 바뀌는 위험**
   - 자동 유의어 전이 금지, 반의어 우선 veto, 정상 표현 사전 충돌 veto.
2. **오타 판정이 실제 다른 단어를 삼키는 위험**
   - 최소 길이·초성·유일 후보·기존 사전 단어 veto·기능 플래그.
3. **기존 부분 문자열 정답이 줄어드는 변화**
   - 동결본 회귀 비교에서 의도된 변경만 승인 목록으로 관리.
4. **유의어 데이터의 무한 확장**
   - 고빈도 학생 사례 우선, 검수 배치, 전역 그룹과 C-N별 별칭 분리.
5. **민감한 Vault 데이터 노출**
   - legacy 한글 뜻과 교사 승인 표현만 사용; `vocab-data.js` 무변경 검증.
6. **Service Worker가 구버전 엔진을 유지하는 위험**
   - 새 파일 APP_SHELL 등록, 쿼리/캐시 동시 bump, 온라인·오프라인 QA.
