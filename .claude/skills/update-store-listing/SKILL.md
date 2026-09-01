---
name: update-store-listing
description: Google Play ストア掲載（ja-JP / en-US のアプリ名・説明文・スマホ用スクリーンショット・アイコン・フィーチャーグラフィック・タグ）を CLI で更新する。listing-ja.md / listing-en.md / phone-screenshots{,-en}/ / generate-icons.mjs / generate-play-promos.mjs を単一ソースとして androidpublisher API で反映。スクショはエミュレータから言語ごとに機械的に再取得できる。
---

# Play ストア掲載の CLI 更新

詳細は `docs/リリース手順.md` §3。プライバシーポリシーの公開反映は §4（公開 URL は gist — 更新時は同期コマンドを実行）。

## アプリ名・説明文（短い説明・詳しい説明）

1. `docs/store/google-play/listing-ja.md` / `listing-en.md` の「## アプリ名」（30字以内・ASO のため
   キーワードを含める）「## 短い説明」（80字以内）「## 詳しい説明」（4000字以内・プレーンテキスト、
   ■/・で整形）を編集。**英語版は日本語の訳ではなく、その言語で通る文面を書く**
2. **公開文面なので必ずユーザーに文面を提示して承認を得る**
3. 掲載のある言語の確認（読み取りのみ）: `node scripts/release/list-play-listings.mjs`
4. ドライラン: `node scripts/release/update-play-listing.mjs --lang ja-JP --dry-run`
5. 反映: `node scripts/release/update-play-listing.mjs --lang ja-JP`
   （**Play の edit は同時に 1 つだけ**なので言語ごとに実行を分ける）
   - 動画は Play 側の現行値を自動維持
   - 認証キー: `C:\secure\play-service-account.json`（`PLAY_SERVICE_ACCOUNT_KEY` で上書き可・値は出力しない）
   - `COMMITTED edit: <id>` が出れば完了
   - **API の commit は即時成功するが公開ページへの伝播は数分〜数時間かかる**（Console 管理画面は即時反映）
6. listing-ja.md の変更を PR で develop にマージ（リポジトリ記録と Play の同期を保つ）

## アプリのアイコン（ストア掲載用・アプリ本体とは独立）

1. 意匠は `scripts/generate-icons.mjs`（SVG をコードで生成 — `apps/mobile/assets/icon.png` 等 4 種を出力）
2. **公開のブランド資産なのでユーザーに画像を提示して承認を得る**（小サイズ 48-96px での視認性も検証すること —
   細い線画の付け足しは縮小で消える。既存要素と同等の太さ・面積で置き換える方が安全）
3. 生成: `node scripts/generate-icons.mjs`
4. Play ストア掲載アイコンへ反映（512x512 に自動リサイズ）:
   `node scripts/release/update-play-icon.mjs --dry-run` → `node scripts/release/update-play-icon.mjs`
   - **アイコン変更は Play の審査を経てから公開される**（説明文より慎重な扱い — Console に「審査中の変更」表示）
   - アプリ本体（起動アイコン）は次回ビルドで自動的に同じ意匠になる（1024px 版を bundle）
5. `apps/mobile/assets/*.png` と `scripts/generate-icons.mjs` の変更を PR でマージ

## スクリーンショット（スマホ用・機械的に再取得）

単一ソース = `docs/store/google-play/phone-screenshots/`（英語は `-en` 付きの別ディレクトリ。
表示順は README.md の表 = `update-play-screenshots.mjs` の ORDER 配列。変えるときは両方更新）。
**言語ごとにスクショを入れないと、その言語の掲載は日本語の画面のまま出る。**

0. **撮る前に「どの版を撮るのか」を確定させる。** 掲載物に写ってよいのは**公開済みの UI だけ**。
   - **ビルド元はリリース済みのタグから**。`git worktree add <dir> v<version>-play-<versionCode>`
     で切り出して組む（開発中のブランチで組むと未公開の画面が混ざる）
   - **端末に入っているビルドが何かを必ず確かめる。`versionName` では分からない。**
     2026-08-26 に、AQUOS の `versionName=1.11.0` を信じて撮ろうとしたが、中身は未マージの
     `feat/shopping-pick`（ボトムタブに「買物」が増えていた）だった。
     画面を 1 枚撮って**タブバーと主要導線が公開版と一致するか**を目で見るのが確実
   - `EXPO_PUBLIC_ADMOB_*` は**付けない**（掲載物にテスト広告が写り込む事故を防ぐ）
   - **BYOK（自分の AI キー）を消してから撮る。** 検証で入れたキーが残っていると
     「写真からレシピ」の導線に **`自分のAIキー・使い放題`** と出て、無料枠の表示
     （`無料作成：あと 1 回 ・ 使い放題にする`）が掲載物から消える。
     2026-08-26 に 07 を撮った後で気づいて撮り直した。`daidoko://ai-key` →「保存したキーを削除」。
     **消しても無料枠は減っていない**（BYOK 中の生成は `recordCloudInference` を通らない）ので、
     先にキーで撮影用データを作り、最後にキーを消してから 07 を撮り直すのが速い

