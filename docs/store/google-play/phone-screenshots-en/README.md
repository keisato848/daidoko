# Google Play スマホ用スクリーンショット（en-US）

英語掲載用。**言語ごとにスクショを入れないと、en-US の掲載は日本語の画面のまま出る。**
日本語版は `../phone-screenshots/`。

**機械的な再取得**（詳細は `docs/リリース手順.md` §3-2）:

```bash
node scripts/release/capture-store-screenshots.mjs \
  --locale en-US --out docs/store/google-play/phone-screenshots-en
```

- アプリ単位の言語（Android 13+）を一時的に en-US にして撮り、終了時に端末既定へ戻す
- **サンプルデータも英語になる**（`apps/mobile/src/db/seed.en.ts`）。シードは初回起動の
  一度きりなので、**データを消した端末に入れてから**撮ること（`-wipe-data` でエミュを起動し直す）
- 反映: `node scripts/release/update-play-screenshots.mjs --lang en-US`（下表の順に upload）

| 順  | ファイル                     | 内容                                    |
| --- | ---------------------------- | --------------------------------------- |
| 1   | `10-recipe-detail-photo.png` | 料理写真つきレシピ詳細（ヒーロー）      |
| 2   | `07-photo-to-recipe.png`     | 写真からレシピ（導線・AI の仕組み説明） |
| 3   | `01-home-timeline.png`       | ホーム（家族の調理タイムライン）        |
| 4   | `02-recipe-library.png`      | レシピ蔵書庫（一覧・検索）              |
| 5   | `03-recipe-detail.png`       | レシピ詳細                              |
| 6   | `04-cooking-mode.png`        | 料理中モード                            |
| 7   | `06-family-group.png`        | 家族グループ                            |

日本語版にある `08-photo-recipe-result.png`（AI 結果画面）は手動撮影のショットで、
英語版はまだ撮っていないため 7 枚（Play の下限 2 枚・上限 8 枚は満たす）。
順番は日本語版と揃えている（1〜2 枚目で推し機能を見せる — ASO 監査 2026-07-14）。

`10-recipe-detail-photo.png` は表紙写真のある recipe-7 を開いて撮る:

```bash
node scripts/release/capture-store-screenshots.mjs \
  --locale en-US --recipe recipe-7 --shots 03 --out <一時ディレクトリ>
# 撮れた 03-recipe-detail.png を 10-recipe-detail-photo.png として置く
```
