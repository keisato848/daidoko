/**
 * バーコード(JAN)スキャン（P2b）— 在庫画面の「スキャン」から開く。
 * JAN を読み取り、既知なら在庫へ即追加、未知なら名前を入力して記憶（次回は自動補完）。
 * docs/買い物リスト・在庫設計.md §5.2
 */
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors } from '../../src/constants/theme';
import { lookupJan, rememberJan } from '../../src/services/jan.service';
import { addPantryItem } from '../../src/services/pantry.service';

export default function ScanBarcodeScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scannedCode, setScannedCode] = useState<string | null>(null); // set = unknown JAN, naming mode
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const lockRef = useRef(false);

  const handleScan = useCallback(
    async (result: BarcodeScanningResult) => {
      if (lockRef.current) return;
      lockRef.current = true;
      const code = result.data;

      const known = await lookupJan(code).catch(() => null);
      if (known) {
        await addPantryItem(known.name, { janCode: code, unit: known.unit, quantity: 1 }).catch(
          () => undefined,
        );
        Alert.alert('在庫', `「${known.name}」を在庫に追加しました`, [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        setScannedCode(code); // switch to naming mode (lock stays held)
      }
    },
    [router],
  );

  const handleSave = useCallback(async () => {
    const trimmed = name.trim();
    if (!scannedCode || !trimmed) return;
    const unitValue = unit.trim() || null;
    await rememberJan(scannedCode, trimmed, unitValue).catch(() => undefined);
    await addPantryItem(trimmed, { janCode: scannedCode, unit: unitValue, quantity: 1 }).catch(
      () => undefined,
    );
    router.back();
  }, [scannedCode, name, unit, router]);

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>バーコードを読み取るにはカメラの許可が必要です。</Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>カメラを許可</Text>
        </Pressable>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.link}>戻る</Text>
        </Pressable>
      </View>
    );
  }

  if (scannedCode) {
    return (
      <View style={styles.center}>
        <Text style={styles.namingTitle}>新しい商品</Text>
        <Text style={styles.code}>JAN: {scannedCode}</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="商品名（例: 牛乳）"
          placeholderTextColor={Colors.muted}
          autoFocus
          maxLength={50}
        />
        <TextInput
          style={styles.input}
          value={unit}
          onChangeText={setUnit}
          placeholder="単位（任意, 例: 本）"
          placeholderTextColor={Colors.muted}
          maxLength={6}
        />
        <Pressable
          style={[styles.button, !name.trim() && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={!name.trim()}
        >
          <Text style={styles.buttonText}>在庫に追加して記憶</Text>
        </Pressable>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.link}>キャンセル</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
        onBarcodeScanned={handleScan}
      />
      <View style={styles.overlay}>
        <Pressable style={styles.closeButton} onPress={() => router.back()} hitSlop={12}>
          <X size={26} color="#FFFFFF" />
        </Pressable>
        <View style={styles.frame} />
        <Text style={styles.hint}>商品のバーコードを枠に合わせてください</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  center: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  message: { color: Colors.paper, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  namingTitle: { color: Colors.paper, fontSize: 18, fontWeight: '600' },
  code: { color: Colors.muted, fontSize: 13 },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: '#130E08',
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.paper,
  },
  button: {
    backgroundColor: Colors.gold,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: Colors.bg, fontSize: 15, fontWeight: '600' },
  link: { color: Colors.muted, fontSize: 14 },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  closeButton: { position: 'absolute', top: 54, left: 20 },
  frame: {
    width: 260,
    height: 160,
    borderWidth: 2,
    borderColor: Colors.gold,
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  hint: {
    position: 'absolute',
    bottom: 120,
    color: '#FFFFFF',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
