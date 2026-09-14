/** Candidate collection only: vector complexity never confirms character identity. */
export function characterGroupCandidate(node: SceneNode): boolean {
  if (!['GROUP','FRAME','COMPONENT','INSTANCE','BOOLEAN_OPERATION'].includes(node.type) || !('children' in node)) return false;
  if (node.width < 12 || node.height < 12 || node.width/node.height < .2 || node.width/node.height > 5) return false;
  if ('isMask' in node && node.isMask) return false;
  let current: BaseNode | null = node;
  while (current && current.type !== 'PAGE' && current.type !== 'DOCUMENT') {
    if ('visible' in current && !current.visible || 'opacity' in current && current.opacity === 0) return false;
    current = current.parent;
  }
  let vectors = 0, texts = 0, visited = 0;
  const stack: {node:SceneNode;depth:number}[] = [{node,depth:0}];
  while (stack.length && visited++ < 160) {
    const {node:n,depth} = stack.pop()!;
    if (n.visible === false || 'opacity' in n && n.opacity === 0) continue;
    if (n.type === 'TEXT') {texts++;continue;}
    if (['VECTOR','BOOLEAN_OPERATION','ELLIPSE','RECTANGLE','POLYGON','STAR'].includes(n.type)) vectors++;
    if ('children' in n && depth < 10) for (const child of n.children) stack.push({node:child,depth:depth+1});
  }
  return vectors >= 4 && texts <= 2;
}

export function sourceAncestors(node: SceneNode): string[] {
  const ids: string[] = [];
  let parent = node.parent;
  while (parent && parent.type !== 'PAGE' && parent.type !== 'DOCUMENT') {ids.push(parent.id);parent=parent.parent;}
  return ids;
}
