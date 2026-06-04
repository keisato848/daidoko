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

  it('does not open the gallery when media library permission is denied', async () => {
    mockedImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: false,
      expires: 'never',
      status: ImagePicker.PermissionStatus.DENIED,
      accessPrivileges: 'none',
    });

    await expect(expoImagePickerPhotoCaptureAdapter.pickFromGallery()).rejects.toThrow(
      '写真ライブラリの使用が許可されていません',
    );
    expect(mockedImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });
});