1. ストアショット用リリース APK をビルド（サンプルデータ有効＋コーチマーク無効。エミュレータは x86_64）:
   `EXPO_PUBLIC_ENABLE_SAMPLE_DATA=1 EXPO_PUBLIC_DISABLE_COACH_MARKS=1 node scripts/agent/build-android.mjs --arch x86_64`
   **新しい worktree で初回に組むときは `--prebuild` が要る**（`android/` は gitignore なので
   存在しない。無いまま叩くと「gradlew.bat が認識されていません」という、PATH の問題に
   見えるエラーで止まる）

   > **実機で撮るなら、サンプルデータが入らないことに先に気づくこと。**
   > `EXPO_PUBLIC_ENABLE_SAMPLE_DATA=1` は **DB が空のときしかシードしない**（`app_meta` の版で判定）。
   > 実機には利用者のデータが入っているので、そのまま撮ると検証で作った半端なレシピが並ぶ。
   > **エミュレータで撮るのが既定**（`-wipe-data` で必ず空から始まる）。
   > 実機で撮る必要があるなら、アプリのデータ全消しは利用者の判断（フックが止める）なので、
   > **先に許可を得る**か、別 applicationId のビルドを併存させる。

2. クリーンなエミュレータを起動（**1080x2400 の `daidoko_e2e_fresh_api36` を使う** — 既存掲載と同解像度）:
   `emulator -avd daidoko_e2e_fresh_api36 -wipe-data -no-snapshot`
   ※ wipe 直後の SystemUI ANR ダイアログは capture スクリプトが dumpsys で検出して自動で閉じる
3. `adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
4. 取得: `node scripts/release/capture-store-screenshots.mjs`
   - ショットごとに force-stop → `daidoko://` ディープリンクでコールドスタート → screencap
   - ステータスバーは SystemUI デモモードで固定（09:00・電池100%・通知なし）
   - `manual` 指定のショット（AI 結果画面など）はスキップして既存ファイルを維持
   - `04` が始めた調理セッション（Now Cooking pill が後続ショットに写り込む）は
     各ショット前と run 終了時に `adb root`＋sqlite3 で自動で消される
     （`--shots 04` で撮り終えても手動の `08`/`10` に持ち越さない。実機は警告して続行。
     詳細は `docs/store/google-play/phone-screenshots/README.md`）
   - 部分再取得: `--shots 01,04` / 対象レシピ変更: `--recipe recipe-3`
   - 英語版: `--locale en-US --out docs/store/google-play/phone-screenshots-en`
     （アプリ単位の言語を一時的に切り替える。終了時に端末既定へ自動で戻る。
     **サンプルデータも英語になる** — `src/db/seed.en.ts`。初回起動でシードするので
     wipe 済みの端末に入れてから撮ること）

   > **`manual` の 2 枚（08 AI 結果 / 10 写真つき詳細）を手で撮るときも、
   > ステータスバーは同じデモモードに揃える。** スクリプトと同じ broadcast を打てばよい:
   > `settings put global sysui_demo_allowed 1` → `am broadcast -a com.android.systemui.demo -e command enter`
   > → `clock hhmm 0900` / `battery level 100 plugged false` / `network wifi show level 4 fully true`
   > → `network mobile hide` / `notifications visible false`。撮り終えたら `command exit`。
   > 揃え忘れると 8 枚のうち 2 枚だけ時計と通知アイコンが違う

   > **撮影用データを実機で作るときの注意（2026-08-26 に実際にやった手順）**
   >
   > - **`adb install -r` はアプリのデータを残す** → サンプルデータのシードが走らない。
   >   空から始めたいなら `pm uninstall` してから入れる
   > - **Android の自動バックアップが復元をかけて、消したはずのデータが戻る。**
   >   `bmgr enabled` / `settings get secure backup_auto_restore` を先に確認して切り、
   >   **終わったら元の値に戻す**
   > - 「写真からレシピ」で作ったレシピには、**元の写真が調理記録として自動で付く**
   >   （`handleSave` が `persistCookingLogPhotos` → `createCookingLog`）。ヒーロー画像はこれ。
   >   フォームの「写真」欄に手で足す必要は無い（足すと表紙写真が二重になる）
   > - **AI が付ける材料名・レシピ名は長い。** 長いと詳細の材料行と料理中モードのヘッダーで
   >   文字が重なる（#222）。撮る前に該当画面を目で見て、崩れていたらデータ側を短くする

   > **デモモードは Wi-Fi アイコンまでは固定できないことがある**（AQUOS SH-RM19s・2026-08-26）。
   > `network -e wifi show -e level 4 -e fully true` を打っても**実通信の上下矢印がそのまま写り**、
   > 8 枚のうち何枚かだけアイコンが違う、という揃わなさ方をする。
   > 矢印は点滅しているので、**同じ画面で数フレーム撮って、きれいなフレームを選ぶ**のが確実:
   > 既に揃っている 1 枚の `(790,10)-(880,65)` を基準に差分 0 のフレームを採る。
   > 写真の上にステータスバーが乗る画面（詳細・ヒーロー）は差分で判定できないので目で見る

   > **無料枠の表示が入る画面（07）は、撮り直すと表示が変わる。** 生涯 1 回の枠なので、
   > 検証でサーバー経路の生成を 1 回でも通すと「あと 1 回」→「あと 0 回」になり、
   > **再インストールしないと戻らない**（`app_meta` の生涯カウンタ）。
   > 07 を撮るなら**検証より先に**撮る

