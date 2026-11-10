#!/usr/bin/env python3
"""Check data/snippets.json against the schema rules and against real Python.

Usage: python3 tools/check_snippets.py data/snippets.json

WARNING: this runs the snippet code with exec(). Only run it on snippets you wrote.

Diagram objects are either
  {"type": "list"|"tuple", "items": [1, "a", {"ref": "o2"}]}   (a ref points at another object)
  {"type": "int"|"str", "value": 5}

Two ways steps map onto code:
  * Straight-line snippets: one step per code line, the state after that line runs.
  * Snippets that define functions (a code line starting with "def "): the checker traces the
    program. There is one step per executed line, except that a line containing a call gets two:
    one when the call begins (the call's names appear in `frames`) and one when it returns.
    The `def` line itself is a step. The first step for a call line shows the call's names;
    the call line's second step shows the state after the call has returned.
"""
import contextlib
import io
import json
import re
import sys


def is_ref(item):
    return isinstance(item, dict) and "ref" in item


def partition_of(ns, names):
    """Group names by the identity of the object they point to."""
    by_id = {}
    for n in names:
        by_id.setdefault(id(ns[n]), []).append(n)
    return sorted(sorted(g) for g in by_id.values())


def same_value(drawn, real):
    """Equal and of the same type (so 1 is not accepted for True)."""
    return type(drawn) is type(real) and drawn == real


def map_diagram_to_python(step, glob, frames, k, err):
    """Map each diagram object id to the real Python object it stands for.

    Start from the names (global names and the names inside running calls), then follow ref
    cells. Reports any object id that would stand for two different Python objects.
    """
    real = {}
    queue = []

    def bind(oid, obj, where):
        if oid not in step["objects"]:
            err(f"step {k}: {where} points to missing diagram object {oid}")
            return
        if oid in real:
            if real[oid] is not obj:
                err(f"step {k}: {where}: diagram object {oid} stands for two different Python objects")
        else:
            real[oid] = obj
            queue.append(oid)

    for name, oid in step["bindings"].items():
        if name in glob:
            bind(oid, glob[name], f"name {name}")
    for drawn, (fname, locs) in zip(step.get("frames", []), frames):
        for name, oid in drawn["bindings"].items():
            if name in locs:
                bind(oid, locs[name], f"name {name} in {fname}()")

    while queue:
        oid = queue.pop()
        obj = step["objects"][oid]
        py = real[oid]
        for idx, item in enumerate(obj.get("items", [])):
            if is_ref(item) and isinstance(py, (list, tuple)) and idx < len(py):
                bind(item["ref"], py[idx], f"cell {idx} of {oid}")
    return real


def check_step_state(step, glob, frames, names, k, err):
    """Compare one diagram step with the real state.

    glob: the global names that exist, mapped to their objects.
    frames: [(function name, {local name: object})] for the calls that are running.
    """
    defined = [n for n in names if n in glob]
    shown = [n for n in names if n in step["bindings"]]
    if sorted(defined) != sorted(shown):
        err(f"step {k}: diagram shows names {sorted(shown)} but Python has {sorted(defined)}")
        return
    stray = sorted(set(step["bindings"]) - set(names))
    if stray:
        err(f"step {k}: diagram binds names {stray} that are not in the snippet's names")
        return

    drawn_frames = step.get("frames", [])
    if [f["name"] for f in drawn_frames] != [f for f, _ in frames]:
        err(f"step {k}: diagram shows calls {[f['name'] for f in drawn_frames]} but Python is in {[f for f, _ in frames]}")
        return
    for drawn, (fname, locs) in zip(drawn_frames, frames):
        if sorted(drawn["bindings"]) != sorted(locs):
            err(f"step {k}: {fname}() diagram shows names {sorted(drawn['bindings'])} but Python has {sorted(locs)}")
            return

    real = map_diagram_to_python(step, glob, frames, k, err)

    # Exactly the reachable objects are drawn.
    if set(step["objects"]) != set(real):
        extra = sorted(set(step["objects"]) - set(real))
        missing = sorted(set(real) - set(step["objects"]))
        err(f"step {k}: drawn objects are not exactly those reachable from the names (extra {extra}, missing {missing})")

    # Two different diagram objects must be two different Python objects.
    seen = {}
    for oid, py in real.items():
        if id(py) in seen:
            err(f"step {k}: diagram draws {seen[id(py)]} and {oid} as different objects, but Python has one object")
        seen[id(py)] = oid

    # Type and contents of every object.
    for oid, py in real.items():
        obj = step["objects"].get(oid)
        if obj is None:
            continue
        if obj["type"] != type(py).__name__:
            err(f"step {k}: {oid} is drawn as {obj['type']} but is {type(py).__name__}")
            continue
        if "items" in obj:
            if not isinstance(py, (list, tuple)) or len(obj["items"]) != len(py):
                err(f"step {k}: {oid} drawn with {len(obj['items'])} items but Python has {py!r}")
                continue
            for idx, item in enumerate(obj["items"]):
                if is_ref(item):
                    continue  # identity checked through map_diagram_to_python
                if not same_value(item, py[idx]):
                    err(f"step {k}: {oid} cell {idx} drawn as {item!r} but Python has {py[idx]!r}")
        elif "value" in obj:
            if not same_value(obj["value"], py):
                err(f"step {k}: {oid} drawn with value {obj['value']!r} but Python has {py!r}")
        else:
            err(f"step {k}: {oid} has neither items nor value")


