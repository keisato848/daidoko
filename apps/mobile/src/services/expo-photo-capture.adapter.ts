import * as ImagePicker from 'expo-image-picker';

import type { CapturedPhoto, PhotoCaptureAdapter } from './photo-capture.service';

type RawCapturedPhoto = Omit<CapturedPhoto, 'source' | 'takenAt' | 'temporary'>;

function toCapturedPhoto(asset: ImagePicker.ImagePickerAsset | undefined): RawCapturedPhoto | null {
  if (!asset) return null;
  return {
    localPath: asset.uri,
    width: asset.width,
    height: asset.height,
    mimeType: asset.mimeType,
  };
}

async function ensureCameraPermission(): Promise<void> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error('カメラの使用が許可されていません');
}

async function ensureGalleryPermission(): Promise<void> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('写真ライブラリの使用が許可されていません');
}

export const expoImagePickerPhotoCaptureAdapter: PhotoCaptureAdapter = {
  async captureFromCamera() {
    await ensureCameraPermission();
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    return result.canceled ? null : toCapturedPhoto(result.assets[0]);
  },
  async pickFromGallery() {
    await ensureGalleryPermission();
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    return result.canceled ? null : toCapturedPhoto(result.assets[0]);
  },
};
