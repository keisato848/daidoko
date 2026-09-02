---
name: ios-release
description: iOS（App Store）リリース一式（macOS で実行）。Xcode/シミュレータのセットアップ → シミュレータでの動作確認 → iOS用スクショ取得 → EAS iOS ビルド → TestFlight → App Store Connect 提出。方針=無料・広告あり（2026-08 変更）・EU/英国除外で取引者申告回避。
---

# iOS（App Store）リリースパイプライン（macOS 専用）

このスキルは **Mac 上の Claude / 開発者** 向け。Windows 環境では iOS シミュレータ・Xcode が使えないため、
iOS 固有の作業（シミュレータ動作確認・iOS スクショ・ローカル iOS ビルド）はすべて Mac 側で行う。
背景と全体像は `docs/リリース手順.md` §7、機能パリティ・方針は `docs/フリーミアム設計.md`。

**方針（確定 2026-07-06）**: iOS 初回は **無料・広告なし・非取引者(non-trader)**。
iOS の AI は「無料枠1日1回 ＋ BYOK」。広告/課金の導線は iOS では非表示。

## 0. 前提（初回のみ・ユーザー作業）

- **Apple Developer Program 登録**（年 $99）。App Store Connect でアプリ枠を作成（bundle id `com.daidoko.app`）。
- Mac に **Xcode**（＋Command Line Tools）、**CocoaPods**、**Node/pnpm**、**EAS CLI**（`npm i -g eas-cli`）。
- **リポジトリを iCloud 同期の外に置く**（2026-08-27 に実害が出た）。

  > macOS の「デスクトップと書類フォルダ」を iCloud Drive に同期する設定がオンだと、
  > `~/Documents/` 配下のリポジトリが同期対象になる。**iOS のローカルビルドが不定期に壊れる。**
  >
  > 確認: `defaults read com.apple.finder FXICloudDriveDocuments` が `1` なら同期対象。
  >
  > 実際に起きたこと:
  >
  > 1. **競合コピーが作られる** — `app 2.xcodeproj` / `Pods 2` / `node_modules/drizzle-orm 2` 等。
  >    iCloud が同期の競合を解決するときに作る「 2」付きのファイル
  > 2. **`pod install` が止まる** — `app.xcodeproj` と `app 2.xcodeproj` が両方あるため
  >    `[!] Could not automatically select an Xcode project`
  > 3. **ファイル読み取りが中断される** — `Errno::ECANCELED - Operation canceled @ io_fread`。
  >    ファイル自体は壊れていない（`head` では読める）。iCloud のファイルプロバイダが中断している。
  >    **毎回は出ない**（3 回目で通った）ので「たまに失敗する」という一番厄介な形になる
  > 4. **ビルドが失敗する** — `pod install` が最後まで通っていないため
  >    `no type or protocol named EXPermissionsRequester` 等で落ちる
  >
  > **EAS のクラウドビルドでは表面化しない**（一時ディレクトリへコピーして prebuild し直すため。
  > ただしログには `The ios project is malformed, project files will be cleared and reinitialized`
  > が出る）。**ローカルビルド・`pod install`・シミュレータ確認だけが直撃を受ける。**
  >
  > `node_modules` と `ios/Pods` は数万ファイルあり、再生成できるものなので、
  > **そもそも同期する意味がない**。`~/Projects` のような同期外へ移すのが本筋。

- リポジトリを clone し、**リポジトリルートで** `pnpm install`（`.npmrc` が `node-linker=hoisted`。
  `apps/mobile` 内では実行しない）。

## 1. シミュレータで動作確認（Windows で未確認の iOS 描画をここで検証）

```bash
xcrun simctl boot "iPhone 16 Pro Max" ; open -a Simulator
pnpm --filter mobile exec expo run:ios          # dev クライアントで起動
```

確認ポイント（iOS で有効化した機能）:

- **写真からレシピ**（AI）が表示・動作する（サーバー/BYOK 経由）。端末内ラベリングは iOS では効かないが
  サーバー推論にフォールバックする。
