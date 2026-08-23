---
name: emulator-verify
description: Android エミュレータ/実機での画面・機能検証の定型。AVD 準備（DNS・wipe）、検証用ビルド（サンプルデータ/コーチマーク無効/無料枠調整）、ディープリンク遷移、スクショ確認、ローカルサーバー E2E、テスト写真の投入まで。ML Kit・広告などネット必須機能の落とし穴込み。
---

# Android エミュレータ/実機 検証の定型

**着手前に `docs/開発ハーネス.md` §4 を読むこと。** 過去に踏んだ罠（キーボードに隠れた欄を叩くと
キーが押される・日本語 IME のかな混入・平文 HTTP の遮断など）がそこに集約されている。
検証中に新しく分かったことは `record-finding` Skill の作法で §4 か本 Skill へ書き足す。

実機操作の細則は `.claude/agents/android-verifier.md`、リリース検証は `release-play` / `release-verify` Skill。

## 1. エミュレータ準備

```powershell
# AVD 一覧 / 起動（検証は 1080x2400 の daidoko_e2e_fresh_api36 が基準。x86_64 なので --arch x86_64 でビルド）
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -list-avds
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd daidoko_e2e_fresh_api36 -no-boot-anim -no-audio -no-snapshot -dns-server 8.8.8.8,1.1.1.1
```

- **`-dns-server 8.8.8.8,1.1.1.1` を必ず付ける**（エミュレータ DNS 死亡の実績。広告/UMP/ML Kit モデル DL はネット必須）
- **疎通判定に ping は使えない**（emulator NAT は ICMP 不可）— `dumpsys connectivity` の `IS_VALIDATED` を見る
- クリーン状態が要る検証（初回フロー・シード確認）だけ `-wipe-data`。wipe 直後は SystemUI ANR が出やすい
  （dumpsys で `Application Not Responding` を検出 → 画面 x30%/y57% の「Wait」をタップ。capture スクリプトは自動処理）
- **ML Kit（OCR/ラベリング）はオフラインでは動かない**（unbundled モデルを Play Services 経由で初回 DL）。
  OCR 検証は実機かオンラインの Google Play イメージで

## 2. 検証用ビルドのフラグ

```bash
# すべて EXPO_PUBLIC_* はビルド時焼き込み。組み合わせて使う
EXPO_PUBLIC_ENABLE_SAMPLE_DATA=1     # サンプルシード（recipe-1〜6・調理記録・家族「恵/健/陽」）
EXPO_PUBLIC_DISABLE_COACH_MARKS=1    # コーチマーク非表示（スクショ・回帰確認用）
EXPO_PUBLIC_FREE_DAILY_LIMIT=0       # 無料枠0=常時ペイウォール（広告フロー E2E 用）
EXPO_PUBLIC_ADMOB_ENABLED=true       # 広告有効。**これだけでは広告は出ない**（次行が要る）
EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID=ca-app-pub-3940256099942544/5224354917  # Google のテスト用リワード枠
node scripts/agent/build-android.mjs --arch x86_64   # app.json/plugins 変更時は --prebuild 必須
```

**ユニット ID を渡さないと広告は「出せない」扱いになる。** `isAdRewardConfigured()` は
`ADMOB_ENABLED && ADMOB_REWARDED_UNIT_ID !== ''` で、空だと広告まわりが丸ごとスタブに落ちる
（本番ビルドにテスト広告を出さないための設計 — `apps/mobile/src/config.ts`）。この状態で枠切れにすると
広告視聴の確認を飛ばして**ペイウォールに直行**するので、「広告フローが壊れた」と読み違える。

**ビルドスクリプトはリポジトリのルートから叩く。** `apps/mobile` を cwd にしたまま
`node scripts/agent/build-android.mjs` を叩くと MODULE_NOT_FOUND で即死するが、
`| tail` などに繋いでいると**パイプ側の終了コード 0 が返って成功に見える**。
「ビルドし直したのに変更が反映されない」の正体がこれだったことがある。

