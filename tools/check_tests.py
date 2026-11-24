"""Validate data/tests.json against real Python and against data/snippets.json."""
import io, json, sys, contextlib

UNIT_OF = {"A1":1,"A2":1,"A3":1,"A6":2,"A7":2,"A8":2,"A9":2,"A4":3,"A5":3,"A10":3}
CORE = ["A1","A2","A3","A4","A5","A6","A7","A8"]

def run(code):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        exec("\n".join(code), {})
    return buf.getvalue().rstrip("\n")

def main(tp, sp):
    t = json.load(open(tp, encoding="utf-8"))
    sn = json.load(open(sp, encoding="utf-8"))
    known = set(sn["misconceptions"])
    snippet_code = {"\n".join(s["code"]) for s in sn["snippets"]}
    errs, forms_code = [], {}
    for fk, form in t["forms"].items():
        items = form["items"]
        ids = [i["id"] for i in items]
        if len(ids) != len(set(ids)): errs.append(f"{fk}: duplicate ids")
        matched = [i["tag"] for i in items if i["scored"] == "matched"]
        if sorted(matched) != sorted(CORE): errs.append(f"{fk}: matched tags {sorted(matched)} != A1-A8")
        extras = sorted(i["tag"] for i in items if i["scored"] == "extra")
        if fk == "pre" and extras: errs.append("pre has extras")
        if fk == "post" and extras != ["A10", "A9"]: errs.append(f"post extras {extras}")
        for it in items:
            tag = it["tag"]; where = it["id"]
            if tag not in known: errs.append(f"{where}: unknown tag {tag}")
            if UNIT_OF.get(tag) != it["unit"]: errs.append(f"{where}: unit {it['unit']} wrong for {tag}")
            opts = it["options"]
            if sum(o["correct"] for o in opts) != 1: errs.append(f"{where}: need exactly one correct option")
            texts = [o["text"] for o in opts]
            if len(texts) != len(set(texts)): errs.append(f"{where}: duplicate option text")
            for o in opts:
                if o["tag"] is not None and o["tag"] not in known: errs.append(f"{where}: option tag {o['tag']}")
                if o["correct"] and o["tag"]: errs.append(f"{where}: correct option has tag")
            try:
                out = run(it["code"])
            except Exception as e:
                out = None; errs.append(f"{where}: code raised {e!r}")
            if out is not None:
                cor = [o for o in opts if o["correct"]][0]["text"]
                if cor != out: errs.append(f"{where}: correct option {cor!r} != real output {out!r}")
                for o in opts:
                    if not o["correct"] and o["text"] == out: errs.append(f"{where}: distractor equals real output")
            code = "\n".join(it["code"])
            if code in snippet_code: errs.append(f"{where}: code identical to a lesson snippet")
            if code in forms_code: errs.append(f"{where}: code identical to {forms_code[code]}")
            forms_code[code] = where
    if errs:
        print("\n".join("FAIL: " + e for e in errs)); sys.exit(1)
    print("OK: tests valid;", {k: len(f["items"]) for k, f in t["forms"].items()}, "items, outputs match real Python")

main(sys.argv[1] if len(sys.argv) > 1 else "data/tests.json", sys.argv[2] if len(sys.argv) > 2 else "data/snippets.json")
