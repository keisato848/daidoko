import { preprocessImageForOcr, type ImagePreprocessAdapter } from '../image-preprocess.service';

describe('OCR-SVC-01 preprocessImageForOcr', () => {
  it('resizes large images through the adapter', async () => {
    const adapter: ImagePreprocessAdapter = {
      getInfo: async () => ({ imageUri: 'file:///tmp/original.jpg', width: 2400, height: 1800 }),
      resize: async (imageUri, options) => ({
        imageUri: `${imageUri}?max=${options.maxDimension}`,
        width: 1200,
        height: 900,
      }),
    };

    const result = await preprocessImageForOcr('file:///tmp/original.jpg', adapter);

    expect(result).toMatchObject({
      imageUri: 'file:///tmp/original.jpg?max=1200',
      width: 1200,
      height: 900,
      warnings: [],
    });
  });

  it('warns when the processed image is too small', async () => {
    const result = await preprocessImageForOcr('file:///tmp/small.jpg', {
      getInfo: async () => ({ imageUri: 'file:///tmp/small.jpg', width: 640, height: 480 }),
    });

    expect(result.warnings).toContainEqual({
      code: 'IMAGE_TOO_SMALL',
      message: '画像が小さすぎます',
    });
  });

  it('warns when file size is above OCR budget', async () => {
    const result = await preprocessImageForOcr('file:///tmp/large-file.jpg', {
      getInfo: async () => ({
        imageUri: 'file:///tmp/large-file.jpg',
        width: 1200,
        height: 900,
        fileSizeBytes: 3 * 1024 * 1024,
      }),
    });

    expect(result.warnings).toContainEqual({
      code: 'IMAGE_TOO_LARGE',
      message: '画像サイズが大きすぎます',
    });
  });
});
