import { LayoutMetadata } from './asset-types';

/** Snapshot only. Coordinates are relative to the parent's local axes, not its rotated AABB. */
export function layoutMetadata(node: SceneNode): LayoutMetadata {
  const p = node.parent;
  const a = node as SceneNode & Partial<FrameNode>;
  const meta: LayoutMetadata = {
    nodeId: node.id, parentId: p?.id, zIndex: p && 'children' in p ? p.children.indexOf(node as never) : 0,
    rotation: 'rotation' in node ? node.rotation : 0, aspectRatio: node.height > 0 ? node.width / node.height : 0,
    absoluteBounds: node.absoluteBoundingBox ? { ...node.absoluteBoundingBox } : undefined,
  };
  if (p && 'width' in p && p.width > 0 && p.height > 0) {
    const t = node.relativeTransform;
    meta.normalizedBounds = { x: t[0][2] / p.width, y: t[1][2] / p.height, width: node.width / p.width, height: node.height / p.height };
  }
  if ('constraints' in node) meta.constraints = node.constraints;
  if ('layoutMode' in node) {
    meta.autoLayout = a.layoutMode;
    meta.padding = [a.paddingTop!, a.paddingRight!, a.paddingBottom!, a.paddingLeft!];
    meta.gap = a.itemSpacing;
    meta.alignment = { primary: a.primaryAxisAlignItems, counter: a.counterAxisAlignItems };
  }
  meta.sizingHorizontal = a.layoutSizingHorizontal; meta.sizingVertical = a.layoutSizingVertical;
  if ('componentProperties' in node) meta.componentProperties = node.componentProperties;
  meta.styles = { fill: a.fillStyleId, stroke: a.strokeStyleId, effect: a.effectStyleId };
  if ('boundVariables' in node) meta.variables = node.boundVariables;
  return meta;
}
