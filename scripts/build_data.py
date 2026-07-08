#!/usr/bin/env python3
"""거만어 Quiz 데이터 빌드.

기존 Gumanuv1100_quiz.html의 VOCAB(한글 뜻 = 채점 기준, 불변)과
Vault wiki/vocab/*.md(발음기호·sense별 의미/예문/Synonym·어원)를
cn ↔ C-N으로 병합해 js/vocab-data.js 를 생성한다.

실행: repo 루트에서  python3 scripts/build_data.py
"""
import json
import os
import re
import sys
import unicodedata

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VAULT_VOCAB = os.path.expanduser(
    "~/Library/Mobile Documents/iCloud~md~obsidian/Documents/GRE Verbal Vault/wiki/vocab"
)
LEGACY_JSON = os.path.join(REPO, "scripts", "legacy_vocab.json")
OUT = os.path.join(REPO, "js", "vocab-data.js")

# Vault pronunciation이 "-" 자리표시자인 표제어 보충
IPA_OVERRIDES = {
    "at a premium": "[æt ə príːmiəm]",
    "double-edged": "[dʌ̀bl édʒd]",
    "free-for-all": "[fríː fər ɔ̀ːl]",
    "fringe benefit": "[frindʒ bénəfit]",
    "from the get-go": "[frəm ðə gétgòu]",
    "keep ~ at bay": "[kiːp ət béi]",
    "hard-pressed": "[hɑ̀ːrd prést]",
    "mince no words": "[mins nou wə́ːrdz]",
    "on a par with": "[ɑn ə pɑ́ːr wið]",
    "pit against": "[pit əgénst]",
    "profit monger": "[prɑ́fit mʌ̀ŋgər]",
    "puff pieces": "[pʌf píːsiz]",
    "pull no punches": "[pul nou pʌ́ntʃiz]",
    "run afoul of": "[rʌn əfául əv]",
    "sidestep": "[sáidstèp]",
    "square with": "[skwɛər wið]",
    "stave off": "[steiv ɔ́ːf]",
    "succumb to": "[səkʌ́m tuː]",
    "unexampled": "[ʌ̀nigzǽmpld]",
}


def nfc(s):
    return unicodedata.normalize("NFC", s)


def load_legacy_vocab():
    """구버전 퀴즈의 VOCAB(한글 뜻 = 채점 기준). scripts/legacy_vocab.json에 보존."""
    return json.load(open(LEGACY_JSON, encoding="utf-8"))


SENSE_HEAD = re.compile(r"^##\s*sense\s*(\d+)", re.I)
BULLET = re.compile(r"^-\s*\*\*(의미|예문|Synonym|versions)\*\*\s*:?\s*(.*)$", re.I)


def parse_md(path):
    """vocab md 하나를 파싱해 {cn, word, ipa, senses[], ety, syn_all} 반환."""
    raw = nfc(open(path, encoding="utf-8").read())
    lines = raw.splitlines()

    # frontmatter
    fm = {}
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                body_lines = lines[i + 1:]
                break
            m = re.match(r"^([\w-]+):\s*(.*)$", lines[i])
            if m:
                fm[m.group(1)] = m.group(2).strip().strip('"')
        else:
            body_lines = lines
    else:
        body_lines = lines

    cn = fm.get("C-N")
    word = fm.get("word", "")
    ipa = fm.get("pronunciation", "").strip().strip('"')

    senses = []
    ety = ""
    syn_all = ""
    cur = None          # 현재 sense dict
    section = None      # 'sense' | 'ety' | 'synall' | None
    cont_key = None     # 직전 bullet 키 (여러 줄 이어짐 대비)

    for ln in body_lines:
        s = ln.strip()
        if s.startswith("## "):
            cont_key = None
            if SENSE_HEAD.match(s):
                cur = {"d": "", "ex": "", "syn": ""}
                senses.append(cur)
                section = "sense"
            elif "어원" in s:
                section = "ety"
            elif "synonym" in s.lower():
                section = "synall"
            else:
                section = None
            continue
        if not s or s.startswith("# ") or re.fullmatch(r"\[.*\]", s) and not senses and section is None:
            # 본문 상단의 단독 발음기호 라인 등은 무시
            continue
        if section == "sense" and cur is not None:
            m = BULLET.match(s)
            if m:
                key, val = m.group(1).lower(), m.group(2).strip()
                if key == "의미":
                    cur["d"] = val; cont_key = "d"
                elif key == "예문":
                    cur["ex"] = val; cont_key = "ex"
                elif key == "synonym":
                    cur["syn"] = val; cont_key = "syn"
                else:
                    cont_key = None
            elif cont_key and not s.startswith("-"):
                cur[cont_key] = (cur[cont_key] + " " + s).strip()
        elif section == "ety":
            ety = (ety + " " + s).strip()
        elif section == "synall":
            syn_all = (syn_all + " " + s).strip()

    return {"cn": cn, "word": word, "ipa": ipa, "senses": senses,
            "ety": ety, "syn_all": syn_all}


