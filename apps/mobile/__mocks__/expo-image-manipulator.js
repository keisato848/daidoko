/* global jest */
/**
 * Manual Jest mock for expo-image-manipulator — keeps the native module out of
 * unit tests. manipulate(uri) renders a fake 4000x3000 image whose saveAsync
 * yields "<uri sans extension>-compressed.jpg".
 */
const makeContext = (uri) => ({
  resize: jest.fn(function resize() {
    return this;
  }),
  renderAsync: jest.fn(async () => ({
    width: 4000,
    height: 3000,
    saveAsync: jest.fn(async () => ({
      uri: `${uri.replace(/\.[A-Za-z0-9]+$/, '')}-compressed.jpg`,
      width: 1600,
      height: 1200,
    })),
  })),
});

module.exports = {
  ImageManipulator: {
    manipulate: jest.fn((uri) => makeContext(uri)),
  },
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
  FlipType: { Vertical: 'vertical', Horizontal: 'horizontal' },
};
