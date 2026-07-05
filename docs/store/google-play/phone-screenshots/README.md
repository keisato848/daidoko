# Google Play スマホ用スクリーンショット

Google Play はスマホ用スクショを**最大 8 枚**まで。このフォルダ直下の 8 枚を
この順番でアップロードする（フリーミアムの目玉＝写真からレシピを中心に据えた構成）。

**機械的な再取得とアップロード**（詳細は `docs/リリース手順.md` §3-2）:

- 取得: `node scripts/release/capture-store-screenshots.mjs`（サンプルデータ入り
  リリース APK ＋ 1080x2400 エミュレータ `daidoko_e2e_fresh_api36` 前提）
- 反映: `node scripts/release/update-play-screenshots.mjs`（下表の順にアップロード。
  順序を変えるときはスクリプトの ORDER 配列も併せて更新）
- `08` と `10` は自動化対象外（manual）— 既存 PNG を維持する

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

## extras/（アップロード対象外）

8 枚に収めるため以下は `extras/` に退避（必要なら差し替え可）。

- `05-ocr-import.png` — OCR 取り込みは現状スタブのため優先度低。
- `09-recipe-library-photos.png` — `02-recipe-library` と内容が重複。