- **文字入り画像OCR / レシート** の入口が **表示されない**（add / 在庫画面。Android 専用のため iOS で非表示）。
- ローカル機能（レシピ/買い物/在庫/調理記録/家族）・バーコード・URL/手動/テキストが動作する。
- **iCloud バックアップ包含の確認**（#79）: Documents（DB・写真）をバックアップ除外して**いない**こと
  — コードベースに `isExcludedFromBackup` / `NSURLIsExcludedFromBackupKey` が無いことを確認
  （既定で iCloud デバイスバックアップに含まれる。バックアップ画面の iOS 案内カードと整合）。

## 2. App Store 用スクリーンショット（自動取得）

```bash
# ストアショット用ビルド（サンプルデータ有効＋コーチマーク無効）をシミュレータへ
EXPO_PUBLIC_ENABLE_SAMPLE_DATA=1 EXPO_PUBLIC_DISABLE_COACH_MARKS=1 \
  pnpm --filter mobile exec expo run:ios --configuration Release
node scripts/release/capture-ios-screenshots.mjs     # 9:41・満充電に固定して取得
```

- 出力 = `docs/store/app-store/phone-screenshots/`（en は `phone-screenshots-en/`。順序・サイズは同 README）。
- 主サイズ = 6.9"（iPhone 16 Pro Max = 1320×2868）。`08`/`10` は manual（AI 実行と実データが要る）。
- **ストア公開物なのでユーザーに提示して承認を得る**。アップロードは Windows 側から
  `node scripts/release/update-appstore-screenshots.mjs --lang ja|en`（ロケールごとに別セット。
  `docs/リリース手順.md` §7-5）。

### シミュレータ操作の罠（2026-08-29・1.12.3 の撮影で実測）

- **`simctl erase` 後に Simulator.app のウィンドウが最小化されることがある。**
  最小化されると `System Events` の `count of windows` が 0 になり AppleScript のタップが
  全滅する。`open -a Simulator` でも Window メニューでも復帰せず、**Dock のアイコンを
  クリック**して解決した。erase したら `count of windows` を確認すること
- **撮影前に `simctl list devices booted` が 1 台だけか確認する。** `open -a Simulator` の
  繰り返しで別の個体（iPhone 16 Plus）が意図せず同時起動していた。撮影スクリプトは
  booted を自動選択するので、複数起動だと別の画面サイズを撮る。`--udid` 明示と二重で守る
- **タップは座標でなくアクセシビリティ要素名で。** iOS の AX 要素は macOS 側から見える:
  `entire contents of window 1` から `description` 一致で click。**`repeat with e in els` では
  要素参照が解決されない — インデックス指定（`item i of els`）が必要**。URL 確認ダイアログの
  「開く」は SpringBoard 側にあり、アプリの AX ツリーではなくウィンドウ全体から探す

## 3. EAS iOS 本番ビルド（**クラウド一択**）

> **ローカル Mac ビルドは「不要」ではなく「使えない」**（2026-08-27 実測）。
> Apple は 2026-04-28 以降 **Xcode 26 + iOS 26 SDK** を要求し、手元の Mac は
> Xcode 16.4 / iOS 18.5 SDK。`eas build --local` の成果物は
> `SUBMISSION_SERVICE_IOS_SDK_VERSION_ERROR` で弾かれる。
> **しかもアップロードは成功して Apple 側で拒否される**ので失敗が分かるのが遅い。
>
> **Xcode は上げようがない** — この Mac は macOS Tahoe 26 の対象外で、かつ
> **Xcode 26 に Intel 版が無い**（arm64 単独ビルドしか配布されていない）。
> `xcodes list` は `[Universal]` と表示するが嘘で、入れても `bad CPU type in executable`
> になる（2026-08-28 実測・XcodesOrg/xcodes#456）。**入れる前に `lipo -archs` で実体を見ること。**
> 詳しくは `docs/リリース手順.md` §7-4。
>
> **EAS の無料枠が尽きたら翌月 1 日のリセットを待つ。**`--local` は枠を消費しないが、
> **枠の問題ではなく SDK の問題**なので回避策にならない。

```bash
git checkout main && git pull            # EAS はローカル作業ディレクトリをアップロードするため main を使う
cd apps/mobile
pnpm exec eas build -p ios --profile production --non-interactive --no-wait
pnpm exec eas build:view <BUILD_ID> --json   # status FINISHED / artifacts
```

- ~~初回は EAS が Apple ログインを求める~~ → **クレデンシャル構築済み（2026-08-13・`docs/リリース手順.md` §7-4-2）**。
  配布証明書・プロビジョニングプロファイルは EAS 管理（期限 2027-08-13）。ビルドは Windows からでも非対話で通る。
