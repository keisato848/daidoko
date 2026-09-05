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

- **アップロードは ASC API でできる**（`appScreenshotSets` → `appScreenshots` の予約＋アップロード＋コミット。
  2026-08-13 に疎通確認済み）。Play の `update-play-screenshots.mjs` 相当の一括スクリプトはまだ無いだけ。
  **撮影だけ macOS 必須で、アップロードは Windows からでよい。** Web UI から手で上げても構わない。
- **`10` は自動化済み**（2026-08-13）。seed の `recipe-7`（ふわとろスクランブルエッグトースト）に
  `seedBundledCoverPhotos` が `assets/seed-photos/scrambled-egg.jpg` を表紙として付けるので、
  実データ無しで再現できる。`--photo-recipe <id>` で別レシピに差し替え可。
  ※ Android 版 `capture-store-screenshots.mjs` はまだ `manual` のまま（Play は掲載済みのため未着手）。
- `08`（AI 結果画面）は自動化対象外（manual）。deep link で到達できず、実際に AI 推論を走らせる必要がある。
- **調理セッション汚染に注意**（PR #254 の調理セッション以降）: `04` で料理中モードを開くと
  調理セッションが `app_meta` の `cooking_session` キーに永続化され、「完成」を押すまで
  タブバー直上に Now Cooking pill が出続ける（アプリを terminate しても次回起動で復元される）。
  `04` の後に撮るショットに pill が写り込むため、Android 版 `capture-store-screenshots.mjs` は
  ショットごとに自動で消すが、**`capture-ios-screenshots.mjs` は未対応**。シミュレータでは
  DB を sqlite3 で直接消せる（`04` を撮った後・影響ショットの撮り直し前に実行）:
  `xcrun simctl terminate booted com.daidoko.app` →
  `sqlite3 "$(xcrun simctl get_app_container booted com.daidoko.app data)/Documents/SQLite/daidoko.db" "UPDATE app_meta SET value='' WHERE key='cooking_session';"`
  （空文字は store の persist(null) と同じ表現で、起動時の復元がスキップされる）

- 提出全体の進捗と残作業は `../SUBMISSION.md`。

> **全ショットが同じ絵になったら、アプリが起動できていない（2026-08-13 の教訓）**
>
> 症状: iOS が **「"だいどこ" で開きますか?」**（キャンセル／開く）の確認を出し続け、
> 画面遷移が起きず、**全ショットが「ホーム画面＋ダイアログ」の同一画像**になる。
>
> **ダイアログ自体は原因ではない。** アプリが起動直後にクラッシュしていると、
> SpringBoard が `openurl` のたびに「アプリを開くか」を訊いてくる。
> このときは実際に `ExpoLocalization` ネイティブモジュールが無くて即死していた
> （`ios/` が古い prebuild のままで、後から入った依存がリンクされていなかった）。
> **`expo prebuild -p ios --clean` でネイティブを作り直したら、確認ダイアログは一度も出なくなった。**
>
> 詰まったら、まず `xcrun simctl launch <udid> com.daidoko.app` してから
> 30 秒後にプロセスが生きているか確認する。死んでいるならスクショの問題ではない。
> 原因は `xcrun simctl spawn <udid> log show --last 5m --predicate 'process == "app"'` で追う。
>
> なおスクリプトは**同一画像を検出したら FAILED にする**（黙って成功扱いにしない）。

| 順  | ファイル                     | 内容                               |
| --- | ---------------------------- | ---------------------------------- |
| 1   | `01-home-timeline.png`       | ホーム（家族の調理タイムライン）   |
| 2   | `02-recipe-library.png`      | レシピ一覧（一覧・検索）           |
| 3   | `03-recipe-detail.png`       | レシピ詳細                         |
| 4   | `04-cooking-mode.png`        | 料理中モード                       |
| 5   | `06-family-group.png`        | 家族グループ                       |
| 6   | `07-photo-to-recipe.png`     | 写真からレシピ（導線）             |
| 7   | `08-photo-recipe-result.png` | 写真からつくったレシピの結果       |
| 8   | `10-recipe-detail-photo.png` | 料理写真つきレシピ詳細（ヒーロー） |

※ 番号は Google Play 版と揃えている（欠番 05/09 も同様）。iOS では OCR 機能を隠すため、
`05`（OCR 取り込み）系は使わない。
