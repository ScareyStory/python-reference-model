// Predict-observe-explain runner for the Python reference-model module.
// Flow per snippet: predict -> commit -> observe (step through diagram) -> compare + explain -> feedback.
// All state lives in memory only. Nothing is stored or sent anywhere.

import { renderDiagram, describeStep } from "./diagram.js";

const app = document.getElementById("app");

const state = {
  data: null,
  i: 0, // current snippet index
  a: null, // chosen predictA option id
  b: null, // chosen predictB option id
  order: null, // shuffled option lists for this snippet
  stepIndex: 0,
  maxStep: 0,
  explanation: "",
  results: [], // per-snippet { id, aOk, bOk } for the end summary only
};

// ---------- small helpers ----------

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else if (v !== false && v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function setView(...nodes) {
  app.textContent = "";
  app.append(...nodes.filter((n) => n !== null && n !== undefined && n !== false));
  const h = app.querySelector("h2");
  if (h) {
    h.setAttribute("tabindex", "-1");
    h.focus();
  }
  window.scrollTo(0, 0);
}

const snippet = () => state.data.snippets[state.i];
const total = () => state.data.snippets.length;

function progressNode() {
  return el(
    "p",
    { class: "progress" },
    `Snippet ${state.i + 1} of ${total()}`,
    el("progress", { max: total(), value: state.i + 1, "aria-label": "Progress through the unit" })
  );
}

function codeNode(sn, activeLine = null) {
  const ol = el("ol", { class: "code", "aria-label": "Python code" });
  sn.code.forEach((line, k) => {
    const li = el("li", { class: activeLine === k + 1 ? "active" : "" }, el("code", { text: line }));
    if (activeLine === k + 1) li.setAttribute("aria-current", "step");
    ol.append(li);
  });
  return ol;
}

function updateCode(ol, line) {
  [...ol.children].forEach((li, k) => {
    const on = line === k + 1;
    li.className = on ? "active" : "";
    if (on) li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
  });
}

function optionById(list, id) {
  return list.find((o) => o.id === id);
}

// ---------- screens ----------

function showStart() {
  state.i = 0;
  state.results = [];
  setView(
    el("h2", { text: "Before you start" }),
    el(
      "div",
      { class: "panel" },
      // TODO: replace with the orientation text (what this teaches, what you should already know).
      el("p", {
        text: "This module is for people who know basic Python. In each snippet you will predict what happens, watch a diagram of what Python actually does, and explain the result in your own words.",
      }),
      el("p", { text: `There are ${total()} short snippets in this unit.` })
    ),
    el("button", { onclick: startSnippet, text: "Start" })
  );
}

function startSnippet() {
  const sn = snippet();
  state.a = null;
  state.b = null;
  state.stepIndex = 0;
  state.maxStep = 0;
  state.explanation = "";
  state.order = { a: shuffle(sn.predictA.options), b: shuffle(sn.predictB.options) };
  renderPredict();
}

function radioGroup(name, legendText, options, selectedId, onPick, mono) {
  const fs = el("fieldset", {}, el("legend", { text: legendText }));
  options.forEach((o) => {
    const id = `${name}-${o.id}`;
    const input = el("input", { type: "radio", name, id, value: o.id });
    if (selectedId === o.id) input.checked = true;
    input.addEventListener("change", () => onPick(o.id));
    fs.append(
      el(
        "div",
        { class: "option" },
        input,
        el("label", { for: id }, mono ? el("code", { text: o.text }) : o.text)
      )
    );
  });
  return fs;
}

function renderPredict() {
  const sn = snippet();
  const commit = el("button", { text: "Commit my predictions", disabled: true });
  const refresh = () => (commit.disabled = !(state.a && state.b));
  commit.addEventListener("click", renderObserve);
  refresh();

  setView(
    progressNode(),
    el("h2", { text: "Predict" }),
    sn.preface ? el("p", { class: "preface", text: sn.preface }) : null,
    codeNode(sn),
    radioGroup("predA", `1. ${sn.predictA.prompt}`, state.order.a, state.a, (id) => { state.a = id; refresh(); }, true),
    radioGroup("predB", `2. ${sn.predictB.prompt}`, state.order.b, state.b, (id) => { state.b = id; refresh(); }, false),
    el("p", { class: "hint", text: "Once you commit, your answers are locked." }),
    commit
  );
}

function renderObserve() {
  const sn = snippet();
  const last = sn.steps.length - 1;

  const codeEl = codeNode(sn, sn.steps[0].line);
  const diagramBox = el("div", { class: "diagram" });
  const caption = el("p", { class: "caption", "aria-live": "polite" });
  const textequiv = el("p", { class: "textequiv" });
  const output = el("p", { class: "output" });

  const prev = el("button", { class: "secondary", text: "Previous step" });
  const next = el("button", { class: "secondary", text: "Next step" });
  const cont = el("button", { text: "Continue" });

  function update() {
    const step = sn.steps[state.stepIndex];
    state.maxStep = Math.max(state.maxStep, state.stepIndex);
    updateCode(codeEl, step.line);
    renderDiagram(diagramBox, step, sn.names);
    caption.textContent = `Step ${state.stepIndex + 1} of ${sn.steps.length}: ${step.caption}`;
    textequiv.textContent = "In words: " + describeStep(step, sn.names);
    output.textContent = "";
    if (step.output !== undefined) output.append(el("strong", { text: "Output: " }), el("code", { text: step.output }));
    prev.disabled = state.stepIndex === 0;
    next.disabled = state.stepIndex === last;
    cont.disabled = state.maxStep < last;
  }

  prev.addEventListener("click", () => { state.stepIndex--; update(); });
  next.addEventListener("click", () => { state.stepIndex++; update(); });
  cont.addEventListener("click", renderExplain);

  setView(
    progressNode(),
    el("h2", { text: "Observe what Python does" }),
    el("div", { class: "observe" }, el("div", {}, codeEl), el("div", {}, diagramBox)),
    caption,
    textequiv,
    output,
    el("div", {}, prev, next, cont),
    el("p", { class: "hint", text: "Step through to the end to continue." })
  );
  state.stepIndex = 0;
  update();
}

function evaluate() {
  const sn = snippet();
  const aOpt = optionById(sn.predictA.options, state.a);
  const bOpt = optionById(sn.predictB.options, state.b);
  return {
    sn,
    aOpt,
    bOpt,
    aCorrect: sn.predictA.options.find((o) => o.correct),
    bCorrect: sn.predictB.options.find((o) => o.correct),
    aOk: aOpt.correct,
    bOk: bOpt.correct,
  };
}

function staticFinalDiagram(sn) {
  const box = el("div", { class: "diagram" });
  renderDiagram(box, sn.steps[sn.steps.length - 1], sn.names);
  return box;
}

function compareTable(ev) {
  const status = (ok) => el("span", { class: ok ? "ok" : "no", text: ok ? "✓ Matches" : "✗ Different" });
  const row = (label, mine, right, ok, mono) =>
    el(
      "tr",
      {},
      el("th", { scope: "row", text: label }),
      el("td", {}, mono ? el("code", { text: mine }) : mine),
      el("td", {}, mono ? el("code", { text: right }) : right),
      el("td", {}, status(ok))
    );
  return el(
    "table",
    { class: "compare" },
    el("thead", {}, el("tr", {}, el("th", { text: "Question" }), el("th", { text: "Your prediction" }), el("th", { text: "What happened" }), el("th", { text: "Result" }))),
    el(
      "tbody",
      {},
      row("1. Output", ev.aOpt.text, ev.aCorrect.text, ev.aOk, true),
      row("2. Same object?", ev.bOpt.text, ev.bCorrect.text, ev.bOk, false)
    )
  );
}

function renderExplain() {
  const ev = evaluate();
  const prompts = state.data.prompts;
  const mismatch = !(ev.aOk && ev.bOk);
  const promptText = mismatch ? prompts.explainMismatch : prompts.explainMatch;

  const ta = el("textarea", { id: "explain", rows: 4 });
  const submit = el("button", { text: "Submit explanation", disabled: true });
  ta.addEventListener("input", () => (submit.disabled = ta.value.trim().length < 5));
  submit.addEventListener("click", () => {
    state.explanation = ta.value.trim(); // kept in memory for display only; never stored or scored
    renderFeedback(ev);
  });

  setView(
    progressNode(),
    el("h2", { text: "Compare, then explain" }),
    compareTable(ev),
    staticFinalDiagram(ev.sn),
    el("label", { for: "explain", class: "caption", text: promptText }),
    ta,
    el("p", { class: "hint", text: "Write a sentence or two. Your explanation is not saved or scored." }),
    submit
  );
}

function feedbackBlock(tag, fb) {
  return el(
    "div",
    { class: "fb" },
    el("p", {}, el("strong", { text: "What you may have thought:" }), " ", fb.thought),
    el("p", {}, el("strong", { text: "Why it is natural:" }), " ", fb.why),
    el("p", {}, el("strong", { text: "What Python does:" }), " ", fb.model)
  );
}

function renderFeedback(ev) {
  const sn = ev.sn;
  state.results.push({ id: sn.id, aOk: ev.aOk, bOk: ev.bOk });

  const blocks = [];
  if (ev.aOk && ev.bOk) {
    blocks.push(el("div", { class: "fb good" }, el("p", { text: sn.feedback.correct })));
  } else {
    const seen = new Set();
    let needFiller = false;
    for (const o of [ev.aOk ? null : ev.aOpt, ev.bOk ? null : ev.bOpt]) {
      if (!o) continue;
      if (o.tag && sn.feedback.byTag[o.tag]) {
        if (!seen.has(o.tag)) {
          seen.add(o.tag);
          blocks.push(feedbackBlock(o.tag, sn.feedback.byTag[o.tag]));
        }
      } else {
        needFiller = true;
      }
    }
    if (needFiller) blocks.push(el("div", { class: "fb" }, el("p", { text: state.data.prompts.fillerFeedback })));
  }

  const isLast = state.i === total() - 1;
  const nextBtn = el("button", {
    text: isLast ? "Finish unit" : "Next snippet",
    onclick: () => {
      if (isLast) showDone();
      else {
        state.i++;
        startSnippet();
      }
    },
  });

  setView(
    progressNode(),
    el("h2", { text: "Feedback" }),
    ...blocks,
    el("h3", { text: "Your explanation" }),
    el("p", { class: "your-explanation", text: state.explanation }),
    nextBtn
  );
}

function showDone() {
  const items = state.results.map((r, k) =>
    el("li", { text: `Snippet ${k + 1}: output ${r.aOk ? "matched" : "differed"}, object sharing ${r.bOk ? "matched" : "differed"}` })
  );
  setView(
    el("h2", { text: "Unit 1 complete" }),
    el("p", { text: "Here is how your predictions compared with what Python does. This summary is not saved." }),
    el("ul", { class: "summary" }, ...items),
    el("button", { text: "Start over", onclick: showStart })
  );
}

// ---------- boot ----------

async function boot() {
  try {
    const res = await fetch("./data/snippets.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
    showStart();
  } catch (err) {
    setView(
      el("h2", { text: "Could not load the module" }),
      el("p", { class: "error", text: String(err.message || err) }),
      el("p", {
        text: "If you opened this page directly from a file, start a local server instead (for example: python3 -m http.server 8000) and open http://localhost:8000.",
      })
    );
  }
}

boot();