- `eas.json` の `build.production` は platform 共有（top-level の env/autoIncrement）なので **iOS ビルドにそのまま使える**。
  **`submit.production.ios` も設定済み**（App Store Connect API キー `8C387NYC2T`・`.p8` は `C:\secure\`・リポジトリ外）。
  `appVersionSource: local` なので app.json の `version` を上げる。
- `ITSAppUsesNonExemptEncryption: false` は設定済み（輸出コンプライアンス質問を回避）。

> **App Extension ターゲットを足した版は、非対話ビルドが通らない**（2026-09-02・1.13.0 で被弾）。
> 症状: `Setting up credentials for target ShoppingWidget (com.daidoko.app.widget)` の直後に
> `Distribution Certificate is not validated for non-interactive builds.` →
> `Failed to set up credentials. Run this command again in interactive mode.` でビルドが始まらない。
> 原因: EAS 管理のクレデンシャル（上の 2026-08-13 構築分）は**本体 `com.daidoko.app` の分しか無い**。
> ウィジェットは別バンドル ID なので、専用のプロビジョニングプロファイルを作る必要があり、
> その作成は Apple への対話ログインを伴うため `--non-interactive` では必ず落ちる。
> `EXPO_ASC_API_KEY_PATH` / `EXPO_ASC_KEY_ID` / `EXPO_ASC_ISSUER_ID` を渡しても**変わらない**
> （ASC API キーは submit 用で、Developer Portal のプロファイル作成には効かない）。
> **先に Bundle ID が Apple Developer Portal に登録されているか確かめる。** 1.13.0 では
> `com.daidoko.app.widget` が**未登録**で、対話メニューを最後まで進めてもプロファイルを作れず
> 同じエラーに戻った（登録してから対話をやり直す必要がある）。EAS のエラー文には
> 「App ID が無い」とは出ないので、ここを疑えないと同じ対話を何度も繰り返すことになる。
> 確認は App Store Connect API で非対話にできる（`C:\secure\AuthKey_8C387NYC2T.p8`・
> `kid=8C387NYC2T`・`iss=5390b406-…` で ES256 の JWT を作り
> `GET https://api.appstoreconnect.apple.com/v1/bundleIds?limit=200`）。
> 登録も同じキーで `POST /v1/bundleIds`（`identifier` / `name` / `platform: "IOS"`）でできる
> ＝**Portal の画面を開かずに登録まで通せる**。2026-09-02 はこれで登録した（id `HX44G883F7`）。
>
> 対処: Bundle ID を登録したうえで、**人間が対話ターミナルで一度だけ**（エージェントはメニューを操作できない）:
>
> ```
> cd apps/mobile && pnpm exec eas credentials -p ios
> ```
>
> `production` → ターゲット選択で **新しい extension の方**（例 `ShoppingWidget
(com.daidoko.app.widget)`）→ `Build Credentials` → `All: Set up all the required
credentials to build your project` → Apple ID でログイン（2FA）→ 配布証明書は
> **既存を再利用**・プロビジョニングプロファイルだけ新規作成 → `Go back` → `Exit`。
> 以後は非対話で通る。
>
> **どちらのターゲットに居るかはプロファイル名で見分ける。** `Would you like to reuse the
original profile?` で出る名前が `[expo] com.daidoko.app AppStore …`（`.widget` が付かない）なら
> **本体ターゲット**に居る。本体は既に正常なので **Yes（再利用）**を選び、`Go back` して
> ウィジェットのターゲットを選び直す。ここで本体のプロファイルを作り直すと、動いている
> 配布設定を壊しかねない。ウィジェット側はプロファイルが存在しないので新規作成になる。
> **配布証明書は必ず「再利用」を選ぶ。** `Reuse this distribution certificate?` で出る
> `5HJ3PY728Y` は `📲 Used by: @keisato848/daidoko,@keisato848/saien-techo` ＝**2 アプリ共用**。
> Apple は配布証明書の本数に上限があり、新規作成すると枠を食ううえ、さいえん手帳側の
> ビルドにも影響しうる。新規作成が要るのは**プロファイルだけ**。
>
> **App Group は EAS が自動で面倒を見る。** ウィジェットのターゲットを通すと
> `Synced capabilities: Enabled: App Groups` / `Linked: group.com.daidoko.app` が出て、
> 本体とウィジェットの App Group が Apple 側で紐づく（手で Portal を触る必要はない）。
>
> **新しい extension ターゲットを足す PR を見たら、リリース前にこの一手が要ると思うこと。**

