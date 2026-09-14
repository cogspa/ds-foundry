export type Scope = 'selection' | 'page' | 'document';

export type Category =
  | 'screen'
  | 'section'
  | 'nav'
  | 'card'
  | 'button'
  | 'input'
  | 'badge'
  | 'avatar'
  | 'image'
  | 'icon'
  | 'divider'
  | 'list-item'
  | 'checkbox'
  | 'toggle'
  | 'text'
  | 'shape'
  | 'logo'
  | 'character'
  | 'illustration'
  | 'symbol'
  | 'tagline'
  | 'copy'
  | 'debris'
  | 'other';

export interface ColorToken {
  key: string;        // hex+alpha
  hex: string;
  r: number; g: number; b: number; a: number;
  count: number;
  name: string;       // e.g. primary/500
  role: string;       // primary | neutral | success ...
  step: number;
}

export interface TypeToken {
  key: string;
  family: string;
  style: string;
  size: number;
  lineHeight: LineHeight;
  letterSpacing: LetterSpacing;
  count: number;
  name: string;       // e.g. heading/lg/bold
  role: string;       // display | heading | title | body | caption
  weight: string;     // light | regular | medium | semibold | bold
  cssWeight: number;
}

export interface SpaceToken { value: number; count: number; name: string; }
export interface RadiusToken { value: number; count: number; name: string; }

export interface EffectToken {
  key: string;
  effects: Effect[];
  count: number;
  name: string;
  css: string;
}

export interface ElementRec {
  id: string;
  category: Category;
  assetName?: import('./asset-names').AssetName | null;
  artworkRole?: 'whole' | 'part';
  partOf?: string;
  characterAncestorIds?: string[];
  nodeType?: string;
  semanticName?: string;
  originalName?: string; // saved before generated layer labels were applied
  name: string;         // original name
  text: string;         // primary text content (if any)
  w: number;
  h: number;
  fingerprint: string;
  inInstance: boolean;
  fillRole: string;     // for buttons/badges: primary | neutral | outline | ghost ...
  sizeClass: string;    // sm | md | lg
  textRole: string;     // for text nodes: heading/lg/bold
  desc: string;         // deterministic description for shapes/vectors (e.g. navy-outline-blob-56x30)
  page: string;
  identity?: import('./asset-types').IdentityFeatures;
  layout?: import('./asset-types').LayoutMetadata;
}

export interface ComponentRef { id: string; name: string; remote: boolean; count: number; }

export interface Inventory {
  scope: Scope;
  artworkParts?: {nodeId:string;ownerId:string;name:string;nodeType:string;layout?:import('./asset-types').LayoutMetadata}[];
  characterCandidates?: ElementRec[]; // Nested groups stay out of sheets until approved as whole characters.
  characterCandidatesDeferred?: number;
  assetMap?: import('./asset-types').AssetMap;
  pages: string[];
  pageIds: string[];
  nodeCount: number;
  colors: ColorToken[];
  types: TypeToken[];
  spacing: SpaceToken[];
  radii: RadiusToken[];
  effects: EffectToken[];
  elements: ElementRec[];
  icons: ElementRec[];
  shapes: ElementRec[];      // plain geometry that is not an icon, divider or image — every one gets a descriptive name
  components: ComponentRef[];
  fonts: { family: string; style: string }[];
  missingFonts: string[];
}

export interface BuildOptions {
  prefix: string;
  labels: boolean;
  labelText: boolean;
  rename: boolean;
  styles: boolean;
  variables: boolean;
  foundations: boolean;
  components: boolean;
  icons: boolean;
  tidy: boolean;
  assets: boolean;       // build the DS · Assets contact sheet
  baseGrid: number;
}

export interface BuildResult {
  paintStyles: number;
  textStyles: number;
  effectStyles: number;
  variables: number;
  labeled: number;
  componentSets: number;
  components: number;
  icons: number;
  assets: number;
  pages: string[];
  notes: string[];
  files: Record<string, string>;
}

/** Compact inventory summary sent to the UI */
export interface InventorySummary {
  scope: Scope;
  pages: string[];
  nodeCount: number;
  colors: { hex: string; a: number; name: string; count: number; role: string }[];
  types: { name: string; family: string; style: string; size: number; count: number }[];
  spacing: { name: string; value: number; count: number }[];
  radii: { name: string; value: number; count: number }[];
  effects: { name: string; css: string; count: number }[];
  elements: Record<string, { count: number; samples: string[] }>;
  icons: { count: number; samples: string[] };
  shapes: { count: number; samples: string[] };
  debris: number;
  components: { name: string; remote: boolean; count: number }[];
  fonts: string[];
  missingFonts: string[];
}
