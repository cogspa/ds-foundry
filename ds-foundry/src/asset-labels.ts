import {assetName} from './asset-names';
import {isDefaultName} from './naming';
import {ElementRec} from './types';

/** Shared by sheets and naming: a geometry label is not an identification. */
export function descriptiveName(value: string | undefined, prefix = 'ds/'): string | undefined {
  if (!value) return;
  let path = value.trim();
  if (prefix && path.startsWith(prefix)) path = path.slice(prefix.length);
  // The saved category can change after review; accept any old category path.
  path = path.replace(/^(?:[^/]+\/)?(icon|symbol|logo|character|illustration|image|avatar|screen|section|nav|card|button|input|shape|debris|component)\//, '');
  const leaf = path.split('/').pop()!.replace(/[-_]/g, ' ');
  if (!leaf || isDefaultName(leaf) || /^(icon|symbol|logo|character|illustration|component|screen|section|other)(\s*\d+)?$/i.test(leaf)) return;
  if (/needs[\s-]+identification|possible[\s-]+debris|\d+[- ]piece|\d+[x×]\d+/i.test(path)) return;
  return path;
}

export function establishedName(rec: Pick<ElementRec, 'name' | 'category' | 'semanticName' | 'originalName' | 'assetName'>, prefix = 'ds/'): string | undefined {
  // Explicit identifications retain their spelling, including short user-chosen names.
  if (rec.semanticName?.trim() && !/needs[\s-]+identification/i.test(rec.semanticName)) return rec.semanticName.trim();
  if (rec.assetName) return assetName(rec.assetName);
  return descriptiveName(rec.name, prefix) || descriptiveName(rec.originalName, prefix);
}