def main():
    legacy = load_legacy_vocab()
    print(f"legacy VOCAB: {len(legacy)}")

    md_by_cn = {}
    anomalies = []
    files = [f for f in os.listdir(VAULT_VOCAB) if f.endswith(".md")]
    for fn in files:
        info = parse_md(os.path.join(VAULT_VOCAB, fn))
        if not info["cn"] or not info["cn"].isdigit():
            anomalies.append(f"C-N 없음: {fn}")
            continue
        cn = int(info["cn"])
        if cn in md_by_cn:
            anomalies.append(f"C-N 중복: {fn} (cn={cn}, 기존 {md_by_cn[cn]['_fn']})")
            continue
        info["_fn"] = fn
        md_by_cn[cn] = info

    print(f"vault md: {len(files)} (C-N 매핑 {len(md_by_cn)})")
    for a in anomalies:
        print("  ⚠", a)

    merged = []
    no_md, no_ipa, word_mismatch = [], [], []
    for w in legacy:
        cn = w["cn"]
        entry = {"ch": w["ch"], "cn": cn, "word": w["word"].strip(),
                 "meaning": w["meaning"]}
        md = md_by_cn.get(cn)
        if not md:
            no_md.append(f"{cn} {w['word']}")
        else:
            if nfc(md["word"].strip().lower()) != nfc(w["word"].strip().lower()):
                word_mismatch.append(f"cn={cn}: quiz '{w['word']}' vs md '{md['word']}'")
            md_ipa = md["ipa"] if md["ipa"].strip() not in ("-", "–", "—") else ""
            ipa = md_ipa or IPA_OVERRIDES.get(w["word"].strip(), "")
            if ipa:
                entry["ipa"] = ipa
            else:
                no_ipa.append(w["word"].strip())
            # ★ 선생님 확정 2026-07-08: 웹 공개 데이터는 표제어·발음기호·한글뜻까지만.
            #   영어 정의·예문·동의어·어원(Vault 원문)은 절대 출력하지 않는다 (이해관계 문제).
        merged.append(entry)

    print(f"\n병합 결과: {len(merged)}")
    print(f"  md 매칭 실패: {len(no_md)} {no_md[:10]}")
    print(f"  단어 표기 불일치: {len(word_mismatch)}")
    for x in word_mismatch[:15]:
        print("   ", x)
    print(f"  발음기호 없음: {len(no_ipa)} {no_ipa[:15]}")
    n_sense = 0
    n_ex = 0
    n_ety = 0
    print(f"  senses 보유 {n_sense} · 예문 보유 {n_ex} · 어원 보유 {n_ety}")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    payload = json.dumps(merged, ensure_ascii=False, separators=(",", ":"))
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// generated by scripts/build_data.py — 직접 수정 금지\n")
        f.write("const VOCAB = " + payload + ";\n")
    print(f"\n→ {OUT} ({os.path.getsize(OUT)/1024/1024:.2f} MB)")


if __name__ == "__main__":
    main()
