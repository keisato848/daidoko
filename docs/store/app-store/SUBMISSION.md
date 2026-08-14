# App Store 初回審査提出 — 進捗と残作業

対象: iOS 1.7.0 / build 10019 ／ App ID **6800964382** ／ bundle `com.daidoko.app`
Team: **VY7SNHS2BY**（Kei Sato, Individual）

このファイルは**作業の引き継ぎ用**。Mac 側でこのブランチを clone/checkout して再開する。
背景と手順の全体像は `docs/リリース手順.md` §7 と `.claude/skills/ios-release`。

---

## 済んでいること（2026-08-13・Windows 側で完了）

| 項目                       | 状態                                                                      |
| -------------------------- | ------------------------------------------------------------------------- |
| Apple Developer Program    | 有効（Team `VY7SNHS2BY`）                                                 |
| 署名クレデンシャル         | 配布証明書・Provisioning Profile とも **2027-08-13 まで有効**（EAS 保管） |
| App Store Connect アプリ枠 | 作成済み（App ID `6800964382`・SKU `daidoko`・プライマリ言語 日本語）     |
| EAS iOS 本番ビルド         | 成功（build `567e0560-d356-422d-a5f9-72d26a21f76c`）                      |
| **TestFlight**             | **1.7.0(1) 配信済み・実機で動作確認済み**（内部グループ「身内テスト」）   |
| 配信地域                   | 175 → **147**（EU27＋英国を除外。新地域の自動追加もオフ）                 |
| App Privacy（栄養ラベル）  | **申告・公開済み**                                                        |
| プライバシーポリシー URL   | 設定済み（gist）                                                          |
| 提出用 API キー            | `eas.json` の `submit.production.ios` に配線済み（`.p8` は `C:\secure\`） |

**提出コマンドは非対話で通る状態**:

```bash
cd apps/mobile
pnpm exec eas submit -p ios --profile production --id <BUILD_ID> --non-interactive
```

---

## 残作業

### 1. スクリーンショット（**撮影済み** — 2026-08-13）

**8枚とも取得済み**（`phone-screenshots/` にコミット済み・commit 666f1ce）。
iPhone 16 Pro Max / iOS 18.5 で 1320×2868、ステータスバー 9:41 固定、8枚すべて別画像であることを確認済み。
**残るはアップロードだけで、これは ASC API 経由なので Windows からでもできる。**

主サイズ = 6.9インチ（iPhone 16 Pro Max = 1320×2868）。構成・順序は
`phone-screenshots/README.md` の表（Google Play 版と揃える。iOS では OCR 系の `05` を使わない）。

**iPad 用スクショは不要**（2026-08-13 確認）。本アプリは iPhone 専用に宣言している:

| 箇所                                            | 設定                         |
| ----------------------------------------------- | ---------------------------- |
| `apps/mobile/app.json`                          | `ios.supportsTablet: false`  |
| `apps/mobile/ios/app.xcodeproj/project.pbxproj` | `TARGETED_DEVICE_FAMILY = 1` |

ASC は宣言したデバイスファミリーぶんしかスクショを要求しないので、iPad スロットは必須にならない。
iPhone 専用アプリが iPad 上で互換モード表示されることに対して iPad スクショを求められることもない。
**将来 `supportsTablet: true` にすると 13インチ iPad のスクショが必須になる**点だけ注意。

```bash
# 前提: リポジトリルートで pnpm install（apps/mobile 内では実行しない）
xcrun simctl boot "iPhone 16 Pro Max" ; open -a Simulator

# ストアショット用ビルド（サンプルデータ有効＋コーチマーク無効）
EXPO_PUBLIC_ENABLE_SAMPLE_DATA=1 EXPO_PUBLIC_DISABLE_COACH_MARKS=1 \
  pnpm --filter mobile exec expo run:ios --configuration Release

