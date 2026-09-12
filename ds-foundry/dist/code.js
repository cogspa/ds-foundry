"use strict";
(() => {
  // src/util.ts
  var PD_ORIGINAL = "dsf.originalName";
  var PD_CATEGORY = "dsf.category";
  var PD_GENERATED = "dsf.generated";
  var cancelled = false;
  function setCancelled(v) {
    cancelled = v;
  }
  function post(msg) {
    figma.ui.postMessage(msg);
  }
  function progress(pct, msg) {
    post({ type: "progress", pct: Math.max(0, Math.min(100, Math.round(pct))), msg });
  }
  function tick() {
    return new Promise((r) => setTimeout(r, 0));
  }
  function slug(s, max = 32) {
    const out = (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "");
    return out || "item";
  }
  function round(n, places = 2) {
    const p = Math.pow(10, places);
    return Math.round(n * p) / p;
  }
  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }
  function toHex(r, g, b) {
    const h = (v) => clamp(Math.round(v * 255), 0, 255).toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
  }
  function rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h * 60, s, l };
  }
  function hueName(h) {
    if (h < 12 || h >= 345) return "red";
    if (h < 40) return "orange";
    if (h < 68) return "yellow";
    if (h < 95) return "lime";
    if (h < 155) return "green";
    if (h < 190) return "teal";
    if (h < 210) return "cyan";
    if (h < 250) return "blue";
    if (h < 275) return "indigo";
    if (h < 300) return "purple";
    return "pink";
  }
  function rgbaCss(r, g, b, a) {
    if (a >= 0.999) return toHex(r, g, b);
    return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${round(a, 3)})`;
  }
  function firstSolid(paints) {
    if (!paints || paints === figma.mixed) return null;
    for (const p of paints) if (p.type === "SOLID" && p.visible !== false) return p;
    return null;
  }
  function hasImageFill(paints) {
    if (!paints || paints === figma.mixed) return false;
    return paints.some((p) => (p.type === "IMAGE" || p.type === "VIDEO") && p.visible !== false);
  }
  function effectCss(e) {
    if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
      const c = e.color;
      const inset = e.type === "INNER_SHADOW" ? "inset " : "";
      return `${inset}${round(e.offset.x)}px ${round(e.offset.y)}px ${round(e.radius)}px ${round(e.spread || 0)}px ${rgbaCss(c.r, c.g, c.b, c.a)}`;
    }
    if (e.type === "LAYER_BLUR") return `blur(${round(e.radius)}px)`;
    if (e.type === "BACKGROUND_BLUR") return `backdrop-blur(${round(e.radius)}px)`;
    return "";
  }
  function effectKey(effects) {
    return effects.filter((e) => e.visible !== false).map((e) => {
      if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
        return `${e.type}:${round(e.offset.x)}:${round(e.offset.y)}:${round(e.radius)}:${round(e.spread || 0)}:${rgbaCss(e.color.r, e.color.g, e.color.b, e.color.a)}`;
      }
      return `${e.type}:${round(e.radius)}`;
    }).join("|");
  }
  function snap(v, grid) {
    if (grid <= 1) return Math.round(v);
    return Math.max(0, Math.round(v / grid) * grid);
  }

  // src/classify.ts
  var VECTOR_TYPES = /* @__PURE__ */ new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "LINE", "ELLIPSE", "RECTANGLE"]);
  var CONTAINER_TYPES = /* @__PURE__ */ new Set(["FRAME", "GROUP", "INSTANCE", "COMPONENT"]);
  function isVectorSubtree(node, depth = 0) {
    if (depth > 6) return false;
    if (node.type === "VECTOR" || node.type === "BOOLEAN_OPERATION" || node.type === "STAR" || node.type === "POLYGON" || node.type === "LINE") return true;
    if (node.type === "ELLIPSE" || node.type === "RECTANGLE") return !hasImageFill(node.fills);
    if (node.type === "GROUP" || node.type === "FRAME" || node.type === "INSTANCE" || node.type === "COMPONENT") {
      const kids = node.children;
      if (kids.length === 0 || kids.length > 24) return false;
      return kids.every((k) => isVectorSubtree(k, depth + 1));
    }
    return false;
  }
  function ownFillHex(node) {
    if (!("fills" in node)) return null;
    const s = firstSolid(node.fills);
    if (!s) return null;
    const { r, g, b } = s.color;
    const h = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
  }
  function ownStrokeHex(node) {
    if (!("strokes" in node)) return null;
    const s = firstSolid(node.strokes);
    if (!s) return null;
    const sw = node.strokeWeight;
    if (typeof sw === "number" && sw <= 0) return null;
    const { r, g, b } = s.color;
    const h = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
  }
  function isLight(hex) {
    if (!hex) return true;
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    return rgbToHsl(r, g, b).l > 0.9;
  }
  function uniformRadius(node) {
    if (!("cornerRadius" in node)) return 0;
    const cr = node.cornerRadius;
    if (typeof cr === "number") return cr;
    const rn = node;
    return Math.min(rn.topLeftRadius ?? 0, rn.topRightRadius ?? 0, rn.bottomLeftRadius ?? 0, rn.bottomRightRadius ?? 0);
  }
  function hasShadow(node) {
    if (!("effects" in node)) return false;
    return node.effects.some((e) => e.visible !== false && (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW"));
  }
  function collectTexts(node, depth = 0, out = []) {
    if (node.type === "TEXT") {
      out.push(node);
      return out;
    }
    if (depth >= 3) return out;
    if ("children" in node) for (const k of node.children) collectTexts(k, depth + 1, out);
    return out;
  }
  function countDescendants(node, depth = 0) {
    if (!("children" in node) || depth > 3) return 0;
    let n = node.children.length;
    for (const k of node.children) n += countDescendants(k, depth + 1);
    return n;
  }
  function textIsPlaceholderLike(t) {
    const seg = firstSolid(t.fills);
    if (!seg) return false;
    const { s, l } = rgbToHsl(seg.color.r, seg.color.g, seg.color.b);
    return s < 0.15 && l > 0.45 && l < 0.8;
  }
  function describeShape(node, fillHex, strokeHex) {
    const w = Math.round(node.width), h = Math.round(node.height);
    const aspect = h > 0 ? w / h : 1;
    const r = uniformRadius(node);
    let kind = "shape";
    if (node.type === "ELLIPSE") kind = aspect > 0.85 && aspect < 1.18 ? "circle" : "oval";
    else if (node.type === "RECTANGLE") {
      if (r >= Math.min(w, h) / 2 - 0.5 && Math.min(w, h) > 0) kind = aspect > 0.85 && aspect < 1.18 ? "circle" : "pill";
      else if (r > 0) kind = aspect > 0.85 && aspect < 1.18 ? "rounded-square" : "rounded-rect";
      else kind = aspect > 0.85 && aspect < 1.18 ? "square" : aspect > 6 || aspect < 1 / 6 ? "bar" : "rect";
    } else if (node.type === "LINE") kind = "line";
    else if (node.type === "STAR") kind = "star";
    else if (node.type === "POLYGON") kind = `${node.pointCount}-gon`;
    else if (node.type === "VECTOR" || node.type === "BOOLEAN_OPERATION") {
      let curved = false, closed = false, segs = 0, regions = 0;
      try {
        const vn = node.vectorNetwork;
        if (vn) {
          segs = vn.segments.length;
          regions = vn.regions ? vn.regions.length : 0;
          closed = regions > 0;
          curved = vn.segments.some((sg) => sg.tangentStart && (sg.tangentStart.x || sg.tangentStart.y) || sg.tangentEnd && (sg.tangentEnd.x || sg.tangentEnd.y));
        }
      } catch {
      }
      if (node.type === "BOOLEAN_OPERATION") kind = "compound";
      else if (segs === 0) kind = "empty-path";
      else if (!closed) kind = curved ? "curve" : segs === 1 ? "line" : "polyline";
      else if (curved) kind = segs <= 4 ? "blob" : "outline";
      else kind = segs === 3 ? "triangle" : segs === 4 ? "quad" : "polygon";
      if (Math.max(w, h) < 8) kind = "speck";
    }
    const colour = fillHex ? colourWord(fillHex) : strokeHex ? `${colourWord(strokeHex)}-outline` : "transparent";
    return `${colour}-${kind}-${w}x${h}`;
  }
  function colourWord(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const { h, s, l } = rgbToHsl(r, g, b);
    if (l > 0.95) return "white";
    if (l < 0.08) return "black";
    if (s < 0.12) return l > 0.6 ? "light-gray" : l > 0.35 ? "gray" : "dark-gray";
    const base = h < 12 || h >= 345 ? "red" : h < 40 ? "orange" : h < 68 ? "yellow" : h < 95 ? "lime" : h < 155 ? "green" : h < 190 ? "teal" : h < 210 ? "cyan" : h < 250 ? l < 0.3 ? "navy" : "blue" : h < 275 ? "indigo" : h < 300 ? "purple" : "pink";
    return l > 0.8 ? `pale-${base}` : l < 0.25 && base !== "navy" ? `dark-${base}` : base;
  }
  function describeGroup(node) {
    const st = vectorStats(node);
    let colour = "mixed";
    if ("children" in node) {
      for (const k of node.children) {
        const h = ownFillHex(k) || ownStrokeHex(k);
        if (h) {
          colour = colourWord(h);
          break;
        }
      }
    }
    return `${colour}-${st.n}-piece-${Math.round(node.width)}x${Math.round(node.height)}`;
  }
  function vectorStats(node, depth = 0, acc = { n: 0, text: 0 }) {
    if (depth > 6) return acc;
    if (node.type === "TEXT") {
      acc.text++;
      return acc;
    }
    if ("children" in node) {
      for (const k of node.children) vectorStats(k, depth + 1, acc);
      return acc;
    }
    acc.n++;
    return acc;
  }
  function classify(node, ctx) {
    const w = node.width, h = node.height;
    const aspect = h > 0 ? w / h : 1;
    const fillHex = ownFillHex(node);
    const strokeHex = ownStrokeHex(node);
    const radius = uniformRadius(node);
    const fp = (cat, extra = "") => `${cat}|${Math.round(w / 8)}x${Math.round(h / 8)}|${fillHex || ""}|${strokeHex || ""}|${Math.round(radius)}${extra}`;
    if (node.type === "TEXT") {
      const t = node;
      const chars = t.characters;
      const size = typeof t.fontSize === "number" ? t.fontSize : 14;
      const lines = chars.split("\n").length;
      let cat = "text";
      if (chars.length > 90 || lines > 2 || lines === 2 && chars.length > 60) cat = "copy";
      else if (size >= 14 && size < 34 && chars.trim().split(/\s+/).length >= 3 && chars.length <= 90 && !/[.!?]$/.test(chars.trim()) && !ctx.topLevel) cat = "tagline";
      return { category: cat, text: chars, fillHex, strokeHex, fingerprint: fp(cat), desc: "" };
    }
    if (node.type === "LINE" || node.type === "RECTANGLE" && (h <= 2 || w <= 2) && Math.max(w, h) >= 24) {
      return { category: "divider", text: "", fillHex, strokeHex, fingerprint: fp("divider"), desc: "" };
    }
    if (node.type === "RECTANGLE" || node.type === "ELLIPSE") {
      if (hasImageFill(node.fills)) {
        const round2 = node.type === "ELLIPSE" || radius >= Math.min(w, h) / 2 - 0.5;
        if (round2 && aspect > 0.8 && aspect < 1.25 && Math.max(w, h) <= 200) {
          return { category: "avatar", text: "", fillHex, strokeHex, fingerprint: fp("avatar"), desc: "" };
        }
        return { category: "image", text: "", fillHex, strokeHex, fingerprint: fp("image"), desc: "" };
      }
    }
    const ntype = node.type;
    if (VECTOR_TYPES.has(ntype) || ntype === "GROUP") {
      const tiny = Math.max(w, h) < 6 || w * h < 24 && ntype !== "LINE";
      let empty = false;
      try {
        empty = ntype === "VECTOR" && node.vectorNetwork.segments.length === 0;
      } catch {
      }
      const invisibleFill = "fills" in node && !fillHex && !strokeHex && ntype !== "GROUP";
      const ghost = "opacity" in node && node.opacity === 0 || node.visible === false && Math.max(w, h) < 24;
      if (tiny || empty || ghost || invisibleFill && Math.max(w, h) < 24) {
        return { category: "debris", text: "", fillHex, strokeHex, fingerprint: `debris|${node.type}|${Math.round(w)}x${Math.round(h)}`, desc: describeShape(node, fillHex, strokeHex) };
      }
    }
    if (VECTOR_TYPES.has(node.type) || CONTAINER_TYPES.has(node.type)) {
      const nameHint = node.name.toLowerCase();
      const vec = isVectorSubtree(node);
      const kids2 = "children" in node ? countDescendants(node) : 0;
      const primitive = !CONTAINER_TYPES.has(node.type) && node.type !== "VECTOR" && node.type !== "BOOLEAN_OPERATION";
      const vfp = (cat) => `${cat}|${nameHint}|${Math.round(w)}x${Math.round(h)}|${kids2}`;
      const artDesc = () => CONTAINER_TYPES.has(node.type) ? describeGroup(node) : describeShape(node, fillHex, strokeHex);
      if (/\b(logo|wordmark|brand|logotype)\b/.test(nameHint) && (vec || CONTAINER_TYPES.has(node.type))) {
        return { category: "logo", text: "", fillHex, strokeHex, fingerprint: vfp("logo"), desc: artDesc() };
      }
      if (vec) {
        if (Math.max(w, h) <= 64 && Math.min(w, h) >= 6 && aspect >= 0.5 && aspect <= 2) {
          return { category: "icon", text: "", fillHex, strokeHex, fingerprint: vfp("icon"), desc: "" };
        }
        if (primitive) {
          return { category: "shape", text: "", fillHex, strokeHex, fingerprint: fp("shape"), desc: describeShape(node, fillHex, strokeHex) };
        }
        if (aspect >= 2.4 && h <= 160 && kids2 >= 3 && Math.max(w, h) > 64) {
          return { category: "logo", text: "", fillHex, strokeHex, fingerprint: vfp("logo"), desc: artDesc() };
        }
        if (Math.max(w, h) <= 200 && kids2 <= 6 && aspect >= 0.4 && aspect <= 2.5 && Math.max(w, h) > 64) {
          return { category: "symbol", text: "", fillHex, strokeHex, fingerprint: vfp("symbol"), desc: artDesc() };
        }
        if (Math.max(w, h) > 64 && (kids2 > 6 || Math.max(w, h) > 200)) {
          return { category: "illustration", text: "", fillHex, strokeHex, fingerprint: vfp("illustration"), desc: artDesc() };
        }
        if (Math.max(w, h) > 64 && !CONTAINER_TYPES.has(node.type)) {
          return { category: "symbol", text: "", fillHex, strokeHex, fingerprint: vfp("symbol"), desc: describeShape(node, fillHex, strokeHex) };
        }
      }
      if (CONTAINER_TYPES.has(node.type)) {
        const st = vectorStats(node);
        if (st.n >= 2 && st.text >= 1 && st.text <= 2 && aspect >= 1.8 && h <= 160 && kids2 <= 30) {
          return { category: "logo", text: collectTexts(node)[0]?.characters || "", fillHex, strokeHex, fingerprint: vfp("logo"), desc: artDesc() };
        }
      }
    }
    if (!CONTAINER_TYPES.has(node.type)) {
      return { category: "shape", text: "", fillHex, strokeHex, fingerprint: fp("shape"), desc: describeShape(node, fillHex, strokeHex) };
    }
    const c = node;
    const kids = c.children;
    const texts = collectTexts(node);
    const primaryText = texts.length ? texts[0].characters : "";
    const textLen = primaryText.length;
    const hasFill = !!fillHex;
    const hasStroke = !!strokeHex;
    const shadow = hasShadow(node);
    const layoutMode = "layoutMode" in c ? c.layoutMode : "NONE";
    const imageFill = "fills" in c && hasImageFill(c.fills);
    if (ctx.topLevel && w >= 300 && h >= 300) {
      return { category: "screen", text: primaryText, fillHex, strokeHex, fingerprint: fp("screen"), desc: "" };
    }
    if (imageFill && kids.length <= 2) {
      const round2 = radius >= Math.min(w, h) / 2 - 0.5;
      if (round2 && aspect > 0.8 && aspect < 1.25 && Math.max(w, h) <= 200) {
        return { category: "avatar", text: "", fillHex, strokeHex, fingerprint: fp("avatar"), desc: "" };
      }
      return { category: "image", text: "", fillHex, strokeHex, fingerprint: fp("image"), desc: "" };
    }
    if (Math.max(w, h) <= 32 && kids.length <= 2 && (hasFill || hasStroke)) {
      if (aspect >= 1.6 && aspect <= 2.6 && radius >= h / 2 - 0.5) {
        return { category: "toggle", text: "", fillHex, strokeHex, fingerprint: fp("toggle"), desc: "" };
      }
      if (aspect > 0.8 && aspect < 1.25 && texts.length === 0) {
        return { category: "checkbox", text: "", fillHex, strokeHex, fingerprint: fp("checkbox"), desc: "" };
      }
    }
    if (texts.length >= 1 && texts.length <= 2 && kids.length <= 4 && h >= 18 && h <= 80 && w <= 520 && textLen > 0 && textLen <= 40 && (hasFill || hasStroke)) {
      if (h <= 28 && w <= 180) {
        return { category: "badge", text: primaryText, fillHex, strokeHex, fingerprint: fp("badge"), desc: "" };
      }
      const looksInput = hasStroke && isLight(fillHex) && w >= 140 && (textIsPlaceholderLike(texts[0]) || /^(search|enter|type|email|password|your|placeholder)/i.test(primaryText));
      if (looksInput) {
        return { category: "input", text: primaryText, fillHex, strokeHex, fingerprint: fp("input"), desc: "" };
      }
      return { category: "button", text: primaryText, fillHex, strokeHex, fingerprint: fp("button", `|${Math.round(texts[0].fontSize === figma.mixed ? 0 : texts[0].fontSize)}`), desc: "" };
    }
    if (ctx.parentW > 0 && h <= 110 && w >= ctx.parentW * 0.6 && ctx.yInParent <= Math.max(16, ctx.parentH * 0.12) && kids.length >= 2 && !ctx.topLevel) {
      return { category: "nav", text: primaryText, fillHex, strokeHex, fingerprint: fp("nav", `|${kids.length}`), desc: "" };
    }
    if (aspect > 0.8 && aspect < 1.25 && Math.max(w, h) <= 120 && radius >= Math.min(w, h) / 2 - 0.5 && (hasFill || imageFill)) {
      return { category: "avatar", text: primaryText, fillHex, strokeHex, fingerprint: fp("avatar"), desc: "" };
    }
    if (ctx.parentW > 0 && layoutMode === "HORIZONTAL" && w >= ctx.parentW * 0.7 && h <= 140 && h >= 32 && texts.length >= 1 && !ctx.topLevel) {
      return { category: "list-item", text: primaryText, fillHex, strokeHex, fingerprint: fp("list-item", `|${kids.length}`), desc: "" };
    }
    if ((hasFill || hasStroke || shadow) && kids.length >= 2 && w >= 120 && h >= 72 && (ctx.parentW === 0 || w <= ctx.parentW * 0.95 || h <= ctx.parentH * 0.6)) {
      if (!(ctx.parentW > 0 && w >= ctx.parentW * 0.98 && h >= ctx.parentH * 0.9)) {
        return { category: "card", text: primaryText, fillHex, strokeHex, fingerprint: fp("card", `|${kids.length}|${shadow ? "s" : ""}`), desc: "" };
      }
    }
    if (ctx.parentW > 0 && w >= ctx.parentW * 0.8 && h >= 120 && kids.length >= 1 && !ctx.topLevel) {
      return { category: "section", text: primaryText, fillHex, strokeHex, fingerprint: fp("section"), desc: "" };
    }
    return { category: "other", text: primaryText, fillHex, strokeHex, fingerprint: fp("other"), desc: "" };
  }

  // src/naming.ts
  function neutralStep(l) {
    const s = Math.round((1 - l) * 10) * 100;
    return clamp(s === 0 ? 50 : s, 50, 950);
  }
  function chromaticStep(l, anchorL) {
    const s = 500 + Math.round((anchorL - l) * 9) * 100;
    return clamp(s, 50, 950);
  }
  function nameColors(colors) {
    const families = /* @__PURE__ */ new Map();
    const neutrals = [];
    for (const c of colors) {
      const { s, l } = rgbToHsl(c.r, c.g, c.b);
      const isNeutral = s < 0.12 || l > 0.985 || l < 0.02 || s < 0.28 && (l > 0.88 || l < 0.12);
      if (isNeutral) {
        neutrals.push(c);
        continue;
      }
      const { h } = rgbToHsl(c.r, c.g, c.b);
      const fam = hueName(h);
      if (!families.has(fam)) families.set(fam, []);
      families.get(fam).push(c);
    }
    const ranked = [...families.entries()].sort((a, b) => sum(b[1]) - sum(a[1]));
    const roleOf = /* @__PURE__ */ new Map();
    const taken = /* @__PURE__ */ new Set();
    if (ranked[0]) {
      roleOf.set(ranked[0][0], "primary");
      taken.add("primary");
    }
    if (ranked[1]) {
      roleOf.set(ranked[1][0], "secondary");
      taken.add("secondary");
    }
    for (const [fam] of ranked.slice(2)) {
      let role = fam;
      if (fam === "red" && !taken.has("error")) role = "error";
      else if ((fam === "green" || fam === "lime") && !taken.has("success")) role = "success";
      else if ((fam === "yellow" || fam === "orange") && !taken.has("warning")) role = "warning";
      else if ((fam === "blue" || fam === "cyan") && !taken.has("info")) role = "info";
      if (taken.has(role)) role = fam;
      if (taken.has(role)) role = `${fam}-2`;
      taken.add(role);
      roleOf.set(fam, role);
    }
    const out = [];
    for (const [fam, list] of families) {
      const role = roleOf.get(fam) || fam;
      assignSteps(list, role, out);
    }
    assignSteps(neutrals, "neutral", out);
    const order = ["primary", "secondary", "neutral"];
    out.sort((a, b) => {
      const ia = order.indexOf(a.role), ib = order.indexOf(b.role);
      const ra = ia === -1 ? 99 : ia, rb = ib === -1 ? 99 : ib;
      if (ra !== rb) return ra - rb;
      if (a.role !== b.role) return a.role < b.role ? -1 : 1;
      return a.step - b.step;
    });
    return out;
  }
  function sum(list) {
    return list.reduce((n, c) => n + c.count, 0);
  }
  function assignSteps(list, role, out) {
    if (!list.length) return;
    const sorted = [...list].sort((a, b) => rgbToHsl(b.r, b.g, b.b).l - rgbToHsl(a.r, a.g, a.b).l);
    const anchor = [...list].sort((a, b) => b.count - a.count)[0];
    const anchorL = rgbToHsl(anchor.r, anchor.g, anchor.b).l;
    const used = /* @__PURE__ */ new Set();
    for (const c of sorted) {
      const { l } = rgbToHsl(c.r, c.g, c.b);
      let step;
      if (role === "neutral" && l > 0.985) step = 0;
      else if (role === "neutral" && l < 0.02) step = 1e3;
      else if (role === "neutral") step = neutralStep(l);
      else if (sorted.length === 1) step = 500;
      else step = chromaticStep(l, anchorL);
      while (used.has(step)) step += 50;
      used.add(step);
      c.role = role;
      c.step = step;
      c.name = `${role}/${step}`;
      if (c.a < 0.999) c.name += `-a${Math.round(c.a * 100)}`;
      out.push(c);
    }
  }
  function weightClass(style) {
    const s = style.toLowerCase();
    if (/black|heavy|extra ?bold|ultra/.test(s)) return { name: "black", css: 800 };
    if (/bold/.test(s) && !/semi/.test(s)) return { name: "bold", css: 700 };
    if (/semi|demi/.test(s)) return { name: "semibold", css: 600 };
    if (/medium/.test(s)) return { name: "medium", css: 500 };
    if (/light|thin|hairline/.test(s)) return { name: "light", css: 300 };
    return { name: "regular", css: 400 };
  }
  function typeRole(size) {
    if (size >= 40) return "display";
    if (size >= 24) return "heading";
    if (size >= 18) return "title";
    if (size >= 14) return "body";
    return "caption";
  }
  var SIZE_LABELS = {
    1: ["md"],
    2: ["lg", "sm"],
    3: ["lg", "md", "sm"],
    4: ["xl", "lg", "md", "sm"],
    5: ["xl", "lg", "md", "sm", "xs"],
    6: ["2xl", "xl", "lg", "md", "sm", "xs"]
  };
  function nameTypes(types) {
    for (const t of types) {
      t.role = typeRole(t.size);
      const w = weightClass(t.style);
      t.weight = w.name;
      t.cssWeight = w.css;
    }
    const byRole = /* @__PURE__ */ new Map();
    for (const t of types) {
      if (!byRole.has(t.role)) byRole.set(t.role, []);
      byRole.get(t.role).push(t);
    }
    const used = /* @__PURE__ */ new Set();
    for (const [role, list] of byRole) {
      const sizes = [...new Set(list.map((t) => t.size))].sort((a, b) => b - a);
      const labels = SIZE_LABELS[sizes.length] || sizes.map((_, i) => String(sizes.length - i));
      const labelOf = /* @__PURE__ */ new Map();
      sizes.forEach((s, i) => labelOf.set(s, labels[i]));
      for (const t of list) {
        let name = `${role}/${labelOf.get(t.size)}/${t.weight}`;
        let n = 2;
        while (used.has(name)) name = `${role}/${labelOf.get(t.size)}/${t.weight}-${n++}`;
        used.add(name);
        t.name = name;
      }
    }
    const roleOrder = ["display", "heading", "title", "body", "caption"];
    types.sort((a, b) => {
      const r = roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role);
      if (r !== 0) return r;
      if (a.size !== b.size) return b.size - a.size;
      return b.cssWeight - a.cssWeight;
    });
    return types;
  }
  function nameSpacing(list) {
    list.sort((a, b) => a.value - b.value);
    for (const s of list) s.name = `space/${s.value}`;
    return list;
  }
  var RADIUS_LABELS = {
    1: ["md"],
    2: ["sm", "lg"],
    3: ["sm", "md", "lg"],
    4: ["sm", "md", "lg", "xl"],
    5: ["xs", "sm", "md", "lg", "xl"],
    6: ["xs", "sm", "md", "lg", "xl", "2xl"],
    7: ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"]
  };
  function nameRadii(list) {
    list.sort((a, b) => a.value - b.value);
    const full = list.filter((r) => r.value >= 999);
    const rest = list.filter((r) => r.value < 999);
    const labels = RADIUS_LABELS[rest.length] || rest.map((_, i) => String(i + 1));
    rest.forEach((r, i) => r.name = `radius/${labels[i]}`);
    full.forEach((r) => r.name = "radius/full");
    return [...rest, ...full];
  }
  function nameEffects(list) {
    const shadows = list.filter((e) => e.effects.some((x) => x.type === "DROP_SHADOW" || x.type === "INNER_SHADOW"));
    const blurs = list.filter((e) => !shadows.includes(e));
    const depth = (e) => e.effects.reduce((n, x) => n + x.radius + ("offset" in x ? Math.abs(x.offset.y) : 0), 0);
    shadows.sort((a, b) => depth(a) - depth(b));
    blurs.sort((a, b) => depth(a) - depth(b));
    shadows.forEach((e, i) => e.name = `elevation/${i + 1}`);
    blurs.forEach((e, i) => e.name = `blur/${i + 1}`);
    return [...shadows, ...blurs];
  }
  function sizeClass(h) {
    if (h <= 32) return "sm";
    if (h <= 44) return "md";
    return "lg";
  }
  var DEFAULT_NAME = /^(vector|group|frame|rectangle|ellipse|line|polygon|star|boolean|union|subtract|intersect|exclude|path|shape|layer|image|mask)(\s*\d+)?(\s*copy(\s*\d+)?)?$/i;
  function isDefaultName(name) {
    return DEFAULT_NAME.test(name.trim());
  }
  function elementLabel(rec, prefix) {
    const p = prefix;
    const s = isDefaultName(rec.name) && rec.desc ? rec.desc : slug(rec.name);
    const t = rec.text ? slug(rec.text, 24) : "";
    const cat = rec.category;
    switch (cat) {
      case "screen":
        return `${p}screen/${s}`;
      case "section":
        return `${p}section/${s}`;
      case "nav":
        return `${p}nav/${s}`;
      case "card":
        return `${p}card/${s}`;
      case "button":
        return `${p}button/${rec.fillRole || "default"}-${rec.sizeClass}${t ? "/" + t : ""}`;
      case "input":
        return `${p}input/${rec.sizeClass}${t ? "/" + t : ""}`;
      case "badge":
        return `${p}badge/${rec.fillRole || "default"}${t ? "/" + t : ""}`;
      case "avatar":
        return `${p}avatar/${rec.sizeClass}`;
      case "image":
        return `${p}image/${s}`;
      case "icon":
        return `${p}icon/${s}`;
      case "divider":
        return `${p}divider`;
      case "list-item":
        return `${p}list-item/${s}`;
      case "checkbox":
        return `${p}checkbox`;
      case "toggle":
        return `${p}toggle`;
      case "text":
        return `${p}text/${(rec.textRole || "body").replace(/\//g, "-")}`;
      case "tagline":
        return `${p}tagline/${t || s}`;
      case "copy":
        return `${p}copy/${t || s}`;
      case "logo":
        return `${p}logo/${t || s}`;
      case "character":
        return `${p}character/${s}`;
      case "illustration":
        return `${p}illustration/${s}`;
      case "symbol":
        return `${p}symbol/${s}`;
      case "shape":
        return `${p}shape/${rec.desc || s}`;
      case "debris":
        return `${p}debris/${rec.desc || s}`;
      default:
        return `${p}${s}`;
    }
  }

  // src/scan.ts
  var SKIP_TYPES = /* @__PURE__ */ new Set(["SLICE", "STICKY", "CONNECTOR", "SHAPE_WITH_TEXT", "CODE_BLOCK", "WIDGET", "EMBED", "LINK_UNFURL", "MEDIA", "TABLE"]);
  async function scan(scope, baseGrid) {
    const colors = /* @__PURE__ */ new Map();
    const types = /* @__PURE__ */ new Map();
    const spacing = /* @__PURE__ */ new Map();
    const radii = /* @__PURE__ */ new Map();
    const effects = /* @__PURE__ */ new Map();
    const elements = [];
    const icons = [];
    const shapes = [];
    const SHAPE_TYPES = /* @__PURE__ */ new Set(["RECTANGLE", "ELLIPSE", "POLYGON", "STAR", "VECTOR", "BOOLEAN_OPERATION"]);
    const components = /* @__PURE__ */ new Map();
    const fonts = /* @__PURE__ */ new Map();
    const missingFonts = /* @__PURE__ */ new Set();
    const pages = [];
    const pageIds = [];
    const stack = [];
    const pushRoots = (nodes, page, topLevel) => {
      for (const n of nodes) {
        stack.push({ node: n, ctx: { parentW: 0, parentH: 0, yInParent: 0, topLevel }, inInstance: n.type === "INSTANCE", page: page.name });
      }
    };
    if (scope === "document") {
      await figma.loadAllPagesAsync();
      for (const p of figma.root.children) {
        pages.push(p.name);
        pageIds.push(p.id);
        pushRoots(p.children, p, true);
      }
    } else if (scope === "page") {
      const p = figma.currentPage;
      pages.push(p.name);
      pageIds.push(p.id);
      pushRoots(p.children, p, true);
    } else {
      const p = figma.currentPage;
      pages.push(p.name);
      pageIds.push(p.id);
      const sel = p.selection;
      for (const n of sel) {
        const topLevel = n.parent?.type === "PAGE";
        const pw = n.parent && "width" in n.parent ? n.parent.width : 0;
        const ph = n.parent && "height" in n.parent ? n.parent.height : 0;
        stack.push({ node: n, ctx: { parentW: pw, parentH: ph, yInParent: n.y, topLevel }, inInstance: n.type === "INSTANCE", page: p.name });
      }
    }
    const rootCount = stack.length;
    let visited = 0;
    let sinceTick = 0;
    const addColor = (paint) => {
      const { r, g, b } = paint.color;
      const a = paint.opacity === void 0 ? 1 : paint.opacity;
      const hex = toHex(r, g, b);
      const key = a >= 0.999 ? hex : `${hex}@${Math.round(a * 100)}`;
      const t = colors.get(key);
      if (t) t.count++;
      else colors.set(key, { key, hex, r, g, b, a, count: 1, name: "", role: "", step: 0 });
    };
    const addPaints = (paints, isStroke = false, weight) => {
      if (!paints || paints === figma.mixed) return;
      if (isStroke && typeof weight === "number" && weight <= 0) return;
      for (const p of paints) if (p.type === "SOLID" && p.visible !== false) addColor(p);
    };
    const addSpace = (v) => {
      if (!isFinite(v) || v <= 0) return;
      const s = snap(v, baseGrid);
      if (s <= 0) return;
      const t = spacing.get(s);
      if (t) t.count++;
      else spacing.set(s, { value: s, count: 1, name: "" });
    };
    const addRadius = (v) => {
      if (!isFinite(v) || v <= 0) return;
      const r = v >= 999 ? 999 : Math.round(v);
      const t = radii.get(r);
      if (t) t.count++;
      else radii.set(r, { value: r, count: 1, name: "" });
    };
    const addEffects = (list) => {
      const vis = list.filter((e) => e.visible !== false);
      if (!vis.length) return;
      const key = effectKey(vis);
      const t = effects.get(key);
      if (t) t.count++;
      else {
        const clean = vis.map((e) => {
          const { boundVariables, ...rest } = e;
          return rest;
        });
        effects.set(key, { key, effects: clean, count: 1, name: "", css: vis.map(effectCss).filter(Boolean).join(", ") });
      }
    };
    const textRoleOf = (node) => {
      let firstKey = "";
      let segs = null;
      try {
        segs = node.getStyledTextSegments(["fontName", "fontSize", "lineHeight", "letterSpacing", "fills"]);
      } catch {
        segs = null;
      }
      if (!segs || !segs.length) return "";
      for (const s of segs) {
        const fn = s.fontName;
        const lh = s.lineHeight;
        const ls = s.letterSpacing;
        const lhKey = lh.unit === "AUTO" ? "auto" : `${Math.round(lh.value * 100) / 100}${lh.unit === "PERCENT" ? "%" : "px"}`;
        const lsKey = `${Math.round(ls.value * 100) / 100}${ls.unit === "PERCENT" ? "%" : "px"}`;
        const key = `${fn.family}|${fn.style}|${s.fontSize}|${lhKey}|${lsKey}`;
        if (!firstKey) firstKey = key;
        const t = types.get(key);
        if (t) t.count += Math.max(1, s.characters.length > 0 ? 1 : 0);
        else types.set(key, { key, family: fn.family, style: fn.style, size: s.fontSize, lineHeight: lh, letterSpacing: ls, count: 1, name: "", role: "", weight: "", cssWeight: 400 });
        fonts.set(`${fn.family}|${fn.style}`, { family: fn.family, style: fn.style });
        if (node.hasMissingFont) missingFonts.add(`${fn.family} ${fn.style}`);
        addPaints(s.fills);
      }
      return firstKey;
    };
    const fillRoleOf = (hex, strokeHex) => {
      if (!hex) return strokeHex ? "outline" : "ghost";
      const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
      const { s, l } = rgbToHsl(r, g, b);
      if (l > 0.94 && s < 0.2) return strokeHex ? "outline" : "ghost";
      if (s < 0.1) return "neutral";
      return "__" + hex;
    };
    while (stack.length) {
      if (cancelled) throw new Error("cancelled");
      const item = stack.pop();
      const node = item.node;
      if (SKIP_TYPES.has(node.type) || node.removed) continue;
      visited++;
      sinceTick++;
      if (sinceTick >= 400) {
        sinceTick = 0;
        const pct = rootCount ? Math.min(85, 5 + visited / Math.max(visited + stack.length, 1) * 80) : 50;
        progress(pct, `Scanning\u2026 ${visited.toLocaleString()} layers`);
        await tick();
      }
      const inInstance = item.inInstance;
      if ("fills" in node) {
        if (node.type !== "TEXT") addPaints(node.fills);
      }
      if ("strokes" in node) addPaints(node.strokes, true, node.strokeWeight);
      if ("effects" in node) addEffects(node.effects);
      if ("cornerRadius" in node) {
        const cr = node.cornerRadius;
        if (typeof cr === "number") addRadius(cr);
        else {
          const rn = node;
          [rn.topLeftRadius, rn.topRightRadius, rn.bottomLeftRadius, rn.bottomRightRadius].forEach((v) => typeof v === "number" && addRadius(v));
        }
      }
      if ("layoutMode" in node && node.layoutMode !== "NONE") {
        const f = node;
        addSpace(f.paddingLeft);
        addSpace(f.paddingRight);
        addSpace(f.paddingTop);
        addSpace(f.paddingBottom);
        if (typeof f.itemSpacing === "number" && f.primaryAxisAlignItems !== "SPACE_BETWEEN") addSpace(f.itemSpacing);
        if (f.layoutWrap === "WRAP" && typeof f.counterAxisSpacing === "number") addSpace(f.counterAxisSpacing);
      }
      if (node.type === "INSTANCE") {
        try {
          const mc = await node.getMainComponentAsync();
          if (mc) {
            const target = mc.parent && mc.parent.type === "COMPONENT_SET" ? mc.parent : mc;
            const ref = components.get(target.id);
            if (ref) ref.count++;
            else components.set(target.id, { id: target.id, name: target.name, remote: target.remote, count: 1 });
          }
        } catch {
        }
      }
      let textRole = "";
      if (node.type === "TEXT") textRole = textRoleOf(node);
      const cls = classify(node, item.ctx);
      if (cls.category !== "other") {
        const rec = {
          id: node.id,
          category: cls.category,
          name: node.name,
          text: cls.text.slice(0, 80),
          w: node.width,
          h: node.height,
          fingerprint: cls.fingerprint,
          inInstance,
          fillRole: cls.category === "button" || cls.category === "badge" ? fillRoleOf(cls.fillHex, cls.strokeHex) : "",
          sizeClass: sizeClass(node.height),
          textRole,
          desc: cls.desc,
          page: item.page
        };
        if (cls.category === "icon") icons.push(rec);
        else if (cls.category === "shape") {
          if (shapes.length < 4e3) shapes.push(rec);
        } else elements.push(rec);
      }
      if ("children" in node && cls.category !== "icon") {
        const kids = node.children;
        const pw = node.width, ph = node.height;
        for (let i = kids.length - 1; i >= 0; i--) {
          const k = kids[i];
          stack.push({ node: k, ctx: { parentW: pw, parentH: ph, yInParent: k.y, topLevel: false }, inInstance: inInstance || node.type === "INSTANCE", page: item.page });
        }
      } else if ("children" in node && cls.category === "icon") {
        const inner = [...node.children];
        while (inner.length) {
          const k = inner.pop();
          if ("fills" in k) addPaints(k.fills);
          if ("strokes" in k) addPaints(k.strokes, true, k.strokeWeight);
          if ("children" in k) inner.push(...k.children);
        }
      }
    }
    progress(90, "Naming tokens\u2026");
    await tick();
    const namedColors = nameColors([...colors.values()]);
    const hexRole = /* @__PURE__ */ new Map();
    for (const c of namedColors) if (!hexRole.has(c.hex)) hexRole.set(c.hex, c.role);
    for (const e of elements) {
      if (e.fillRole.startsWith("__")) e.fillRole = hexRole.get(e.fillRole.slice(2)) || "custom";
    }
    const namedTypes = nameTypes([...types.values()]);
    const typeName = /* @__PURE__ */ new Map();
    for (const t of namedTypes) typeName.set(t.key, t.name);
    for (const e of elements) if (e.category === "text" && e.textRole) e.textRole = typeName.get(e.textRole) || "body";
    const inv = {
      scope,
      pages,
      pageIds,
      nodeCount: visited,
      colors: namedColors,
      types: namedTypes,
      spacing: nameSpacing([...spacing.values()]),
      radii: nameRadii([...radii.values()]),
      effects: nameEffects([...effects.values()]),
      elements,
      icons,
      shapes,
      components: [...components.values()].sort((a, b) => b.count - a.count),
      fonts: [...fonts.values()],
      missingFonts: [...missingFonts]
    };
    progress(100, "Scan complete");
    return inv;
  }

  // src/tokens.ts
  var cssName = (s) => s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  function lineHeightCss(lh) {
    if (lh.unit === "AUTO") return "normal";
    return lh.unit === "PERCENT" ? `${round(lh.value / 100, 3)}` : `${round(lh.value)}px`;
  }
  function letterSpacingCss(ls) {
    if (!ls.value) return "0";
    return ls.unit === "PERCENT" ? `${round(ls.value / 100, 3)}em` : `${round(ls.value)}px`;
  }
  function setDeep(obj, path, value) {
    let cur = obj;
    for (let i = 0; i < path.length - 1; i++) {
      cur[path[i]] = cur[path[i]] || {};
      cur = cur[path[i]];
    }
    cur[path[path.length - 1]] = value;
  }
  function buildTokenFiles(inv, opts, result) {
    const files = {};
    const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
    const source = { plugin: "DS Foundry", version: "1.4.0", generatedAt, scope: inv.scope, pages: inv.pages };
    const dtcg = { $schema: "https://tr.designtokens.org/format/", $extensions: { "com.cogspa.dsfoundry": source } };
    for (const c of inv.colors) {
      setDeep(dtcg, ["color", ...c.name.split("/")], { $type: "color", $value: rgbaCss(c.r, c.g, c.b, c.a), $extensions: { usage: c.count } });
    }
    for (const s of inv.spacing) {
      setDeep(dtcg, ["space", String(s.value)], { $type: "dimension", $value: `${s.value}px`, $extensions: { usage: s.count } });
    }
    for (const r of inv.radii) {
      setDeep(dtcg, ["radius", r.name.split("/")[1]], { $type: "dimension", $value: r.value >= 999 ? "9999px" : `${r.value}px`, $extensions: { usage: r.count } });
    }
    for (const e of inv.effects) {
      const shadows = e.effects.filter((x) => x.type === "DROP_SHADOW" || x.type === "INNER_SHADOW");
      if (shadows.length) {
        setDeep(dtcg, ["shadow", ...e.name.split("/")], {
          $type: "shadow",
          $value: shadows.map((s) => ({
            color: rgbaCss(s.color.r, s.color.g, s.color.b, s.color.a),
            offsetX: `${round(s.offset.x)}px`,
            offsetY: `${round(s.offset.y)}px`,
            blur: `${round(s.radius)}px`,
            spread: `${round(s.spread || 0)}px`,
            inset: s.type === "INNER_SHADOW"
          })),
          $extensions: { usage: e.count }
        });
      } else {
        setDeep(dtcg, ["blur", ...e.name.split("/")], { $type: "dimension", $value: `${round(e.effects[0].radius)}px`, $extensions: { usage: e.count } });
      }
    }
    for (const t of inv.types) {
      setDeep(dtcg, ["typography", ...t.name.split("/")], {
        $type: "typography",
        $value: {
          fontFamily: t.family,
          fontWeight: t.cssWeight,
          fontStyle: /italic|oblique/i.test(t.style) ? "italic" : "normal",
          fontSize: `${round(t.size)}px`,
          lineHeight: lineHeightCss(t.lineHeight),
          letterSpacing: letterSpacingCss(t.letterSpacing)
        },
        $extensions: { figmaStyle: t.style, usage: t.count }
      });
    }
    files["tokens.json"] = JSON.stringify(dtcg, null, 2);
    const css = [`/* Generated by DS Foundry \u2014 ${generatedAt} */`, ":root {"];
    css.push("  /* colour */");
    for (const c of inv.colors) css.push(`  --color-${cssName(c.name)}: ${rgbaCss(c.r, c.g, c.b, c.a)};`);
    css.push("", "  /* spacing */");
    for (const s of inv.spacing) css.push(`  --space-${s.value}: ${s.value}px;`);
    css.push("", "  /* radius */");
    for (const r of inv.radii) css.push(`  --${cssName(r.name)}: ${r.value >= 999 ? "9999px" : r.value + "px"};`);
    css.push("", "  /* effects */");
    for (const e of inv.effects) css.push(`  --${cssName(e.name)}: ${e.css};`);
    css.push("", "  /* typography */");
    for (const t of inv.types) {
      const n = cssName(t.name);
      css.push(`  --font-${n}: ${t.cssWeight} ${round(t.size)}px/${lineHeightCss(t.lineHeight)} "${t.family}", sans-serif;`);
      if (t.letterSpacing.value) css.push(`  --font-${n}-tracking: ${letterSpacingCss(t.letterSpacing)};`);
    }
    css.push("}", "");
    css.push("/* Utility classes for typography */");
    for (const t of inv.types) {
      const n = cssName(t.name);
      css.push(`.text-${n} { font: var(--font-${n});${t.letterSpacing.value ? ` letter-spacing: var(--font-${n}-tracking);` : ""} }`);
    }
    files["tokens.css"] = css.join("\n") + "\n";
    const tw = { theme: { extend: { colors: {}, spacing: {}, borderRadius: {}, boxShadow: {}, fontSize: {}, fontFamily: {} } } };
    for (const c of inv.colors) setDeep(tw.theme.extend.colors, c.name.split("/").map(cssName), rgbaCss(c.r, c.g, c.b, c.a));
    for (const s of inv.spacing) tw.theme.extend.spacing[String(s.value)] = `${s.value}px`;
    for (const r of inv.radii) tw.theme.extend.borderRadius[r.name.split("/")[1]] = r.value >= 999 ? "9999px" : `${r.value}px`;
    for (const e of inv.effects) if (e.name.startsWith("elevation")) tw.theme.extend.boxShadow[cssName(e.name)] = e.css;
    for (const t of inv.types) tw.theme.extend.fontSize[cssName(t.name)] = [`${round(t.size)}px`, { lineHeight: lineHeightCss(t.lineHeight), letterSpacing: letterSpacingCss(t.letterSpacing), fontWeight: String(t.cssWeight) }];
    const fams = [...new Set(inv.types.map((t) => t.family))];
    fams.forEach((f, i) => tw.theme.extend.fontFamily[i === 0 ? "sans" : cssName(f)] = [f, "sans-serif"]);
    files["tailwind.tokens.cjs"] = `/** Generated by DS Foundry \u2014 ${generatedAt}. Merge into tailwind.config.js */
module.exports = ${JSON.stringify(tw, null, 2)};
`;
    const md = [];
    md.push(`# Design system \u2014 ${inv.pages.join(", ")}`);
    md.push("", `Generated by DS Foundry on ${generatedAt.slice(0, 10)} from ${inv.nodeCount.toLocaleString()} layers (${inv.scope}).`, "");
    md.push("## What was built", "");
    md.push(`- ${result.paintStyles} colour styles, ${result.textStyles} text styles, ${result.effectStyles} effect styles`);
    md.push(`- ${result.variables} variables in the "DS Foundry / Primitives" collection`);
    md.push(`- ${result.componentSets} component sets (${result.components} variants) and ${result.icons} icon components`);
    md.push(`- ${result.labeled} layers labelled with the \`${opts.prefix}\` prefix`);
    if (result.notes.length) {
      md.push("", "### Notes", "");
      for (const n of result.notes) md.push(`- ${n}`);
    }
    md.push("", "## Colour", "", "| Token | Value | Uses |", "|---|---|---|");
    for (const c of inv.colors) md.push(`| \`${c.name}\` | \`${rgbaCss(c.r, c.g, c.b, c.a)}\` | ${c.count} |`);
    md.push("", "## Typography", "", "| Token | Font | Size | Line height | Tracking | Uses |", "|---|---|---|---|---|---|");
    for (const t of inv.types) md.push(`| \`${t.name}\` | ${t.family} ${t.style} | ${round(t.size)}px | ${lineHeightCss(t.lineHeight)} | ${letterSpacingCss(t.letterSpacing)} | ${t.count} |`);
    md.push("", "## Spacing", "", "| Token | Value | Uses |", "|---|---|---|");
    for (const s of inv.spacing) md.push(`| \`${s.name}\` | ${s.value}px | ${s.count} |`);
    md.push("", "## Radius", "", "| Token | Value | Uses |", "|---|---|---|");
    for (const r of inv.radii) md.push(`| \`${r.name}\` | ${r.value >= 999 ? "full" : r.value + "px"} | ${r.count} |`);
    md.push("", "## Effects", "", "| Token | CSS | Uses |", "|---|---|---|");
    for (const e of inv.effects) md.push(`| \`${e.name}\` | \`${e.css}\` | ${e.count} |`);
    md.push("", "## Elements found", "", "| Category | Count |", "|---|---|");
    const counts = /* @__PURE__ */ new Map();
    for (const e of inv.elements) counts.set(e.category, (counts.get(e.category) || 0) + 1);
    counts.set("icon", inv.icons.length);
    for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) md.push(`| ${k} | ${v} |`);
    if (inv.components.length) {
      md.push("", "## Components already in use", "", "| Component | Instances | Source |", "|---|---|---|");
      for (const c of inv.components.slice(0, 80)) md.push(`| ${c.name} | ${c.count} | ${c.remote ? "library" : "local"} |`);
    }
    if (inv.missingFonts.length) md.push("", `> Missing fonts: ${inv.missingFonts.join(", ")} \u2014 text styles for these were skipped.`);
    files["DESIGN_SYSTEM.md"] = md.join("\n") + "\n";
    files["inventory.json"] = JSON.stringify({
      source,
      elements: inv.elements.map((e) => ({ id: e.id, page: e.page, category: e.category, name: e.name, text: e.text, w: round(e.w), h: round(e.h), fillRole: e.fillRole, size: e.sizeClass, inInstance: e.inInstance })),
      icons: inv.icons.map((e) => ({ id: e.id, page: e.page, name: e.name, w: round(e.w), h: round(e.h) })),
      components: inv.components,
      fonts: inv.fonts
    }, null, 2);
    return files;
  }

  // src/build.ts
  var UI_FONT = { family: "Inter", style: "Regular" };
  var UI_BOLD = { family: "Inter", style: "Semi Bold" };
  var fontOk = /* @__PURE__ */ new Map();
  async function loadFont(f) {
    const k = `${f.family}|${f.style}`;
    if (fontOk.has(k)) return fontOk.get(k);
    try {
      await figma.loadFontAsync(f);
      fontOk.set(k, true);
      return true;
    } catch {
      fontOk.set(k, false);
      return false;
    }
  }
  var INK = { r: 0.09, g: 0.09, b: 0.11 };
  var MUTED = { r: 0.45, g: 0.46, b: 0.5 };
  var PAPER = { r: 1, g: 1, b: 1 };
  var HAIR = { r: 0.9, g: 0.9, b: 0.92 };
  var CANVAS = { r: 0.965, g: 0.965, b: 0.97 };
  async function mkText(chars, o = {}) {
    const t = figma.createText();
    let f = o.font || (o.bold ? UI_BOLD : UI_FONT);
    if (!await loadFont(f)) {
      f = UI_FONT;
      await loadFont(f);
    }
    t.fontName = f;
    t.characters = chars;
    t.fontSize = o.size ?? 12;
    t.fills = [{ type: "SOLID", color: o.color || INK }];
    t.textAutoResize = "WIDTH_AND_HEIGHT";
    return t;
  }
  function mkFrame(name, o = {}) {
    const f = figma.createFrame();
    f.name = name;
    f.layoutMode = o.dir === "H" ? "HORIZONTAL" : "VERTICAL";
    const pad = o.pad ?? 0;
    const [px, py] = Array.isArray(pad) ? pad : [pad, pad];
    f.paddingLeft = f.paddingRight = px;
    f.paddingTop = f.paddingBottom = py;
    f.itemSpacing = o.gap ?? 0;
    f.counterAxisAlignItems = o.align || "MIN";
    f.fills = o.fill === null || o.fill === void 0 ? [] : [{ type: "SOLID", color: o.fill }];
    if (o.stroke) {
      f.strokes = [{ type: "SOLID", color: o.stroke }];
      f.strokeWeight = 1;
    }
    if (o.radius) f.cornerRadius = o.radius;
    f.clipsContent = false;
    if (o.wrap) {
      f.layoutWrap = "WRAP";
      f.counterAxisSpacing = o.gap ?? 0;
      f.primaryAxisSizingMode = "FIXED";
      f.counterAxisSizingMode = "AUTO";
      f.resize(o.w ?? 1200, 100);
    } else {
      f.primaryAxisSizingMode = "AUTO";
      f.counterAxisSizingMode = "AUTO";
      if (o.w) {
        f.counterAxisSizingMode = "FIXED";
        f.resize(o.w, 100);
      }
    }
    return f;
  }
  function mkRect(w, h, fill, o = {}) {
    const r = figma.createRectangle();
    r.resize(w, h);
    r.fills = [{ type: "SOLID", color: fill, opacity: o.opacity ?? 1 }];
    if (o.radius !== void 0) r.cornerRadius = o.radius;
    if (o.stroke) {
      r.strokes = [{ type: "SOLID", color: o.stroke }];
      r.strokeWeight = 1;
      r.strokeAlign = "INSIDE";
    }
    return r;
  }
  async function mkSection(title, subtitle, page, cursor) {
    const section = mkFrame(title, { dir: "V", pad: 48, gap: 28, fill: PAPER, radius: 24, stroke: HAIR });
    section.setPluginData(PD_GENERATED, "1");
    const head = mkFrame("title", { dir: "V", gap: 6 });
    head.appendChild(await mkText(title, { bold: true, size: 22 }));
    if (subtitle) head.appendChild(await mkText(subtitle, { size: 12, color: MUTED }));
    section.appendChild(head);
    const body = mkFrame("content", { dir: "V", gap: 20 });
    section.appendChild(body);
    page.appendChild(section);
    section.x = 0;
    section.y = cursor.y;
    return { section, body };
  }
  function finishSection(section, cursor) {
    cursor.y = section.y + section.height + 96;
  }
  async function getOrCreatePage(name) {
    let page = figma.root.children.find((p) => p.name === name);
    if (!page) {
      page = figma.createPage();
      page.name = name;
      return page;
    }
    await page.loadAsync();
    for (const c of [...page.children]) if (c.getPluginData(PD_GENERATED) === "1") c.remove();
    return page;
  }
  async function nodeById(id) {
    try {
      const n = await figma.getNodeByIdAsync(id);
      if (!n || n.removed || n.type === "DOCUMENT" || n.type === "PAGE") return null;
      return n;
    } catch {
      return null;
    }
  }
  function unlockSizing(n) {
    try {
      const a = n;
      const isAL = "layoutMode" in n && n.layoutMode !== "NONE";
      if ("layoutSizingHorizontal" in a && a.layoutSizingHorizontal === "FILL") a.layoutSizingHorizontal = isAL ? "HUG" : "FIXED";
      if ("layoutSizingVertical" in a && a.layoutSizingVertical === "FILL") a.layoutSizingVertical = isAL ? "HUG" : "FIXED";
      if ("layoutPositioning" in a && a.layoutPositioning === "ABSOLUTE") a.layoutPositioning = "AUTO";
    } catch {
    }
  }
  async function applyLabels(inv, opts) {
    let n = 0;
    const all = [...inv.elements, ...inv.icons, ...inv.shapes];
    for (let i = 0; i < all.length; i++) {
      if (cancelled) throw new Error("cancelled");
      const rec = all[i];
      if (rec.inInstance) continue;
      if ((rec.category === "text" || rec.category === "tagline" || rec.category === "copy") && !opts.labelText) continue;
      const node = await nodeById(rec.id);
      if (!node) continue;
      try {
        if (!node.getPluginData(PD_ORIGINAL)) node.setPluginData(PD_ORIGINAL, node.name);
        node.setPluginData(PD_CATEGORY, rec.category);
        if (opts.rename && !node.name.startsWith(opts.prefix)) node.name = elementLabel(rec, opts.prefix);
        n++;
      } catch {
      }
      if (i % 200 === 0) {
        progress(5 + i / all.length * 10, `Labelling layers\u2026 ${i}/${all.length}`);
        await tick();
      }
    }
    return n;
  }
  async function revertLabels() {
    await figma.loadAllPagesAsync();
    let n = 0;
    for (const page of figma.root.children) {
      const hits = page.findAll((x) => !!x.getPluginData(PD_ORIGINAL));
      for (const node of hits) {
        try {
          node.name = node.getPluginData(PD_ORIGINAL);
          node.setPluginData(PD_ORIGINAL, "");
          node.setPluginData(PD_CATEGORY, "");
          n++;
        } catch {
        }
      }
      await tick();
    }
    return n;
  }
  async function buildVariables(inv, opts, notes) {
    const maps = { color: /* @__PURE__ */ new Map(), space: /* @__PURE__ */ new Map(), radius: /* @__PURE__ */ new Map(), count: 0 };
    const name = "DS Foundry / Primitives";
    let col;
    try {
      const cols = await figma.variables.getLocalVariableCollectionsAsync();
      col = cols.find((c) => c.name === name) || figma.variables.createVariableCollection(name);
    } catch (e) {
      notes.push("Variables could not be created (plan limit or permissions) \u2014 colour styles were created without variable bindings.");
      return null;
    }
    const mode = col.defaultModeId;
    const existing = (await figma.variables.getLocalVariablesAsync()).filter((v) => v.variableCollectionId === col.id);
    const byName = new Map(existing.map((v) => [v.name, v]));
    const getVar = (n, type) => {
      const found = byName.get(n);
      if (found && found.resolvedType === type) return found;
      try {
        const v = figma.variables.createVariable(n, col, type);
        byName.set(n, v);
        return v;
      } catch (e) {
        return null;
      }
    };
    let failed = 0;
    for (const c of inv.colors) {
      const v = getVar(`color/${c.name}`, "COLOR");
      if (!v) {
        failed++;
        continue;
      }
      v.setValueForMode(mode, { r: c.r, g: c.g, b: c.b, a: c.a });
      try {
        v.scopes = ["ALL_FILLS", "STROKE_COLOR", "EFFECT_COLOR"];
      } catch {
      }
      maps.color.set(c.key, v);
      maps.count++;
    }
    for (const s of inv.spacing) {
      const v = getVar(s.name, "FLOAT");
      if (!v) {
        failed++;
        continue;
      }
      v.setValueForMode(mode, s.value);
      try {
        v.scopes = ["GAP", "WIDTH_HEIGHT"];
      } catch {
      }
      maps.space.set(s.value, v);
      maps.count++;
    }
    for (const r of inv.radii) {
      const v = getVar(r.name, "FLOAT");
      if (!v) {
        failed++;
        continue;
      }
      v.setValueForMode(mode, r.value >= 999 ? 9999 : r.value);
      try {
        v.scopes = ["CORNER_RADIUS"];
      } catch {
      }
      maps.radius.set(r.name, v);
      maps.count++;
    }
    if (failed) notes.push(`${failed} variables could not be created (plan limit reached?). Styles still cover every token.`);
    return maps;
  }
  async function buildStyles(inv, opts, vars, notes) {
    const maps = { paint: /* @__PURE__ */ new Map(), text: /* @__PURE__ */ new Map(), effect: /* @__PURE__ */ new Map() };
    const p = opts.prefix;
    const paints = await figma.getLocalPaintStylesAsync();
    for (const c of inv.colors) {
      const name = `${p}color/${c.name}`;
      let st = paints.find((s) => s.name === name);
      if (!st) {
        st = figma.createPaintStyle();
        st.name = name;
      }
      let paint = { type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: c.a };
      const v = vars?.color.get(c.key);
      if (v) {
        try {
          paint = figma.variables.setBoundVariableForPaint(paint, "color", v);
        } catch {
        }
      }
      st.paints = [paint];
      st.description = `${c.count} uses`;
      maps.paint.set(c.key, st);
    }
    await tick();
    const texts = await figma.getLocalTextStylesAsync();
    let skipped = 0;
    for (const t of inv.types) {
      const f = { family: t.family, style: t.style };
      if (!await loadFont(f)) {
        skipped++;
        continue;
      }
      const name = `${p}text/${t.name}`;
      let st = texts.find((s) => s.name === name);
      if (!st) {
        st = figma.createTextStyle();
        st.name = name;
      }
      try {
        st.fontName = f;
        st.fontSize = t.size;
        st.lineHeight = t.lineHeight;
        st.letterSpacing = t.letterSpacing;
        st.description = `${t.family} ${t.style} ${round(t.size)}px \xB7 ${t.count} uses`;
        maps.text.set(t.key, st);
      } catch {
        skipped++;
      }
    }
    if (skipped) notes.push(`${skipped} text styles skipped because their fonts are missing on this machine.`);
    await tick();
    const effects = await figma.getLocalEffectStylesAsync();
    for (const e of inv.effects) {
      const name = `${p}effect/${e.name}`;
      let st = effects.find((s) => s.name === name);
      if (!st) {
        st = figma.createEffectStyle();
        st.name = name;
      }
      st.effects = e.effects;
      st.description = `${e.css} \xB7 ${e.count} uses`;
      maps.effect.set(e.key, st);
    }
    return maps;
  }
  async function buildFoundations(inv, opts, styles, notes) {
    const page = await getOrCreatePage("DS \xB7 Foundations");
    const cursor = { y: 0 };
    const primary = inv.colors.find((c) => c.role === "primary") || inv.colors[0];
    const accent = primary ? { r: primary.r, g: primary.g, b: primary.b } : { r: 0.2, g: 0.3, b: 0.9 };
    if (inv.colors.length) {
      const { section, body } = await mkSection("Colour", `${inv.colors.length} colours found across ${inv.nodeCount.toLocaleString()} layers, grouped by role and ranked by lightness.`, page, cursor);
      const roles = [...new Set(inv.colors.map((c) => c.role))];
      for (const role of roles) {
        const group = mkFrame(role, { dir: "V", gap: 10 });
        group.appendChild(await mkText(role, { bold: true, size: 13 }));
        const row = mkFrame("swatches", { dir: "H", gap: 12, wrap: true, w: 1160 });
        for (const c of inv.colors.filter((x) => x.role === role)) {
          const cell = mkFrame(c.name, { dir: "V", gap: 8 });
          const sw = mkRect(132, 84, { r: c.r, g: c.g, b: c.b }, { radius: 10, opacity: c.a, stroke: HAIR });
          const st = styles?.paint.get(c.key);
          if (st) {
            try {
              await sw.setFillStyleIdAsync(st.id);
            } catch {
            }
          }
          cell.appendChild(sw);
          cell.appendChild(await mkText(c.name, { bold: true, size: 11 }));
          cell.appendChild(await mkText(`${rgbaCss(c.r, c.g, c.b, c.a)} \xB7 ${c.count}\xD7`, { size: 10, color: MUTED }));
          row.appendChild(cell);
        }
        group.appendChild(row);
        body.appendChild(group);
      }
      finishSection(section, cursor);
      await tick();
    }
    if (inv.types.length) {
      const { section, body } = await mkSection("Typography", `${inv.types.length} text styles, named by role (display \xB7 heading \xB7 title \xB7 body \xB7 caption), size and weight.`, page, cursor);
      for (const t of inv.types) {
        const row = mkFrame(t.name, { dir: "H", gap: 32, align: "CENTER" });
        const label = mkFrame("label", { dir: "V", gap: 2, w: 220 });
        label.appendChild(await mkText(t.name, { bold: true, size: 11 }));
        label.appendChild(await mkText(`${t.family} ${t.style} \xB7 ${round(t.size)}px`, { size: 10, color: MUTED }));
        row.appendChild(label);
        const f = { family: t.family, style: t.style };
        const ok = await loadFont(f);
        const specimen = await mkText(ok ? "Sphinx of black quartz, judge my vow" : `${t.family} ${t.style} is not installed`, { font: ok ? f : UI_FONT, size: Math.min(t.size, 96), color: ok ? INK : MUTED });
        if (ok) {
          try {
            specimen.lineHeight = t.lineHeight;
            specimen.letterSpacing = t.letterSpacing;
          } catch {
          }
          const st = styles?.text.get(t.key);
          if (st) {
            try {
              await specimen.setTextStyleIdAsync(st.id);
            } catch {
            }
          }
        }
        row.appendChild(specimen);
        body.appendChild(row);
      }
      finishSection(section, cursor);
      await tick();
    }
    if (inv.spacing.length) {
      const { section, body } = await mkSection("Spacing", `Auto-layout padding and gaps, snapped to a ${opts.baseGrid}px grid.`, page, cursor);
      for (const s of inv.spacing) {
        const row = mkFrame(s.name, { dir: "H", gap: 20, align: "CENTER" });
        const label = mkFrame("label", { dir: "V", w: 120 });
        label.appendChild(await mkText(s.name, { bold: true, size: 11 }));
        row.appendChild(label);
        row.appendChild(mkRect(Math.max(2, s.value), 20, accent, { radius: 3 }));
        row.appendChild(await mkText(`${s.value}px \xB7 ${s.count}\xD7`, { size: 10, color: MUTED }));
        body.appendChild(row);
      }
      finishSection(section, cursor);
    }
    if (inv.radii.length) {
      const { section, body } = await mkSection("Radius", "Corner radii in use, smallest to largest.", page, cursor);
      const row = mkFrame("radii", { dir: "H", gap: 24, wrap: true, w: 1160 });
      for (const r of inv.radii) {
        const cell = mkFrame(r.name, { dir: "V", gap: 8, align: "CENTER" });
        cell.appendChild(mkRect(88, 88, CANVAS, { radius: Math.min(r.value, 44), stroke: HAIR }));
        cell.appendChild(await mkText(r.name, { bold: true, size: 11 }));
        cell.appendChild(await mkText(r.value >= 999 ? "full" : `${r.value}px`, { size: 10, color: MUTED }));
        row.appendChild(cell);
      }
      body.appendChild(row);
      finishSection(section, cursor);
    }
    if (inv.effects.length) {
      const { section, body } = await mkSection("Elevation & blur", "Shadow and blur effects, ranked by depth.", page, cursor);
      const row = mkFrame("effects", { dir: "H", gap: 40, wrap: true, w: 1160 });
      for (const e of inv.effects) {
        const cell = mkFrame(e.name, { dir: "V", gap: 10 });
        const card = mkRect(180, 110, PAPER, { radius: 12 });
        card.effects = e.effects;
        const st = styles?.effect.get(e.key);
        if (st) {
          try {
            await card.setEffectStyleIdAsync(st.id);
          } catch {
          }
        }
        cell.appendChild(card);
        cell.appendChild(await mkText(e.name, { bold: true, size: 11 }));
        cell.appendChild(await mkText(e.css.slice(0, 60), { size: 10, color: MUTED }));
        row.appendChild(cell);
      }
      body.appendChild(row);
      body.fills = [{ type: "SOLID", color: CANVAS }];
      body.paddingLeft = body.paddingRight = body.paddingTop = body.paddingBottom = 32;
      body.cornerRadius = 16;
      finishSection(section, cursor);
    }
    return page;
  }
  var COMPONENT_ORDER = ["button", "input", "badge", "checkbox", "toggle", "avatar", "list-item", "card", "nav", "section"];
  var COMPONENT_LIMIT = { button: 14, input: 8, badge: 14, checkbox: 6, toggle: 6, avatar: 8, "list-item": 8, card: 8, nav: 4, section: 4 };
  function variantNames(recs) {
    const base = recs.map((r) => {
      const style = r.fillRole || "default";
      return `Style=${style}, Size=${r.sizeClass}`;
    });
    const dup = base.some((b, i) => base.indexOf(b) !== i);
    if (!dup) return base;
    const seen = /* @__PURE__ */ new Map();
    return base.map((b) => {
      const n = (seen.get(b) || 0) + 1;
      seen.set(b, n);
      return `${b}, Alt=${n}`;
    });
  }
  async function buildComponents(inv, opts, notes) {
    const page = await getOrCreatePage("DS \xB7 Components");
    const cursor = { y: 0 };
    let sets = 0, comps = 0;
    for (const cat of COMPONENT_ORDER) {
      if (cancelled) throw new Error("cancelled");
      const pool = inv.elements.filter((e) => e.category === cat && !e.inInstance);
      if (!pool.length) continue;
      const seen = /* @__PURE__ */ new Set();
      const picks = [];
      for (const r of pool) {
        if (seen.has(r.fingerprint)) continue;
        seen.add(r.fingerprint);
        picks.push(r);
        if (picks.length >= (COMPONENT_LIMIT[cat] || 6)) break;
      }
      progress(60, `Building ${cat} components\u2026`);
      await tick();
      const { section, body } = await mkSection(`${cat[0].toUpperCase()}${cat.slice(1)}`, `${pool.length} found \xB7 ${picks.length} distinct variant${picks.length === 1 ? "" : "s"} promoted to components.`, page, cursor);
      const stage = mkFrame("stage", { dir: "H", gap: 40, wrap: true, w: 1160, align: "MIN" });
      body.appendChild(stage);
      const made = [];
      const names = variantNames(picks);
      for (let i = 0; i < picks.length; i++) {
        const src = await nodeById(picks[i].id);
        if (!src) continue;
        let clone;
        try {
          clone = src.clone();
        } catch {
          continue;
        }
        try {
          stage.appendChild(clone);
          unlockSizing(clone);
          const comp = figma.createComponentFromNode(clone);
          comp.name = names[i];
          comp.description = `From "${picks[i].name}" on page "${picks[i].page}"${picks[i].text ? ` \u2014 "${picks[i].text}"` : ""}`;
          comp.setPluginData(PD_GENERATED, "1");
          made.push(comp);
        } catch {
          try {
            clone.remove();
          } catch {
          }
        }
      }
      if (!made.length) {
        section.remove();
        continue;
      }
      comps += made.length;
      if (made.length === 1) {
        made[0].name = `${opts.prefix}${cat}`;
      } else {
        try {
          const set = figma.combineAsVariants(made, stage);
          set.name = `${opts.prefix}${cat}`;
          set.description = `Auto-generated by DS Foundry. Variants were sampled from distinct ${cat} instances in the file.`;
          set.setPluginData(PD_GENERATED, "1");
          set.layoutMode = "HORIZONTAL";
          set.layoutWrap = "WRAP";
          set.itemSpacing = 24;
          set.counterAxisSpacing = 24;
          set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = 24;
          set.primaryAxisSizingMode = "FIXED";
          set.counterAxisSizingMode = "AUTO";
          set.resize(1100, set.height);
        } catch (e) {
          notes.push(`Could not combine ${cat} into a variant set; components were left as individual components.`);
          made.forEach((m, i) => m.name = `${opts.prefix}${cat}/${i + 1}`);
        }
      }
      sets++;
      finishSection(section, cursor);
    }
    if (inv.components.length) {
      progress(70, "Placing existing components\u2026");
      await tick();
      const { section, body } = await mkSection("Components already in use", `${inv.components.length} components referenced by instances in the scanned scope. Library components are shown for reference.`, page, cursor);
      const stage = mkFrame("gallery", { dir: "H", gap: 32, wrap: true, w: 1160 });
      body.appendChild(stage);
      let placed = 0;
      for (const ref of inv.components.slice(0, 60)) {
        try {
          const n = await figma.getNodeByIdAsync(ref.id);
          if (!n) continue;
          const comp = n.type === "COMPONENT_SET" ? n.defaultVariant : n.type === "COMPONENT" ? n : null;
          if (!comp) continue;
          const cell = mkFrame(ref.name, { dir: "V", gap: 8 });
          const inst = comp.createInstance();
          cell.appendChild(inst);
          unlockSizing(inst);
          cell.appendChild(await mkText(`${ref.name} \xB7 ${ref.count}\xD7 ${ref.remote ? "\xB7 library" : ""}`, { size: 10, color: MUTED }));
          stage.appendChild(cell);
          placed++;
        } catch {
        }
      }
      if (!placed) section.remove();
      else finishSection(section, cursor);
    }
    return { page, sets, comps };
  }
  async function buildIcons(inv, opts, notes) {
    const page = await getOrCreatePage("DS \xB7 Icons");
    const cursor = { y: 0 };
    const seen = /* @__PURE__ */ new Set();
    const picks = [];
    for (const r of inv.icons) {
      if (r.inInstance || seen.has(r.fingerprint)) continue;
      seen.add(r.fingerprint);
      picks.push(r);
      if (picks.length >= 240) break;
    }
    if (!picks.length) return { page, count: 0 };
    const { section, body } = await mkSection("Icons", `${inv.icons.length} icon-like vectors found \xB7 ${picks.length} unique, each promoted to a component on a square frame.`, page, cursor);
    const grid = mkFrame("grid", { dir: "H", gap: 20, wrap: true, w: 1160 });
    body.appendChild(grid);
    const usedNames = /* @__PURE__ */ new Set();
    let count = 0;
    for (let i = 0; i < picks.length; i++) {
      if (cancelled) throw new Error("cancelled");
      const rec = picks[i];
      const src = await nodeById(rec.id);
      if (!src) continue;
      let clone;
      try {
        clone = src.clone();
      } catch {
        continue;
      }
      try {
        const size = Math.max(16, Math.ceil(Math.max(clone.width, clone.height) / 4) * 4);
        const cell = mkFrame(rec.name, { dir: "V", gap: 6, align: "CENTER" });
        grid.appendChild(cell);
        const box = figma.createFrame();
        box.resize(size, size);
        box.fills = [];
        box.clipsContent = false;
        cell.appendChild(box);
        box.appendChild(clone);
        unlockSizing(clone);
        clone.x = (size - clone.width) / 2;
        clone.y = (size - clone.height) / 2;
        const comp = figma.createComponentFromNode(box);
        let name = `${opts.prefix}icon/${slug(rec.name)}`;
        let n = 2;
        while (usedNames.has(name)) name = `${opts.prefix}icon/${slug(rec.name)}-${n++}`;
        usedNames.add(name);
        comp.name = name;
        comp.description = `${size}\xD7${size} \xB7 from page "${rec.page}"`;
        comp.setPluginData(PD_GENERATED, "1");
        cell.appendChild(await mkText(slug(rec.name).slice(0, 18), { size: 9, color: MUTED }));
        count++;
      } catch {
        try {
          clone.remove();
        } catch {
        }
      }
      if (i % 25 === 0) {
        progress(75 + i / picks.length * 15, `Icons\u2026 ${i}/${picks.length}`);
        await tick();
      }
    }
    finishSection(section, cursor);
    return { page, count };
  }
  var ASSET_SECTIONS = [
    { key: "logos", title: "Logos", cats: ["logo"], cap: 40, kind: "vector" },
    { key: "characters", title: "Characters", cats: ["character"], cap: 60, kind: "vector" },
    { key: "illustrations", title: "Illustrations", cats: ["illustration"], cap: 60, kind: "vector" },
    { key: "symbols", title: "Symbols & ornaments", cats: ["symbol"], cap: 80, kind: "vector" },
    { key: "icons", title: "Icons", cats: ["icon"], cap: 240, kind: "vector" },
    { key: "buttons", title: "Buttons & badges", cats: ["button", "badge"], cap: 40, kind: "vector" },
    { key: "taglines", title: "Taglines", cats: ["tagline"], cap: 80, kind: "text" },
    { key: "copy", title: "Copy", cats: ["copy"], cap: 40, kind: "text" },
    { key: "vectors", title: "Vectors & shapes", cats: ["shape"], cap: 120, kind: "vector" },
    { key: "debris", title: "Debris", cats: ["debris"], cap: 300, kind: "list" }
  ];
  function stripPrefix(name, prefix) {
    return prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name;
  }
  async function buildAssets(inv, opts, notes) {
    const page = await getOrCreatePage("DS \xB7 Assets");
    const cursor = { y: 0 };
    let count = 0;
    const pool = [...inv.elements, ...inv.icons, ...inv.shapes].filter((r) => !r.inInstance);
    const resolved = [];
    for (let i = 0; i < pool.length; i++) {
      if (cancelled) throw new Error("cancelled");
      const rec = pool[i];
      const node = await nodeById(rec.id);
      if (!node) continue;
      const pd = node.getPluginData(PD_CATEGORY);
      resolved.push({ rec, node, cat: pd || rec.category });
      if (i % 300 === 0) {
        progress(80 + i / pool.length * 6, `Sorting assets\u2026 ${i}/${pool.length}`);
        await tick();
      }
    }
    const intro = await mkSection("Assets", `Every logo, character, illustration, symbol, icon, button, tagline, copy block and vector in the scanned scope, grouped by class and named. Debris is listed so it can be selected and deleted from the plugin.`, page, cursor);
    intro.section.name = "Assets \xB7 index";
    const idx = mkFrame("index", { dir: "H", gap: 24, wrap: true, w: 1160 });
    for (const sec of ASSET_SECTIONS) {
      const n = resolved.filter((r) => sec.cats.includes(r.cat)).length;
      idx.appendChild(await mkText(`${sec.title} \xB7 ${n}`, { size: 12, color: n ? INK : MUTED }));
    }
    intro.body.appendChild(idx);
    finishSection(intro.section, cursor);
    for (const sec of ASSET_SECTIONS) {
      if (cancelled) throw new Error("cancelled");
      let items = resolved.filter((r) => sec.cats.includes(r.cat));
      if (!items.length) continue;
      const seen = /* @__PURE__ */ new Map();
      for (const it of items) {
        const k = sec.kind === "text" ? `${it.cat}|${it.rec.text.slice(0, 80)}` : `${it.cat}|${it.node.name}|${it.rec.fingerprint}`;
        const g = seen.get(k);
        if (g) g.n++;
        else seen.set(k, { ...it, n: 1 });
      }
      const distinct = [...seen.values()].sort((a, b) => a.node.name.localeCompare(b.node.name)).slice(0, sec.cap);
      progress(86, `Assets \xB7 ${sec.title}\u2026`);
      await tick();
      const { section, body } = await mkSection(sec.title, `${items.length} found \xB7 ${distinct.length} distinct${items.length > sec.cap ? ` \xB7 showing ${sec.cap}` : ""}`, page, cursor);
      section.name = `Assets \xB7 ${sec.title}`;
      if (sec.kind === "list") {
        const col = mkFrame("list", { dir: "V", gap: 4 });
        for (const d of distinct) {
          col.appendChild(await mkText(`${stripPrefix(d.node.name, opts.prefix)} \xB7 ${Math.round(d.rec.w)}\xD7${Math.round(d.rec.h)} \xB7 ${d.rec.page}${d.n > 1 ? ` \xB7 \xD7${d.n}` : ""}`, { size: 10, color: MUTED }));
        }
        body.appendChild(col);
        body.appendChild(await mkText(`Tip: in the plugin's Elements tab, "Select debris" selects these on the current page so you can delete them.`, { size: 10, color: MUTED }));
        finishSection(section, cursor);
        continue;
      }
      const grid = mkFrame("grid", { dir: "H", gap: 24, wrap: true, w: 1160, align: "MIN" });
      body.appendChild(grid);
      for (const d of distinct) {
        let clone;
        try {
          clone = d.node.clone();
        } catch {
          continue;
        }
        try {
          const cell = mkFrame(stripPrefix(d.node.name, opts.prefix), { dir: "V", gap: 8, align: "MIN" });
          grid.appendChild(cell);
          if (sec.kind === "text") {
            cell.appendChild(clone);
            unlockSizing(clone);
            const t = clone;
            try {
              if (t.width > 320) {
                t.textAutoResize = "HEIGHT";
                t.resize(320, t.height);
              }
            } catch {
            }
          } else {
            const w = Math.max(24, Math.ceil(clone.width)), h = Math.max(24, Math.ceil(clone.height));
            const box = figma.createFrame();
            box.resize(Math.min(w, 480), Math.min(h, 480));
            box.fills = [];
            box.clipsContent = w > 480 || h > 480;
            cell.appendChild(box);
            box.appendChild(clone);
            unlockSizing(clone);
            if (w > 480 || h > 480) {
              const sc = Math.min(480 / w, 480 / h);
              try {
                clone.rescale(sc);
              } catch {
              }
            }
            clone.x = 0;
            clone.y = 0;
            if (["logos", "characters", "illustrations", "symbols", "icons", "vectors"].includes(sec.key)) {
              const comp = figma.createComponentFromNode(box);
              comp.name = d.node.name.startsWith(opts.prefix) ? d.node.name : `${opts.prefix}${d.cat}/${slug(d.node.name)}`;
              comp.description = `${d.cat} \xB7 ${Math.round(d.rec.w)}\xD7${Math.round(d.rec.h)} \xB7 from "${d.rec.page}"`;
              comp.setPluginData(PD_GENERATED, "1");
            }
          }
          cell.appendChild(await mkText(stripPrefix(d.node.name, opts.prefix), { bold: true, size: 10 }));
          cell.appendChild(await mkText(`${Math.round(d.rec.w)}\xD7${Math.round(d.rec.h)}${d.n > 1 ? ` \xB7 \xD7${d.n}` : ""}`, { size: 9, color: MUTED }));
          count++;
        } catch {
          try {
            clone.remove();
          } catch {
          }
        }
      }
      finishSection(section, cursor);
    }
    if (!count) notes.push("No assets were found for the contact sheet.");
    return { page, count };
  }
  async function tidyScreens(inv) {
    let moved = 0;
    for (const pid of inv.pageIds) {
      const page = await figma.getNodeByIdAsync(pid);
      if (!page) continue;
      await page.loadAsync();
      const frames = page.children.filter((c) => (c.type === "FRAME" || c.type === "COMPONENT" || c.type === "COMPONENT_SET") && c.getPluginData(PD_GENERATED) !== "1" && !c.locked);
      if (frames.length < 2) continue;
      const cls = (w) => w < 520 ? 0 : w < 1024 ? 1 : 2;
      const groups = [[], [], []];
      for (const f of frames) groups[cls(f.width)].push(f);
      let y = Math.min(...frames.map((f) => f.y));
      const x0 = Math.min(...frames.map((f) => f.x));
      for (const g of groups) {
        if (!g.length) continue;
        g.sort((a, b) => a.name.localeCompare(b.name));
        let x = x0, rowH = 0;
        for (const f of g) {
          if (x - x0 + f.width > 6e3 && x > x0) {
            x = x0;
            y += rowH + 160;
            rowH = 0;
          }
          f.x = x;
          f.y = y;
          x += f.width + 120;
          rowH = Math.max(rowH, f.height);
          moved++;
        }
        y += rowH + 240;
      }
      await tick();
    }
    return moved;
  }
  async function build(inv, opts) {
    const notes = [];
    const res = { paintStyles: 0, textStyles: 0, effectStyles: 0, variables: 0, labeled: 0, componentSets: 0, components: 0, icons: 0, assets: 0, pages: [], notes };
    await loadFont(UI_FONT);
    await loadFont(UI_BOLD);
    if (opts.labels) {
      progress(5, "Labelling layers\u2026");
      res.labeled = await applyLabels(inv, opts);
    }
    let vars = null;
    if (opts.variables) {
      progress(18, "Creating variables\u2026");
      await tick();
      vars = await buildVariables(inv, opts, notes);
      res.variables = vars?.count || 0;
    }
    let styles = null;
    if (opts.styles) {
      progress(28, "Creating styles\u2026");
      await tick();
      styles = await buildStyles(inv, opts, vars, notes);
      res.paintStyles = styles.paint.size;
      res.textStyles = styles.text.size;
      res.effectStyles = styles.effect.size;
    }
    let firstPage = null;
    if (opts.foundations) {
      progress(40, "Drawing foundations page\u2026");
      await tick();
      const p = await buildFoundations(inv, opts, styles, notes);
      res.pages.push(p.name);
      firstPage = firstPage || p;
    }
    if (opts.components) {
      progress(58, "Building components\u2026");
      await tick();
      const r = await buildComponents(inv, opts, notes);
      res.componentSets = r.sets;
      res.components = r.comps;
      res.pages.push(r.page.name);
      firstPage = firstPage || r.page;
    }
    if (opts.icons) {
      progress(74, "Building icons\u2026");
      await tick();
      const r = await buildIcons(inv, opts, notes);
      res.icons = r.count;
      if (r.count) res.pages.push(r.page.name);
      else {
        try {
          if (r.page.children.length === 0) r.page.remove();
        } catch {
        }
      }
      firstPage = firstPage || (r.count ? r.page : null);
    }
    if (opts.assets) {
      progress(80, "Building assets contact sheet\u2026");
      await tick();
      const r = await buildAssets(inv, opts, notes);
      res.assets = r.count;
      if (r.count) res.pages.push(r.page.name);
      else {
        try {
          if (r.page.children.length === 0) r.page.remove();
        } catch {
        }
      }
      firstPage = firstPage || (r.count ? r.page : null);
    }
    if (opts.tidy) {
      progress(92, "Tidying screens\u2026");
      await tick();
      const moved = await tidyScreens(inv);
      notes.push(`${moved} top-level frames arranged by device width.`);
    }
    progress(96, "Writing token files\u2026");
    await tick();
    const files = buildTokenFiles(inv, opts, res);
    if (firstPage) {
      try {
        await figma.setCurrentPageAsync(firstPage);
        figma.viewport.scrollAndZoomIntoView(firstPage.children);
      } catch {
      }
    }
    progress(100, "Done");
    return { ...res, files };
  }

  // src/ai.ts
  var KEY_STORAGE = { anthropic: "dsf.anthropicKey", gemini: "dsf.geminiKey", proxy: "dsf.proxyKey", proxyUrl: "dsf.proxyUrl" };
  async function getApiKeys() {
    const out = { anthropic: "", gemini: "", proxy: "", proxyUrl: "" };
    for (const k of Object.keys(KEY_STORAGE)) {
      try {
        out[k] = await figma.clientStorage.getAsync(KEY_STORAGE[k]) || "";
      } catch {
      }
    }
    return out;
  }
  async function setApiKey(provider, key) {
    const slot = KEY_STORAGE[provider];
    if (!slot) return;
    try {
      await figma.clientStorage.setAsync(slot, key || "");
    } catch {
    }
  }
  function pickDistinct(list, limit) {
    const groups = /* @__PURE__ */ new Map();
    for (const r of list) {
      if (r.inInstance) continue;
      const g = groups.get(r.fingerprint);
      if (g) g.ids.push(r.id);
      else groups.set(r.fingerprint, { rec: r, ids: [r.id] });
    }
    return [...groups.values()].slice(0, limit);
  }
  async function exportPng(node, target) {
    try {
      if (node.width < 1 || node.height < 1) return null;
      const constraint = node.width >= node.height ? { type: "WIDTH", value: target } : { type: "HEIGHT", value: target };
      return await node.exportAsync({ format: "PNG", constraint, useAbsoluteBounds: true });
    } catch {
      return null;
    }
  }
  async function prepareAiItems(inv, targets, maxItems) {
    const plan = [];
    const cap = (n) => Math.max(0, Math.min(n, maxItems - plan.length));
    if (targets.icons) {
      for (const g of pickDistinct(inv.icons, cap(400))) plan.push({ rec: g.rec, ids: g.ids, category: "icon", name: g.rec.name, text: "", page: g.rec.page, size: 256, nodeId: g.rec.id });
      for (const g of pickDistinct(inv.elements.filter((e) => e.category === "symbol"), cap(200))) plan.push({ rec: g.rec, ids: g.ids, category: "symbol", name: g.rec.name, text: "", page: g.rec.page, size: 320, nodeId: g.rec.id });
    }
    if (targets.art) for (const g of pickDistinct(inv.elements.filter((e) => e.category === "logo" || e.category === "character" || e.category === "illustration"), cap(200))) plan.push({ rec: g.rec, ids: g.ids, category: g.rec.category, name: g.rec.name, text: g.rec.text, page: g.rec.page, size: 384, nodeId: g.rec.id });
    if (targets.text) for (const g of pickDistinct(inv.elements.filter((e) => e.category === "tagline" || e.category === "copy"), cap(200))) plan.push({ rec: g.rec, ids: g.ids, category: g.rec.category, name: g.rec.name, text: g.rec.text, page: g.rec.page, size: 320, nodeId: g.rec.id });
    if (targets.images) for (const g of pickDistinct(inv.elements.filter((e) => e.category === "image" || e.category === "avatar"), cap(200))) plan.push({ rec: g.rec, ids: g.ids, category: g.rec.category, name: g.rec.name, text: "", page: g.rec.page, size: 384, nodeId: g.rec.id });
    if (targets.screens) for (const g of pickDistinct(inv.elements.filter((e) => e.category === "screen" || e.category === "section" || e.category === "nav"), cap(200))) plan.push({ rec: g.rec, ids: g.ids, category: g.rec.category, name: g.rec.name, text: g.rec.text, page: g.rec.page, size: 384, nodeId: g.rec.id });
    if (targets.cards) for (const g of pickDistinct(inv.elements.filter((e) => e.category === "card" || e.category === "list-item"), cap(200))) plan.push({ rec: g.rec, ids: g.ids, category: g.rec.category, name: g.rec.name, text: g.rec.text, page: g.rec.page, size: 384, nodeId: g.rec.id });
    if (targets.components) {
      for (const c of inv.components.filter((x) => !x.remote).slice(0, cap(200))) {
        plan.push({ rec: null, ids: [c.id], category: "component", name: c.name, text: "", page: "", size: 384, nodeId: c.id });
      }
    }
    if (targets.shapes) for (const g of pickDistinct(inv.shapes, cap(200))) plan.push({ rec: g.rec, ids: g.ids, category: "shape", name: g.rec.name, text: "", page: g.rec.page, size: 256, nodeId: g.rec.id });
    let chunk = [];
    let sent = 0;
    for (let i = 0; i < plan.length; i++) {
      if (cancelled) throw new Error("cancelled");
      const p = plan[i];
      let node = null;
      try {
        const n = await figma.getNodeByIdAsync(p.nodeId);
        if (n && !n.removed && n.type !== "DOCUMENT" && n.type !== "PAGE") node = n;
      } catch {
        node = null;
      }
      if (!node) continue;
      const exportNode = node.type === "COMPONENT_SET" ? node.defaultVariant : node;
      const png = await exportPng(exportNode, p.size);
      if (!png) continue;
      chunk.push({ key: p.rec ? p.rec.fingerprint : p.nodeId, ids: p.ids, category: p.category, name: p.name, desc: p.rec ? p.rec.desc : "", text: p.text, w: Math.round(node.width), h: Math.round(node.height), page: p.page, png });
      sent++;
      if (chunk.length >= 6 || i === plan.length - 1) {
        post({ type: "ai_items", items: chunk, sent, total: plan.length });
        chunk = [];
        await tick();
      }
    }
    post({ type: "ai_items", items: [], sent, total: plan.length, done: true });
    return sent;
  }
  var PATH_FOR = {
    icon: "icon",
    symbol: "symbol",
    logo: "logo",
    character: "character",
    illustration: "illustration",
    image: "image",
    avatar: "avatar",
    screen: "screen",
    section: "section",
    nav: "nav",
    card: "card",
    "list-item": "list-item",
    button: "button",
    badge: "badge",
    tagline: "tagline",
    copy: "copy",
    shape: "shape",
    debris: "debris",
    component: ""
  };
  async function applyAiNames(renames, prefix, usePrefix) {
    let n = 0;
    for (let i = 0; i < renames.length; i++) {
      if (cancelled) throw new Error("cancelled");
      const r = renames[i];
      const clean = slug(r.name, 40);
      if (!clean) continue;
      const cat = r.kind && PATH_FOR[r.kind] !== void 0 ? r.kind : r.category;
      const path = PATH_FOR[cat] ?? cat;
      const finalName = usePrefix ? `${prefix}${path ? path + "/" : ""}${clean}` : clean;
      for (const id of r.ids) {
        try {
          const node = await figma.getNodeByIdAsync(id);
          if (!node || node.removed || node.type === "DOCUMENT" || node.type === "PAGE") continue;
          if (node.type === "COMPONENT" && node.parent && node.parent.type === "COMPONENT_SET") continue;
          if (!node.getPluginData(PD_ORIGINAL)) node.setPluginData(PD_ORIGINAL, node.name);
          node.setPluginData(PD_CATEGORY, cat);
          node.name = finalName;
          n++;
        } catch {
        }
      }
      if (i % 25 === 0) {
        post({ type: "progress", pct: Math.round(i / renames.length * 100), msg: `Renaming\u2026 ${i}/${renames.length}` });
        await tick();
      }
    }
    return n;
  }

  // src/code.ts
  figma.showUI(__html__, { width: 440, height: 680, themeColors: true });
  var inventory = null;
  var busy = false;
  function summarize(inv, prefix) {
    const elements = {};
    for (const e of inv.elements) {
      const slot = elements[e.category] = elements[e.category] || { count: 0, samples: [] };
      slot.count++;
      if (slot.samples.length < 6) {
        const label = elementLabel(e, prefix);
        if (!slot.samples.includes(label)) slot.samples.push(label);
      }
    }
    const iconSamples = [];
    for (const i of inv.icons) {
      const l = elementLabel(i, prefix);
      if (iconSamples.length < 8 && !iconSamples.includes(l)) iconSamples.push(l);
    }
    return {
      scope: inv.scope,
      pages: inv.pages,
      nodeCount: inv.nodeCount,
      colors: inv.colors.map((c) => ({ hex: rgbaCss(c.r, c.g, c.b, c.a), a: c.a, name: c.name, count: c.count, role: c.role })),
      types: inv.types.map((t) => ({ name: t.name, family: t.family, style: t.style, size: round(t.size), count: t.count })),
      spacing: inv.spacing.map((s) => ({ name: s.name, value: s.value, count: s.count })),
      radii: inv.radii.map((r) => ({ name: r.name, value: r.value, count: r.count })),
      effects: inv.effects.map((e) => ({ name: e.name, css: e.css, count: e.count })),
      elements,
      icons: { count: inv.icons.length, samples: iconSamples },
      shapes: { count: inv.shapes.length, samples: inv.shapes.slice(0, 8).map((r) => elementLabel(r, prefix)) },
      debris: inv.elements.filter((e) => e.category === "debris").length,
      components: inv.components.slice(0, 40).map((c) => ({ name: c.name, remote: c.remote, count: c.count })),
      fonts: inv.fonts.map((f) => `${f.family} ${f.style}`),
      missingFonts: inv.missingFonts
    };
  }
  figma.ui.onmessage = async (msg) => {
    try {
      if (msg.type === "cancel") {
        setCancelled(true);
        return;
      }
      if (msg.type === "scan") {
        if (busy) return;
        busy = true;
        setCancelled(false);
        const scope = msg.scope;
        if (scope === "selection" && figma.currentPage.selection.length === 0) {
          post({ type: "error", msg: "Select one or more frames first, or switch the scope to Page or Document." });
          busy = false;
          return;
        }
        post({ type: "progress", pct: 2, msg: "Loading pages\u2026" });
        inventory = await scan(scope, msg.baseGrid || 4);
        post({ type: "scanned", summary: summarize(inventory, msg.prefix || "ds/") });
        busy = false;
        return;
      }
      if (msg.type === "relabel") {
        if (inventory) post({ type: "scanned", summary: summarize(inventory, msg.prefix || "ds/") });
        return;
      }
      if (msg.type === "build") {
        if (busy) return;
        if (!inventory) {
          post({ type: "error", msg: "Scan the file first." });
          return;
        }
        busy = true;
        setCancelled(false);
        const opts = msg.options;
        const result = await build(inventory, opts);
        post({ type: "built", result });
        figma.notify(`DS Foundry: ${result.paintStyles + result.textStyles + result.effectStyles} styles \xB7 ${result.variables} variables \xB7 ${result.componentSets} component sets \xB7 ${result.icons} icons`);
        busy = false;
        return;
      }
      if (msg.type === "revert") {
        if (busy) return;
        busy = true;
        const n = await revertLabels();
        post({ type: "reverted", count: n });
        figma.notify(`Restored ${n} layer names`);
        busy = false;
        return;
      }
      if (msg.type === "ai_key_get") {
        post({ type: "ai_keys", keys: await getApiKeys() });
        return;
      }
      if (msg.type === "ai_key_set") {
        await setApiKey(msg.provider, msg.key || "");
        return;
      }
      if (msg.type === "ai_prepare") {
        if (busy) return;
        if (!inventory) {
          post({ type: "error", msg: "Scan the file first." });
          return;
        }
        busy = true;
        setCancelled(false);
        await prepareAiItems(inventory, msg.targets, msg.maxItems || 300);
        busy = false;
        return;
      }
      if (msg.type === "ai_apply") {
        if (busy) return;
        busy = true;
        setCancelled(false);
        const n = await applyAiNames(msg.renames || [], msg.prefix || "ds/", !!msg.usePrefix);
        post({ type: "ai_applied", count: n });
        figma.notify(`Renamed ${n} layers`);
        busy = false;
        return;
      }
      if (msg.type === "select") {
        if (!inventory) return;
        const cat = msg.category;
        const here = figma.currentPage.name;
        const recs = [...inventory.elements, ...inventory.icons, ...inventory.shapes].filter((r) => r.category === cat && !r.inInstance);
        const onPage = recs.filter((r) => r.page === here);
        const nodes = [];
        for (const r of onPage) {
          const n = await figma.getNodeByIdAsync(r.id);
          if (n && !n.removed && n.type !== "PAGE" && n.type !== "DOCUMENT") nodes.push(n);
        }
        figma.currentPage.selection = nodes;
        if (nodes.length) figma.viewport.scrollAndZoomIntoView(nodes);
        figma.notify(nodes.length ? `Selected ${nodes.length} ${cat} layer${nodes.length === 1 ? "" : "s"} on this page` : `No ${cat} on this page${recs.length ? ` (${recs.length} on other pages)` : ""}`);
        return;
      }
      if (msg.type === "resize") {
        figma.ui.resize(440, Math.max(480, Math.min(900, msg.height | 0)));
        return;
      }
      if (msg.type === "close") {
        figma.closePlugin();
        return;
      }
    } catch (e) {
      busy = false;
      const m = String(e && e.message ? e.message : e);
      if (m === "cancelled") post({ type: "error", msg: "Stopped. Nothing else was changed." });
      else post({ type: "error", msg: m });
    }
  };
})();
