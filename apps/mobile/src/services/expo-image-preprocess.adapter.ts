import { manipulateAsync, SaveFormat, type ImageResult } from 'expo-image-manipulator';

import type { ImageInfo, ImagePreprocessAdapter } from './image-preprocess.service';

function toImageInfo(result: ImageResult): ImageInfo {
  return {
    imageUri: result.uri,
    width: result.width,
    height: result.height,
  };
}

function buildResizeAction(info: ImageInfo, maxDimension: number) {
  return info.width >= info.height
    ? { resize: { width: maxDimension } }
    : { resize: { height: maxDimension } };
}

export const expoImageManipulatorPreprocessAdapter: ImagePreprocessAdapter = {
  async getInfo(imageUri) {
    const result = await manipulateAsync(imageUri, [], { compress: 1, format: SaveFormat.JPEG });
    return toImageInfo(result);
  },
  async resize(imageUri, options) {
    const info = await this.getInfo(imageUri);
    const result = await manipulateAsync(
      imageUri,
      [buildResizeAction(info, options.maxDimension)],
      {
        compress: 0.9,
        format: SaveFormat.JPEG,
      },
    );
    return toImageInfo(result);
  },
};