**インストールできて起動もするのに画面が真っ黒なら、APK に JS バンドルが入っていない。**
`build-android.mjs` は `EXPO_PUBLIC_*` が変わると JS バンドルの出力を消して作り直させるが、
このとき `intermediates/assets` まで消すため **`mergeReleaseAssets` の差分状態と食い違う**。
症状は 2 段階で出る（2026-08-23 に実測）:

1. 消した直後のビルドは通るが、**`index.android.bundle` の無い APK** ができる
   （サイズが 50MB → 44MB のように急に落ちるのが手がかり）
2. 次のビルドは `Cannot invoke "DataFile.getItems()" because "dataFile" is null` で失敗する

```powershell
# APK にバンドルがあるか（黒画面を見たら真っ先にこれ）
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($apk)
$zip.Entries | Where-Object { $_.FullName -like "*index.android.bundle*" }
```

```bash
# 直し方: マージの差分状態ごと消してから作り直す
rm -rf apps/mobile/android/app/build/intermediates/incremental/mergeReleaseAssets \
       apps/mobile/android/app/build/intermediates/assets \
       apps/mobile/android/app/build/intermediates/merged_assets \
       apps/mobile/android/app/build/intermediates/compressed_assets
```

インストールは常に `adb install -r`（`-r` なしはローカルデータ消失リスクで hook が ask）。

## 3. 画面遷移・確認

- 遷移は **ディープリンクが最も堅牢**: `adb shell am start -W -a android.intent.action.VIEW -d "daidoko://<route>" com.daidoko.app`
  （route 例: 空=ホーム / recipes / recipes/recipe-1 / recipes/recipe-1/cook / family / recipes/import-photo / settings / pantry / shopping）
- 状態を確定させたいときは事前に `adb shell am force-stop com.daidoko.app`（コールドスタート）
- スクショ: `adb exec-out screencap -p > file.png` → Read で目視。**adb は PowerShell ツールで**（Git Bash は /sdcard を壊す）
- 座標タップは**直前のスクショで座標を確認**（コーチマーク・ANR・通知パネル等のオーバーレイが座標を奪う）

## 4. ローカルサーバー E2E（AI 機能）

```bash
# サーバー起動（.env は自動ロードされない — --env-file 必須）
cd apps/server && pnpm exec tsx --env-file=.env src/index.ts
```

**古いサーバーが生き残る。** Git Bash の `pkill -f tsx` は **Windows の node を殺せない**。
「止めて起動し直した」つもりで**前のセッションの版が応答し続ける**ことがあり、症状は
**新しいエンドポイントだけ 404**（2026-08-24 に被弾。前日 21:09 起動のプロセスが 3210 を掴んでいた）。
起動し直したら、必ず**今の版かを起動時刻で確かめる**:

```powershell
$procId = (Get-NetTCPConnection -LocalPort 3210 -State Listen).OwningProcess | Select-Object -Unique
(Get-Process -Id $procId).StartTime      # 直前でなければ古い版
Stop-Process -Id $procId -Force          # 入れ替えるときはこれで殺す
```

```powershell
adb reverse tcp:3000 tcp:3000        # 端末 localhost:3000 → ホスト（開発検証）
adb reverse --remove-all             # 本番構成検証時は必ず除去（既定 = Railway 本番へ向く）
```

サーバーログの 200 応答で「端末から届いた」ことを裏どりする。

**リリースビルドは平文 HTTP を遮断する**（targetSdk 28+ の既定。`localhost` も例外ではない）。
`adb reverse` は張れているのにサーバーへ 1 件も届かず、アプリ側の表示は
「インターネットにつながっていません」——**ネットワーク不通と見分けが付かない**（2026-08-23 に実測）。