## 4. TestFlight → 提出（外向きアクション — ユーザー承認を確認）

**審査提出まで全部 Windows の API で通る**（2026-09-03 の 1.13.0 で実証。ASC の画面は不要）:

```bash
node scripts/release/create-appstore-version.mjs --version <x.y.z> [--rename]  # 器（編集中があれば付け替え）
node scripts/release/update-appstore-listing.mjs --lang ja --version <x.y.z>   # 掲載文＋whatsNew
node scripts/release/update-appstore-listing.mjs --lang en --version <x.y.z>
node scripts/release/submit-appstore-version.mjs --version <x.y.z> --build-number <NNNNN> [--dry-run]
```

最後のスクリプトがビルド紐づけ → reviewSubmission 作成 → submitted:true まで行う。

**審査の状態確認（「却下された？」に API で即答する）** — 見る場所は 2 つ:

- `listVersions`（`lib/asc-api.mjs`）で `appStoreState`。審査待ち = `WAITING_FOR_REVIEW`、
  却下は `REJECTED` / `METADATA_REJECTED` / `DEVELOPER_REJECTED`
- `GET /v1/reviewSubmissions?filter[app]=<id>&limit=5` と `GET /v1/reviewSubmissions/<id>/items`。
  過去分も並ぶので履歴ごと分かる（APPROVED / REMOVED など）。
  却下理由の本文（Resolution Center のメッセージ）だけは API に無い — ASC の画面かメールで読む

> **新しいロケールを足した直後の提出は `STATE_ERROR.ENTITY_STATE_INVALID` で落ちる**
> （2026-09-03・en-US 追加直後に 2 連発）。`update-appstore-listing.mjs` が新規作成する
> ロケールには **`privacyPolicyUrl`（appInfoLocalizations 側）と `supportUrl`
> （appStoreVersionLocalizations 側）が入っていない**が、この 2 つは提出の必須属性。
> エラー本文の `associatedErrors` に欠けた属性名がそのまま出るので、ja から値を PATCH で
> 写して再実行すれば通る。掲載スクリプト側の恒久修正は今後の宿題（このときは手で埋めた）。

1. `pnpm exec eas submit -p ios --profile production --latest`（または App Store Connect にアップロード）。
   **アップロードが届いたかの裏どりは ASC API が確実**（eas-cli 16.x に `submit:list` は無く、
   `build:view --json` にも submissions フィールドが無い — 2026-09-03 実測）。
   `GET /v1/builds?filter[app]=6800964382&sort=-uploadedDate`（JWT は §3 の要領）で
   該当 build number が `processingState: VALID` で並べば成功。
2. **TestFlight** で実機インストールし、写真レシピ・ローカル機能を最終確認。
3. App Store Connect でメタデータを設定:
   - **App Privacy（栄養ラベル）**: AI 機能利用時に写真・食材名をサーバー送信する旨を申告（Play のデータセーフティ相当）。
     端末内 OCR は無効化済みなので申告不要。
   - **DSA: EU/英国は配信対象外にして取引者申告を回避**（2026-08 方針変更で iOS も広告あり。Play と同じ配信方針）。
     将来 EU 配信する場合は取引者だが Apple は個人でも **P.O. Box 可**（自宅住所は不要）。
   - スクショ（§2）・説明文（`docs/store/` を iOS 向けに流用）・年齢レーティング・カテゴリ（フード＆ドリンク）。
4. 審査提出（~1〜3日）。

## 既知の注意

- **広告 SDK**: iOS は広告なしだが `react-native-google-mobile-ads` の iosAppId はテスト ID のまま同梱される。
  App Privacy を簡素化したいなら iOS 向けに ads プラグインを app.config.js の条件分岐で除外する検討余地あり。
- **スクショの iOS サイズ**は Android と別物（6.9"）。`docs/store/app-store/` に iOS 専用で保管し、Play の
  `docs/store/google-play/` とは混ぜない。
- iOS のローカル release ビルドは Android の `build-android.mjs` のような特別扱いは不要（`expo run:ios` / EAS で足りる）。
