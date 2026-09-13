import { Category } from './types';

export interface VariantProperties {
  color?: string; orientation?: string; treatment?: string; lockup?: string;
  state?: string; crop?: string; pose?: string;
}
export interface LayoutMetadata {
  nodeId: string; parentId?: string; parentSemanticRole?: string; zIndex: number;
  absoluteBounds?: { x: number; y: number; width: number; height: number };
  normalizedBounds?: { x: number; y: number; width: number; height: number };
  rotation: number; aspectRatio: number;
  constraints?: unknown; autoLayout?: string; sizingHorizontal?: string; sizingVertical?: string;
  alignment?: unknown; padding?: number[]; gap?: number; componentFamily?: string;
  mainComponentId?: string; componentProperties?: unknown; styles?: unknown; variables?: unknown;
}
export interface IdentityFeatures {
  version: 1; geometrySignature?: string; geometryReliable: boolean;
  visualSignature?: string; visibleText: string; componentFamily?: string;
  variant: VariantProperties; warnings: string[];
}
export interface AssetItem {
  nodeId: string; kind: Category; name: string; semanticName?: string; description?: string;
  fingerprint: string; width: number; height: number; page: string; features: IdentityFeatures;
  layout?: LayoutMetadata; image?: string; approvedAssetId?: string; approvedVariant?: VariantProperties;
}
export interface AssetVariant extends AssetItem {
  assetId: string; canonicalName: string; variantId: string; variant: VariantProperties;
  identityConfidence: number; identityEvidence: string[]; aspectRatio: number;
}
export interface AssetFamily {
  assetId: string; canonicalName: string; kind: Category; variants: AssetVariant[];
  confidence: number; aliases: string[]; referenceNodeId?: string; brandFamily?: string;
  status: 'pending' | 'approved'; supersedes: string[];
}
export interface AssetProposal {
  left: string; right: string; confidence: number; evidence: string[];
  relation: 'same' | 'related' | 'uncertain'; canonicalName?: string;
}
export interface AssetMap {
  schemaVersion: 1; documentId: string; assets: AssetFamily[]; proposals: AssetProposal[];
  warnings: string[]; calls: number; candidateCount: number;
}
