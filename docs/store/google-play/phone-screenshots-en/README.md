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

## 現在の中身（2026-08-28 更新・1.12.3 / versionCode 10033）

**エミュレータ `daidoko_e2e_fresh_api36`（1080x2400）で撮っている。**

**2026-08-28 に 6 枚（`01` `02` `03` `04` `06` `10`）を 1.12.2 で撮り直した。**
1.12.1 まではタブバーが下の safe-area を確保しておらず、**ジェスチャーバーの白い横棒が
`Add` を横切り、`Recipes` / `Pantry` / `Shopping` のディセンダが切れていた**（PR #244）。

**撮り直しが要るのはタブバーが写る画面だけ**なので `07` と `08` は 1.12.1 のまま維持した:

- `07-photo-to-recipe`（`recipes/import-photo`）は `FULLSCREEN_CHILD_ROUTES` に入っていて
  **撮影画面ではタブバーを隠す**
- `08` はモーダルなのでタブバーが無い

**どの枚がタブバーを持つかは、下端 200px を切り出して並べると一目で分かる。**
1 枚ずつ開いて確かめると見落とす。

2026-08-27 に全 8 枚を撮り直した時点の記録: 旧版は #217 / #219 より前の
**4 タブ UI**（ホーム/レシピ/追加/設定）で、買物・在庫のタブが無かった。

- 全画面が英語シード（`seed.en.ts`）。**単位もヤード・ポンド法に換算されている**
  （0.38 oz / 1 tbsp / 4 cups）
- ヒーロー（`10`）は同梱のシード写真（Creamy Scrambled Egg Toast）
- `08` は**本番サーバー経由の実物の AI 下書き**（Beef Carpaccio with Parmesan and Herb
  Dressing — ja 版と同じカルパッチョ写真）。撮影後に破棄したので蔵書には残っていない
- **1.12.3 で `07` と `08` を差し替えた**: `07` は無料枠の説明が
  「1 free creation left ＋ Watch an ad for more · unlimited with your own AI key」の
  2 行になり、`08` は Reading 欄（ふりがなの直訳残り）が消えた
  （ペルソナレビュー docs/reviews/persona/1.12.2.md の high #1・#9）

> **日本語版（1080x2432・実機）とは解像度が違うが、寸法の検証は言語ごとなので問題ない。**
> 日本語版は実際の料理写真を使っており、英語版はシードのみ — この差は意図的。

### 撮るときに踏んだこと

- **wipe 直後は既定の待ち 7 秒では足りない。** 初回起動はシードを流すので、`01` `02` が
  **ローディングのスピナーのまま撮れた**（2026-08-28）。`--wait 18000` で撮り直したら通った。
  **PNG のファイルサイズが見分けになる** — 中身のある `01` は 191KB、`02` は 371KB なのに対し、
  スピナーだけだと 21KB / 20KB しか無い。撮ったら必ずサイズを見る
- **`adb push` が無言で失敗する**（`docs/開発ハーネス.md` §4）。base64 で流し込む
- `MEDIA_SCANNER_SCAN_FILE` のブロードキャストは効かない。
  `content call --uri content://media/external --method scan_volume --arg external_primary`
- **スクリプトの `--locale` は終了時に端末既定へ戻す。** 手動ショット（`08` / `10`）を撮る前に
  `cmd locale set-app-locales com.daidoko.app --locales en-US` を打ち直すこと
- デモモードは script が `enter` し直すと Wi-Fi が消えることがある。手で入れてから
  `--keep-status-bar` で撮ると揃う

| 順  | ファイル                     | 内容                                     |
| --- | ---------------------------- | ---------------------------------------- |
| 1   | `10-recipe-detail-photo.png` | 料理写真つきレシピ詳細（ヒーロー）       |
| 2   | `07-photo-to-recipe.png`     | 写真からレシピ（導線・AI の仕組み説明）  |
| 3   | `08-photo-recipe-result.png` | 写真からつくったレシピの編集可能な下書き |
| 4   | `01-home-timeline.png`       | ホーム（家族の調理タイムライン）         |
| 5   | `02-recipe-library.png`      | レシピ蔵書庫（一覧・検索）               |
| 6   | `03-recipe-detail.png`       | レシピ詳細                               |
| 7   | `04-cooking-mode.png`        | 料理中モード                             |
| 8   | `06-family-group.png`        | 家族グループ                             |

順番は日本語版と揃えている（1〜3 枚目で推し機能を見せる — ASO 監査 2026-07-14）。

`08-photo-recipe-result.png` は自動化できない（AI を実際に走らせる必要がある）。撮り方:

1. サンプルデータ入りビルドを wipe 済みのエミュレータに入れ、`--locale en-US` 相当に
   （`cmd locale set-app-locales com.daidoko.app --locales en-US`）
2. `adb push apps/mobile/assets/seed-photos/scrambled-egg.jpg /sdcard/Pictures/`（**PowerShell から**。
   Git Bash は /sdcard のパスを壊す）→ MEDIA_SCANNER_SCAN_FILE をブロードキャスト
3. `daidoko://recipes/import-photo` → Choose from library → 写真を選ぶ → Create recipe
4. SystemUI デモモードでステータスバーを固定してから撮る（capture スクリプトと同じ設定）

**Gemini の推論を 1 回消費する**（`INFER_GLOBAL_DAILY_LIMIT` の枠を使う）。

`10-recipe-detail-photo.png` は表紙写真のある recipe-7 を開いて撮る:

```bash
node scripts/release/capture-store-screenshots.mjs \
  --locale en-US --recipe recipe-7 --shots 03 --out <一時ディレクトリ>
# 撮れた 03-recipe-detail.png を 10-recipe-detail-photo.png として置く
```
