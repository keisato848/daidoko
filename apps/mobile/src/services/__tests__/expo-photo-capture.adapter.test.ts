import * as ImagePicker from 'expo-image-picker';

import { expoImagePickerPhotoCaptureAdapter } from '../expo-photo-capture.adapter';

jest.mock('expo-image-picker', () => ({
  MediaTypeOptions: { Images: 'Images' },
  PermissionStatus: { DENIED: 'denied' },
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

const mockedImagePicker = ImagePicker as jest.Mocked<typeof ImagePicker>;

describe('OCR-REQ-01 Expo photo capture adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not launch the camera when camera permission is denied', async () => {
    mockedImagePicker.requestCameraPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: false,
      expires: 'never',
      status: ImagePicker.PermissionStatus.DENIED,
    });

    await expect(expoImagePickerPhotoCaptureAdapter.captureFromCamera()).rejects.toThrow(
      'カメラの使用が許可されていません',
    );
    expect(mockedImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('opens the gallery via the system photo picker without requesting media library permission', async () => {
    mockedImagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: true,
      assets: null,
    });

    await expoImagePickerPhotoCaptureAdapter.pickFromGallery();

    expect(mockedImagePicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
    expect(mockedImagePicker.launchImageLibraryAsync).toHaveBeenCalled();
  });
});
