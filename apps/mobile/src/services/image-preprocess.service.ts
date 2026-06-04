/**
 * ImagePreprocess service — adapter boundary for OCR image preparation.
 */
export type ImageQualityWarningCode = 'IMAGE_TOO_SMALL' | 'IMAGE_TOO_LARGE';

export interface ImageQualityWarning {
  code: ImageQualityWarningCode;
  message: string;
}

export interface ImageInfo {
  imageUri: string;
  width: number;
  height: number;
  fileSizeBytes?: number;
}

export interface ImagePreprocessAdapter {
  getInfo: (imageUri: string) => Promise<ImageInfo>;
  resize?: (imageUri: string, options: { maxDimension: number }) => Promise<ImageInfo>;
}

export interface ImagePreprocessOptions {
  maxDimension?: number;
  minShortEdge?: number;
  maxFileSizeBytes?: number;
}

export interface ImagePreprocessResult extends ImageInfo {
  warnings: ImageQualityWarning[];
}

const DEFAULT_MAX_DIMENSION = 1200;
const DEFAULT_MIN_SHORT_EDGE = 800;
const DEFAULT_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

function buildWarnings(
  info: ImageInfo,
  options: Required<ImagePreprocessOptions>,
): ImageQualityWarning[] {
  const warnings: ImageQualityWarning[] = [];
  if (Math.min(info.width, info.height) < options.minShortEdge) {
    warnings.push({ code: 'IMAGE_TOO_SMALL', message: '画像が小さすぎます' });
  }
  if (info.fileSizeBytes != null && info.fileSizeBytes > options.maxFileSizeBytes) {
    warnings.push({ code: 'IMAGE_TOO_LARGE', message: '画像サイズが大きすぎます' });
  }
  return warnings;
}

function withDefaults(options: ImagePreprocessOptions = {}): Required<ImagePreprocessOptions> {
  return {
    maxDimension: options.maxDimension ?? DEFAULT_MAX_DIMENSION,
    minShortEdge: options.minShortEdge ?? DEFAULT_MIN_SHORT_EDGE,
    maxFileSizeBytes: options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES,
  };
}

export async function preprocessImageForOcr(
  imageUri: string,
  adapter: ImagePreprocessAdapter,
  options: ImagePreprocessOptions = {},
): Promise<ImagePreprocessResult> {
  const resolvedOptions = withDefaults(options);
  const original = await adapter.getInfo(imageUri);
  const needsResize = Math.max(original.width, original.height) > resolvedOptions.maxDimension;
  const processed =
    needsResize && adapter.resize
      ? await adapter.resize(original.imageUri, { maxDimension: resolvedOptions.maxDimension })
      : original;

  return {
    ...processed,
    warnings: buildWarnings(processed, resolvedOptions),
  };
}
