# Google Play Assets

更新日: 2026-06-04
撮影環境: Android Emulator / com.daidoko.app 1.0.1 (10003) / targetSdk 35

## アイコン

- 出力先: `docs/store/google-play/icons/icon-play-512.png`
- 元画像: `apps/mobile/assets/icon.png`
- 用途: Google Play 高解像度アイコン

## フィーチャー グラフィック

- 出力先: `docs/store/google-play/graphics/feature-graphic.png`
- 生成コマンド: `node scripts/generate-play-promos.mjs`
- 用途: Google Play フィーチャー グラフィック（1024x500）

## スクリーンショット採用順

1. `phone-screenshots/01-home-timeline.png`
   キャプション案: 家族の最近の調理記録をひと目で振り返る
2. `phone-screenshots/02-recipe-library.png`
   キャプション案: 食材名やタグから、定番レシピをすぐ探せる
3. `phone-screenshots/03-recipe-detail.png`
   キャプション案: 材料と手順をまとめて確認し、そのまま調理へ
4. `phone-screenshots/04-cooking-mode.png`
   キャプション案: 調理モードで次の一手だけを大きく表示
5. `phone-screenshots/05-ocr-import.png`
   キャプション案: 紙のレシピや画像から OCR で下書きを作成
6. `phone-screenshots/06-family-group.png`
   キャプション案: 家族グループ情報をひとつの台所ノートに整理

## 元画像対応表

- `01-home-timeline.png` <- `e2e/screenshots/e2e-android/store-recipes-live.png`
- `02-recipe-library.png` <- `e2e/screenshots/e2e-android/store-recipes2.png`
- `03-recipe-detail.png` <- `e2e/screenshots/e2e-android/store-detail2.png`
- `04-cooking-mode.png` <- `e2e/screenshots/e2e-android/store-cook2.png`
- `05-ocr-import.png` <- `e2e/screenshots/e2e-android/12-ocr-entry.png`
- `06-family-group.png` <- `e2e/screenshots/e2e-android/13-family.png`

## メモ

- 現在の画像は生のエミュレータキャプチャです
- Play Console へはこのまま投入できます
- 文字入りの訴求画像にしたい場合は、この順序を元に別途デザイン化すると扱いやすいです

## 販促版スクリーンショット

- 出力先: `docs/store/google-play/promotional-screenshots/`
- 生成コマンド: `node scripts/generate-play-promos.mjs`
- ベース画像: `docs/store/google-play/phone-screenshots/`
- 用途: ストア提出前の比較、SNS 告知、追加訴求案の叩き台
