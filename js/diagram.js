// Draws one step of a snippet as an SVG memory diagram.
// Input: the `step` object from data/snippets.json plus the snippet's `names` order.
// Names on the left, objects on the right, arrows from each name to its object.
// Nothing here knows about Python; it only draws what the data says.

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

function itemText(item) {
  return typeof item === "string" ? JSON.stringify(item) : String(item);
}

// Plain-text version of a step, used for the visible text equivalent and aria-label.
export function describeStep(step, nameOrder) {
  const parts = [];
  for (const name of nameOrder) {
    const oid = step.bindings[name];
    if (oid === undefined) continue;
    const obj = step.objects[oid];
    const contents = obj && Array.isArray(obj.items) ? "[" + obj.items.map(itemText).join(", ") + "]" : "";
    parts.push(`${name} points to ${obj ? obj.type : "object"} ${idLabel(oid)} ${contents}`.trim());
  }
  return parts.length ? parts.join("; ") + "." : "No names are defined yet.";
}

export function renderDiagram(container, step, nameOrder) {
  container.textContent = "";

  const names = nameOrder.filter((n) => n in step.bindings);
  const objIds = Object.keys(step.objects);
  const changedNames = new Set((step.changed && step.changed.names) || []);
  const changedObjs = new Set((step.changed && step.changed.objects) || []);

  const height =
    Math.max(L.top + names.length * L.namePitch, L.top + objIds.length * L.objPitch) + 8;

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
  const nameY = {};
  names.forEach((n, j) => (nameY[n] = L.top + j * L.namePitch));
  const objTop = {};
  objIds.forEach((id, i) => (objTop[id] = L.top + i * L.objPitch));

  // Objects
  for (const id of objIds) {
    const obj = step.objects[id];
    const top = objTop[id];
    const g = s("g", { class: "object" + (changedObjs.has(id) ? " changed" : "") });
    const label =
      `${obj.type} ${idLabel(id)}` + (changedObjs.has(id) ? " (changed)" : "");
    g.appendChild(s("text", { x: L.objX, y: top + 12, class: "obj-label" }, label));
    const items = Array.isArray(obj.items) ? obj.items : [];
    if (items.length === 0) {
      g.appendChild(
        s("rect", { x: L.objX, y: top + L.labelH, width: L.cellW, height: L.cellH, class: "cell" })
      );
    }
    items.forEach((item, k) => {
      const x = L.objX + k * L.cellW;
      g.appendChild(
        s("rect", { x, y: top + L.labelH, width: L.cellW, height: L.cellH, class: "cell" })
      );
      g.appendChild(
        s(
          "text",
          { x: x + L.cellW / 2, y: top + L.labelH + L.cellH / 2 + 5, class: "cell-text", "text-anchor": "middle" },
          itemText(item)
        )
      );
    });
    svg.appendChild(g);
  }

  // Names and arrows
  for (const n of names) {
    const y = nameY[n];
    const g = s("g", { class: "name" + (changedNames.has(n) ? " changed" : "") });
    g.appendChild(s("rect", { x: L.nameX, y, width: L.nameW, height: L.nameH, rx: 17, class: "name-box" }));
    g.appendChild(
      s("text", { x: L.nameX + L.nameW / 2, y: y + L.nameH / 2 + 5, class: "name-text", "text-anchor": "middle" }, n)
    );
    svg.appendChild(g);

    const oid = step.bindings[n];
    const x1 = L.nameX + L.nameW;
    const y1 = y + L.nameH / 2;
    const x2 = L.objX - 6;
    const y2 = objTop[oid] + L.labelH + L.cellH / 2;
    svg.appendChild(
      s("path", {
        d: `M ${x1} ${y1} C ${x1 + 70} ${y1}, ${x2 - 70} ${y2}, ${x2} ${y2}`,
        class: "arrow" + (changedNames.has(n) ? " changed" : ""),
        "marker-end": "url(#arrowhead)",
      })
    );
  }

  container.appendChild(svg);
}
