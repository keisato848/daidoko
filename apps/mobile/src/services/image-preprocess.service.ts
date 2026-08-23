import { t } from '../i18n';
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

/**
 * 既定は**サーバーへ送る画像**に合わせた値（アップロードのサイズ制約がある）。
 * 端末内 OCR は送らないので `ON_DEVICE_OCR_MAX_DIMENSION` を明示して使う。
 */
const DEFAULT_MAX_DIMENSION = 1200;

/**
 * 端末内 OCR に渡す画像の長辺。**送信しないので、読める大きさを優先する。**
 *
 * 既定の 1200 で読ませると、実測（AQUOS + S&B シーズニング裏面・2026-08-23）で
 * 4320x7680 の写真が **675x1200** まで潰れ、本文が数ピクセルになっていた。
 * 結果、ML Kit が 1 文を 8〜10 個の断片に割り、「300g→3005」「耐熱皿→耐禁E」のような
 * 誤読が出る。しかも**自分で縮めた画像に対して「画像が小さすぎます」と警告する**状態だった。
 */
export const ON_DEVICE_OCR_MAX_DIMENSION = 3000;
const DEFAULT_MIN_SHORT_EDGE = 800;
const DEFAULT_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

function buildWarnings(
  info: ImageInfo,
  options: Required<ImagePreprocessOptions>,
): ImageQualityWarning[] {
  const warnings: ImageQualityWarning[] = [];
  if (Math.min(info.width, info.height) < options.minShortEdge) {
    warnings.push({ code: 'IMAGE_TOO_SMALL', message: t('error.imageTooSmall') });
  }
  if (info.fileSizeBytes != null && info.fileSizeBytes > options.maxFileSizeBytes) {
    warnings.push({ code: 'IMAGE_TOO_LARGE', message: t('error.imageTooLarge') });
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