# 取得（ステータスバーは 9:41・満充電に固定される）
node scripts/release/capture-ios-screenshots.mjs
```

- 出力 = `phone-screenshots/`。**ストア公開物なのでユーザーに提示して承認を得る。**
- **アップロードは ASC API でできる**（`appScreenshotSets` → `appScreenshots` の予約＋アップロード＋コミット。
  疎通確認済み）。Play の `update-play-screenshots.mjs` 相当のスクリプトは未作成なので、
  撮り終えたら Windows 側でも書ける。Web UI から手で上げてもよい。

### 2. ~~掲載文の反映~~ → **反映済み（2026-08-13）**

`listing-ja.md` の内容を `appStoreVersionLocalizations` / `appInfoLocalizations` に流す。
**公開文面なので、反映前に必ずユーザーに提示して承認を得る。**

- **App 名の変更が必要**: アプリ枠は旧 ASO 名で作ってしまっている
  （現行「だいどこ - レシピ管理・買い物リスト・食材管理」→ Play と揃えて
  「だいどこ - お店の味を再現するレシピ・買い物リスト」へ）
- サブタイトル・プロモーションテキスト・キーワード・説明・新機能・サポート URL・著作権

### 3. カテゴリ・年齢制限（Console UI／一部 API）

- プライマリ = フード＆ドリンク、セカンダリ = ライフスタイル
- **年齢レーティングの UGC 質問 → 「該当なし」で申告する**（2026-08-13 判断）

  Apple の年齢レーティング質問票が訊いているのは
  **「アプリ内で、他人が作ったコンテンツをユーザーが目にするか」**（＝ Guideline 1.2 が求める
  フィルタ・通報・ブロックの必要性の有無）。`docs/Web共有設計.md` の設計上、これに当たらない:
  - サイト内に**一覧・検索・発見の面を作らない**（§2-1）
  - `noindex` ＋ `X-Robots-Tag` で検索エンジンにも載せない
  - 共有はユーザーの明示操作のみ・**いつでも取り消し可**（取り消し後は 404）
  - 出ていくのは**自分のレシピだけ**。受け手が読むのは**ブラウザ側**で、
    アプリ内に他人の投稿を見る導線は無い
  - 共有可否は `sources.type` で機械的に判定し、取り込み由来のレシピは共有できない（§2-2）

  **Play の「その他のユーザー作成コンテンツを収集」とは別の質問なので、矛盾しない。**
  あちらは「どんなデータを収集するか」（＝ Apple では App Privacy 側。申告済み）、
  こちらは「他人の投稿を見せる面があるか」。引き継ぎ時にここを混同しないこと。

  ※ ASC の質問文は改訂されることがあるので、実際の文面が上記の趣旨とずれていたら読み直して判断する。

### 4. App Review 情報

- **アカウント不要**（デモアカウントの提供は不要）。ログインは存在しない
- **Sign-in required = No / Demo account = 不要**

仕様は `apps/mobile/src/services/usage.service.ts:20-29` で確認済み（2026-08-13）:
無料枠は **生涯 1 回（`FREE_LIFETIME_LIMIT`・日付キーを持たないのでリセットされない）**、
広告で得たトークンは**失効しない**、**広告視聴は 1 日 3 本まで**（`AD_BONUS_DAILY_LIMIT`）。

**Review Notes（そのまま貼れる英文）:**

```
No account or login is required. All core features (recipe library, cooking mode,
shopping list, pantry) work fully offline with no sign-in.

AI features (photo-to-recipe, taste adjustment, recipe consultation) require a
network connection:
- Each install includes 1 free AI generation. This is a lifetime allowance and
  does not reset daily.
- After it is used, the user can watch a rewarded ad to earn 1 more generation
  (max 3 ad views per day; earned credits never expire).
- Alternatively, entering a personal Google Gemini API key under
  Settings > "Use your own AI key" removes the limit entirely, with no ads.

The app does NOT perform allergen detection or provide medical/dietary advice.
This is stated in the app description as well.