5. **スクショはストア公開物 — 画像をユーザーに提示して承認を得る**
6. ドライラン: `node scripts/release/update-play-screenshots.mjs --lang ja-JP --dry-run`（枚数・寸法検証。**8 枚の寸法が揃っていないと止まる** — 一部だけ撮り直して混ざるのを防ぐ）
7. 反映: `node scripts/release/update-play-screenshots.mjs --lang ja-JP`（既存全削除→順番にアップロード→commit）
   → 英語も入れるなら続けて `--lang en-US`（**edit は同時に 1 つだけ**なので言語ごとに実行）
8. PNG の変更を PR で develop にマージ

## フィーチャーグラフィック（1024x500）

1. 意匠は `scripts/generate-play-promos.mjs`（`buildFeatureGraphicSvg()` のテキスト・
   `renderFeatureGraphic()` の参照スクショパスを編集。アイコンは `apps/mobile/assets/icon.png`
   を都度リサイズする単一ソース — `docs/store/google-play/icons/icon-play-512.png` は副産物なので直接編集しない）
2. **公開のブランド資産なのでユーザーに画像を提示して承認を得る**
3. 生成: `node scripts/generate-play-promos.mjs`（フィーチャーグラフィック＋販促スクショ6枚を再生成）
4. Play へ反映: `node scripts/release/update-play-feature-graphic.mjs --dry-run` →
   `node scripts/release/update-play-feature-graphic.mjs`
   - **アイコンと同様 Play の審査を経てから公開される**（Console に「審査中の変更」表示）
5. `docs/store/google-play/graphics/*.png` 等の変更を PR でマージ

## プロモーション動画（YouTube 埋め込み）

独立 Skill 化済み: **`promo-video`**（`.claude/skills/promo-video/SKILL.md`）を参照。
見せるデータ（実演レシピ・買い物リスト・お店の写真）はコード管理（seed.ts / promo-assets/）で
UI操作なしに再現でき、収録・編集・レビュー・YouTube引き渡しの手順もそちらに集約している。

## タグ（カテゴリ内の発見性）

Play Console UI のみ（API 非対応）: ストアの設定 → 「アプリのカテゴリ」の編集 →
「タグを管理」→ 検索して選択（最大5個）→ 適用。Google の定義済みタグ体系からの選択制で、
日本語の一般語（「料理」「買い物」等）はヒットしないことが多い — 実際に検索して当たったものだけ選ぶ。

## 注意

- データセーフティフォームは API 非対応（Console UI / ブラウザ自動化）— 回答ガイドは `docs/リリース手順.md` §4
