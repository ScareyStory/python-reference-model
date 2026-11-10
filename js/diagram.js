// Draws one step of a snippet as an SVG memory diagram.
// Input: the `step` object from data/snippets.json plus the snippet's `names` order.
// Names on the left, objects on the right, arrows from each name to its object.
// Nothing here knows about Python; it only draws what the data says.
//
// Object kinds (see data/snippets.json):
//   { type: "list" | "tuple", items: [ 1, "a", { ref: "o2" } ] }   a row of cells; a ref cell is a dot
//                                                                  with an arrow to another object
//   { type: "int" | "str" | ..., value: 5 }                        a single box holding the value

const NS = "http://www.w3.org/2000/svg";

const L = {
  top: 30,
  nameX: 16,
  nameW: 84,
  nameH: 34,
  namePitch: 56,
  objX: 250,
  labelH: 18,
  cellW: 46,
  cellH: 34,
  objPitch: 84,
  width: 520,
  charW: 10, // approximate width of one character in a value box
  valuePad: 14,
};

function s(tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function idLabel(id) {
  return "#" + String(id).replace(/^o/, "");
}

const isRef = (item) => item !== null && typeof item === "object" && "ref" in item;
const isRow = (obj) => Array.isArray(obj.items);

function valueText(v) {
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}

function itemText(item, step) {
  if (isRef(item)) {
    const t = step.objects[item.ref];
    return t ? `${t.type} ${idLabel(item.ref)}` : "object";
  }
  return valueText(item);
}

function contentsText(obj, step) {
  if (isRow(obj)) {
    const inner = obj.items.map((i) => itemText(i, step)).join(", ");
    return obj.type === "tuple" ? `(${inner})` : `[${inner}]`;
  }
  if ("value" in obj) return `with value ${valueText(obj.value)}`;
  return "";
}

// Plain-text version of a step, used for the visible text equivalent and aria-label.
export function describeStep(step, nameOrder) {
  const parts = [];
  const sentence = (prefix, name, oid) => {
    const obj = step.objects[oid];
    const tail = obj ? contentsText(obj, step) : "";
    parts.push(`${prefix}${name} points to ${obj ? obj.type : "object"} ${idLabel(oid)} ${tail}`.trim());
  };
  for (const name of nameOrder) {
    const oid = step.bindings[name];
    if (oid !== undefined) sentence("", name, oid);
  }
  // Names that exist only while a function call is running
  for (const fr of step.frames || []) {
    for (const [name, oid] of Object.entries(fr.bindings)) sentence(`Inside ${fr.name}(), `, name, oid);
  }
  return parts.length ? parts.join("; ") + "." : "No names are defined yet.";
}

function objectWidth(obj) {
  if (isRow(obj)) return Math.max(1, obj.items.length) * L.cellW;
  if ("value" in obj) return Math.max(L.cellW, valueText(obj.value).length * L.charW + 2 * L.valuePad);
  return L.cellW;
}

// Stack objects top to bottom. An object that another object points at is placed
// directly below the first object that points at it, so the arrow between them
// drops straight down.
function orderObjects(step) {
  const ids = Object.keys(step.objects);
  const refsOf = (id) => {
    const o = step.objects[id];
    return isRow(o) ? o.items.filter(isRef).map((i) => i.ref) : [];
  };
  const referenced = new Set(ids.flatMap(refsOf));
  const placed = [];
  const place = (id) => {
    if (!(id in step.objects) || placed.includes(id)) return;
    placed.push(id);
    refsOf(id).forEach(place);
  };
  ids.filter((id) => !referenced.has(id)).forEach(place);
  ids.forEach(place);
  return placed;
}

// opts.scopes: label the global names and draw each running function call's names in a
// labeled box below them (used by snippets that define functions).
export function renderDiagram(container, step, nameOrder, opts = {}) {
  container.textContent = "";

  const scopes = Boolean(opts.scopes);
  const frames = step.frames || [];
  const objIds = orderObjects(step);
  const changedNames = new Set((step.changed && step.changed.names) || []);
  const changedFrameNames = new Set((step.changed && step.changed.frameNames) || []);
  const changedObjs = new Set((step.changed && step.changed.objects) || []);

  // Every name to draw, top to bottom: the global names, then the names of each running call.
  const nameItems = [];
  const globals = nameOrder.filter((n) => n in step.bindings);
  globals.forEach((n, j) =>
    nameItems.push({ name: n, oid: step.bindings[n], y: L.top + j * L.namePitch, changed: changedNames.has(n) })
  );
  const frameBoxes = [];
  let namesExtent = L.top + globals.length * L.namePitch;
  if (frames.length) {
    let bottom = globals.length ? L.top + (globals.length - 1) * L.namePitch + L.nameH : L.top;
    for (const fr of frames) {
      const boxTop = bottom + 14;
      const entries = Object.entries(fr.bindings);
      const firstY = boxTop + 26;
      entries.forEach(([n, oid], j) =>
        nameItems.push({ name: n, oid, y: firstY + j * L.namePitch, changed: changedFrameNames.has(n) })
      );
      const lastBottom = entries.length ? firstY + (entries.length - 1) * L.namePitch + L.nameH : firstY;
      frameBoxes.push({ label: `${fr.name}()`, top: boxTop, bottom: lastBottom + 10 });
      bottom = lastBottom + 10;
    }
    namesExtent = bottom;
  }

  const height = Math.max(namesExtent, L.top + objIds.length * L.objPitch) + 8;

  const svg = s("svg", {
    viewBox: `0 0 ${L.width} ${height}`,
    role: "img",
    "aria-label": describeStep(step, nameOrder),
    class: "diagram-svg",
  });

  const defs = s("defs");
  const marker = s("marker", {
    id: "arrowhead",
    viewBox: "0 0 10 10",
    refX: "9",
    refY: "5",
    markerWidth: "7",
    markerHeight: "7",
    orient: "auto-start-reverse",
  });
  marker.appendChild(s("path", { d: "M 0 0 L 10 5 L 0 10 z", class: "arrow-head" }));
  defs.appendChild(marker);
  svg.appendChild(defs);

  // Positions
  const objTop = {};
  objIds.forEach((id, i) => (objTop[id] = L.top + i * L.objPitch));

  // Objects
  const refArrows = [];
  for (const id of objIds) {
    const obj = step.objects[id];
    const top = objTop[id];
    const cellTop = top + L.labelH;
    const g = s("g", {
      class: "object" + (obj.type === "tuple" ? " tuple" : "") + (changedObjs.has(id) ? " changed" : ""),
    });
    const label = `${obj.type} ${idLabel(id)}` + (changedObjs.has(id) ? " (changed)" : "");
    g.appendChild(s("text", { x: L.objX, y: top + 12, class: "obj-label" }, label));

    if (isRow(obj)) {
      const rx = obj.type === "tuple" ? 10 : 0;
      if (obj.items.length === 0) {
        g.appendChild(s("rect", { x: L.objX, y: cellTop, width: L.cellW, height: L.cellH, rx, class: "cell" }));
      }
      obj.items.forEach((item, k) => {
        const x = L.objX + k * L.cellW;
        g.appendChild(s("rect", { x, y: cellTop, width: L.cellW, height: L.cellH, rx, class: "cell" }));
        if (isRef(item)) {
          const cx = x + L.cellW / 2;
          const cy = cellTop + L.cellH / 2;
          g.appendChild(s("circle", { cx, cy, r: 4.5, class: "dot" }));
          refArrows.push({ cx, cy, target: item.ref });
        } else {
          g.appendChild(
            s(
              "text",
              { x: x + L.cellW / 2, y: cellTop + L.cellH / 2 + 5, class: "cell-text", "text-anchor": "middle" },
              valueText(item)
            )
          );
        }
      });
    } else {
      const w = objectWidth(obj);
      g.appendChild(s("rect", { x: L.objX, y: cellTop, width: w, height: L.cellH, class: "cell value" }));
      if ("value" in obj) {
        g.appendChild(
          s(
            "text",
            { x: L.objX + w / 2, y: cellTop + L.cellH / 2 + 5, class: "cell-text", "text-anchor": "middle" },
            valueText(obj.value)
          )
        );
      }
    }
    svg.appendChild(g);
  }

  // Arrows from reference cells to the objects they point at
  for (const { cx, cy, target } of refArrows) {
    if (!(target in objTop)) continue;
    const tObj = step.objects[target];
    const tw = objectWidth(tObj);
    const tx = Math.min(Math.max(cx, L.objX + 8), L.objX + tw - 8);
    const below = objTop[target] > cy;
    // Land just above the target's label when it is below, or just under its cells when it is above.
    const ty = below ? objTop[target] - 3 : objTop[target] + L.labelH + L.cellH + 3;
    const dy = below ? 28 : -28;
    svg.appendChild(
      s("path", {
        d: `M ${cx} ${cy} C ${cx} ${cy + dy}, ${tx} ${ty - dy}, ${tx} ${ty}`,
        class: "arrow ref",
        "marker-end": "url(#arrowhead)",
      })
    );
  }

  // Scope labels and the box around a running call's names
  if (scopes) svg.appendChild(s("text", { x: L.nameX, y: L.top - 10, class: "scope-label" }, "global"));
  for (const fb of frameBoxes) {
    svg.appendChild(
      s("rect", {
        x: L.nameX - 8,
        y: fb.top,
        width: L.nameW + 16,
        height: fb.bottom - fb.top,
        rx: 8,
        class: "frame-box",
      })
    );
    svg.appendChild(s("text", { x: L.nameX, y: fb.top + 17, class: "scope-label" }, fb.label));
  }

  // Names and arrows
  for (const item of nameItems) {
    const { name: n, oid, y } = item;
    const g = s("g", { class: "name" + (item.changed ? " changed" : "") });
    g.appendChild(s("rect", { x: L.nameX, y, width: L.nameW, height: L.nameH, rx: 17, class: "name-box" }));
    g.appendChild(
      s("text", { x: L.nameX + L.nameW / 2, y: y + L.nameH / 2 + 5, class: "name-text", "text-anchor": "middle" }, n)
    );
    svg.appendChild(g);

    const x1 = L.nameX + L.nameW;
    const y1 = y + L.nameH / 2;
    const x2 = L.objX - 6;
    const y2 = objTop[oid] + L.labelH + L.cellH / 2;
    svg.appendChild(
      s("path", {
        d: `M ${x1} ${y1} C ${x1 + 70} ${y1}, ${x2 - 70} ${y2}, ${x2} ${y2}`,
        class: "arrow" + (item.changed ? " changed" : ""),
        "marker-end": "url(#arrowhead)",
      })
    );
  }

  container.appendChild(svg);
}
