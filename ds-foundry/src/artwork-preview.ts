/** Preserve inherited rotation/reflection when copying artwork into an unrotated sheet frame. */
export function fitArtworkPreview(source: SceneNode, clone: SceneNode, box: FrameNode, limit = 480): void {
  // Render bounds are clipped by ancestor frames. Measure the complete copy.
  box.clipsContent = false;
  // Generated sheet frames have no rotation/scale. Copy the source's world
  // orientation before centering; its local transform may omit rotated ancestors.
  const transform = source.absoluteTransform;
  const current = clone.absoluteTransform;
  if (transform && (!current || [0,1].some(row => [0,1].some(col => Math.abs(transform[row][col]-current[row][col]) > 1e-6))))
    clone.relativeTransform = [[transform[0][0],transform[0][1],clone.x],[transform[1][0],transform[1][1],clone.y]];
  let bounds = ('absoluteRenderBounds' in clone && clone.absoluteRenderBounds) || clone.absoluteBoundingBox;
  const w = Math.max(1,bounds?.width || clone.width), h = Math.max(1,bounds?.height || clone.height);
  const scale = Math.min(1,limit/w,limit/h);
  if (scale < 1 && 'rescale' in clone) clone.rescale(scale);
  bounds = ('absoluteRenderBounds' in clone && clone.absoluteRenderBounds) || clone.absoluteBoundingBox;
  const width = bounds?.width || clone.width, height = bounds?.height || clone.height;
  // Resizing the parent with constraints can move/scale nested eye groups.
  // Fit the frame without changing any child geometry.
  box.resizeWithoutConstraints(Math.max(24,Math.ceil(width)),Math.max(24,Math.ceil(height)));
  box.clipsContent = false;
  // Resize can move auto-layout ancestors, so reread both bounds together.
  bounds = ('absoluteRenderBounds' in clone && clone.absoluteRenderBounds) || clone.absoluteBoundingBox;
  const frame = box.absoluteBoundingBox;
  if (bounds && frame) {
    clone.x += frame.x + (box.width-bounds.width)/2 - bounds.x;
    clone.y += frame.y + (box.height-bounds.height)/2 - bounds.y;
  } else {
    clone.x = (box.width-clone.width)/2;
    clone.y = (box.height-clone.height)/2;
  }
}