`build-android.mjs` は release しか組まないので、**ローカルサーバーへ向ける検証ビルドでは
`android/app/src/main/AndroidManifest.xml` の `<application>` に
`android:usesCleartextTraffic="true"` を手で足してから**組む。これで release でも通る
（2026-08-23・24 の同期 E2E はこの手で 2 台とも通した）。`android/` は `.gitignore` 対象なので
コミットには出ないが、`--prebuild` で再生成されると消えるので**組む直前に毎回確かめる**。
**検証が終わったら戻す**（平文許可のビルドを配ってはいけない）。

手を入れずに release ビルドで AI 機能だけ通したいときの代わりの手:

- **BYOK 経路を使う**（設定 → 自分の AI キーに Gemini キーを入れる）。端末から Google へ
  HTTPS 直通なのでサーバーが要らず、アプリ側の処理（base64 化・リクエスト組み立て・
  応答の正規化・画面反映）は全部通る。**検証が終わったらキーを消す**
- サーバー経路そのものを見たいなら Railway にデプロイして本番 URL で確認する

**端末がそもそもオフラインでないかを先に見る。** Wi-Fi が切れているだけのことがある
（`adb shell dumpsys wifi | grep "^Wi-Fi is"` / `adb shell svc wifi enable`）。
ただし**無線 adb では `svc wifi disable` は使えない**（adb 自身が切れる）。

**実機での UI 自動操作の落とし穴**（2026-08-22 Pixel 9a で被弾）:

- 日本語 IME だと `adb shell input text` に**かなが混ざる**（`PIXELSYNC` が `PIXELSYNCま` になる）
- **キーボードに隠れた入力欄を叩くと、キーボードのキーが押される**。`uiautomator dump` の
  bounds はキーボードの裏の欄も返すので、座標だけ見て叩くと打鍵が別の欄に入る。
  叩く前に `dumpsys input_method | grep mInputShown` で閉じているか確かめ、
  叩いた後は dump の `focused=true` がどの欄かを確認する
- レシピ保存は**材料 1 行と手順 1 行**が必須（zod）。埋めずに保存を押しても無反応に見える