def check_every_step(s, err):
    """Straight-line snippets: run one line at a time and compare every step with real Python."""
    ns = {}
    for k, (line, st) in enumerate(zip(s["code"], s["steps"]), start=1):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            exec(compile(line, f"<{s['id']} line {k}>", "exec"), ns)
        printed = buf.getvalue().strip()

        glob = {n: ns[n] for n in s["names"] if n in ns}
        check_step_state(st, glob, [], s["names"], k, err)

        if st.get("output") != (printed if printed else None):
            err(f"step {k}: output is {st.get('output')!r} but Python printed {printed!r}")


def check_traced_steps(s, err):
    """Snippets with functions: trace the program and compare every step with real Python.

    Returns {step number: {name: object}} so predictions about a moment inside a call can be checked.
    """
    names = s["names"]
    steps = s["steps"]
    filename = f"<{s['id']}>"
    compiled = compile("\n".join(s["code"]), filename, "exec")
    ns = {}
    buf = io.StringIO()
    snapshots = {}
    st = {"i": 0, "pos": 0, "pending_module": None, "pending_body": None,
          "after_call": None, "module_line": None, "depth": 0}

    def check(line, frame_info):
        k = st["i"] + 1
        if st["i"] >= len(steps):
            err(f"the trace has more steps than the {len(steps)} in the data (extra step at line {line})")
            st["i"] += 1
            return
        step = steps[st["i"]]
        st["i"] += 1
        if step["line"] != line:
            err(f"step {k}: data highlights line {step['line']} but Python is at line {line}")
        glob = {n: ns[n] for n in names if n in ns}
        frames = [frame_info] if frame_info else []
        check_step_state(step, glob, frames, names, k, err)
        text = buf.getvalue()
        out = text[st["pos"]:].strip()
        st["pos"] = len(text)
        if step.get("output") != (out if out else None):
            err(f"step {k}: output is {step.get('output')!r} but Python printed {out!r}")
        snap = dict(glob)
        if frame_info:
            snap.update(frame_info[1])
        snapshots[k] = snap

    def frame_info(frame):
        return (frame.f_code.co_name, dict(frame.f_locals))

    def resolve_module():
        if st["after_call"] is not None:
            line, st["after_call"] = st["after_call"], None
            check(line, None)
        elif st["pending_module"] is not None:
            line, st["pending_module"] = st["pending_module"], None
            check(line, None)

    def tracer(frame, event, arg):
        if frame.f_code.co_filename != filename:
            return None
        is_module = frame.f_code.co_name == "<module>"
        if event == "call":
            if is_module:
                return tracer
            st["depth"] += 1
            if st["depth"] > 1:
                err("nested function calls are not supported by the checker")
            line = st["module_line"]
            st["pending_module"] = None
            check(line, frame_info(frame))
            st["after_call"] = line
            return tracer
        if event == "line":
            if is_module:
                resolve_module()
                st["pending_module"] = st["module_line"] = frame.f_lineno
            else:
                if st["pending_body"] is not None:
                    check(st["pending_body"], frame_info(frame))
                st["pending_body"] = frame.f_lineno
        elif event == "return":
            if is_module:
                resolve_module()
            else:
                if st["pending_body"] is not None:
                    check(st["pending_body"], frame_info(frame))
                    st["pending_body"] = None
                st["depth"] -= 1
        return tracer

    previous = sys.gettrace()
    try:
        with contextlib.redirect_stdout(buf):
            sys.settrace(tracer)
            try:
                exec(compiled, ns)
            finally:
                sys.settrace(previous)
    except Exception as e:  # a bug in the snippet or the checker
        err(f"tracing failed: {type(e).__name__}: {e}")
        return snapshots
    if st["i"] != len(steps):
        err(f"data has {len(steps)} steps but the trace of the code has {st['i']}")
    return snapshots


