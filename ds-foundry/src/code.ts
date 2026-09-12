import { Inventory, InventorySummary, BuildOptions, Scope } from './types';
import { scan } from './scan';
import { build, revertLabels } from './build';
import { elementLabel } from './naming';
import { post, setCancelled, rgbaCss, round } from './util';
import { prepareAiItems, applyAiNames, getApiKeys, setApiKey } from './ai';

figma.showUI(__html__, { width: 440, height: 680, themeColors: true });

let inventory: Inventory | null = null;
let busy = false;

function summarize(inv: Inventory, prefix: string): InventorySummary {
  const elements: InventorySummary['elements'] = {};
  for (const e of inv.elements) {
    const slot = (elements[e.category] = elements[e.category] || { count: 0, samples: [] });
    slot.count++;
    if (slot.samples.length < 6) {
      const label = elementLabel(e, prefix);
      if (!slot.samples.includes(label)) slot.samples.push(label);
    }
  }
  const iconSamples: string[] = [];
  for (const i of inv.icons) { const l = elementLabel(i, prefix); if (iconSamples.length < 8 && !iconSamples.includes(l)) iconSamples.push(l); }
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
    debris: inv.elements.filter((e) => e.category === 'debris').length,
    components: inv.components.slice(0, 40).map((c) => ({ name: c.name, remote: c.remote, count: c.count })),
    fonts: inv.fonts.map((f) => `${f.family} ${f.style}`),
    missingFonts: inv.missingFonts,
  };
}

figma.ui.onmessage = async (msg: { type: string; [k: string]: any }) => {
  try {
    if (msg.type === 'cancel') { setCancelled(true); return; }

    if (msg.type === 'scan') {
      if (busy) return;
      busy = true; setCancelled(false);
      const scope: Scope = msg.scope;
      if (scope === 'selection' && figma.currentPage.selection.length === 0) {
        post({ type: 'error', msg: 'Select one or more frames first, or switch the scope to Page or Document.' });
        busy = false; return;
      }
      post({ type: 'progress', pct: 2, msg: 'Loading pages…' });
      inventory = await scan(scope, msg.baseGrid || 4);
      post({ type: 'scanned', summary: summarize(inventory, msg.prefix || 'ds/') });
      busy = false; return;
    }

    if (msg.type === 'relabel') {
      if (inventory) post({ type: 'scanned', summary: summarize(inventory, msg.prefix || 'ds/') });
      return;
    }

    if (msg.type === 'build') {
      if (busy) return;
      if (!inventory) { post({ type: 'error', msg: 'Scan the file first.' }); return; }
      busy = true; setCancelled(false);
      const opts: BuildOptions = msg.options;
      const result = await build(inventory, opts);
      post({ type: 'built', result });
      figma.notify(`DS Foundry: ${result.paintStyles + result.textStyles + result.effectStyles} styles · ${result.variables} variables · ${result.componentSets} component sets · ${result.icons} icons`);
      busy = false; return;
    }

    if (msg.type === 'revert') {
      if (busy) return;
      busy = true;
      const n = await revertLabels();
      post({ type: 'reverted', count: n });
      figma.notify(`Restored ${n} layer names`);
      busy = false; return;
    }

    if (msg.type === 'ai_key_get') { post({ type: 'ai_keys', keys: await getApiKeys() }); return; }
    if (msg.type === 'ai_key_set') { await setApiKey(msg.provider, msg.key || ''); return; }

    if (msg.type === 'ai_prepare') {
      if (busy) return;
      if (!inventory) { post({ type: 'error', msg: 'Scan the file first.' }); return; }
      busy = true; setCancelled(false);
      await prepareAiItems(inventory, msg.targets, msg.maxItems || 300);
      busy = false; return;
    }

    if (msg.type === 'ai_apply') {
      if (busy) return;
      busy = true; setCancelled(false);
      const n = await applyAiNames(msg.renames || [], msg.prefix || 'ds/', !!msg.usePrefix);
      post({ type: 'ai_applied', count: n });
      figma.notify(`Renamed ${n} layers`);
      busy = false; return;
    }

    if (msg.type === 'select') {
      if (!inventory) return;
      const cat = msg.category as string;
      const here = figma.currentPage.name;
      const recs = [...inventory.elements, ...inventory.icons, ...inventory.shapes].filter((r) => r.category === cat && !r.inInstance);
      const onPage = recs.filter((r) => r.page === here);
      const nodes: SceneNode[] = [];
      for (const r of onPage) { const n = await figma.getNodeByIdAsync(r.id); if (n && !n.removed && n.type !== 'PAGE' && n.type !== 'DOCUMENT') nodes.push(n as SceneNode); }
      figma.currentPage.selection = nodes;
      if (nodes.length) figma.viewport.scrollAndZoomIntoView(nodes);
      figma.notify(nodes.length ? `Selected ${nodes.length} ${cat} layer${nodes.length === 1 ? '' : 's'} on this page` : `No ${cat} on this page${recs.length ? ` (${recs.length} on other pages)` : ''}`);
      return;
    }

    if (msg.type === 'resize') { figma.ui.resize(440, Math.max(480, Math.min(900, msg.height | 0))); return; }
    if (msg.type === 'close') { figma.closePlugin(); return; }
  } catch (e: any) {
    busy = false;
    const m = String(e && e.message ? e.message : e);
    if (m === 'cancelled') post({ type: 'error', msg: 'Stopped. Nothing else was changed.' });
    else post({ type: 'error', msg: m });
  }
};
