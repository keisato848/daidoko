import { NativeModules } from 'react-native';

export interface ClientImageLabel {
  text: string;
  confidence: number;
  index?: number;
}

interface NativeImageLabelModule {
  isAvailable: () => Promise<boolean>;
  labelImage: (imageUri: string) => Promise<ClientImageLabel[]>;
}

function isNativeImageLabelModule(value: unknown): value is NativeImageLabelModule {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as { isAvailable?: unknown; labelImage?: unknown };
  return typeof candidate.isAvailable === 'function' && typeof candidate.labelImage === 'function';
}

function getNativeImageLabelModule(): NativeImageLabelModule | null {
  const moduleCandidate: unknown = NativeModules['DaidokoOcr'];
  return isNativeImageLabelModule(moduleCandidate) ? moduleCandidate : null;
}

function normalizeLabels(labels: ClientImageLabel[]): ClientImageLabel[] {
  return labels
    .filter((label) => label.text.trim())
    .map((label) => ({
      text: label.text.trim(),
      confidence: Number.isFinite(label.confidence) ? label.confidence : 0,
      index: label.index,
    }))
    .sort((left, right) => right.confidence - left.confidence);
}

export async function isClientImageLabelingAvailable(): Promise<boolean> {
  const module = getNativeImageLabelModule();
  return module ? module.isAvailable() : false;
}

export function createClientImageLabeler():
  | ((imageUri: string) => Promise<ClientImageLabel[]>)
  | undefined {
  const module = getNativeImageLabelModule();
  if (!module) return undefined;
  return async (imageUri) => normalizeLabels(await module.labelImage(imageUri));
}
