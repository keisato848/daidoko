/**
 * 写真を**切り取らずに**全画面で見るビューア。
 *
 * 一覧・詳細の写真は `resizeMode="cover"` で枠に合わせて切っている（レイアウトが揃うので
 * それ自体は正しい）。ただし切られた端が見たいことがあるので、**押したら元の縦横比のまま
 * 開ける**逃げ道を用意する。
 *
 * 拡大縮小は載せない。`react-native-gesture-handler` が入っていないので、
 * ピンチを自前で捌くと ScrollView と競合する。**まずは「切らずに全部見える」まで**。
 */
import { X } from 'lucide-react-native';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';

import { Colors } from '../constants/theme';
import { t } from '../i18n';

interface Props {
  /** null なら閉じている */
  uri: string | null;
  onClose: () => void;
}

export function PhotoViewer({ uri, onClose }: Props) {
  return (
    <Modal visible={uri != null} transparent animationType="fade" onRequestClose={onClose}>
      {/* 背景のどこを押しても閉じる。写真だけを見に来ているので、閉じ方は多いほどよい */}
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')}>
        {uri != null && (
          <Image source={{ uri }} style={styles.photo} resizeMode="contain" accessible={false} />
        )}
        <View style={styles.closeButton} pointerEvents="none">
          <X size={22} color={Colors.paper} />
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    // 写真だけを見せたいので、シートより濃く落とす
    backgroundColor: 'rgba(6,4,2,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  closeButton: {
    position: 'absolute',
    top: 44,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(10,8,5,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