Recipe sharing creates an unlisted web link for the user's OWN recipe only.
There is no in-app feed, search, or discovery of other users' content. Links are
noindex, are revocable by the user at any time, and return 404 once revoked.
```

日本語で出す場合も内容は同じ。**数値（1回・生涯・広告1日3本）は上記から変えないこと。**

### 5. 提出

上記が揃ってから審査提出。**外向きアクションなのでユーザーの明示承認を得てから。**

---

## 注意（実際に踏んだもの）

- **`eas submit` は「Something went wrong」と出しながら実際は成功していることがある。**
  失敗と決めつけて再実行すると、2回目がビルド番号重複で本当に落ちる。
  **必ず TestFlight 画面（`/apps/6800964382/testflight/ios`）で実物を確認する。**
  詳細ログは CLI に出ない → `expo.dev/.../submissions/<id>` の「Upload to App Store Connect」を展開する
- **`ios.buildNumber` は `app.json` で versionCode と同値に揃えてある。**
  同じ `version` で作り直して再提出するときは buildNumber だけさらに上げる
- App Store Connect の Web UI は**ウィンドウ幅が狭いとサイドバーが畳まれて操作しづらい**。
  ASC API で済むものは API で（アプリ枠作成と App Privacy だけが API 非対応）

### Mac 側でスクショを撮るとき（2026-08-13 に踏んだもの）

- **`node_modules` が古いと `expo run:ios` は JS バンドル段階で落ちる。**
  今回は `expo-localization` が `package.json` にあるのに未導入で
  `Unable to resolve module expo-localization`。**リポジトリルートで `pnpm install` してから**ビルドする
  （このときは `+29 -167` パッケージ入れ替わった）。`apps/mobile` 内では実行しない。
- **Release 構成は既定で `ONLY_ACTIVE_ARCH=NO`** ＝ シミュレータ向けでも x86_64 と arm64 の
  両スライスを作るのでコンパイル量が 2 倍になる。Intel Mac では x86_64 しか使わないので、
  `ONLY_ACTIVE_ARCH=YES` を渡せば実測で半分になる（`sqlite3.c` のような巨大 C ファイルで差が大きい）。
- ビルド中は **`xcrun simctl` 系が 120 秒でタイムアウトする**ことがある（2 コア機で CPU を奪われるため）。
  シミュレータの故障ではないので、ビルド完了を待ってから叩き直す。
- ビルド完走までシミュレータはホーム画面のまま。`expo run:ios` は
  **コンパイル完了後にインストール＆起動**するので、途中で何も起きないのが正常。
- **ランタイムは Xcode の SDK 版に合わせる。** Xcode 16.4 の SDK は **18.5**
  （ビルドログの `iPhoneSimulator18.5.sdk` で確認できる）。
  **iOS 18.6 ランタイム**を使うと `com.apple.-0LaunchServicesMigrator` が
  ウォッチドッグ（30秒）で殺され、`Data Migration Failed` → `simctl install` が
  タイムアウトする。erase しても CPU が空いていても再現した。18.5 に落とすと install は通る。
- **`simctl` がタイムアウトしても「失敗」とは限らない。** `perl -e 'alarm N; exec @ARGV'` で
  上限をかけると `rc=142`（128+SIGALRM）になる。これは自分のタイムアウトであってアプリのエラーではない。
- **`simctl terminate` が刺さると後続の `simctl` が全部詰まる**（CoreSimulator はデバイス操作を直列化する）。
  復旧は「刺さった simctl を kill → `killall -9 com.apple.CoreSimulator.CoreSimulatorService`（launchd が復帰させる）」。
- この機体（**8GB / Intel 4コア 1.4GHz**）では、シミュレータのシステムデーモンが
  次々クラッシュし（`maild` `searchd` `MobileCal` ほか）、アプリも起動 **19秒**ほどで消え、
  合成タップも UI に届かなくなった。Pageins は 4,099万回。
  **ビルドとシミュレータを同時に走らせないこと。** 詰まったら Mac 再起動が結局早い。

---

## 反映ログ（2026-08-13・Windows から ASC API で実施）

| 項目                        | 結果                                                                         |
| --------------------------- | ---------------------------------------------------------------------------- |
| App 名                      | 「だいどこ - お店の味を再現するレシピ・買い物リスト」へ変更（旧 ASO 名から） |
| サブタイトル                | 写真1枚から、家で作れるレシピに（16/30）                                     |
| プロモーションテキスト      | 57/170。**審査なしで後から変更できる唯一の欄**                               |
| キーワード                  | 83/100                                                                       |
| 説明                        | 1109/4000                                                                    |
| サポート/マーケティング URL | LP                                                                           |
| 著作権                      | 2026 Kei Sato                                                                |
| バージョン番号              | 自動作成の `1.0` → **`1.7.0`**（アップロード済みビルドに合わせる）           |
| カテゴリ                    | FOOD_AND_DRINK / LIFESTYLE                                                   |
| スクリーンショット          | `APP_IPHONE_67` に 8 枚・README の順序で並べ替え済み・全て COMPLETE          |

**踏んだ落とし穴:**

- **初回リリースには `whatsNew` を書けない**（`409 STATE_ERROR: Attribute 'whatsNew' cannot be edited at this time`）。
  「バージョンごとの新機能」はアップデートの欄なので、初回は説明文が担う。listing-ja.md の
  当該節は 1.8.0 以降で使う
- スクショは **`appScreenshotSets` を作り直してから**入れると順序が確実
  （予約 → PUT → `uploaded:true` + MD5 でコミット → `relationships/appScreenshots` の PATCH で並べ替え）
- **アップロードは Windows から実行できる**（撮影だけ macOS 必須）。スクリプトはスクラッチパッドの
  `push-listing.mjs` / `push-shots.mjs`（恒久化するなら `scripts/release/` へ）

**残り**: 年齢レーティングの質問票（Console UI）→ 価格（無料）→ 審査提出。
提出前に **PR #163（iOS 写真パス修正）をマージした上で iOS ビルドを作り直す**こと
（今のビルドには写真が消える不具合が入っている）。

---

## 初回審査に提出（2026-08-14）

**iOS 1.8.0 / build 10023 を審査に提出した（`WAITING_FOR_REVIEW`・承認後に自動公開）。**

### 提出前の監査で見つけて直したもの

**掲載情報だけでなく、提出物そのもの（.ipa）を開いて検査した**（手順 = `docs/リリース手順.md` §7-4-3）。

| 見つけたもの                                                   | 原因                                                            | 対処                                                                                                            |
| -------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 使っていない `NSMicrophoneUsageDescription`                    | `expo-camera` **と** `expo-image-picker` の**両方**が既定で足す | 両方に `microphonePermission: false`（片方だけでは消えない — 10021 で実証）                                     |
| `NSUserTrackingUsageDescription` があるのに ATT を呼んでいない | ads プラグインの `userTrackingUsageDescription`                 | 削除。**文字列があるだけで Apple はバイナリを「トラッキングする」と判定**し、App Privacy と矛盾して提出が止まる |

### 提出 API を叩いて初めて出たブロッカー

静的検査では見つからない「申告どうしの矛盾・未設定」は、**実際に提出して初めて分かる**。先に踏んでおくと審査に回ってから拒否されるより早い。

- `ENTITY_ERROR.ATTRIBUTE.REQUIRED: contentRightsDeclaration` → `DOES_NOT_USE_THIRD_PARTY_CONTENT`
- `STATE_ERROR.APP_PRICING_REQUIRED` → 価格スケジュールを**無料**で作成（基準地域 JPN・`/v1/appPriceSchedules` に `${p1}` 形式のローカル ID で inline 作成）
- `STATE_ERROR.BINARY_INDICATES_APP_TRACKS_USERS` → 上記 ATT 文字列の削除（**再ビルドが必要**）

### 提出の API 手順（旧 API は使えない）

`appStoreVersionSubmissions` は **CREATE 不可**（403）。現行は:

1. `POST /v1/reviewSubmissions`（platform: IOS）
2. `POST /v1/reviewSubmissionItems`（reviewSubmission + appStoreVersion）
3. `PATCH /v1/reviewSubmissions/{id}` に `{ submitted: true }` → `WAITING_FOR_REVIEW`

### 年齢制限の追加質問に回答（2026-08-14・期限 2026-09-07 より前に完了）

Apple が質問票を改訂して追加した項目。**督促は「アプリ情報」ページに出るが、
回答欄はそこには無い** — 「年齢制限指定 → 編集」で開くステップ 1「機能」の中にある。
督促文だけ見て探すと見つからないので注意。

未回答だったのは **「13歳未満のユーザに対するソーシャルメディアの利用不可」の 1 問だけ**で、
これが空のまま「次へ」が無効になっていた（他は API で入れた値がそのまま反映済み）。

| 設問                                 | 回答     |
| ------------------------------------ | -------- |
| ペアレンタルコントロール             | いいえ   |
| 年齢保証                             | いいえ   |
| 制限のないWebアクセス                | いいえ   |
| ユーザ生成コンテンツ                 | いいえ   |
| ソーシャルメディア                   | いいえ   |
| 13歳未満のソーシャルメディア利用不可 | いいえ   |
| メッセージ・チャット                 | いいえ   |
| 広告                                 | **はい** |

ステップ 2〜7 は「なし」のまま、上書きも「該当なし」で保存。
**算出結果 = 4+**（172か所の国または地域／ブラジル A12／韓国 すべて／ベトナム 00+）。
`GET /v1/apps/6800964382/appInfos?include=ageRatingDeclaration` で
`socialMediaAgeRestricted: false` が入ったことと `appStoreAgeRating: FOUR_PLUS` を確認済み。

**保存直後に「問題が発生しました」らしき要素が DOM に現れるが、8 件とも非表示のテンプレート残骸**で、
実際の保存は通っている。API で読み返して確かめること。

### 残タスク

- 審査結果の確認。承認後は `SHARE_APP_STORE_URL` を Railway に設定すると、共有ページの「アプリで保存」が iOS 端末では App Store に向く
- 無料枠が**再インストールで復活する**件（アップデートでは復活しない）。iOS はキーチェーンが削除後も残るので `expo-secure-store` に記録すれば塞げる。次リリースの題材
