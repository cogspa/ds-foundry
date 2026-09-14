/** A named fragment can identify a character without depicting the whole figure. */
export function characterPart(name = '', crop = ''): boolean {
  if (crop && !/^(whole|full|full-body|uncropped)$/i.test(crop)) return true;
  const normalized = name.toLowerCase().replace(/[_/\s]+/g, '-').replace(/-\d+$/, '');
  if (/(?:^|-)(?:full|whole)-body$/.test(normalized)) return false;
  return /(?:^|-)(?:body-only|body|wing|wings|beak|eye|eyes|eyes-only|face-only|head-only|foot|feet|hand|hands|tail|arm|arms|leg|legs)(?:-only)?$/.test(normalized);
}

export function characterLabel(name = ''): boolean {
  return /(?:^|[\s/_-])(ollie|owl|owls|mascot|character|penguin|bird)(?:$|[\s/_-])/i.test(name);
}
