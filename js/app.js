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
  tests: null, // data/tests.json, or null when absent or turned off with ?tests=off
  test: null, // the test in progress: { form, items, k, answers }
  scores: {}, // { pre, post } score summaries, kept in memory for the comparison only
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
  const unitName = (state.data.units || {})[snippet().unit];
  const unitLabel = unitName ? `Unit ${snippet().unit}: ${unitName} \u00b7 ` : "";
  return el(
    "p",
    { class: "progress" },
    `${unitLabel}Snippet ${state.i + 1} of ${total()}`,
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

function countText() {
  const units = new Set(state.data.snippets.map((s) => s.unit)).size;
  const minutes = Math.max(5, Math.round((total() * 10) / 6 / 5) * 5);
  const where = units === 1 ? "in this unit" : `across ${units} units`;
  return `There are ${total()} short snippets ${where}. Plan for about ${minutes} minutes.`;
}

function showStart() {
  state.i = 0;
  state.results = [];
  state.scores = {};
  state.test = null;
  setView(
    el("h2", { text: "Before you start" }),
    el(
      "div",
      { class: "panel" },
      el("p", {
        text: "This module is about how Python behaves when names refer to objects: what happens when two names share one object, and what changes (and what does not) when an object can or cannot be changed.",
      }),
      el("p", {
        text: "You should already be comfortable with variables, assignment, lists, and calling functions. You do not need anything beyond that.",
      }),
      el("h3", { text: "How each snippet works" }),
      el(
        "ol",
        {},
        el("li", { text: "Read a short piece of Python code." }),
        el("li", { text: "Predict what it prints and which names share an object. Commit to your answer before you see the result." }),
        el("li", { text: "Step through the code and view a diagram of how Python actually handles the objects." }),
        el("li", { text: "Compare your prediction with what happened, then explain the result in your own words." })
      ),
      el("p", {
        text: state.tests
          ? "Wrong predictions are expected and are the point. They show where your mental model differs from Python's. The snippets are not graded. The short pre-test and post-test show you a score at the end of each. Nothing is saved: your answers, explanations and scores stay in your browser and disappear when you close or reload the page."
          : "Wrong predictions are expected and are the point. They show where your mental model differs from Python's. Your answers are not graded, and your explanations stay in your browser and are not saved.",
      }),
      el("p", { text: countText() }),
      state.tests
        ? el("p", { text: `The order is: a short pre-test (${state.tests.forms.pre.items.length} questions), the snippets, then a post-test (${state.tests.forms.post.items.length} questions).` })
        : null
    ),
    el("button", { onclick: state.tests ? () => showTestIntro("pre") : startSnippet, text: state.tests ? "Start the pre-test" : "Start" })
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
    renderDiagram(diagramBox, step, sn.names, { scopes: sn.scopes === true });
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
  renderDiagram(box, sn.steps[sn.steps.length - 1], sn.names, { scopes: sn.scopes === true });
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
    text: isLast ? "Finish" : "Next snippet",
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


// ---------- pre-test and post-test ----------
// One question at a time, no feedback, answers locked on Continue. Scores are computed in memory
// and shown on the results screen. Matched items (A1-A8) make the total and the per-unit counts;
// extra items are reported separately and never mixed into the matched total.

function showTestIntro(form) {
  const f = state.tests.forms[form];
  const start = () => {
    state.test = {
      form,
      items: shuffle(f.items).map((it) => ({ ...it, options: shuffle(it.options) })),
      k: 0,
      answers: [],
    };
    renderTestItem();
  };
  setView(
    el("h2", { text: f.label }),
    el("div", { class: "panel" }, ...f.intro.map((t) => el("p", { text: t })), el("p", { text: `There are ${f.items.length} questions.` })),
    el("button", { text: `Start the ${f.label.toLowerCase()}`, onclick: start })
  );
}

function renderTestItem() {
  const t = state.test;
  const it = t.items[t.k];
  let picked = null;
  const next = el("button", { text: t.k === t.items.length - 1 ? "Finish test" : "Continue", disabled: true });
  next.addEventListener("click", () => {
    t.answers.push({ item: it, option: it.options.find((o) => o.id === picked) });
    if (t.k === t.items.length - 1) showTestResults();
    else {
      t.k++;
      renderTestItem();
    }
  });
  setView(
    el("p", { class: "progress" }, `${state.tests.forms[t.form].label} · Question ${t.k + 1} of ${t.items.length}`, el("progress", { max: t.items.length, value: t.k + 1, "aria-label": "Progress through the test" })),
    el("h2", { text: `Question ${t.k + 1}` }),
    codeNode(it),
    radioGroup("test", it.prompt, it.options, null, (id) => { picked = id; next.disabled = false; }, true),
    el("p", { class: "hint", text: "Once you continue, your answer is locked. You will see your score at the end." }),
    next
  );
}

// Score summary for one finished test: matched total, matched count per unit, extras listed apart.
function summarize(t) {
  const matched = t.answers.filter((a) => a.item.scored === "matched");
  const byUnit = {};
  for (const a of matched) {
    const u = (byUnit[a.item.unit] = byUnit[a.item.unit] || { right: 0, count: 0 });
    u.count++;
    if (a.option.correct) u.right++;
  }
  return {
    right: matched.filter((a) => a.option.correct).length,
    count: matched.length,
    byUnit,
    extras: t.answers.filter((a) => a.item.scored === "extra").map((a) => ({ label: a.item.label || a.item.id, ok: a.option.correct })),
  };
}

function showTestResults() {
  const t = state.test;
  const form = t.form;
  const f = state.tests.forms[form];
  const sum = summarize(t);
  state.scores[form] = sum;
  const unitNames = state.data.units || {};
  const units = Object.keys(sum.byUnit).sort();

  const unitRows = units.map((u) =>
    el("tr", {}, el("th", { scope: "row", text: `Unit ${u}: ${unitNames[u] || ""}` }), el("td", { text: `${sum.byUnit[u].right} of ${sum.byUnit[u].count}` }))
  );
  const scoreTable = el(
    "table",
    { class: "compare" },
    el("thead", {}, el("tr", {}, el("th", { text: "Category" }), el("th", { text: "Score" }))),
    el("tbody", {}, ...unitRows, el("tr", {}, el("th", { scope: "row", text: "Total" }), el("td", {}, el("strong", { text: `${sum.right} of ${sum.count}` }))))
  );

  const extras = sum.extras.length
    ? [
        el("h3", { text: "Extra questions (scored separately)" }),
        el("p", { class: "hint", text: "These go a little beyond the lessons, so they are not part of the total above." }),
        el("ul", { class: "results" }, ...sum.extras.map((x) => el("li", {}, `${x.label}: `, mark(x.ok)))),
      ]
    : [];

  let comparison = [];
  if (form === "post" && state.scores.pre) {
    const pre = state.scores.pre;
    const rows = units.map((u) =>
      el(
        "tr",
        {},
        el("th", { scope: "row", text: `Unit ${u}: ${unitNames[u] || ""}` }),
        el("td", { text: pre.byUnit[u] ? `${pre.byUnit[u].right} of ${pre.byUnit[u].count}` : "–" }),
        el("td", { text: `${sum.byUnit[u].right} of ${sum.byUnit[u].count}` })
      )
    );
    comparison = [
      el("h3", { text: "Pre-test and post-test on the same ideas" }),
      el(
        "table",
        { class: "compare" },
        el("thead", {}, el("tr", {}, el("th", { text: "Category" }), el("th", { text: "Pre-test" }), el("th", { text: "Post-test" }))),
        el("tbody", {}, ...rows, el("tr", {}, el("th", { scope: "row", text: "Total" }), el("td", { text: `${pre.right} of ${pre.count}` }), el("td", {}, el("strong", { text: `${sum.right} of ${sum.count}` }))))
      ),
      el("p", { class: "hint", text: "The two tests use different code for each idea, so this compares understanding, not memory of the questions." }),
    ];
  }

  const action =
    form === "pre"
      ? el("button", { text: "Begin the snippets", onclick: startSnippet })
      : el("button", { text: "Start over", onclick: showStart });

  setView(
    el("h2", { text: `${f.label} results` }),
    el("p", { text: "This score is not saved. It disappears when you close or reload the page." }),
    scoreTable,
    ...extras,
    ...comparison,
    action
  );
}

// A mark that does not rely on colour alone: symbol + word.
function mark(ok) {
  return el("span", { class: ok ? "ok" : "no", text: ok ? "✓ Correct" : "✗ Incorrect" });
}

function showDone() {
  const unitNames = state.data.units || {};

  // Group results by unit, keeping the order the snippets were played in.
  const groups = [];
  state.results.forEach((r, k) => {
    const sn = state.data.snippets.find((s) => s.id === r.id);
    let g = groups.find((x) => x.unit === sn.unit);
    if (!g) {
      g = { unit: sn.unit, rows: [] };
      groups.push(g);
    }
    g.rows.push({ k, r, sn });
  });

  const sections = groups.map((g) => {
    const desc = unitNames[g.unit];
    const items = g.rows.map(({ k, r, sn }) =>
      el(
        "li",
        {},
        el("strong", { text: `Snippet ${k + 1}: ${sn.title}` }),
        el(
          "ul",
          { class: "results" },
          el("li", {}, "Output prediction: ", mark(r.aOk)),
          el("li", {}, "Object sharing prediction: ", mark(r.bOk))
        )
      )
    );
    return el(
      "section",
      { class: "unit-summary" },
      el("h3", { text: desc ? `Unit ${g.unit}: ${desc}` : `Unit ${g.unit}` }),
      el("ul", { class: "summary" }, ...items)
    );
  });

  setView(
    el("h2", { text: groups.length > 1 ? "All units complete" : "Unit complete" }),
    el("p", { text: "Here is how your predictions compare with how Python actually behaves. This summary is not saved." }),
    ...sections,
    state.tests
      ? el("button", { text: "Take the post-test", onclick: () => showTestIntro("post") })
      : el("button", { text: "Start over", onclick: showStart })
  );
}

// ---------- boot ----------

async function boot() {
  try {
    const res = await fetch("./data/snippets.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
    // Tests are optional: ?tests=off, or a missing data/tests.json, gives the lessons alone.
    if (new URLSearchParams(location.search).get("tests") !== "off") {
      try {
        const tr = await fetch("./data/tests.json");
        if (tr.ok) state.tests = await tr.json();
      } catch (_) {
        state.tests = null;
      }
    }
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