**2 端末の検証は AVD を 2 つ起動するのが速い**（`-port 5556` を付けて 2 台目を起動）。
実機は画面ロック（暗証番号）が掛かっていると `screencap` が真っ黒になり操作できない。

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd daidoko_e2e_fresh_api36 -port 5556 -no-boot-anim -no-audio -no-snapshot -dns-server 8.8.8.8,1.1.1.1
adb -s emulator-5554 reverse tcp:3210 tcp:3210   # 端末ごとに張る
adb -s emulator-5556 reverse tcp:3210 tcp:3210
```

ポートは**空いているものを選ぶ**（このマシンは 3000/3100 が別プロセスで埋まっていた）。
サーバー側は `PORT` と `SYNC_DATABASE_URL` を渡して起動する。

## 5. テスト写真の投入（AI 写真機能の E2E）

ギャラリーに画像が要る場合:

```powershell
adb push test.jpg /sdcard/Pictures/test.jpg
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/test.jpg
```

（画像自体は実写真をコピーするか、System.Drawing 等で生成した「料理らしい」画像。not_a_dish 判定される画像は無料枠を消費しない）

**紙面レシピ（`/infer/recipe-page`）の検証は合成画像では通らない。** 文字を描画しただけの平坦な画像は
`found=false`（読めなかった扱い）になり、画面には「レシピを読み取れませんでした」しか出ないので
**実装の不具合と見分けが付かない**。端末で撮った実物の写真（食品パッケージの表と裏、レシピ本の見開き）を使う。
2026-08-24 の実測: 合成画像 → 読み取れず / 実写真 2 枚 → `confidence: high` で表裏を 1 レシピに統合。

## 既知の落とし穴まとめ

| 症状                                                   | 原因と対処                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 広告/UMP/名寄せが失敗                                  | エミュレータの DNS 死亡 → `-dns-server` 付きで再起動。ping での判定は不可                                                                                                                                                                                                            |
| OCR/ラベリングが動かない                               | ML Kit モデル未DL（オフライン）→ オンライン実機/Google Playイメージで                                                                                                                                                                                                                |
| スクショに ANR ダイアログ                              | wipe 直後の SystemUI 高負荷 → Wait をタップ、2〜3分待つ                                                                                                                                                                                                                              |
| タップが効かない                                       | オーバーレイ（コーチマーク等）が手前 → スクショで確認して先に閉じる                                                                                                                                                                                                                  |
| ネイティブ変更が反映されない                           | prebuild していない → `--prebuild`（build スクリプトが警告を出す）                                                                                                                                                                                                                   |
| 署名不一致で install 失敗                              | debug/release・EAS 鍵の混在 → 同一署名のビルドで `-r`、やむを得ない時だけユーザー承認の上アンインストール                                                                                                                                                                            |
| `input text` が入らない                                | 日本語 IME（Gboard 12キー）が変換中のまま抱えて確定しない → 入力後に確定キー（右下の ✓・1080幅で `input tap 968 2189`）を押す。初回は「入力レイアウトの選択」が被るので先にスキップする                                                                                              |
| サンプルデータが入らない                               | 既存 DB があると `seedDatabase` は `app_meta` の版で判定して何もしない。アプリのデータ全消しはフックが止める（データ消失防止）ので、**検証用データは画面から手で作る**か、ユーザーに wipe を依頼する                                                                                 |
| 別セッションの端末を掴む                               | エミュレータが複数動いていることがある。`adb -s <serial> emu avd name` で AVD 名を、`adb -s <serial> shell cat /proc/uptime` で自分が起動したものかを確かめ、以後 `adb -s` を必ず付ける                                                                                              |
| 実機を再インストールしても DB が空にならない           | Android の自動バックアップが**アンインストール→再インストールでアプリデータを戻す**（Pixel 9a で実測 2026-08-23: 消したはずのレシピ 6 件が初回起動で復活。サンプルシードも走らない）。戻ったデータは利用者のものかもしれないので、**破壊的操作の検証は自分で作った捨てデータで**行う |
| `-wipe-data` で起動したのに前のデータが残る/起動しない | **同じポートに前セッションのエミュレータが生きている**と新しい起動が黙って失敗する（`adb devices` には出たままなので気づけない）。`adb -s <serial> emu avd name` と `/proc/uptime` で確かめ、`adb -s <serial> emu kill` → ポートが空くのを待ってから起動する                         |
| wipe 直後、アプリを開くと即 ANR                        | SystemUI が高負荷。**アプリを起動する前に**「Wait」をタップして 30〜40 秒待つと、その後は安定する                                                                                                                                                                                    |
| 実機が勝手にロックされる                               | adb 操作中でも画面は消える。`KEYCODE_WAKEUP` で点くが指紋/PIN は adb では解除できない → **利用者に解除を頼む**。`screen_off_timeout` を触るなら先に現在値を読んで戻す                                                                                                                |

## 同時減算の手順（S2-B・在庫数量の持ち分）

2 台が**同じ品目を同時に**減らして収束するかを見る。逐次のシナリオでは出ない欠陥（§5-2f N1 の型）。

1. A・B を同じグループに入れ、共有中の在庫（例: RiceA 数量 5）を両方に出す
2. PowerShell で 2 台へ**同じ秒内**に `input tap`（−ボタン）を送る:
   `& $adb -s emulator-5554 shell input tap <x> <y>; & $adb -s emulator-5556 shell input tap <x> <y>`
3. 10 秒待って両方の画面を撮る → **両方 3**（LWW だと 4 で止まる）
4. 裏取り: `docker exec daidoko-sync-pg psql … -c "select entity_id, payload from sync_entities where entity_type='pantry_quantity'"`
   に端末ごとの持ち分が 2 行（net = −1 ずつ）。端末側は
   `adb shell "run-as com.daidoko.app sqlite3 …"` ではなく、画面の値と `quantity_base + Σ` の一致で見る
5. 5 回繰り返す（1 回では競合の窓に当たらない）
