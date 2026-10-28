#!/usr/bin/env python3
"""Check data/snippets.json against the schema rules and against real Python.

Usage: python3 tools/check_snippets.py data/snippets.json

WARNING: this runs the snippet code with exec(). Only run it on snippets you wrote.
"""
import contextlib
import io
import json
import sys


def partition_of(ns, names):
    """Group names by the identity of the object they point to."""
    by_id = {}
    for n in names:
        by_id.setdefault(id(ns[n]), []).append(n)
    return sorted(sorted(g) for g in by_id.values())


def check_snippet(s, miscs, errors):
    sid = s.get("id", "?")

    def err(msg):
        errors.append(f"{sid}: {msg}")

    # tags exist
    for part in ("predictA", "predictB"):
        opts = s[part]["options"]
        if not 2 <= len(opts) <= 4:
            err(f"{part} should have 2-4 options, has {len(opts)}")
        if sum(1 for o in opts if o["correct"]) != 1:
            err(f"{part} must have exactly one correct option")
        untagged_wrong = [o for o in opts if not o["correct"] and o["tag"] is None]
        if len(untagged_wrong) > 1:
            err(f"{part} has more than one untagged filler option")
        if not any(o["tag"] for o in opts if not o["correct"]):
            err(f"{part} has no tagged distractor")
        for o in opts:
            if o["tag"] is not None and o["tag"] not in miscs:
                err(f"{part} option {o['id']} uses unknown tag {o['tag']}")
            if o["tag"] is not None and o["tag"] not in s["feedback"]["byTag"]:
                err(f"{part} option {o['id']} has tag {o['tag']} but no feedback.byTag entry")
    for t in s["targets"]:
        if t not in miscs:
            err(f"unknown target {t}")

    # steps match code
    if len(s["steps"]) != len(s["code"]):
        err(f"{len(s['code'])} code lines but {len(s['steps'])} steps")
    for i, st in enumerate(s["steps"], start=1):
        if st["line"] != i:
            err(f"step {i} has line {st['line']}")
        for name, oid in st["bindings"].items():
            if oid not in st["objects"]:
                err(f"step {i}: name {name} points to missing object {oid}")

    # run the real code
    ns = {}
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        exec("\n".join(s["code"]), ns)
    out = buf.getvalue().strip()

    correct_a = next(o for o in s["predictA"]["options"] if o["correct"])
    if correct_a["text"].strip() != out:
        err(f"correct predictA is {correct_a['text']!r} but real output is {out!r}")
    if s["steps"][-1].get("output") != out:
        err(f"last step output is {s['steps'][-1].get('output')!r} but real output is {out!r}")

    real_groups = partition_of(ns, s["names"])
    correct_b = next(o for o in s["predictB"]["options"] if o["correct"])
    if sorted(sorted(g) for g in correct_b["groups"]) != real_groups:
        err(f"correct predictB groups {correct_b['groups']} but real groups {real_groups}")

    final = s["steps"][-1]
    step_groups = {}
    for name in s["names"]:
        step_groups.setdefault(final["bindings"][name], []).append(name)
    if sorted(sorted(g) for g in step_groups.values()) != real_groups:
        err("last step bindings do not match real object sharing")
    for name in s["names"]:
        shown = final["objects"][final["bindings"][name]]["items"]
        if shown != ns[name]:
            err(f"last step shows {shown} for {name} but real value is {ns[name]}")


def main(path):
    data = json.load(open(path, encoding="utf-8"))
    errors = []
    ids = [s["id"] for s in data["snippets"]]
    if len(ids) != len(set(ids)):
        errors.append("duplicate snippet ids")
    for s in data["snippets"]:
        check_snippet(s, data["misconceptions"], errors)
    if errors:
        print("PROBLEMS:")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print(f"OK: {len(data['snippets'])} snippets passed.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data/snippets.json")
