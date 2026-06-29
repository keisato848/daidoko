import { ImageManipulator, SaveFormat, type ImageResult } from 'expo-image-manipulator';

import type { ImageInfo, ImagePreprocessAdapter } from './image-preprocess.service';

function toImageInfo(result: ImageResult): ImageInfo {
  return {
    imageUri: result.uri,
    width: result.width,
    height: result.height,
  };
}

export const expoImageManipulatorPreprocessAdapter: ImagePreprocessAdapter = {
  async getInfo(imageUri) {
    const ref = await ImageManipulator.manipulate(imageUri).renderAsync();
    const result = await ref.saveAsync({ compress: 1, format: SaveFormat.JPEG });
    return toImageInfo(result);
  },
  async resize(imageUri, options) {
    const info = await this.getInfo(imageUri);
    const context = ImageManipulator.manipulate(imageUri).resize(
      info.width >= info.height
        ? { width: options.maxDimension }
        : { height: options.maxDimension },
    );
    const ref = await context.renderAsync();
    const result = await ref.saveAsync({ compress: 0.9, format: SaveFormat.JPEG });
    return toImageInfo(result);
  },
};
