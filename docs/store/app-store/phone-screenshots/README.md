# App Store iPhone 用スクリーンショット（macOS で取得）

App Store Connect の iPhone スクショは、**6.9インチ（iPhone 16 Pro Max = 1320×2868）** を主サイズとして登録する
（このサイズを入れれば下位サイズは自動流用される。6.5インチ 1284×2778 を別途求められる場合あり）。
Android（Google Play）と同じ画面構成・同じ順序で揃える。

**機械的な再取得**（macOS 専用・詳細は `docs/リリース手順.md` §7、`.claude/skills/ios-release`）:

```bash
# 1. ストアショット用ビルド（サンプルデータ有効＋コーチマーク無効）をシミュレータへ
xcrun simctl boot "iPhone 16 Pro Max" ; open -a Simulator
EXPO_PUBLIC_ENABLE_SAMPLE_DATA=1 EXPO_PUBLIC_DISABLE_COACH_MARKS=1 \
  pnpm --filter mobile exec expo run:ios --configuration Release

# 2. 取得（ステータスバーは 9:41・満充電に固定される）
node scripts/release/capture-ios-screenshots.mjs            # 全自動ショット
node scripts/release/capture-ios-screenshots.mjs --shots 01,04   # 部分再取得
```

- アップロードは App Store Connect の Web UI か fastlane deliver（Play のような API 一括スクリプトは未整備）。
- `08` と `10` は自動化対象外（manual）— 既存 PNG を維持する。

| 順  | ファイル                     | 内容                               |
| --- | ---------------------------- | ---------------------------------- |
| 1   | `01-home-timeline.png`       | ホーム（家族の調理タイムライン）   |
| 2   | `02-recipe-library.png`      | レシピ蔵書庫（一覧・検索）         |
| 3   | `03-recipe-detail.png`       | レシピ詳細                         |
| 4   | `04-cooking-mode.png`        | 料理中モード                       |
| 5   | `06-family-group.png`        | 家族グループ                       |
| 6   | `07-photo-to-recipe.png`     | 写真からレシピ（導線）             |
| 7   | `08-photo-recipe-result.png` | 写真からつくったレシピの結果       |
| 8   | `10-recipe-detail-photo.png` | 料理写真つきレシピ詳細（ヒーロー） |

※ 番号は Google Play 版と揃えている（欠番 05/09 も同様）。iOS では OCR 機能を隠すため、
`05`（OCR 取り込み）系は使わない。
