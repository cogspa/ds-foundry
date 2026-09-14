"use strict";
(() => {
  // src/asset-names.ts
  var APPEARANCE_FIELDS = ["color", "pose", "crop", "treatment", "orientation"];
  var clean = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  function normalizeAssetName(value) {
    if (!value || typeof value !== "object") return null;
    const v = value, identity = clean(v.identity).slice(0, 40);
    if (!identity) return null;
    const appearance = {};
    for (const k of APPEARANCE_FIELDS) {
      const s = clean(v.appearance?.[k]).slice(0, 30);
      if (s) appearance[k] = s;
    }
    return { identity, appearance };
  }
  function assetName(value) {
    return [value.identity, ...APPEARANCE_FIELDS.map((k) => value.appearance[k]).filter(Boolean)].join("-");
  }
  function readAssetName(node) {
    try {
      return normalizeAssetName(JSON.parse(node.getPluginData("dsf.assetName")));
    } catch {
      return null;
    }
  }

  // src/util.ts
  var PD_ASSET_ID = "dsf.assetId";
  var PD_ASSET_VARIANT = "dsf.assetVariant";
  var PD_ASSET_CONFIDENCE = "dsf.assetConfidence";
  var PD_ASSET_PROJECT = "dsf.assetProject";
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
      return `${e.type}:${"radius" in e ? round(e.radius) : JSON.stringify(e)}`;
    }).join("|");
  }
  function snap(v, grid) {
    if (grid <= 1) return Math.round(v);
    return Math.max(0, Math.round(v / grid) * grid);
  }

  // src/identity.ts
  var q = (v) => Math.round(v * 1e4) / 1e4;
  function identityHash(s) {
    let a = 2166136261, b = 5381;
    for (let i = 0; i < s.length; i++) {
      a = Math.imul(a ^ s.charCodeAt(i), 16777619);
      b = Math.imul(b, 33) ^ s.charCodeAt(i);
    }
    return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
  }
  function normalizeVisibleText(s) {
    return s.normalize("NFKC").toLowerCase().replace(/[™®©]/g, "").replace(/[‐‑–—-]/g, " ").replace(/\s+/g, " ").trim();
  }
  var CTA = /^(learn more|read more|buy now|shop now|click here|sign up|log in|get started|submit|next|back|download|continue)$/;
  function identityText(s) {
    const t = normalizeVisibleText(s);
    return t.length >= 2 && t.length <= 120 && !CTA.test(t) ? t : "";
  }
  function normalizeNetwork(v, w, h) {
    if (!v.vertices.length || !v.segments.length || w <= 0 || h <= 0) throw new Error("empty geometry");
    const ox = Math.min(...v.vertices.map((p) => p.x)), oy = Math.min(...v.vertices.map((p) => p.y));
    return {
      vertices: v.vertices.map((p) => [q((p.x - ox) / w), q((p.y - oy) / h), p.strokeCap || "", p.strokeJoin || "", q((p.cornerRadius || 0) / Math.max(w, h))]),
      segments: v.segments.map((s) => [s.start, s.end, q((s.tangentStart?.x || 0) / w), q((s.tangentStart?.y || 0) / h), q((s.tangentEnd?.x || 0) / w), q((s.tangentEnd?.y || 0) / h)]),
      regions: (v.regions || []).map((r) => [r.windingRule, r.loops])
    };
  }
  function extractIdentity(node) {
    let reliable = true, nodes = 0, geometryPoints = 0, vectors = 0, textCount = 0, filled = false, stroked = false, unknownPaint = false;
    const texts = [], colors = /* @__PURE__ */ new Set(), warnings = [];
    const walk = (n, depth) => {
      if (++nodes > 1500 || depth > 24) {
        reliable = false;
        return "truncated";
      }
      if (n.visible === false || "opacity" in n && n.opacity === 0) return null;
      const w = n.width, h = n.height;
      if (!(w > 0 && h > 0)) reliable = false;
      for (const key of ["fills", "strokes"]) {
        if (!(key in n)) continue;
        if (key === "strokes" && "strokeWeight" in n && n.strokeWeight === 0) continue;
        const paints = n[key];
        if (!Array.isArray(paints)) {
          unknownPaint = true;
          continue;
        }
        for (const paint of paints) {
          if (paint.visible === false || paint.opacity === 0) continue;
          if (key === "fills") filled = true;
          else stroked = true;
          if (paint.type === "SOLID") {
            colors.add([paint.color.r, paint.color.g, paint.color.b].map((v) => Math.round(v * 255)).join(","));
          } else {
            unknownPaint = true;
            if (paint.type === "IMAGE" || paint.type === "VIDEO") reliable = false;
          }
        }
      }
      const o = { type: ["GROUP", "FRAME", "COMPONENT", "INSTANCE"].includes(n.type) ? "CONTAINER" : n.type, aspect: q(w / (h || 1)), mask: "isMask" in n ? n.isMask : false };
      if ("clipsContent" in n) o.clips = n.clipsContent;
      if (n.type === "VECTOR") {
        vectors++;
        try {
          const network = n.vectorNetwork;
          geometryPoints += network.vertices.length + network.segments.length;
          if (geometryPoints > 2e4) throw new Error("geometry budget");
          o.network = normalizeNetwork(network, w, h);
        } catch {
          reliable = false;
        }
      } else if (n.type === "TEXT") {
        textCount++;
        texts.push(n.characters);
        o.text = normalizeVisibleText(n.characters);
        o.font = n.fontName;
        o.fontSize = typeof n.fontSize === "number" ? q(n.fontSize / (h || 1)) : "mixed";
        if (typeof n.fontName === "symbol" || typeof n.fontSize === "symbol") reliable = false;
      } else if (["RECTANGLE", "ELLIPSE", "POLYGON", "STAR", "LINE"].includes(n.type)) {
        const a = n;
        o.corners = ["topLeftRadius", "topRightRadius", "bottomRightRadius", "bottomLeftRadius"].map((k) => q((a[k] || 0) / (Math.max(w, h) || 1)));
        o.points = a.pointCount;
        o.inner = a.innerRadius;
        o.arc = a.arcData;
      } else if (!("children" in n)) reliable = false;
      if (n.type === "BOOLEAN_OPERATION") o.operation = n.booleanOperation;
      if ("children" in n) {
        const budget = Math.max(0, 1500 - nodes);
        if (n.children.length > budget) reliable = false;
        o.children = n.children.slice(0, budget).filter((k) => k.visible !== false && (!("opacity" in k) || k.opacity !== 0)).map((k) => {
          const t = k.relativeTransform;
          return { bounds: [q(k.width / (w || 1)), q(k.height / (h || 1))], transform: [q(t[0][0]), q(t[0][1]), q(t[0][2] / (w || 1)), q(t[1][0]), q(t[1][1]), q(t[1][2] / (h || 1))], geometry: walk(k, depth + 1) };
        });
      }
      return o;
    };
    const geometry = walk(node, 0);
    if (!vectors && !textCount) reliable = false;
    if (!reliable) warnings.push("Geometry incomplete or non-distinctive; requires other evidence");
    const variant = {};
    if (!unknownPaint && colors.size) {
      if (colors.size > 1) variant.color = "multi";
      else {
        const [r, g, b] = [...colors][0].split(",").map((v) => +v / 255);
        const { h, s, l } = rgbToHsl(r, g, b);
        variant.color = l < 0.08 ? "black" : l > 0.95 ? "white" : s < 0.12 ? "gray" : hueName(h);
      }
      if (!filled && stroked) variant.treatment = "outline";
      else if (colors.size === 1 && variant.color !== "white") variant.treatment = "monochrome";
    }
    const aspect = node.width / (node.height || 1);
    variant.orientation = aspect >= 1.8 ? "horizontal" : aspect <= 0.55 ? "vertical" : aspect >= 0.85 && aspect <= 1.18 ? "square" : void 0;
    if (textCount && !vectors) variant.lockup = "wordmark";
    else if (textCount && vectors) variant.lockup = textCount > 1 ? "tagline-lockup" : "mark-wordmark";
    if (textCount && vectors && "layoutMode" in node && node.layoutMode === "VERTICAL" && "children" in node && node.children.length <= 4) variant.orientation = "stacked";
    return { version: 1, geometrySignature: reliable ? "g1:" + identityHash(JSON.stringify(geometry)) : void 0, geometryReliable: reliable, visibleText: identityText(texts.join(" ")), variant, warnings };
  }
  async function componentRelationship(node) {
    let main = node.type === "COMPONENT" ? node : null;
    if (node.type === "INSTANCE") {
      try {
        main = await node.getMainComponentAsync();
      } catch {
      }
    }
    if (!main) return {};
    const set = main.parent?.type === "COMPONENT_SET" ? main.parent : main;
    return { family: set.key ? "component:" + set.key : void 0, mainComponentId: main.id };
  }

  // src/logo-approval.ts
  function logoApprovalStamp(node) {
    let count = 0;
    const walk = (n, depth) => {
      if (++count > 1500 || depth > 24) throw Error("Artwork too complex");
      return [
        n.type,
        n.width,
        n.height,
        n.relativeTransform,
        n.visible,
        n.opacity,
        n.fills,
        n.strokes,
        n.strokeWeight,
        n.type === "TEXT" ? [n.characters, n.fontName, n.fontSize, n.letterSpacing, n.lineHeight] : null,
        n.type === "VECTOR" ? n.vectorNetwork : null,
        n.type === "BOOLEAN_OPERATION" ? n.booleanOperation : null,
        "children" in n ? n.children.map((c) => walk(c, depth + 1)) : null
      ];
    };
    try {
      return identityHash(JSON.stringify(walk(node, 0)));
    } catch {
      return null;
    }
  }
  function hasCurrentLogoApproval(node) {
    const saved = node.getPluginData("dsf.logoApproval");
    if (!saved) return false;
    try {
      const a = JSON.parse(saved);
      return a.approved === true && !!a.stamp && a.stamp === logoApprovalStamp(node);
    } catch {
      return false;
    }
  }
  function approveLogo(node, name) {
    const stamp = logoApprovalStamp(node);
    if (!stamp) throw Error("Could not fingerprint this logo for approval.");
    node.setPluginData("dsf.logoApproval", JSON.stringify({ approved: true, stamp, name }));
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
    const depth = (e) => e.effects.reduce((n, x) => n + ("radius" in x ? x.radius : 0) + ("offset" in x ? Math.abs(x.offset.y) : 0), 0);
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

  // src/asset-labels.ts
  function descriptiveName(value, prefix = "ds/") {
    if (!value) return;
    let path = value.trim();
    if (prefix && path.startsWith(prefix)) path = path.slice(prefix.length);
    path = path.replace(/^(?:[^/]+\/)?(icon|symbol|logo|character|illustration|image|avatar|screen|section|nav|card|button|input|shape|debris|component)\//, "");
    const leaf = path.split("/").pop().replace(/[-_]/g, " ");
    if (!leaf || isDefaultName(leaf) || /^(icon|symbol|logo|character|illustration|component|screen|section|other)(\s*\d+)?$/i.test(leaf)) return;
    if (/needs[\s-]+identification|possible[\s-]+debris|\d+[- ]piece|\d+[x×]\d+/i.test(path)) return;
    return path;
  }
  function establishedName(rec, prefix = "ds/") {
    if (rec.semanticName?.trim() && !/needs[\s-]+identification/i.test(rec.semanticName)) return rec.semanticName.trim();
    if (rec.assetName) return assetName(rec.assetName);
    return descriptiveName(rec.name, prefix) || descriptiveName(rec.originalName, prefix);
  }

  // src/character-parts.ts
  function characterPart(name = "", crop = "") {
    if (crop && !/^(whole|full|full-body|uncropped)$/i.test(crop)) return true;
    const normalized = name.toLowerCase().replace(/[_/\s]+/g, "-").replace(/-\d+$/, "");
    if (/(?:^|-)(?:full|whole)-body$/.test(normalized)) return false;
    return /(?:^|-)(?:body-only|body|wing|wings|beak|eye|eyes|eyes-only|face-only|head-only|foot|feet|hand|hands|tail|arm|arms|leg|legs)(?:-only)?$/.test(normalized);
  }
  function characterLabel(name = "") {
    return /(?:^|[\s/_-])(ollie|owl|owls|mascot|character|penguin|bird)(?:$|[\s/_-])/i.test(name);
  }

  // src/artwork.ts
  var ART = /* @__PURE__ */ new Set(["icon", "logo", "character", "illustration", "symbol"]);
  function artworkBoundary(node, category) {
    if (!("children" in node) || !node.children.length || !ART.has(category)) return false;
    if (category === "logo") return true;
    if (node.type === "COMPONENT" || node.type === "INSTANCE" || node.type === "BOOLEAN_OPERATION") return true;
    const explicit = node.getPluginData("dsf.semanticName") || readAssetName(node)?.identity;
    if (explicit) return true;
    const clusters = node.children.filter((n) => "children" in n && n.children.length > 0 && n.visible !== false && n.width * n.height >= node.width * node.height * 0.15);
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
      const a = clusters[i], b = clusters[j];
      const overlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      if (overlap < Math.min(a.width * a.height, b.width * b.height) * 0.05) return false;
    }
    return true;
  }
  function artworkRole(node) {
    const data = readAssetName(node);
    const name = node.getPluginData("dsf.semanticName") || data?.identity || node.getPluginData("dsf.originalName") || node.name;
    if (characterPart("", data?.appearance.crop) || (node.getPluginData("dsf.category") === "character" || characterLabel(name)) && characterPart(name)) return { artworkRole: "part", partOf: data?.identity || name };
    return { artworkRole: "whole", partOf: void 0 };
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
  function logoUiCategory(node) {
    if (!CONTAINER_TYPES.has(node.type) || !("children" in node)) return null;
    const original = node.getPluginData?.("dsf.originalName");
    const name = `${original || ""} ${node.name}`.toLowerCase().replace(/[-_/]+/g, " ");
    const texts = collectTexts(node).filter((t) => t.visible !== false).map((t) => t.characters.trim());
    if (/\b(status bar|pagination|page indicator|page control)\b/.test(name)) return "nav";
    if (node.height <= 100 && texts.some((t) => /^(continue\b|sign[ -]?(in|up)\b|log[ -]?in\b|buy now\b|get started\b)/i.test(t))) return "button";
    if (node.width >= 200 && node.height <= 100 && node.width / Math.max(node.height, 1) >= 4 && texts.some((t) => /^\d{1,2}:\d{2}(?:\s*[AP]M)?$/i.test(t)) && vectorStats(node).n >= 2) return "nav";
    const kids = node.children.filter((k) => k.visible !== false);
    if (!/\b(logo|wordmark|logotype)\b/.test(name) && kids.length >= 3 && kids.length <= 12 && node.height <= 20 && kids.every((k) => ["ELLIPSE", "RECTANGLE"].includes(k.type) && k.height <= 12 && k.width <= 32) && Math.max(...kids.map((k) => k.y + k.height / 2)) - Math.min(...kids.map((k) => k.y + k.height / 2)) <= 3) return "nav";
    return null;
  }
  function classify(node, ctx) {
    const w = node.width, h = node.height;
    const aspect = h > 0 ? w / h : 1;
    const fillHex = ownFillHex(node);
    const strokeHex = ownStrokeHex(node);
    const radius = uniformRadius(node);
    const fp = (cat, extra = "") => `${cat}|${Math.round(w / 8)}x${Math.round(h / 8)}|${fillHex || ""}|${strokeHex || ""}|${Math.round(radius)}${extra}`;
    if (node.type === "COMPONENT_SET") return { category: "other", text: "", fillHex, strokeHex, fingerprint: node.id, desc: "" };
    const uiCategory = logoUiCategory(node);
    if (uiCategory) return { category: uiCategory, text: collectTexts(node)[0]?.characters || "", fillHex, strokeHex, fingerprint: fp(uiCategory), desc: "UI control; not a standalone brand asset" };
    if (node.type === "TEXT") {
      const t = node;
      const chars = t.characters;
      const sourceName = node.getPluginData?.("dsf.originalName") || node.name;
      if (/\b(logo|wordmark|logotype)\b/i.test(sourceName) && chars.trim() && chars.length <= 80)
        return { category: "logo", text: chars, fillHex, strokeHex, fingerprint: fp("logo", `|${chars}`), desc: "named text wordmark" };
      const size = typeof t.fontSize === "number" ? t.fontSize : 14;
      const lines = chars.split("\n").length;
      let cat = "text";
      if (chars.length > 90 || lines > 2 || lines === 2 && chars.length > 60) cat = "copy";
      else if (size >= 14 && size < 34 && chars.trim().split(/\s+/).length >= 3 && chars.length <= 90 && !/[.!?]$/.test(chars.trim()) && !ctx.topLevel) cat = "tagline";
      return { category: cat, text: chars, fillHex, strokeHex, fingerprint: fp(cat), desc: "" };
    }
    const genericPathName = /^(vector|line|path)([\s-]*\d+)?(\s*copy(\s*\d+)?)?$/i.test(node.name.trim());
    let partOfArtwork = false;
    for (let p = node.parent; p && p.type !== "PAGE" && p.type !== "DOCUMENT"; p = p.parent) {
      if (p.type === "COMPONENT" || p.type === "COMPONENT_SET" || p.type === "INSTANCE" || p.type === "BOOLEAN_OPERATION" || p.type === "GROUP" && isVectorSubtree(p) || p.type === "FRAME" && Math.max(p.width, p.height) <= 64 && isVectorSubtree(p)) {
        partOfArtwork = true;
        break;
      }
    }
    if (!partOfArtwork && genericPathName && Math.max(w, h) <= 16) {
      let stray = node.type === "LINE";
      let points = 2;
      if (node.type === "VECTOR") {
        try {
          const net = node.vectorNetwork;
          points = net.vertices.length;
          const curved = net.segments.some((s) => [s.tangentStart, s.tangentEnd].some((t) => t && (t.x !== 0 || t.y !== 0)));
          const degrees = /* @__PURE__ */ new Map();
          net.segments.forEach((s) => {
            degrees.set(s.start, (degrees.get(s.start) || 0) + 1);
            degrees.set(s.end, (degrees.get(s.end) || 0) + 1);
          });
          const open = [...degrees.values()].some((n) => n === 1);
          stray = points <= 3 && net.segments.length <= 2 && !net.regions?.length && !curved && (open || net.segments.length === 0);
        } catch {
        }
      }
      if (stray) return {
        category: "debris",
        text: "",
        fillHex,
        strokeHex,
        fingerprint: `debris|${node.id}`,
        desc: `possible-stray-${points}-point-path-${Math.round(w)}x${Math.round(h)}`
      };
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
    if (VECTOR_TYPES.has(node.type) || CONTAINER_TYPES.has(node.type)) {
      const nameHint = (node.getPluginData?.("dsf.originalName") || node.name).toLowerCase();
      const vec = isVectorSubtree(node);
      const kids2 = "children" in node ? countDescendants(node) : 0;
      const primitive = !CONTAINER_TYPES.has(node.type) && node.type !== "VECTOR" && node.type !== "BOOLEAN_OPERATION";
      const vfp = (cat) => `${cat}|${nameHint}|${Math.round(w)}x${Math.round(h)}|${kids2}`;
      const artDesc = () => CONTAINER_TYPES.has(node.type) ? describeGroup(node) : describeShape(node, fillHex, strokeHex);
      if (/\b(logo|wordmark|logotype)\b/.test(nameHint) && (vec || CONTAINER_TYPES.has(node.type))) {
        return { category: "logo", text: "", fillHex, strokeHex, fingerprint: vfp("logo"), desc: artDesc() };
      }
      if (vec) {
        if (Math.max(w, h) <= 64 && Math.min(w, h) >= 6 && aspect >= 0.5 && aspect <= 2) {
          return { category: "icon", text: "", fillHex, strokeHex, fingerprint: vfp("icon"), desc: "" };
        }
        if (primitive) {
          return { category: "shape", text: "", fillHex, strokeHex, fingerprint: fp("shape"), desc: describeShape(node, fillHex, strokeHex) };
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
      if (CONTAINER_TYPES.has(node.type) && !fillHex && !strokeHex && !hasShadow(node)) {
        const st = vectorStats(node);
        if (st.n >= 1 && st.text >= 1 && st.text <= 2 && h <= 160 && kids2 <= 30)
          return { category: "symbol", text: collectTexts(node)[0]?.characters || "", fillHex, strokeHex, fingerprint: vfp("symbol"), desc: "mark-and-text candidate; brand identity needs review" };
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

  // src/contact-sheet.ts
  var categories = /* @__PURE__ */ new Set(["screen", "section", "nav", "card", "button", "input", "badge", "avatar", "image", "icon", "divider", "list-item", "checkbox", "toggle", "text", "shape", "logo", "character", "illustration", "symbol", "tagline", "copy", "debris", "other"]);
  function resolvedCategory(value, fallback) {
    return categories.has(value) ? value : fallback;
  }
  function auditedAssetCategory(rec, node) {
    if (rec.category !== "logo" && !hasCurrentLogoApproval(node)) return { category: rec.category };
    const names = [node.name, node.getPluginData("dsf.originalName"), node.getPluginData("dsf.semanticName"), rec.name, rec.semanticName || "", rec.text || ""].join(" ").toLowerCase().replace(/[-_/]+/g, " ");
    const ui = logoUiCategory(node);
    if (ui) return { category: ui, reason: "UI structure or purpose" };
    if (/\b(status\s*bar|pagination|page indicator|page control)\b/.test(names)) return { category: "nav", reason: "status/pagination role" };
    if (/\b(continue (with|wphone)|sign (in|up)|log in)\b/.test(names) || /continue wphone#/.test(names)) return { category: "button", reason: "sign-in control" };
    if (/\b(arrow (left|right|up|down)|chevron|wifi|wi fi|battery|signal strength|hamburger|search icon|settings icon|close icon)\b/.test(names)) return { category: "icon", reason: "utility icon role" };
    return hasCurrentLogoApproval(node) ? { category: "logo" } : { category: "symbol", reason: "Unapproved logo candidate; inspect and approve before listing in Logos" };
  }
  function hasGeneratedAncestor(node) {
    let current = node;
    while (current && current.type !== "DOCUMENT") {
      if (current.getPluginData(PD_GENERATED) === "1") return true;
      current = current.parent;
    }
    return false;
  }
  function appearanceKey(rec) {
    const f = rec.identity;
    return f?.geometryReliable && f.geometrySignature ? JSON.stringify([rec.category, f.geometrySignature, f.variant, rec.w, rec.h]) : rec.id;
  }
  function sheetName(rec, prefix) {
    const name = establishedName(rec, prefix);
    if (name) return name;
    if (rec.category === "debris") return `Possible debris \xB7 ${rec.desc || "empty or tiny vector"}`;
    if (["icon", "logo", "symbol", "illustration", "character", "other"].includes(rec.category)) {
      return `Needs identification \xB7 ${rec.desc || rec.category} \xB7 ${rec.id}`;
    }
    return elementLabel(rec, "").replace(/\//g, " \xB7 ");
  }
  async function refreshIdentifications(inv) {
    const records = [];
    const ordinary = new Set([...inv.elements, ...inv.icons, ...inv.shapes].map((r) => r.id));
    const candidates = new Map((inv.characterCandidates || []).map((r) => [r.id, r]));
    const approved = new Map(inv.assetMap?.assets.filter((f) => f.status === "approved").flatMap((f) => f.variants.map((v) => [v.nodeId, f])) || []);
    for (const rec of [...inv.elements, ...inv.icons, ...inv.shapes, ...[...candidates.values()].filter((r) => !ordinary.has(r.id))]) {
      const node = await figma.getNodeByIdAsync(rec.id);
      if (!node || node.removed || hasGeneratedAncestor(node)) continue;
      rec.name = node.name;
      rec.assetName = readAssetName(node);
      if ("width" in node) Object.assign(rec, artworkRole(node));
      const savedCategory = node.getPluginData(PD_CATEGORY);
      if (savedCategory !== "debris" || node.getPluginData("dsf.semanticName")) rec.category = resolvedCategory(savedCategory, rec.category);
      const semantic = node.getPluginData("dsf.semanticName");
      rec.semanticName = semantic || void 0;
      rec.originalName = node.getPluginData("dsf.originalName") || void 0;
      try {
        const saved = JSON.parse(node.getPluginData("dsf.assetVariant"));
        const f = rec.identity;
        if (!semantic && f && saved.featureSnapshot === JSON.stringify([f.geometrySignature, f.variant, f.visibleText])) {
          if (typeof saved.canonicalName === "string") rec.semanticName = saved.canonicalName;
          rec.category = resolvedCategory(saved.kind, rec.category);
        }
      } catch {
      }
      const family = approved.get(rec.id);
      if (family && !semantic) {
        rec.category = family.kind;
        rec.semanticName = family.canonicalName;
      }
      if ("width" in node) rec.category = auditedAssetCategory(rec, node).category;
      if (candidates.has(rec.id) && (rec.category !== "character" || rec.artworkRole === "part")) continue;
      records.push(rec);
    }
    const wholeCharacters = new Set(records.filter((r) => r.category === "character" && r.artworkRole !== "part").map((r) => r.id));
    inv.elements = records.filter((r) => r.category !== "icon" && r.category !== "shape" && !(candidates.has(r.id) && r.characterAncestorIds?.some((id) => wholeCharacters.has(id))));
    inv.icons = records.filter((r) => r.category === "icon");
    inv.shapes = records.filter((r) => r.category === "shape");
  }

  // src/similarity.ts
  function shapeFeatures(root) {
    const parts = [], palette = /* @__PURE__ */ new Set(), strokes = [];
    let visited = 0, complete = true;
    function walk(n, depth) {
      if (++visited > 512 || depth > 24) {
        complete = false;
        return;
      }
      if (n.visible === false || "opacity" in n && n.opacity === 0) return;
      for (const key of ["fills", "strokes"]) {
        const paints = n[key];
        if (!Array.isArray(paints)) continue;
        for (const p of paints) if (p.type === "SOLID" && p.visible !== false && p.opacity !== 0) palette.add([p.color.r, p.color.g, p.color.b].map((v) => Math.round(v * 255)).join(","));
      }
      if ("strokeWeight" in n && typeof n.strokeWeight === "number" && n.strokeWeight > 0 && "strokes" in n && Array.isArray(n.strokes) && n.strokes.some((p) => p.visible !== false)) strokes.push(n.strokeWeight / Math.max(root.width, root.height, 1));
      if (n.type === "VECTOR") try {
        const v = n.vectorNetwork;
        if (v.vertices.length + v.segments.length > 2e3) {
          complete = false;
          return;
        }
        if (v.segments.length >= 3) parts.push(identityHash(JSON.stringify(normalizeNetwork(v, n.width, n.height))));
      } catch {
        complete = false;
      }
      if ("children" in n) {
        if (n.children.length > 512) complete = false;
        for (const c of n.children.slice(0, 512)) walk(c, depth + 1);
      }
    }
    walk(root, 0);
    strokes.sort((a, b) => a - b);
    return { geometry: extractIdentity(root).geometrySignature, parts: parts.sort(), palette: [...palette].sort(), stroke: strokes.length ? strokes[Math.floor(strokes.length / 2)] : 0, width: root.width, height: root.height, complete };
  }
  function variationName(base, reference, item) {
    const suffix = [];
    if (JSON.stringify(reference.palette) !== JSON.stringify(item.palette)) suffix.push("recolored");
    if (reference.stroke && item.stroke) {
      const ratio = item.stroke / reference.stroke;
      if (ratio > 1.2) suffix.push("thick-outline");
      else if (ratio < 0.8) suffix.push("thin-outline");
    }
    if (!suffix.length && Math.abs(item.width / reference.width - 1) > 0.05) suffix.push(Math.round(item.width) + "px");
    return [base, ...suffix].join("-");
  }

  // src/sheet-identify.ts
  var LINK = "dsf.sheetSource";
  var CAPTION = "dsf.sheetCaption";
  function linkSheetCell(cell, ids, caption, category, prefix) {
    cell.setPluginData(LINK, JSON.stringify({ ids, category, prefix }));
    caption.setPluginData(CAPTION, "1");
  }
  function selectedSheetCell() {
    if (figma.currentPage.selection.length !== 1) return null;
    let n = figma.currentPage.selection[0];
    while (n && n.type !== "PAGE" && n.type !== "DOCUMENT") {
      if (n.getPluginData(LINK)) return n;
      n = n.parent;
    }
    return null;
  }
  function readLink(n) {
    const l = JSON.parse(n.getPluginData(LINK));
    if (!Array.isArray(l.ids) || !l.ids.length) throw Error("Invalid sheet source link. Rebuild this sheet.");
    return l;
  }
  async function inspectSheetSelection() {
    const cell = selectedSheetCell();
    if (!cell) return { cellId: null };
    const link = readLink(cell), source2 = await figma.getNodeByIdAsync(link.ids[0]);
    return { cellId: cell.id, name: source2?.getPluginData("dsf.semanticName") || "", sourceName: source2?.name || "Source unavailable", category: link.category, assetName: source2 ? readAssetName(source2) : null };
  }
  async function identifySheetSelection(cellId, name, match, metadata) {
    const cell = selectedSheetCell();
    if (!cell || cell.id !== cellId) throw Error("Selection changed. Select the contact-sheet item again.");
    const structured = normalizeAssetName(metadata);
    const clean2 = structured ? assetName(structured) : slug(name, 100);
    if (!clean2) throw Error("Enter a name for this item.");
    const link = readLink(cell);
    const source2 = await figma.getNodeByIdAsync(link.ids[0]);
    if (!source2 || source2.removed || source2.type === "PAGE" || source2.type === "DOCUMENT" || hasGeneratedAncestor(source2)) throw Error("Original artwork is missing. Rebuild the sheet from the source artwork.");
    await figma.loadAllPagesAsync();
    const cells = figma.root.children.flatMap((p) => p.findAll((n) => !!n.getPluginData(LINK)));
    const refs = /* @__PURE__ */ new Map();
    for (const c of cells) {
      const l = readLink(c);
      for (const id of l.ids) refs.set(id, l);
    }
    for (const id of link.ids) refs.set(id, link);
    const base = shapeFeatures(source2);
    const updates = /* @__PURE__ */ new Map();
    for (const [id, l] of refs) {
      const node = await figma.getNodeByIdAsync(id);
      if (!node || node.removed || node.type === "PAGE" || node.type === "DOCUMENT" || hasGeneratedAncestor(node)) continue;
      const selected = link.ids.includes(id);
      const short = node.name.split("/").pop() || "";
      const unnamed = isDefaultName(short.replace(/-/g, " ")) || /needs.identification|\d+x\d+/i.test(short);
      if (!selected && (!match || node.getPluginData("dsf.semanticName") || !unnamed)) continue;
      const f = selected ? base : shapeFeatures(node);
      if (!selected && (!base.geometry || !base.complete || !f.complete || f.geometry !== base.geometry)) continue;
      const traits = structured ? { identity: structured.identity, appearance: { ...structured.appearance } } : null;
      if (traits && !selected && JSON.stringify(base.palette) !== JSON.stringify(f.palette)) traits.appearance.color = "recolored";
      if (traits && !selected && base.stroke && f.stroke) {
        if (f.stroke / base.stroke > 1.2) traits.appearance.treatment = "thick-outline";
        else if (f.stroke / base.stroke < 0.8) traits.appearance.treatment = "thin-outline";
      }
      updates.set(id, { node, name: traits ? assetName(traits) : selected ? clean2 : variationName(clean2, base, f), link: l, assetName: traits });
    }
    const captions = [];
    const cellUpdates = [];
    for (const c of cells) {
      const l = readLink(c), u = l.ids.map((id) => updates.get(id)).find(Boolean);
      if (!u) continue;
      cellUpdates.push({ node: c, name: u.name });
      if ("findAll" in c) for (const t of c.findAll((n) => n.type === "TEXT" && n.getPluginData(CAPTION) === "1")) {
        const fonts = t.fontName === figma.mixed ? t.getRangeAllFontNames(0, t.characters.length) : [t.fontName];
        for (const f of fonts) await figma.loadFontAsync(f);
        captions.push({ node: t, name: u.name });
      }
    }
    if (selectedSheetCell()?.id !== cellId) throw Error("Selection changed. Select the contact-sheet item again.");
    const undo = [];
    const pd = (n, k, v) => {
      const old = n.getPluginData(k);
      undo.push(() => n.setPluginData(k, old));
      n.setPluginData(k, v);
    };
    const rename = (n, v) => {
      const old = n.name;
      undo.push(() => {
        n.name = old;
      });
      n.name = v;
    };
    try {
      for (const u of updates.values()) {
        if (!u.node.getPluginData(PD_ORIGINAL)) pd(u.node, PD_ORIGINAL, u.node.name);
        pd(u.node, "dsf.semanticName", u.name);
        pd(u.node, "dsf.assetName", u.assetName ? JSON.stringify(u.assetName) : "");
        pd(u.node, PD_CATEGORY, u.link.category);
        if (!(u.node.type === "COMPONENT" && u.node.parent?.type === "COMPONENT_SET")) rename(u.node, `${u.link.prefix}${u.link.category}/${u.name}`);
      }
      for (const u of cellUpdates) rename(u.node, u.name);
      for (const u of captions) {
        const old = u.node.characters;
        undo.push(() => {
          u.node.characters = old;
        });
        u.node.characters = u.name;
      }
    } catch (e) {
      for (const restore of undo.reverse()) try {
        restore();
      } catch {
      }
      throw e;
    }
    return { sources: updates.size, sheets: cellUpdates.length, name: clean2, assetName: structured };
  }
  async function exportSheetReference(cellId, name, metadata) {
    const cell = selectedSheetCell();
    if (!cell || cell.id !== cellId) throw Error("Select the contact-sheet item again.");
    const link = readLink(cell), node = await figma.getNodeByIdAsync(link.ids[0]);
    if (!node || node.removed || node.type === "PAGE" || node.type === "DOCUMENT" || hasGeneratedAncestor(node)) throw Error("Original artwork is unavailable.");
    const structured = metadata === void 0 ? readAssetName(node) : normalizeAssetName(metadata);
    const clean2 = structured ? assetName(structured) : slug(name, 100);
    if (!clean2) throw Error("Enter the approved reference name first.");
    const n = node;
    const image = await n.exportAsync({ format: "PNG", constraint: { type: n.width >= n.height ? "WIDTH" : "HEIGHT", value: 320 }, useAbsoluteBounds: true });
    return { name: clean2, assetName: structured, kind: link.category, what: "Approved from a contact-sheet selection", image: figma.base64Encode(image), features: shapeFeatures(n) };
  }

  // src/logo-composition.ts
  function proposeLogoRegions(root) {
    const bounds = ("absoluteRenderBounds" in root ? root.absoluteRenderBounds : null) || root.absoluteBoundingBox;
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) throw Error("Artwork has no visible bounds.");
    const out = [];
    const visit = (n, depth) => {
      if (n.visible === false) return;
      const kids = "children" in n ? n.children.filter((k) => k.visible !== false) : [];
      const hasText = (v) => v.type === "TEXT" || "children" in v && v.children.some(hasText);
      if (kids.length && depth < 4 && (n === root || hasText(n))) {
        for (const k of kids) visit(k, depth + 1);
        return;
      }
      const b = ("absoluteRenderBounds" in n ? n.absoluteRenderBounds : null) || n.absoluteBoundingBox;
      if (!b) return;
      if (out.length >= 48) throw Error("Too many regions. Select a smaller logo group (up to 48 regions).");
      out.push({ id: n.id, name: n.name, text: n.type === "TEXT" ? n.characters.slice(0, 200) : "", role: n.type === "TEXT" ? "signature" : /\b(mark|symbol|logotype)\b/i.test(n.name) ? "symbol" : "unknown", x: (b.x - bounds.x) / bounds.width, y: (b.y - bounds.y) / bounds.height, width: b.width / bounds.width, height: b.height / bounds.height, features: shapeFeatures(n) });
    };
    visit(root, 0);
    return out;
  }
  function logoArrangement(regions) {
    const union = (role) => {
      const r = regions.filter((n) => n.role === role);
      if (!r.length) return null;
      const x = Math.min(...r.map((n) => n.x)), y = Math.min(...r.map((n) => n.y));
      return { x, y, width: Math.max(...r.map((n) => n.x + n.width)) - x, height: Math.max(...r.map((n) => n.y + n.height)) - y };
    };
    const a = union("symbol"), b = union("signature");
    if (!a) return "signature-only";
    if (!b) return "symbol-only";
    const overlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    if (overlap > Math.min(a.width * a.height, b.width * b.height) * 0.1) return "overlapping";
    return Math.abs(a.x + a.width / 2 - b.x - b.width / 2) > Math.abs(a.y + a.height / 2 - b.y - b.height / 2) ? "horizontal" : "stacked";
  }
  async function source() {
    if (figma.currentPage.selection.length !== 1) throw Error("Select one original logo group or linked sheet item.");
    const cell = selectedSheetCell();
    const selected = figma.currentPage.selection[0];
    const n = cell ? await figma.getNodeByIdAsync(JSON.parse(cell.getPluginData("dsf.sheetSource")).ids[0]) : selected;
    if (!n || n.removed || n.type === "PAGE" || n.type === "DOCUMENT" || hasGeneratedAncestor(n)) throw Error("Select original artwork or a linked sheet item.");
    if (logoUiCategory(n)) throw Error("This is a UI control. Select its embedded brand mark instead.");
    return n;
  }
  async function inspectLogo() {
    const n = await source(), regions = proposeLogoRegions(n);
    const image = figma.base64Encode(await n.exportAsync({ format: "PNG", constraint: { type: n.width >= n.height ? "WIDTH" : "HEIGHT", value: 480 }, useAbsoluteBounds: true }));
    const snapshot = identityHash(JSON.stringify([n.id, regions, image]));
    let saved;
    try {
      saved = JSON.parse(n.getPluginData("dsf.logoComposition"));
    } catch {
    }
    if (saved?.snapshot === snapshot) for (const r of regions) {
      const old = saved.regions.find((x) => x.id === r.id);
      if (old) {
        r.role = old.role;
        r.text = old.text;
      }
    }
    return { nodeId: n.id, name: n.getPluginData("dsf.semanticName") || n.name, image, regions, snapshot };
  }
  async function saveLogo(msg) {
    const fresh = await inspectLogo();
    if (fresh.nodeId !== msg.nodeId || fresh.snapshot !== msg.snapshot) throw Error("Selection or artwork changed. Inspect it again before saving.");
    const name = String(msg.name || "").trim().slice(0, 200);
    if (!name) throw Error("Enter the approved logo name.");
    if (!Array.isArray(msg.regions) || msg.regions.length !== fresh.regions.length || new Set(msg.regions.map((r) => r.id)).size !== fresh.regions.length) throw Error("Inspect the regions again.");
    const regions = fresh.regions.map((r) => {
      const edit = msg.regions.find((e) => e.id === r.id);
      if (!edit || !["symbol", "signature", "ignore"].includes(edit.role)) throw Error("Assign every region a role or Ignore before saving.");
      return { ...r, role: edit.role, text: String(edit.text || "").slice(0, 200) };
    });
    if (!regions.some((r) => r.role === "symbol" || r.role === "signature")) throw Error("Identify at least one symbol or signature region.");
    const composition = { version: 1, arrangement: logoArrangement(regions), regions };
    const n = await source();
    if (n.id !== fresh.nodeId) throw Error("Selection changed. Inspect again.");
    const features = shapeFeatures(n);
    approveLogo(n, name);
    n.setPluginData("dsf.category", "logo");
    n.setPluginData("dsf.semanticName", name);
    n.setPluginData("dsf.logoComposition", JSON.stringify({ ...composition, snapshot: fresh.snapshot }));
    return { name, kind: "logo", what: "Human-reviewed logo composition: " + composition.arrangement, image: fresh.image, features, composition };
  }

  // src/character-discovery.ts
  function characterGroupCandidate(node) {
    if (!["GROUP", "FRAME", "COMPONENT", "INSTANCE", "BOOLEAN_OPERATION"].includes(node.type) || !("children" in node)) return false;
    if (node.width < 12 || node.height < 12 || node.width / node.height < 0.2 || node.width / node.height > 5) return false;
    if ("isMask" in node && node.isMask) return false;
    let current = node;
    while (current && current.type !== "PAGE" && current.type !== "DOCUMENT") {
      if ("visible" in current && !current.visible || "opacity" in current && current.opacity === 0) return false;
      current = current.parent;
    }
    let vectors = 0, texts = 0, visited = 0;
    const stack = [{ node, depth: 0 }];
    while (stack.length && visited++ < 160) {
      const { node: n, depth } = stack.pop();
      if (n.visible === false || "opacity" in n && n.opacity === 0) continue;
      if (n.type === "TEXT") {
        texts++;
        continue;
      }
      if (["VECTOR", "BOOLEAN_OPERATION", "ELLIPSE", "RECTANGLE", "POLYGON", "STAR"].includes(n.type)) vectors++;
      if ("children" in n && depth < 10) for (const child of n.children) stack.push({ node: child, depth: depth + 1 });
    }
    return vectors >= 4 && texts <= 2;
  }
  function sourceAncestors(node) {
    const ids = [];
    let parent = node.parent;
    while (parent && parent.type !== "PAGE" && parent.type !== "DOCUMENT") {
      ids.push(parent.id);
      parent = parent.parent;
    }
    return ids;
  }

  // src/layout-meta.ts
  function layoutMetadata(node) {
    const p = node.parent;
    const a = node;
    const meta = {
      nodeId: node.id,
      parentId: p?.id,
      zIndex: p && "children" in p ? p.children.indexOf(node) : 0,
      rotation: "rotation" in node ? node.rotation : 0,
      aspectRatio: node.height > 0 ? node.width / node.height : 0,
      absoluteBounds: node.absoluteBoundingBox ? { ...node.absoluteBoundingBox } : void 0
    };
    if (p && "width" in p && p.width > 0 && p.height > 0) {
      const t = node.relativeTransform;
      meta.normalizedBounds = { x: t[0][2] / p.width, y: t[1][2] / p.height, width: node.width / p.width, height: node.height / p.height };
    }
    if ("constraints" in node) meta.constraints = node.constraints;
    if ("layoutMode" in node) {
      meta.autoLayout = a.layoutMode;
      meta.padding = [a.paddingTop, a.paddingRight, a.paddingBottom, a.paddingLeft];
      meta.gap = a.itemSpacing;
      meta.alignment = { primary: a.primaryAxisAlignItems, counter: a.counterAxisAlignItems };
    }
    meta.sizingHorizontal = a.layoutSizingHorizontal;
    meta.sizingVertical = a.layoutSizingVertical;
    if ("componentProperties" in node) meta.componentProperties = node.componentProperties;
    meta.styles = { fill: a.fillStyleId, stroke: a.strokeStyleId, effect: a.effectStyleId };
    if ("boundVariables" in node) meta.variables = node.boundVariables;
    return meta;
  }

  // src/scan.ts
  var SKIP_TYPES = /* @__PURE__ */ new Set(["SLICE", "STICKY", "CONNECTOR", "SHAPE_WITH_TEXT", "CODE_BLOCK", "WIDGET", "EMBED", "LINK_UNFURL", "MEDIA", "TABLE"]);
  async function scan(scope, baseGrid) {
    const colors = /* @__PURE__ */ new Map();
    const types = /* @__PURE__ */ new Map();
    const spacing = /* @__PURE__ */ new Map();
    const radii = /* @__PURE__ */ new Map();
    const effects = /* @__PURE__ */ new Map();
    const artworkParts = [];
    const characterCandidates = [];
    let characterCandidatesDeferred = 0;
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
        const clean2 = vis.map((e) => {
          const { boundVariables, ...rest } = e;
          return rest;
        });
        effects.set(key, { key, effects: clean2, count: 1, name: "", css: vis.map(effectCss).filter(Boolean).join(", ") });
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
      if (SKIP_TYPES.has(node.type) || node.removed || hasGeneratedAncestor(node)) continue;
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
      if (node.type === "INSTANCE" && !item.artworkOwner) {
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
      const nestedCandidate = !!item.artworkOwner && !["character", "logo"].includes(item.artworkCategory || "") && characterGroupCandidate(node) && artworkRole(node).artworkRole !== "part";
      const keepCandidate = nestedCandidate && characterCandidates.length < 500;
      if (nestedCandidate && !keepCandidate) characterCandidatesDeferred++;
      const cls = item.artworkOwner ? { category: "illustration", text: "", fillHex: null, strokeHex: null, fingerprint: "", desc: "Nested vector group; review whether this is one whole character, a scene or a fragment." } : classify(node, item.ctx);
      const savedCategory = node.getPluginData("dsf.category");
      if (!item.artworkOwner && (savedCategory !== "debris" || node.getPluginData("dsf.semanticName"))) cls.category = resolvedCategory(savedCategory, cls.category);
      if (!item.artworkOwner && cls.category === "logo") cls.category = logoUiCategory(node) || cls.category;
      if (!item.artworkOwner && readAssetName(node)?.appearance.crop && cls.category === "debris") cls.category = "symbol";
      const boundary = !item.artworkOwner && artworkBoundary(node, cls.category);
      const artContainer = "children" in node && ["icon", "logo", "character", "illustration", "symbol"].includes(cls.category);
      if (item.artworkOwner) artworkParts.push({ nodeId: node.id, ownerId: item.artworkOwner, name: node.name, nodeType: node.type, layout: layoutMetadata(node) });
      if (keepCandidate || !item.artworkOwner && (!artContainer || boundary) && (cls.category !== "other" || node.type === "COMPONENT" || node.type === "INSTANCE" || node.type === "COMPONENT_SET")) {
        const rec = {
          id: node.id,
          nodeType: node.type,
          characterAncestorIds: sourceAncestors(node),
          ...["icon", "logo", "character", "illustration", "symbol"].includes(cls.category) ? artworkRole(node) : {},
          assetName: readAssetName(node),
          category: cls.category,
          name: node.name,
          originalName: node.getPluginData("dsf.originalName") || void 0,
          semanticName: node.getPluginData("dsf.semanticName") || void 0,
          text: cls.text.slice(0, 80),
          w: node.width,
          h: node.height,
          fingerprint: cls.fingerprint,
          inInstance,
          fillRole: cls.category === "button" || cls.category === "badge" ? fillRoleOf(cls.fillHex, cls.strokeHex) : "",
          sizeClass: sizeClass(node.height),
          textRole,
          desc: cls.desc,
          page: item.page,
          identity: extractIdentity(node),
          layout: layoutMetadata(node)
        };
        if (keepCandidate) characterCandidates.push(rec);
        else if (cls.category === "icon") icons.push(rec);
        else if (cls.category === "shape") {
          if (shapes.length < 4e3) shapes.push(rec);
        } else elements.push(rec);
      }
      if ("children" in node) {
        for (let i = node.children.length - 1; i >= 0; i--) {
          const k = node.children[i];
          const reviewedCharacter = keepCandidate && node.getPluginData("dsf.category") === "character" && artworkRole(node).artworkRole !== "part";
          stack.push({ node: k, ctx: { parentW: node.width, parentH: node.height, yInParent: k.y, topLevel: false }, inInstance: inInstance || node.type === "INSTANCE", page: item.page, artworkOwner: item.artworkOwner || (boundary ? node.id : void 0), artworkCategory: reviewedCharacter ? "character" : item.artworkCategory || (boundary ? cls.category : void 0) });
        }
      }
    }
    const roles = new Map([...elements, ...icons, ...shapes].map((r) => [r.id, r.category]));
    for (const r of [...elements, ...icons, ...shapes]) if (r.layout?.parentId) r.layout.parentSemanticRole = roles.get(r.layout.parentId);
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
      artworkParts,
      characterCandidates,
      characterCandidatesDeferred,
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

  // package.json
  var version = "1.6.9";

  // src/asset-review.ts
  function exportAssetMap(map) {
    return JSON.stringify({ ...map, assets: map.assets.map((f) => ({ ...f, variants: f.variants.map(({ image, ...v }) => v) })) }, null, 2);
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
    const source2 = { plugin: "DS Foundry", version: "1.5.0", generatedAt, scope: inv.scope, pages: inv.pages };
    const dtcg = { $schema: "https://tr.designtokens.org/format/", $extensions: { "com.cogspa.dsfoundry": source2 } };
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
        setDeep(dtcg, ["blur", ...e.name.split("/")], { $type: "dimension", $value: `${round("radius" in e.effects[0] ? e.effects[0].radius : 0)}px`, $extensions: { usage: e.count } });
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
      source: source2,
      elements: inv.elements.map((e) => ({ id: e.id, page: e.page, category: e.category, name: e.name, text: e.text, w: round(e.w), h: round(e.h), fillRole: e.fillRole, size: e.sizeClass, inInstance: e.inInstance })),
      icons: inv.icons.map((e) => ({ id: e.id, page: e.page, name: e.name, w: round(e.w), h: round(e.h) })),
      components: inv.components,
      fonts: inv.fonts
    }, null, 2);
    if (inv.assetMap) files["asset-map.json"] = exportAssetMap(inv.assetMap);
    const canonical = new Map((inv.assetMap?.assets || []).flatMap((f) => f.variants.map((v) => [v.nodeId, { assetId: f.assetId, variantId: v.variantId, status: f.status }])));
    files["layout-metadata.json"] = JSON.stringify({ schemaVersion: 1, elements: [...inv.elements, ...inv.icons, ...inv.shapes].map((r) => ({ nodeId: r.id, category: r.category, layout: r.layout, canonical: canonical.get(r.id) })) }, null, 2);
    files["asset-identities.json"] = JSON.stringify({ schemaVersion: 1, assets: [...inv.elements, ...inv.icons, ...inv.shapes].filter((r) => r.assetName).map((r) => ({ nodeId: r.id, name: r.semanticName, kind: r.category, ...r.assetName })) }, null, 2);
    files["artwork-parts.json"] = JSON.stringify({ schemaVersion: 1, artwork: [...inv.elements, ...inv.icons, ...inv.shapes].filter((r) => r.artworkRole).map((r) => ({ nodeId: r.id, role: r.artworkRole, partOf: r.partOf })), parts: inv.artworkParts || [] }, null, 2);
    return files;
  }

  // src/artwork-preview.ts
  function fitArtworkPreview(source2, clone, box, limit = 480) {
    box.clipsContent = false;
    const transform = source2.absoluteTransform;
    const current = clone.absoluteTransform;
    if (transform && (!current || [0, 1].some((row) => [0, 1].some((col) => Math.abs(transform[row][col] - current[row][col]) > 1e-6))))
      clone.relativeTransform = [[transform[0][0], transform[0][1], clone.x], [transform[1][0], transform[1][1], clone.y]];
    let bounds = "absoluteRenderBounds" in clone && clone.absoluteRenderBounds || clone.absoluteBoundingBox;
    const w = Math.max(1, bounds?.width || clone.width), h = Math.max(1, bounds?.height || clone.height);
    const scale = Math.min(1, limit / w, limit / h);
    if (scale < 1 && "rescale" in clone) clone.rescale(scale);
    bounds = "absoluteRenderBounds" in clone && clone.absoluteRenderBounds || clone.absoluteBoundingBox;
    const width = bounds?.width || clone.width, height = bounds?.height || clone.height;
    box.resizeWithoutConstraints(Math.max(24, Math.ceil(width)), Math.max(24, Math.ceil(height)));
    box.clipsContent = false;
    bounds = "absoluteRenderBounds" in clone && clone.absoluteRenderBounds || clone.absoluteBoundingBox;
    const frame = box.absoluteBoundingBox;
    if (bounds && frame) {
      clone.x += frame.x + (box.width - bounds.width) / 2 - bounds.x;
      clone.y += frame.y + (box.height - bounds.height) / 2 - bounds.y;
    } else {
      clone.x = (box.width - clone.width) / 2;
      clone.y = (box.height - clone.height) / 2;
    }
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
        if (!node.getPluginData(PD_CATEGORY)) node.setPluginData(PD_CATEGORY, rec.category);
        if (opts.rename && !node.getPluginData("dsf.semanticName") && !node.name.startsWith(opts.prefix)) node.name = elementLabel(rec, opts.prefix);
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
          node.setPluginData("dsf.semanticName", "");
          node.setPluginData("dsf.assetName", "");
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
        if (seen.has(appearanceKey(r))) continue;
        seen.add(appearanceKey(r));
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
          const comp = clone.type === "COMPONENT" ? clone : figma.createComponentFromNode(clone);
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
      if (r.inInstance || r.artworkRole === "part" || seen.has(appearanceKey(r))) continue;
      seen.add(appearanceKey(r));
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
        const cell = mkFrame(rec.name, { dir: "V", pad: 12, gap: 6, align: "CENTER", fill: { r: 0.82, g: 0.82, b: 0.82 } });
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
        let name = `${opts.prefix}icon/${slug(sheetName(rec, opts.prefix))}`;
        let n = 2;
        while (usedNames.has(name)) name = `${opts.prefix}icon/${slug(sheetName(rec, opts.prefix))}-${n++}`;
        usedNames.add(name);
        comp.name = name;
        comp.description = `${size}\xD7${size} \xB7 from page "${rec.page}"`;
        comp.setPluginData(PD_GENERATED, "1");
        const caption = await mkText(sheetName(rec, opts.prefix), { size: 9, color: MUTED });
        cell.appendChild(caption);
        linkSheetCell(cell, inv.icons.filter((r) => appearanceKey(r) === appearanceKey(rec)).map((r) => r.id), caption, rec.category, opts.prefix);
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
    { key: "parts", title: "Artwork parts", cats: [], cap: 120, kind: "vector" },
    { key: "logos", title: "Logos", cats: ["logo"], cap: 40, kind: "vector" },
    { key: "characters", title: "Characters", cats: ["character"], cap: 60, kind: "vector" },
    { key: "illustrations", title: "Illustrations", cats: ["illustration"], cap: 60, kind: "vector" },
    { key: "symbols", title: "Symbols & ornaments", cats: ["symbol"], cap: 80, kind: "vector" },
    { key: "icons", title: "Icons", cats: ["icon"], cap: 240, kind: "vector" },
    { key: "components", title: "Components", cats: ["button", "badge", "input", "checkbox", "toggle", "card", "list-item", "nav", "other"], cap: 120, kind: "vector" },
    { key: "taglines", title: "Taglines", cats: ["tagline"], cap: 80, kind: "text" },
    { key: "copy", title: "Copy", cats: ["copy"], cap: 40, kind: "text" },
    { key: "vectors", title: "Vectors & shapes", cats: ["shape"], cap: 120, kind: "vector" },
    { key: "debris", title: "Possible vector debris", cats: ["debris"], cap: 300, kind: "vector" }
  ];
  async function buildAssets(inv, opts, notes) {
    const builtAt = (/* @__PURE__ */ new Date()).toISOString();
    const buildLabel = `Updated ${builtAt.slice(0, 10)} ${builtAt.slice(11, 19)} UTC \xB7 v${version}`;
    const page = await getOrCreatePage("DS \xB7 Assets");
    const cursor = { y: 0 };
    let count = 0;
    const pool = [...inv.elements, ...inv.icons, ...inv.shapes].filter((r) => !r.inInstance || r.nodeType === "INSTANCE" || r.category === "character" && r.artworkRole !== "part" && !!r.semanticName);
    const resolved = [];
    for (let i = 0; i < pool.length; i++) {
      if (cancelled) throw new Error("cancelled");
      const rec = pool[i];
      const node = await nodeById(rec.id);
      if (!node) continue;
      const audit = auditedAssetCategory(rec, node);
      if (audit.reason) {
        notes.push(`Logo audit: moved ${rec.semanticName || rec.name} (${rec.id}) to ${audit.category}: ${audit.reason}.`);
        rec.category = audit.category;
      }
      resolved.push({ rec, node, cat: audit.category });
      if (i % 300 === 0) {
        progress(80 + i / pool.length * 6, `Sorting assets\u2026 ${i}/${pool.length}`);
        await tick();
      }
    }
    const intro = await mkSection("Assets", `Build: approved-logos-4. Final logo output checks applied. Every logo, character, illustration, symbol, icon, button, tagline, copy block and vector in the scanned scope, grouped by class and named. Possible debris is shown for review; source artwork is retained. Unrecognized artwork is marked Needs identification.`, page, cursor);
    intro.section.name = `Assets \xB7 index \xB7 ${buildLabel}`;
    intro.section.setPluginData("dsf.builtAt", builtAt);
    intro.section.setPluginData("dsf.buildVersion", version);
    const idx = mkFrame("index", { dir: "H", gap: 24, wrap: true, w: 1160 });
    for (const sec of ASSET_SECTIONS) {
      const n = resolved.filter((r) => sec.key === "parts" ? r.rec.artworkRole === "part" : r.rec.artworkRole !== "part" && sec.cats.includes(r.cat)).length;
      idx.appendChild(await mkText(`${sec.title} \xB7 ${n}`, { size: 12, color: n ? INK : MUTED }));
    }
    intro.body.appendChild(idx);
    finishSection(intro.section, cursor);
    for (const sec of ASSET_SECTIONS) {
      if (cancelled) throw new Error("cancelled");
      let items = resolved.filter((r) => sec.key === "parts" ? r.rec.artworkRole === "part" : r.rec.artworkRole !== "part" && sec.cats.includes(r.cat));
      if (!items.length) continue;
      const seen = /* @__PURE__ */ new Map();
      for (const it of items) {
        const k = sec.kind === "text" ? `${it.cat}|${it.rec.text.slice(0, 80)}` : `${it.cat}|${sheetName(it.rec, opts.prefix)}|${appearanceKey(it.rec)}`;
        const g = seen.get(k);
        if (g) {
          g.n++;
          g.ids.push(it.rec.id);
        } else seen.set(k, { ...it, n: 1, ids: [it.rec.id] });
      }
      const distinct = [...seen.values()].sort((a, b) => a.node.name.localeCompare(b.node.name)).slice(0, sec.cap);
      progress(86, `Assets \xB7 ${sec.title}\u2026`);
      await tick();
      const { section, body } = await mkSection(sec.title, `${items.length} found \xB7 ${distinct.length} distinct${items.length > sec.cap ? ` \xB7 showing ${sec.cap}` : ""}
${buildLabel}`, page, cursor);
      section.name = `Assets \xB7 ${sec.title} \xB7 ${buildLabel}`;
      section.setPluginData("dsf.builtAt", builtAt);
      section.setPluginData("dsf.buildVersion", version);
      if (sec.kind === "list") {
        const col = mkFrame("list", { dir: "V", gap: 4 });
        for (const d of distinct) {
          col.appendChild(await mkText(`${sheetName(d.rec, opts.prefix)} \xB7 ${Math.round(d.rec.w)}\xD7${Math.round(d.rec.h)} \xB7 ${d.rec.page}${d.n > 1 ? ` \xB7 \xD7${d.n}` : ""}`, { size: 10, color: MUTED }));
        }
        body.appendChild(col);
        body.appendChild(await mkText(`Tip: in the plugin's Elements tab, "Select debris" selects these on the current page so you can delete them.`, { size: 10, color: MUTED }));
        finishSection(section, cursor);
        continue;
      }
      const grid = mkFrame("grid", { dir: "H", gap: 24, wrap: true, w: 1160, align: "MIN" });
      body.appendChild(grid);
      if (sec.key === "debris") body.appendChild(await mkText("Possible debris \xB7 inspect before deleting. Hidden and empty paths may have no visible preview.", { size: 10, color: MUTED }));
      for (const d of distinct) {
        let clone;
        try {
          clone = d.node.clone();
        } catch {
          notes.push(`Could not copy ${d.node.name} (${d.node.id}) to its contact sheet.`);
          continue;
        }
        try {
          const cell = mkFrame(sheetName(d.rec, opts.prefix), { dir: "V", pad: 12, gap: 8, align: "MIN", fill: { r: 0.82, g: 0.82, b: 0.82 } });
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
            fitArtworkPreview(d.node, clone, box);
            if (["logos", "characters", "illustrations", "symbols", "icons", "vectors"].includes(sec.key)) {
              const comp = figma.createComponentFromNode(box);
              comp.name = `${opts.prefix}${d.cat}/${slug(sheetName(d.rec, opts.prefix), 80)}`;
              comp.description = `${d.cat} \xB7 ${Math.round(d.rec.w)}\xD7${Math.round(d.rec.h)} \xB7 from "${d.rec.page}"`;
              comp.setPluginData(PD_GENERATED, "1");
            }
          }
          const caption = await mkText(sheetName(d.rec, opts.prefix), { bold: true, size: 10 });
          cell.appendChild(caption);
          linkSheetCell(cell, d.ids, caption, d.cat, opts.prefix);
          cell.appendChild(await mkText(`${Math.round(d.rec.w)}\xD7${Math.round(d.rec.h)}${d.n > 1 ? ` \xB7 \xD7${d.n}` : ""}`, { size: 9, color: MUTED }));
          count++;
        } catch (e) {
          notes.push(`Could not place ${d.node.name} (${d.node.id}): ${String(e)}`);
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
    await refreshIdentifications(inv);
    if (!inv.elements.length && !inv.icons.length && !inv.shapes.length) throw new Error("No source artwork in this scan. Select the original design page or use Document scope, then scan again.");
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
  function pickDistinct(list, nested = false) {
    const groups = /* @__PURE__ */ new Map();
    for (const r of list) {
      if (!nested && r.inInstance && r.nodeType !== "INSTANCE") continue;
      const key = JSON.stringify([appearanceKey(r), establishedName(r) || "", nested ? r.id : ""]);
      const g = groups.get(key);
      if (g) g.ids.push(r.id);
      else groups.set(key, { rec: r, ids: [r.id] });
    }
    return [...groups.values()];
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
  async function prepareAiItems(inv, targets, maxItems, charactersOnly = false) {
    await refreshIdentifications(inv);
    const plan = [];
    if (targets.icons) {
      for (const g of pickDistinct(inv.icons)) plan.push({ rec: g.rec, ids: g.ids, category: "icon", name: g.rec.name, text: "", page: g.rec.page, size: 256, nodeId: g.rec.id });
      for (const g of pickDistinct(inv.elements.filter((e) => e.category === "symbol"))) plan.push({ rec: g.rec, ids: g.ids, category: "symbol", name: g.rec.name, text: "", page: g.rec.page, size: 320, nodeId: g.rec.id });
    }
    if (targets.art) for (const g of pickDistinct(inv.elements.filter((e) => e.category === "logo" || e.category === "character" || e.category === "illustration"))) plan.push({ rec: g.rec, ids: g.ids, category: g.rec.category, name: g.rec.name, text: g.rec.text, page: g.rec.page, size: 384, nodeId: g.rec.id });
    if (targets.text) for (const g of pickDistinct(inv.elements.filter((e) => e.category === "tagline" || e.category === "copy"))) plan.push({ rec: g.rec, ids: g.ids, category: g.rec.category, name: g.rec.name, text: g.rec.text, page: g.rec.page, size: 320, nodeId: g.rec.id });
    if (targets.images) for (const g of pickDistinct(inv.elements.filter((e) => e.category === "image" || e.category === "avatar"))) plan.push({ rec: g.rec, ids: g.ids, category: g.rec.category, name: g.rec.name, text: "", page: g.rec.page, size: 384, nodeId: g.rec.id });
    if (targets.screens) for (const g of pickDistinct(inv.elements.filter((e) => e.category === "screen" || e.category === "section" || e.category === "nav"))) plan.push({ rec: g.rec, ids: g.ids, category: g.rec.category, name: g.rec.name, text: g.rec.text, page: g.rec.page, size: 384, nodeId: g.rec.id });
    if (targets.cards) for (const g of pickDistinct(inv.elements.filter((e) => e.category === "card" || e.category === "list-item"))) plan.push({ rec: g.rec, ids: g.ids, category: g.rec.category, name: g.rec.name, text: g.rec.text, page: g.rec.page, size: 384, nodeId: g.rec.id });
    if (targets.components) {
      for (const g of pickDistinct(inv.elements.filter((e) => ["button", "input", "badge", "checkbox", "toggle", "other"].includes(e.category)))) plan.push({ rec: g.rec, ids: g.ids, category: g.rec.category, name: g.rec.name, text: g.rec.text, page: g.rec.page, size: 384, nodeId: g.rec.id });
      for (const c of inv.components.filter((x) => !x.remote)) {
        if (!plan.some((p) => p.ids.includes(c.id))) plan.push({ rec: null, ids: [c.id], category: "component", name: c.name, text: "", page: "", size: 384, nodeId: c.id });
      }
    }
    if (targets.shapes) for (const g of pickDistinct(inv.shapes)) plan.push({ rec: g.rec, ids: g.ids, category: "shape", name: g.rec.name, text: "", page: g.rec.page, size: 256, nodeId: g.rec.id });
    if (charactersOnly) {
      plan.length = 0;
      const records = [...new Map([...inv.elements, ...inv.icons, ...inv.characterCandidates || []].map((r) => [r.id, r])).values()];
      for (const g of pickDistinct(records.filter((r) => ["character", "illustration", "symbol", "icon"].includes(r.category) && r.artworkRole !== "part"), true))
        plan.push({ rec: g.rec, ids: g.ids, category: g.rec.category, name: g.rec.name, text: g.rec.text, page: g.rec.page, size: 384, nodeId: g.rec.id });
      maxItems = Math.min(maxItems, 120);
    }
    const named = (p) => establishedName(p.rec || { name: p.name, category: "other" });
    const trustedCharacter = (p) => p.category === "character" && p.rec?.artworkRole !== "part" && !!named(p);
    const unknown = plan.filter((p) => charactersOnly ? !trustedCharacter(p) : !named(p));
    const art = (p) => ["logo", "character", "illustration"].includes(p.category);
    unknown.sort((a, b) => Number(art(b)) - Number(art(a)));
    const referencePlan = charactersOnly ? plan.filter(trustedCharacter) : pickDistinct([...inv.elements, ...inv.icons].filter(
      (r) => r.artworkRole !== "part" && ["logo", "character", "illustration", "symbol", "icon"].includes(r.category) && establishedName(r)
    )).map((g) => ({ rec: g.rec, ids: g.ids, category: g.rec.category, name: g.rec.name, text: g.rec.text, page: g.rec.page, size: 384, nodeId: g.rec.id }));
    const references = referencePlan.sort(
      (a, b) => Number(b.category === "character") - Number(a.category === "character") || Number(art(b)) - Number(art(a))
    ).slice(0, 32);
    const selected = [...references, ...unknown.slice(0, maxItems)];
    const deferred = Math.max(0, unknown.length - maxItems);
    const preserved = plan.length - unknown.length;
    let exportFailures = 0;
    let chunk = [];
    let sent = 0;
    for (let i = 0; i < selected.length; i++) {
      if (cancelled) throw new Error("cancelled");
      const p = selected[i];
      let node = null;
      try {
        const n = await figma.getNodeByIdAsync(p.nodeId);
        if (n && !n.removed && n.type !== "DOCUMENT" && n.type !== "PAGE") node = n;
      } catch {
        node = null;
      }
      if (!node) {
        exportFailures++;
        continue;
      }
      const exportNode = node.type === "COMPONENT_SET" ? node.defaultVariant : node;
      const png = await exportPng(exportNode, p.size);
      if (!png) {
        exportFailures++;
        continue;
      }
      const preservedName = named(p);
      const referenceName = preservedName && (!charactersOnly || trustedCharacter(p)) && ["character", "illustration", "logo", "symbol", "icon"].includes(p.category) ? preservedName : void 0;
      const desc = (p.rec?.desc || "") + (charactersOnly ? " Character search: classify the entire isolated group. One complete figure is character; multiple figures/scenery are illustration; detached body/wing/eye parts are symbol. Use visible color and pose for unnamed characters." : "");
      chunk.push({ assetName: readAssetName(node), existingAssetName: charactersOnly ? readAssetName(node) : void 0, artworkRole: artworkRole(node).artworkRole, characterSearch: charactersOnly, existingName: charactersOnly ? preservedName : void 0, characterAncestorIds: p.rec?.characterAncestorIds, referenceName, features: shapeFeatures(exportNode), key: (charactersOnly ? "character-v1:" : "") + (p.rec ? appearanceKey(p.rec) : p.nodeId), ids: p.ids, category: p.category, name: p.name, desc, text: p.text, w: Math.round(node.width), h: Math.round(node.height), page: p.page, png });
      sent++;
      if (chunk.length >= 6 || i === selected.length - 1) {
        post({ type: "ai_items", items: chunk, sent, total: selected.length });
        chunk = [];
        await tick();
      }
    }
    if (chunk.length) post({ type: "ai_items", items: chunk, sent, total: selected.length });
    post({ type: "ai_items", items: [], sent, total: selected.length, done: true, deferred: deferred + (charactersOnly ? inv.characterCandidatesDeferred || 0 : 0), preserved, exportFailures, charactersOnly, nestedCandidates: inv.characterCandidates?.length || 0 });
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
    input: "input",
    checkbox: "checkbox",
    toggle: "toggle",
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
      const structured = normalizeAssetName(r.assetName);
      const clean2 = structured ? assetName(structured) : slug(r.name, 100);
      if (!clean2) continue;
      const cat = r.kind && PATH_FOR[r.kind] !== void 0 ? r.kind : r.category;
      for (const id of r.ids) {
        try {
          const node = await figma.getNodeByIdAsync(id);
          if (!node || node.removed || node.type === "DOCUMENT" || node.type === "PAGE") continue;
          if (node.type === "COMPONENT" && node.parent && node.parent.type === "COMPONENT_SET") continue;
          const safeCategory = cat === "logo" ? logoUiCategory(node) || cat : cat;
          const path = PATH_FOR[safeCategory] ?? safeCategory;
          const finalName = usePrefix ? `${prefix}${path ? path + "/" : ""}${clean2}` : clean2;
          if (!node.getPluginData(PD_ORIGINAL)) node.setPluginData(PD_ORIGINAL, node.name);
          node.setPluginData(PD_CATEGORY, safeCategory);
          node.setPluginData("dsf.semanticName", clean2);
          node.setPluginData("dsf.assetName", structured ? JSON.stringify(structured) : "");
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

  // src/assets.ts
  var prepared = /* @__PURE__ */ new Map();
  var documentId = "";
  var preparedProject = "";
  function invalidateAssets() {
    prepared.clear();
  }
  async function prepareAssets(inv, project, semantic = []) {
    prepared.clear();
    preparedProject = project;
    documentId = figma.fileKey || figma.root.getPluginData("dsf.documentId") || "session-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    const byId = new Map(semantic.flatMap((s) => s.ids.map((id) => [id, s])));
    const thumbs = /* @__PURE__ */ new Map();
    let exports = 0;
    const pool = [...inv.elements, ...inv.icons, ...inv.shapes];
    if (pool.length > 1e4) throw new Error("Canonical resolution supports 10,000 records per scan. Narrow the scope.");
    for (let i = 0; i < pool.length; i++) {
      if (cancelled) throw new Error("cancelled");
      const r = pool[i];
      const n = await figma.getNodeByIdAsync(r.id);
      if (!n || n.removed || n.type === "PAGE" || n.type === "DOCUMENT") continue;
      let generated = false;
      for (let p = n; p; p = p.parent) if (p.getPluginData(PD_GENERATED) === "1") {
        generated = true;
        break;
      }
      if (generated || "visible" in n && n.visible === false) continue;
      const node = n, s = byId.get(r.id);
      const kind = s?.kind || node.getPluginData(PD_CATEGORY) || r.category;
      if (kind === "debris" || kind === "other") continue;
      const features = extractIdentity(node), relationship = await componentRelationship(node);
      features.componentFamily = relationship.family;
      const layout = layoutMetadata(node);
      layout.componentFamily = relationship.family;
      layout.mainComponentId = relationship.mainComponentId;
      layout.parentSemanticRole = r.layout?.parentSemanticRole;
      const it = { nodeId: r.id, kind, name: node.name, semanticName: s?.name || "", description: s?.description || "", fingerprint: r.fingerprint, width: node.width, height: node.height, page: r.page, features, layout };
      if (node.getPluginData(PD_ASSET_PROJECT) === project) {
        it.approvedAssetId = node.getPluginData(PD_ASSET_ID) || void 0;
        try {
          const old = JSON.parse(node.getPluginData(PD_ASSET_VARIANT));
          if (old.featureSnapshot === JSON.stringify([features.geometrySignature, features.variant, features.visibleText])) it.approvedVariant = old.variant;
        } catch {
        }
      }
      const key = features.geometrySignature ? features.geometrySignature + JSON.stringify(features.variant) : r.id;
      if (thumbs.has(key)) it.image = thumbs.get(key);
      else if (exports < 400 && node.width > 0 && node.height > 0) {
        try {
          const bytes = await node.exportAsync({ format: "PNG", constraint: { type: node.width >= node.height ? "WIDTH" : "HEIGHT", value: 256 } });
          it.image = figma.base64Encode(bytes);
          thumbs.set(key, it.image);
          exports++;
        } catch {
          features.warnings.push("Thumbnail unavailable");
        }
      }
      prepared.set(it.nodeId, it);
      if (i % 25 === 0) {
        post({ type: "progress", pct: Math.round(i / pool.length * 100), msg: `Canonical features\u2026 ${i}/${pool.length}` });
        await tick();
      }
    }
    post({ type: "assets_prepared", documentId, items: [...prepared.values()], project, warnings: exports >= 400 ? ["Thumbnail budget: 400 distinct appearances. All feature records retained."] : [] });
  }
  async function applyAssets(inv, map, project) {
    if (project !== preparedProject || map.documentId !== documentId || !prepared.size) throw new Error("Scan/resolve again before applying this review");
    const seen = /* @__PURE__ */ new Set(), familyIds = /* @__PURE__ */ new Set();
    const writes = [];
    for (const f of map.assets) {
      if (familyIds.has(f.assetId) || !/^[a-z0-9][a-z0-9/_-]{0,199}$/.test(f.assetId)) throw new Error("Invalid or duplicate asset ID");
      familyIds.add(f.assetId);
      if (f.referenceNodeId && !f.variants.some((v) => v.nodeId === f.referenceNodeId)) throw new Error("Invalid reference node");
      for (const v of f.variants) {
        if (seen.has(v.nodeId) || !prepared.has(v.nodeId) || v.assetId !== f.assetId || v.kind !== f.kind || v.canonicalName !== f.canonicalName) throw new Error("Invalid family membership");
        seen.add(v.nodeId);
        if (f.status !== "approved") continue;
        if (!Number.isFinite(v.identityConfidence) || v.identityConfidence < 0 || v.identityConfidence > 1) throw new Error("Invalid confidence");
        const node = await figma.getNodeByIdAsync(v.nodeId);
        if (!node || node.removed || node.type === "PAGE" || node.type === "DOCUMENT") throw new Error("A reviewed node was removed. Resolve again.");
        const before = prepared.get(v.nodeId);
        const now = extractIdentity(node);
        const comparable = (f2) => JSON.stringify([f2.geometrySignature, f2.geometryReliable, f2.visibleText, f2.variant]);
        if (comparable(now) !== comparable(before.features) || "width" in node && (node.width !== before.width || node.height !== before.height)) throw new Error("A reviewed node changed. Resolve again.");
        const layoutNow = layoutMetadata(node);
        if (JSON.stringify(layoutNow.absoluteBounds) !== JSON.stringify(before.layout?.absoluteBounds)) throw new Error("A reviewed node moved. Resolve again.");
        if (!now.geometryReliable) {
          if (!before.image) throw new Error("A non-vector asset has no review thumbnail. Narrow the scope and resolve again.");
          const n = node;
          const bytes = await n.exportAsync({ format: "PNG", constraint: { type: n.width >= n.height ? "WIDTH" : "HEIGHT", value: 256 } });
          if (figma.base64Encode(bytes) !== before.image) throw new Error("A reviewed image changed. Resolve again.");
        }
        writes.push({ node, values: [[PD_ASSET_ID, f.assetId], [PD_ASSET_VARIANT, JSON.stringify({ version: 1, variantId: v.variantId, kind: f.kind, canonicalName: f.canonicalName, variant: v.variant, referenceNodeId: f.referenceNodeId, featureSnapshot: JSON.stringify([before.features.geometrySignature, before.features.variant, before.features.visibleText]) })], [PD_ASSET_CONFIDENCE, JSON.stringify({ score: v.identityConfidence, evidence: v.identityEvidence })], [PD_ASSET_PROJECT, project]] });
      }
    }
    if (seen.size !== prepared.size) throw new Error("Review lost scanned nodes. Resolve again.");
    const undo = [];
    try {
      if (writes.length && !figma.fileKey && !figma.root.getPluginData("dsf.documentId")) {
        undo.push({ node: figma.root, key: "dsf.documentId", value: "" });
        figma.root.setPluginData("dsf.documentId", documentId);
      }
      for (const w of writes) for (const [key, value] of w.values) {
        undo.push({ node: w.node, key, value: w.node.getPluginData(key) });
        w.node.setPluginData(key, value);
      }
    } catch (e) {
      for (const u of undo.reverse()) {
        try {
          u.node.setPluginData(u.key, u.value);
        } catch {
        }
      }
      throw e;
    }
    inv.assetMap = map;
    post({ type: "assets_applied", count: writes.length, map, project });
  }

  // src/code.ts
  figma.showUI(__html__, { width: 440, height: 680, themeColors: true });
  var inventory = null;
  var busy = false;
  async function reportSheetSelection() {
    try {
      post({ type: "sheet_selection", ...await inspectSheetSelection() });
    } catch {
      post({ type: "sheet_selection", cellId: null });
    }
  }
  figma.on("selectionchange", () => {
    if (!busy) void reportSheetSelection();
  });
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
      if (msg.type === "logo_inspect" || msg.type === "logo_save") {
        if (busy) return;
        busy = true;
        try {
          post(msg.type === "logo_inspect" ? { type: "logo_inspected", data: await inspectLogo() } : { type: "logo_saved", entry: await saveLogo(msg) });
        } catch (e) {
          post({ type: "logo_error", msg: String(e) });
        } finally {
          busy = false;
        }
        return;
      }
      if (msg.type === "sheet_reference") {
        if (busy) return;
        busy = true;
        try {
          post({ type: "sheet_reference_ready", entry: await exportSheetReference(msg.cellId, msg.name, msg.assetName) });
        } finally {
          busy = false;
        }
        return;
      }
      if (msg.type === "sheet_inspect") {
        await reportSheetSelection();
        return;
      }
      if (msg.type === "sheet_identify") {
        if (busy) return;
        busy = true;
        try {
          const result = await identifySheetSelection(msg.cellId, msg.name, !!msg.match, msg.assetName);
          if (inventory) await refreshIdentifications(inventory);
          post({ type: "sheet_identified", ...result });
        } finally {
          busy = false;
        }
        return;
      }
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
        invalidateAssets();
        inventory = await scan(scope, msg.baseGrid || 4);
        post({ type: "scanned", newScan: true, summary: summarize(inventory, msg.prefix || "ds/") });
        busy = false;
        return;
      }
      if (msg.type === "relabel") {
        if (inventory) post({ type: "scanned", summary: summarize(inventory, msg.prefix || "ds/") });
        return;
      }
      if (msg.type === "assets_rebuild") {
        if (busy) return;
        busy = true;
        setCancelled(false);
        try {
          post({ type: "progress", pct: 1, msg: "Rescanning original artwork across the document\u2026" });
          inventory = await scan("document", msg.baseGrid === 8 ? 8 : 4);
          post({ type: "scanned", continuing: true, summary: summarize(inventory, msg.prefix || "ds/") });
          const result = await build(inventory, { prefix: msg.prefix || "ds/", baseGrid: msg.baseGrid === 8 ? 8 : 4, labels: false, rename: false, labelText: false, styles: false, variables: false, foundations: false, components: false, icons: false, assets: true, tidy: false });
          post({ type: "built", result });
          figma.notify("Assets rebuilt from saved names and current logo approvals.");
        } finally {
          busy = false;
        }
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
      if (msg.type === "assets_prepare") {
        if (busy) return;
        if (!inventory) throw new Error("Scan first");
        busy = true;
        setCancelled(false);
        await prepareAssets(inventory, msg.project || "default", msg.semantic || []);
        busy = false;
        return;
      }
      if (msg.type === "assets_apply") {
        if (busy) return;
        if (!inventory) throw new Error("Scan first");
        busy = true;
        setCancelled(false);
        await applyAssets(inventory, msg.map, msg.project || "default");
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
        if (!inventory && !msg.rescanDocument) {
          post({ type: "error", msg: "Scan the file first." });
          return;
        }
        busy = true;
        setCancelled(false);
        if (msg.rescanDocument) {
          post({ type: "progress", pct: 1, msg: msg.charactersOnly ? "Scanning original artwork and nested character groups\u2026" : "Rescanning original artwork for the full design system\u2026" });
          invalidateAssets();
          inventory = await scan(msg.charactersOnly && msg.characterScope === "selection" ? "selection" : "document", msg.baseGrid === 8 ? 8 : 4);
          post({ type: "scanned", newScan: true, continuing: true, summary: summarize(inventory, msg.prefix || "ds/") });
        }
        await prepareAiItems(inventory, msg.targets, Math.max(1, Math.min(2e3, msg.maxItems || 300)), !!msg.charactersOnly);
        busy = false;
        return;
      }
      if (msg.type === "ai_apply") {
        if (busy) return;
        busy = true;
        setCancelled(false);
        const n = await applyAiNames(msg.renames || [], msg.prefix || "ds/", !!msg.usePrefix);
        if (inventory) await refreshIdentifications(inventory);
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
