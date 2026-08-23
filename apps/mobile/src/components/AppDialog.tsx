/**
 * アプリのデザインのダイアログ（`docs/画面設計.md` §7）。
 *
 * OS 標準の `Alert.alert` は Android では Material、iOS では `UIAlertController` の
 * 見た目で出て、暗い背景とゴールドの世界観から浮く。その置き換え。
 *
 * **状態を持たない。** 何を出すかは `dialog.store` が持ち、`DialogHost` が渡す。
 * ここを純粋に保つことで、見た目とボタンの並びだけをテストできる。
 *
 * - `layout: 'card'` … 画面中央のカード。**通知（OK のみ）専用**
 * - `layout: 'sheet'` … ボトムシート。確認・破壊的確認・選択肢
 *
 * 「下から出てくるものは必ず選択を伴う」と決めてあるので、通知をシートで出さないこと。
 */
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from './BottomSheet';
import { Colors, Typography } from '../constants/theme';
import { t } from '../i18n';

/** ボタンの見た目。`default` は枠だけ（キャンセル・選択肢）。 */
export type DialogTone = 'default' | 'primary' | 'destructive';

export interface DialogButton {
  label: string;
  tone: DialogTone;
}

export type DialogLayout = 'card' | 'sheet';

export interface AppDialogProps {
  layout: DialogLayout;
  title: string;
  message?: string;
  buttons: readonly DialogButton[];
  /** ボタンが押された。index は `buttons` の添字 */
  onPress: (index: number) => void;
  /** 背景タップ・Android の戻るキー */
  onDismiss: () => void;
}

/** 3 つ以上は横に並べると文字が潰れるので縦積みにする（§7-2）。 */
function isStacked(buttonCount: number): boolean {
  return buttonCount > 2;
}

function DialogButtons({
  buttons,
  onPress,
}: {
  buttons: readonly DialogButton[];
  onPress: (index: number) => void;
}) {
  const stacked = isStacked(buttons.length);
  return (
    <View style={stacked ? styles.buttonsStacked : styles.buttonsRow}>
      {buttons.map((button, index) => (
        <Pressable
          key={`${button.label}-${index}`}
          accessibilityRole="button"
          style={[
            styles.button,
            stacked ? styles.buttonStacked : styles.buttonInRow,
            button.tone === 'primary' && styles.buttonPrimary,
            button.tone === 'destructive' && styles.buttonDestructive,
          ]}
          onPress={() => onPress(index)}
        >
          <Text
            style={[
              styles.buttonText,
              button.tone === 'primary' && styles.buttonTextPrimary,
              button.tone === 'destructive' && styles.buttonTextDestructive,
            ]}
          >
            {button.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function AppDialog({ layout, title, message, buttons, onPress, onDismiss }: AppDialogProps) {
  const body = (
    <>
      {message != null && message !== '' && (
        <ScrollView style={styles.messageScroll} bounces={false}>
          <Text style={styles.message}>{message}</Text>
        </ScrollView>
      )}
      <DialogButtons buttons={buttons} onPress={onPress} />
    </>
  );

  if (layout === 'sheet') {
    return (
      <BottomSheet visible onClose={onDismiss} title={title}>
        {body}
      </BottomSheet>
    );
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable
        style={styles.backdrop}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        onPress={onDismiss}
      >
        {/* カード自体のタップで閉じない。中身は別ツリー扱いにしない（入力欄は置かない規約） */}
        <Pressable
          accessibilityViewIsModal
          style={styles.card}
          onPress={(event) => event.stopPropagation()}
        >
          <Text style={styles.cardTitle}>{title}</Text>
          {body}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.bgOverlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 20,
  },
  cardTitle: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.medium,
    color: Colors.paper,
    textAlign: 'center',
    marginBottom: 12,
  },
  // 長文でもボタンが画面外に出ないよう、本文だけをスクロールさせる
  messageScroll: {
    maxHeight: 240,
    marginBottom: 20,
  },
  message: {
    fontSize: Typography.size.sm,
    color: Colors.paperDim,
    lineHeight: 20,
    textAlign: 'center',
  },
  buttonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  buttonsStacked: {
    gap: 10,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  buttonInRow: {
    flex: 1,
  },
  buttonStacked: {
    width: '100%',
  },
  buttonPrimary: {
    backgroundColor: Colors.gold,
    borderColor: Colors.gold,
  },
  buttonDestructive: {
    backgroundColor: Colors.dangerBg,
    borderColor: Colors.danger,
  },
  buttonText: {
    fontSize: Typography.size.base,
    color: Colors.paperDim,
  },
  buttonTextPrimary: {
    color: Colors.bg,
    fontWeight: Typography.weight.semibold,
  },
  buttonTextDestructive: {
    color: Colors.danger,
    fontWeight: Typography.weight.semibold,
  },
});
