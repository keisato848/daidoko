# App Store iPhone 用スクリーンショット（macOS で取得）

App Store Connect の iPhone スクショは、**6.9インチ（iPhone 16 Pro Max = 1320×2868）** を主サイズとして登録する
（このサイズを入れれば下位サイズは自動流用される。6.5インチ 1284×2778 を別途求められる場合あり）。
Android（Google Play）と同じ画面構成・同じ順序で揃える。

**1.13.1（2026-09-05）の刷新**: Play 版と同じ 8 枚構成へ入れ替えた（1 枚目に `05` 献立・
3 枚目に `12` 冷蔵庫確認シート・`03`/`04` は `extras/` へ退避）。理由は Play 版 README
（`../../google-play/phone-screenshots/README.md`）の 1.13.0 / 1.13.1 節と同じ —
掲載文の訴求（献立・冷蔵庫）とスクショの整合。**撮影手順の詳細は `SHOOTING-1.13.1.md`**
（機種・データ仕込み・manual ショットの作り方・ja/en）。

| 順  | ファイル                     | 内容                                          | 取得   |
| --- | ---------------------------- | --------------------------------------------- | ------ |
| 1   | `05-menu-plan.png`           | 献立（組んだ状態・理由付き・時間帯チップ）    | 自動 ※ |
| 2   | `10-recipe-detail-photo.png` | 料理写真つきレシピ詳細（recipe-7・seed 表紙） | 自動   |
| 3   | `12-fridge-to-recipe.png`    | 冷蔵庫からレシピ（確認シート・1.13.1 新機能） | manual |
| 4   | `07-photo-to-recipe.png`     | 写真からレシピ（導線・AIの仕組み説明）        | 自動   |
| 5   | `08-photo-recipe-result.png` | 写真からつくったレシピの編集可能な下書き      | manual |
| 6   | `01-home-timeline.png`       | ホーム（家族の調理タイムライン）              | 自動   |
| 7   | `02-recipe-library.png`      | レシピ一覧（一覧・検索）                      | 自動   |
| 8   | `06-family-group.png`        | 家族グループ                                  | 自動   |

※ `05` は事前に在庫仕込み（`scripts/release/seed-pantry-for-shots.mjs`）と献立の組み立てが要る
（`SHOOTING-1.13.1.md` §3）。組んだ献立は `menu_plans` に保存されるので、以後は自動で撮り直せる。

番号は Google Play 版と揃えている（欠番も同様）。**並び順の正は
`scripts/release/update-appstore-screenshots.mjs` の ORDER**（この表と同期させる）。
英語は `../phone-screenshots-en/` に同じ構成で置く（ASC はロケールごとに別セット）。

**機械的な再取得**（macOS 専用・詳細は `docs/リリース手順.md` §7、`.claude/skills/ios-release`）:

```bash
# 1. ストアショット用ビルド（サンプルデータ有効＋コーチマーク無効）をシミュレータへ
xcrun simctl boot "iPhone 16 Pro Max" ; open -a Simulator
EXPO_PUBLIC_ENABLE_SAMPLE_DATA=1 EXPO_PUBLIC_DISABLE_COACH_MARKS=1 \
  pnpm --filter mobile exec expo run:ios --configuration Release

# 2. 取得（ステータスバーは 9:41・満充電に固定される。既定は掲載 8 枚の自動ショットのみ）
node scripts/release/capture-ios-screenshots.mjs
node scripts/release/capture-ios-screenshots.mjs --shots 01,05   # 部分再取得
```

- **アップロードは ASC API でできる**（`update-appstore-screenshots.mjs`。撮影だけ macOS 必須で、
  アップロードは Windows からでよい）。スクショは**バージョンにぶら下がる**ので、審査提出前の
  編集可能バージョンに入れる（READY_FOR_SALE のバージョンは変更できない）。
- `08`（AI 結果画面）と `12`（冷蔵庫確認シート）は自動化対象外（manual）。deep link で到達できず、
  実際に AI 推論を走らせる必要がある（撮り方と素材は `SHOOTING-1.13.1.md` §4）。
- **調理セッション汚染はスクリプトが自動で消す**（1.13.1 で Android 版のガードを移植）:
  cook 画面を開くと調理セッションが `app_meta` の `cooking_session` キーに永続化され、
  「完成」を押すまでタブバー直上に Now Cooking pill が出続ける（PR #254。terminate しても
  次回起動で復元される）。`capture-ios-screenshots.mjs` は各ショットの起動前と run 終了時に
  host の sqlite3 で消す（`--keep-cooking-session` でオプトアウト）。**手動ショットの前に
  手で消したいとき**は:
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

## iOS でも OCR 入口は表示される（旧記述の訂正・2026-09-05）

- **症状**: 旧 README 末尾の「iOS では OCR 機能を隠すため、`05`（OCR 取り込み）系は使わない」を
  根拠に「iOS では入口が出ない」前提で検証や掲載判断をすると、実物と食い違う
  （iOS でも「文字入り画像から」は表示され、動作する）。
- **原因**: PR #212（848f90b）で文字入り画像の読み取りが端末内 ML Kit から AI（サーバー/BYOK）に
  替わり、Android 専用の理由が消えた。`add.tsx` の METHOD_GROUPS は `ocr` を無条件表示・
  `import-ocr.tsx` / `pantry.tsx` に Platform 分岐は無い。レシートも同様
  （`client-ocr.provider.ts` が iOS では端末内 OCR 不可を検知してクラウド解析へ切り替える —
  `../listing-ja.md`「Android 版との差分」の注記と同じ）。
- **対処**: 「iOS では隠している」を前提にしない。掲載 8 枚に OCR 画面が無いのは
  訴求順位の問題であって、機能を隠しているからではない。なお `05` の番号は Play の旧
  `05-ocr-import.png`（#212 で画面ごと陳腐化・extras 送り）から **1.13.1 で献立
  （`05-menu-plan.png`）に引き継がれた**。

## extras/（アップロード対象外）

8 枚に収めるため以下は `extras/` に退避（`--shots 03` のように明示すれば再取得できる）。

- `03-recipe-detail.png` — レシピ詳細（実写なし）。Play 版 1.13.0 と同じ理由
  （`10-recipe-detail-photo.png` と内容が重複気味）。中身は 1.12.3 時点のまま。
- `04-cooking-mode.png` — 料理中モード。1.13.1 で `12-fridge-to-recipe.png` を入れるために退避。
  中身は 1.12.3 時点のまま。撮り直すと調理セッションが残るが、スクリプトのガードが消す。