def check_snippet(s, miscs, errors):
    sid = s.get("id", "?")

    def err(msg):
        errors.append(f"{sid}: {msg}")

    traced = any(line.startswith("def ") for line in s["code"])
    pb = s["predictB"]
    b_names = pb.get("names", s["names"])
    at_step = pb.get("atStep")

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

    # every grouping option must be a partition of the names the question is about
    for o in pb["options"]:
        flat = [n for g in o["groups"] for n in g]
        if sorted(flat) != sorted(b_names):
            err(f"predictB option {o['id']} groups {o['groups']} are not a partition of {b_names}")

    # steps match code
    if not traced:
        if len(s["steps"]) != len(s["code"]):
            err(f"{len(s['code'])} code lines but {len(s['steps'])} steps")
        for i, st in enumerate(s["steps"], start=1):
            if st["line"] != i:
                err(f"step {i} has line {st['line']}")
    for i, st in enumerate(s["steps"], start=1):
        if not 1 <= st["line"] <= len(s["code"]):
            err(f"step {i} has line {st['line']}, outside the {len(s['code'])} code lines")
        for name, oid in st["bindings"].items():
            if oid not in st["objects"]:
                err(f"step {i}: name {name} points to missing object {oid}")
        for fr in st.get("frames", []):
            for name, oid in fr["bindings"].items():
                if oid not in st["objects"]:
                    err(f"step {i}: name {name} in {fr['name']}() points to missing object {oid}")
        for oid, obj in st["objects"].items():
            for item in obj.get("items", []):
                if is_ref(item) and item["ref"] not in st["objects"]:
                    err(f"step {i}: {oid} has a cell pointing at missing object {item['ref']}")

    # Python may share equal small ints and short strings, so `is` on them is unreliable.
    has_immutable_value = any(
        o.get("type") in ("int", "str") for st in s["steps"] for o in st["objects"].values()
    )
    if has_immutable_value and any(re.search(r"\bis\b", line) for line in s["code"]):
        err("snippet uses `is` with ints or strings; use lists for identity checks")

    # every intermediate step against real Python
    snapshots = {}
    if traced:
        snapshots = check_traced_steps(s, err)
    elif len(s["steps"]) == len(s["code"]):
        check_every_step(s, err)

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

    # which names refer to the same object: at the end, or at a chosen step (inside a call)
    if at_step is not None:
        snap = snapshots.get(at_step)
        if snap is None:
            err(f"predictB.atStep {at_step} is not a step the checker reached")
            real_groups = None
        elif any(n not in snap for n in b_names):
            err(f"predictB names {b_names} are not all visible at step {at_step}")
            real_groups = None
        else:
            real_groups = partition_of(snap, b_names)
    else:
        real_groups = partition_of(ns, b_names)
    correct_b = next(o for o in pb["options"] if o["correct"])
    if real_groups is not None and sorted(sorted(g) for g in correct_b["groups"]) != real_groups:
        err(f"correct predictB groups {correct_b['groups']} but real groups {real_groups}")

    final = s["steps"][-1]
    step_groups = {}
    for name in s["names"]:
        step_groups.setdefault(final["bindings"][name], []).append(name)
    if sorted(sorted(g) for g in step_groups.values()) != partition_of(ns, s["names"]):
        err("last step bindings do not match real object sharing")


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
    n_steps = sum(len(s["steps"]) for s in data["snippets"])
    print(f"OK: {len(data['snippets'])} snippets passed; {n_steps} diagram steps checked against real Python.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data/snippets.json")
