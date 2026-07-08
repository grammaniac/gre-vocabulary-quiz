# CLAUDE.md — gre-vocabulary-quiz

송종옥(GRE Verbal) 선생님의 거만어 3,000단어 학습 앱. GitHub Pages로 서빙된다.
프로덕션 URL: https://grammaniac.github.io/gre-vocabulary-quiz/

## 구조

```
index.html            ← 메인 앱 (SPA, 프레임워크 없음)
css/app.css           ← 디자인 시스템 (다크/라이트, 인쇄 CSS 포함)
js/app.js             ← 앱 로직 전체 (모드·채점·SRS·통계·인쇄)
js/vocab-data.js      ← ★생성물. 직접 수정 금지 (build_data.py가 생성)
scripts/build_data.py ← 데이터 빌드 (Vault vocab md + 구버전 VOCAB 병합)
manifest.webmanifest, sw.js, icons/  ← PWA
Gumanuv1100_quiz.html ← 구버전 주소 → 새 앱 리다이렉트 (2026-07-08 확정)
scripts/legacy_vocab.json ← 구버전 VOCAB 보존본 (한글 뜻 = 채점 기준의 원천)
```

## 규칙

1. `Gumanuv1100_quiz.html`은 구버전 주소를 새 앱으로 넘기는 **리다이렉트 페이지**다
   (구버전 앱 본체는 2026-07-08 폐기, 주소만 승계). 새 기능은 index.html 계열에만.
2. **`js/vocab-data.js`는 손으로 고치지 않는다.** 단어 데이터 수정은
   Vault(`~/Library/Mobile Documents/iCloud~md~obsidian/Documents/GRE Verbal Vault/wiki/vocab/`),
   `scripts/legacy_vocab.json`(한글 뜻), 또는 `scripts/build_data.py`를 고친 뒤 재생성:
   `python3 scripts/build_data.py` (Vault가 있는 데스크톱에서만 가능).
3. 한글 뜻(`meaning` 필드)은 **주관식 채점 엔진의 기준**이라 `scripts/legacy_vocab.json`
   (구버전 VOCAB 보존본) 값을 그대로 쓴다. 임의로 바꾸면 채점 결과가 달라진다.
4. ★ **웹 공개 데이터 화이트리스트 (선생님 확정 2026-07-08)**: `vocab-data.js`에는
   표제어·발음기호·한글뜻(`word`/`ipa`/`meaning`)까지만 담는다. Vault 원문의
   영어 정의·예문·동의어·어원은 이해관계 문제로 **절대 웹에 노출하지 않는다.**
   build_data.py가 이를 강제하며, 데이터 재생성 후 필드 화이트리스트를 확인할 것.
5. `sw.js`의 `CACHE_VERSION`은 **배포마다 올린다** (안 올리면 학생 기기에 구버전이 남는다).
6. 학습 기록은 localStorage(`gv.*`) — 서버 없음, 코드에서 개인정보 수집 금지.
7. 배포: main push → GitHub Pages 자동 반영. 학생 공유는 프로덕션 URL로.

## 채점 엔진 (js/app.js §8)

구버전에서 검증된 로직을 그대로 이식한 것: `normalizeKo`(한국어 어미 정규화) →
직접 포함 매칭 → 어근 매칭 → `SYN_GROUPS` 유의어 그룹 매칭.
수정할 때는 기존 정답 판정이 달라지지 않는지 회귀 확인 필수.

## git 이력 주의 (2026-07-08)

영어 정의·예문·어원이 담긴 초기 vocab-data.js를 지우기 위해 **이력을 재작성(force push)**했다.
이 repo는 이력을 보존 대상으로 삼지 않는다 — 필요하면 다시 squash해도 된다.
단, 민감 데이터(웹 공개 화이트리스트 밖 내용)를 커밋하지 않는 것이 우선이다.
