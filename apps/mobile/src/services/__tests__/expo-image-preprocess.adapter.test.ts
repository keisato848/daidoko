import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { expoImageManipulatorPreprocessAdapter } from '../expo-image-preprocess.adapter';

jest.mock('expo-image-manipulator', () => {
  const saveAsyncMock = jest.fn();
  const renderAsyncMock = jest.fn();
  const resizeMock = jest.fn();

  const contextMock = {
    resize: resizeMock,
    renderAsync: renderAsyncMock,
  };

  return {
    SaveFormat: { JPEG: 'jpeg' },
    ImageManipulator: {
      manipulate: jest.fn(() => contextMock),
    },
    _mocks: {
      saveAsyncMock,
      renderAsyncMock,
      resizeMock,
      contextMock,
    },
  };
});

const { _mocks } = jest.requireMock<{
  _mocks: {
    saveAsyncMock: jest.Mock;
    renderAsyncMock: jest.Mock;
    resizeMock: jest.Mock;
    contextMock: { resize: jest.Mock; renderAsync: jest.Mock };
  };
}>('expo-image-manipulator');

describe('expoImageManipulatorPreprocessAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _mocks.saveAsyncMock.mockReset();
    _mocks.contextMock.resize.mockReturnValue(_mocks.contextMock);
    _mocks.renderAsyncMock.mockResolvedValue({
      saveAsync: _mocks.saveAsyncMock,
    });
  });

  describe('resize', () => {
    it('calls manipulate exactly once when width and height are provided (landscape)', async () => {
      _mocks.saveAsyncMock.mockResolvedValue({
        uri: 'file:///tmp/out.jpg',
        width: 1200,
        height: 900,
      });

      const resize = expoImageManipulatorPreprocessAdapter.resize;
      if (!resize) throw new Error('resize must be defined');

      const result = await resize.call(
        expoImageManipulatorPreprocessAdapter,
        'file:///tmp/in.jpg',
        {
          maxDimension: 1200,
          width: 2400,
          height: 1800,
        },
      );

      expect(ImageManipulator.manipulate).toHaveBeenCalledTimes(1);
      expect(ImageManipulator.manipulate).toHaveBeenCalledWith('file:///tmp/in.jpg');
      expect(_mocks.resizeMock).toHaveBeenCalledWith({ width: 1200 });
      expect(_mocks.renderAsyncMock).toHaveBeenCalledTimes(1);
      expect(_mocks.saveAsyncMock).toHaveBeenCalledWith({ compress: 0.9, format: SaveFormat.JPEG });

      expect(result).toEqual({
        imageUri: 'file:///tmp/out.jpg',
        width: 1200,
        height: 900,
      });
    });

    it('calls manipulate exactly once when width and height are provided (portrait)', async () => {
      _mocks.saveAsyncMock.mockResolvedValue({
        uri: 'file:///tmp/out.jpg',
        width: 900,
        height: 1200,
      });

      const resize = expoImageManipulatorPreprocessAdapter.resize;
      if (!resize) throw new Error('resize must be defined');

      await resize.call(expoImageManipulatorPreprocessAdapter, 'file:///tmp/in.jpg', {
        maxDimension: 1200,
        width: 1800,
        height: 2400,
      });

      expect(ImageManipulator.manipulate).toHaveBeenCalledTimes(1);
      expect(_mocks.resizeMock).toHaveBeenCalledWith({ height: 1200 });
    });

    it('calls manipulate twice when width and height are not provided (fallback to getInfo)', async () => {
      // getInfo returns some dimensions
      _mocks.saveAsyncMock.mockResolvedValueOnce({
        uri: 'file:///tmp/info.jpg',
        width: 2400,
        height: 1800,
      });
      // resize returns resized dimensions
      _mocks.saveAsyncMock.mockResolvedValueOnce({
        uri: 'file:///tmp/out.jpg',
        width: 1200,
        height: 900,
      });

      const resize = expoImageManipulatorPreprocessAdapter.resize;
      if (!resize) throw new Error('resize must be defined');

      await resize.call(expoImageManipulatorPreprocessAdapter, 'file:///tmp/in.jpg', {
        maxDimension: 1200,
      });

      // Once in getInfo, once in resize
      expect(ImageManipulator.manipulate).toHaveBeenCalledTimes(2);
      expect(_mocks.resizeMock).toHaveBeenCalledWith({ width: 1200 });
    });
  });
});
