---
name: update-store-listing
description: Google Play ストア掲載（ja-JP の説明文・スマホ用スクリーンショット）を CLI で更新する。listing-ja.md / phone-screenshots/ を単一ソースとして androidpublisher API で反映。スクショはエミュレータから機械的に再取得できる。
---

# Play ストア掲載の CLI 更新

詳細は `docs/リリース手順.md` §3。プライバシーポリシーの公開反映は §4（公開 URL は gist — 更新時は同期コマンドを実行）。

## 説明文（短い説明・詳しい説明）

1. `docs/store/google-play/listing-ja.md` の「## 短い説明」（80字以内）「## 詳しい説明」（4000字以内・プレーンテキスト、■/・で整形）を編集
2. **公開文面なので必ずユーザーに文面を提示して承認を得る**
3. ドライラン: `node scripts/release/update-play-listing.mjs --dry-run`（文字数チェック＋内容表示）
4. 反映: `node scripts/release/update-play-listing.mjs`
   - タイトル・動画は Play 側の現行値を自動維持
   - 認証キー: `C:\secure\play-service-account.json`（`PLAY_SERVICE_ACCOUNT_KEY` で上書き可・値は出力しない）
   - `COMMITTED edit: <id>` が出れば完了
5. listing-ja.md の変更を PR で develop にマージ（リポジトリ記録と Play の同期を保つ）

## スクリーンショット（スマホ用・機械的に再取得）

単一ソース = `docs/store/google-play/phone-screenshots/`（表示順は README.md の表 =
`update-play-screenshots.mjs` の ORDER 配列。変えるときは両方更新）。

1. ストアショット用リリース APK をビルド（サンプルデータ有効＋コーチマーク無効。エミュレータは x86_64）:
   `EXPO_PUBLIC_ENABLE_SAMPLE_DATA=1 EXPO_PUBLIC_DISABLE_COACH_MARKS=1 node scripts/agent/build-android.mjs --arch x86_64`
2. クリーンなエミュレータを起動（**1080x2400 の `daidoko_e2e_fresh_api36` を使う** — 既存掲載と同解像度）:
   `emulator -avd daidoko_e2e_fresh_api36 -wipe-data -no-snapshot`
   ※ wipe 直後の SystemUI ANR ダイアログは capture スクリプトが dumpsys で検出して自動で閉じる
3. `adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
4. 取得: `node scripts/release/capture-store-screenshots.mjs`
   - ショットごとに force-stop → `daidoko://` ディープリンクでコールドスタート → screencap
   - ステータスバーは SystemUI デモモードで固定（09:00・電池100%・通知なし）
   - `manual` 指定のショット（AI 結果画面など）はスキップして既存ファイルを維持
   - 部分再取得: `--shots 01,04` / 対象レシピ変更: `--recipe recipe-3`
5. **スクショはストア公開物 — 画像をユーザーに提示して承認を得る**
6. ドライラン: `node scripts/release/update-play-screenshots.mjs --dry-run`（枚数・寸法検証）
7. 反映: `node scripts/release/update-play-screenshots.mjs`（既存全削除→順番にアップロード→commit）
8. PNG の変更を PR で develop にマージ

## 注意

- フィーチャーグラフィック等 `graphics/` の差し替えは未スクリプト化（Play Console UI）
- データセーフティフォームは API 非対応（Console UI / ブラウザ自動化）— 回答ガイドは `docs/リリース手順.md` §4
