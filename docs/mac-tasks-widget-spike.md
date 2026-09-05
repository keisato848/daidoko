# Mac セッションへの依頼 — R5 iOS ウィジェットのスパイク（#238）

> ブランチ: `release/1.13.0`。設計は `docs/ウィジェット設計.md`（特に §4 リスク・§6 確認事項）。
> 完了したらこのファイルに結果を追記して push してください（Windows 側の管理セッションが読みます）。

## フェーズ 1: 環境チェック（**今すぐ・リポジトリ変更なし**）

`@bacons/apple-targets` 5.0.0 の要件を満たすかの確認。満たさないと
ローカル反復ができず EAS クラウド往復（実測 80〜100 分/回）だけになる。

```bash
sw_vers                     # macOS 15 (Sequoia) 以上か
xcodebuild -version         # Xcode 16 以上か
pod --version               # CocoaPods 1.16.2 以上か
node -v && pnpm -v          # Node 20+ / pnpm
```

結果（バージョン番号そのまま）を本ファイル末尾の「## 合図（2026-08-29・Windows 側から）

**依存追加を push した。フェーズ 2 を開始してよい。**
`@bacons/apple-targets@5.0.0` は apps/mobile/package.json に入っている
（app.json への iOS plugin 配線はまだ — フェーズ 2 は prebuild が通るかの検証が目的なので、
targets/ の雛形が必要なら `npx create-target widget` 相当の最小構成で試してよい。
ただしコミットはスパイク結果の追記だけ）。

## 結果」に書く。

## フェーズ 2: prebuild スパイク（**Windows 側から「依存追加を push した」と連絡が来てから**）

`react-native-android-widget` と `@bacons/apple-targets` を含むコミットが
`release/1.13.0` に載ったら:

1. `git pull` → **リポジトリのルートで** `pnpm install`（apps/mobile 内で実行しない —
   workspace を乗っ取る既知の罠）
2. `cd apps/mobile && npx expo prebuild -p ios --clean`
   - **確かめたいこと**: apple-targets 5.0.0（内部依存 `@expo/prebuild-config ~55.0.6` =
     SDK 55 世代）が **SDK 54 の prebuild で素直に通るか**（ここが今回のスパイクの本題）
3. 通ったら `npx pod-install` → Xcode でウィジェットターゲットがワークスペースに
   生えているかを確認（ビルドまで通れば理想）
4. 失敗した場合: **エラー全文**を本ファイルに貼る（対処は Windows 側で検討する。
   無理に直さない — バージョン固定やパッチは相談してから）

## フェーズ 3: iOS W1 の実装（フェーズ 2 完了済みなので開始してよい・2026-08-29 解禁）

> フェーズ 2 の指摘（「配線が無いので apple-targets のコードパスは未走行」）はそのとおり。
> **配線と targets/ を足すのはフェーズ 3 の仕事**として、実装ごと任せる。
> 設計は `docs/ウィジェット設計.md`（§1 スナップショット契約・§2 出すもの・§4 リスク）。

### 担当範囲（この 4 点だけ。Windows 側はここに触らない）

1. **app.json** の `plugins` に `@bacons/apple-targets` を配線（`appleTeamId: "VY7SNHS2BY"`）。
   **それ以外の app.json（version・既存 plugin）は変えない**
2. **apps/mobile/targets/**（新設）: ShoppingList ウィジェット（SwiftUI・小/中）。
   - App Group: `group.com.daidoko.app`
   - データ: App Group の UserDefaults キー **`widget_snapshot`** に JSON **文字列**。
     契約は `apps/mobile/src/utils/widgetSnapshot.ts` の `WidgetSnapshot`（version 1）。
     **Swift 側でも version > 1 は「アプリを開くと表示されます」の案内表示に落とす**
   - 表示規約は Android 版（`src/widgets/ShoppingListWidget.tsx` / `shoppingWidgetContent.ts`）と同じ:
     小 = 未購入 N 品＋上位 3 品名 / 中 = 6 行＋「ほか n 品」・**「HH:mm 時点」を必ず表示**・
     locale (ja/en) で文言切替・`widgetURL` = `daidoko://shopping`
3. **apps/mobile/src/services/widget-snapshot.service.ts** に **iOS 書き出し分岐**を追加:
   `@bacons/apple-targets` の ExtensionStorage（App Group UserDefaults）へ同じ JSON を書き、
   `reloadWidget()`（相当）を呼ぶ。Android 分岐・既存の write() は壊さない。
   **Platform ガード＋try/catch で、ウィジェット不在でも本体が無事**なこと（Android 版と同じ流儀）
4. テスト: 追加した純関数があれば jest。apps/mobile の typecheck / lint / jest を緑に

### 検証

prebuild -p ios --clean（**今度こそ apple-targets のコードパスが走る** — これがスパイクの本題）
→ シミュレータでビルド → ホーム画面にウィジェット追加 → 買い物リストに品を入れて
表示・タップ遷移を確認。スクショを撮って結果をこのファイルに追記。

### コミット規約（フェーズ 1・2 と違い、実装コミットを解禁）

- `release/1.13.0` に直接 commit・push してよい（Conventional Commits・
  実装は feat(widget): 〜 (W1-iOS・#238)）
- **pnpm-lock.yaml と package.json は変えない**（依存は追加済み。増やしたくなったら相談）
- 証明書・プロビジョニングは触らない（EAS 検証は Windows 側と調整して後で）

## やらないこと

- main / release ブランチへの実装コミット（スパイク結果の追記だけ）
- 証明書・プロビジョニングの変更（EAS 管理のまま）
- pnpm overrides・patch-package の追加（SDK 51 時代の残骸を復活させない）

## 結果

### フェーズ 1: 環境チェック（2026-08-29 実測）

**要件はすべて満たしています。** ローカル反復は可能です。

| 項目      | 要件              | 実測            | 判定 |
| --------- | ----------------- | --------------- | ---- |
| macOS     | 15 (Sequoia) 以上 | 15.7.9 (24G830) | ✅   |
| Xcode     | 16 以上           | 16.4 (16F6)     | ✅   |
| CocoaPods | 1.16.2 以上       | 1.17.0          | ✅   |
| Node      | 20+               | v22.23.2        | ✅   |
| pnpm      | —                 | 9.0.0           | ✅   |

出力そのまま:

```
$ sw_vers
ProductName:		macOS
ProductVersion:		15.7.9
BuildVersion:		24G830

$ xcodebuild -version
Xcode 16.4
Build version 16F6

$ pod --version
1.17.0

$ node -v && pnpm -v
v22.23.2
9.0.0
```

#### ⚠️ この Mac で作業するときの前提（フェーズ 2 で必要）

**1. PATH の先頭にある `node` は壊れています。** 素の状態では node@14 が先に来て、
icu4c が 78 に上がったため `Library not loaded: libicui18n.70.dylib` で起動しません。
`pnpm` も素の PATH には居ません。**コマンドの前に必ずこれを通すこと**:

```bash
export PATH="/usr/local/opt/node@22/bin:$PATH"
```

`brew link` での切り替えはしていません（環境全体が変わるため）。上の実測値はこの
export を通した状態のものです。

**2. リポジトリは iCloud 同期の外に置くこと。** `~/Documents` は「デスクトップと書類」の
iCloud 同期対象で、`~/Documents/GitHub/daidoko` では `node_modules` と `ios/` に
競合コピー（`app 2.xcodeproj` / `Pods 2` / `drizzle-orm 2` など）ができ、
`pod install` が 3 回連続で別々の理由（`.xcodeproj` が 2 つ / `Errno::ECANCELED` /
直接読むと正常な plist に対する `invalid byte sequence in UTF-8`）で失敗しました。
**`~/Projects/daidoko-shots` に clone し直して解決**しています（`pnpm install` が
7分36秒 → 15.2秒）。フェーズ 2 もこの clone で実施します。

**3. iOS ビルドの提出は EAS クラウド一択です**（`docs/リリース手順.md` §7-4 参照）。
この Mac は Xcode 16.4 / iOS 18.5 SDK 止まりで、Apple の要件（Xcode 26 + iOS 26 SDK）を
満たせません。**Xcode 26 は arm64 単独ビルドしか存在せず**、Intel 機には入りません
（`lipo -archs` で確認・`bad CPU type in executable`）。
**スパイクの目的（prebuild が通るか・ターゲットが生えるか）はローカルで確認できますが、
提出用バイナリはこの Mac では作れません。**

フェーズ 2 は「依存追加を push した」の連絡待ちです。

### フェーズ 2: prebuild スパイク（2026-08-29 実測）

**結論: 通ります。SDK 54 の prebuild は apple-targets 5.0.0 を入れても素直に成功しました。**

```
$ pnpm install                      # リポジトリのルートで
Done in 3.6s                        # 54 パッケージ追加・エラーなし

$ cd apps/mobile && npx expo prebuild -p ios --clean
- Clearing ios
✔ Cleared ios code
- Creating native directory (./ios)
✔ Created native directory
- Updating package.json
✔ Updated package.json | no changes
- Running prebuild
✔ Finished prebuild
- Installing CocoaPods...
✔ Installed CocoaPods
                                    # exit 0・警告なし
```

`npx pod-install` は不要でした（prebuild が CocoaPods まで面倒を見ています）。

#### 本題だった SDK 55 世代の依存は、衝突しませんでした

apple-targets 5.0.0 は `@expo/prebuild-config ~55.0.6` を要求し、SDK 54 の
`@expo/cli` は `^54.0.8` を要求します。`.npmrc` が `node-linker=hoisted` なので
「フラット配置では 1 バージョンしか置けず衝突するのでは」と疑いましたが、
**pnpm は競合するものだけネストして共存させていました**:

```
node_modules/@expo/prebuild-config                          55.0.22  ← apple-targets 用
node_modules/@expo/cli/node_modules/@expo/prebuild-config   54.0.8   ← SDK 54 用（CLI はこちらを解決）
```

`require.resolve('@expo/prebuild-config', {paths:['./node_modules/@expo/cli']})` で
**54.0.8 に解決されることを実測**しました。lockfile も両方を別エントリで持っています
（`@expo/prebuild-config@54.0.8` と `@expo/prebuild-config@55.0.22`）。
**overrides も patch も要りません。**

#### ⚠️ ただし、iOS ウィジェットのターゲットはまだ生えていません

これは想定内のはずですが、明示しておきます。**`ec089ad` は Android 側だけを配線しており、
`@bacons/apple-targets` は依存に入っただけで app.json の `plugins` に載っていません。**

```
app.json の plugins（10 件）:
  expo-router / expo-build-properties / withKotlinMetadataSkip /
  withDaidokoBackupRules / withDaidokoShortcuts / expo-image-picker /
  expo-camera / withDaidokoOcr / react-native-google-mobile-ads /
  react-native-android-widget          ← Android のみ
```

`apps/mobile/targets/`（apple-targets の規約ディレクトリ）も存在せず、
生成された `ios/app.xcodeproj` にウィジェット関連のターゲットはありません。

**つまり今回の「通った」は、apple-targets のコードパスを実際に走らせた結果ではありません。**
55 系の prebuild-config が読み込まれる経路をまだ通っていないので、
**プラグイン配線と `targets/` を足したあとに、もう一度このスパイクを回す必要があります。**
そのときに初めて「SDK 54 で 55 世代の prebuild-config が動くか」が試されます。

#### 環境（フェーズ 1 の前提を再掲）

- `export PATH="/usr/local/opt/node@22/bin:$PATH"` を通した状態で実行
- 作業ディレクトリは `~/Projects/daidoko-shots`（iCloud 同期の外）
- `pnpm install` は**リポジトリのルートで**実行（罠を回避）

#### やっていないこと

- app.json への apple-targets の配線（実装コミットになるため）
- `targets/` の作成
- Xcode でのビルド（ターゲットが無いので確認対象が存在しない）
- overrides / patch-package の追加

### フェーズ 3: iOS W1 の実装（2026-08-29 実測）

**結論: prebuild は通り Xcode ターゲットも生えたが、ネイティブモジュール
`ExtensionStorage` が Pod に入らず、アプリから App Group へ書けない。**
原因は apple-targets 5.0.0 側の**旧いプラットフォーム表記**。**直していない**（指示どおり相談待ち）。

#### 通ったもの

```
$ npx expo prebuild -p ios --clean       ✔ Finished prebuild / ✔ Installed CocoaPods（exit 0）
$ xcodebuild ... -configuration Release  ** BUILD SUCCEEDED **（Swift のエラー 0）
```

| 確認                           | 結果                                      |
| ------------------------------ | ----------------------------------------- |
| ウィジェットターゲットの生成   | ✅ `productName = ShoppingWidget`         |
| `WidgetKit.framework` のリンク | ✅                                        |
| `.appex` の同梱                | ✅ `app.app/PlugIns/ShoppingWidget.appex` |
| App Group（本体・拡張の両側）  | ✅ `group.com.daidoko.app`                |
| typecheck / lint / jest        | ✅ 123 suite・1113 件                     |

**SDK 54 の prebuild で SDK 55 世代の `@expo/prebuild-config` を持つ apple-targets は動く** —
フェーズ 2 で保留にしていた本題は「問題なし」で決着。overrides も patch も要らなかった。

#### ⛔ 残った不具合: `ExtensionStorage` が autolink されない

アプリ側から App Group へ書けないので、**ウィジェットは常に「アプリを開くと表示されます」のまま**になる。

`expo-modules-autolinking` は見つけているのに、`Podfile.lock` に入らない:

```
$ npx expo-modules-autolinking resolve -p ios --json
  検出モジュール数: 23
  ★ @bacons/apple-targets -> ['ExtensionStorage']

$ pod install
  Pod installation complete! There are 98 dependencies from the Podfile and 105 total pods installed.
  （エラー・警告なし）

$ 差分
  autolinking: 23 件
  Podfile.lock に無いもの: ['ExtensionStorage']    ← 他の 22 件は全て入っている
```

**原因は `expo-module.config.json` のプラットフォーム表記が旧いこと。**

```
@bacons/apple-targets   "platforms": ["ios"]     s.platform  = :ios, '16.4'   ← 単数
expo-localization       "platforms": ["apple"]   s.platforms = { ... }
expo-system-ui          "platforms": ["apple"]   s.platforms = { ... }
```

リポジトリ全体を走査したが、**`["ios"]` を使っているのは `@bacons/apple-targets` だけ**。
SDK 54 の autolinking は `"apple"` を期待する。`resolve` は互換で拾うが、
`use_expo_modules!` が Podfile へ流す段階で落ちている（**エラーを出さずに黙って消える**のが厄介）。

**症状の出方が静かなので注記**: `ExtensionStorage.js` はネイティブが無いと例外ではなく
**no-op のスタブに落ちる**実装:

```js
const nativeModule = ExtensionStorageModule ?? {
  setString() {},
  reloadWidget() {}, // ← 何もしないで成功したふりをする
};
```

そのため `try/catch` にも引っかからず、`documentDirectory` への書き出しだけ成功して
iOS 側は静かに何も書かれない。**ログにも何も出ない。**

#### 対処案（**未実施** — 相談してから）

1. **`ios.deploymentTarget` を 16.4 以上に上げる** — podspec が要求している。ただし今回の
   直接原因ではない（platform 表記が先に効いている）ので、これだけでは解決しない見込み
2. **apple-targets を新しい版へ上げる** — `platforms: ["apple"]` に直っていれば解決する。
   ただし SDK 55 前提が強まる可能性があり、要調査
3. **patch-package で `expo-module.config.json` の `"ios"` を `"apple"` に書き換える** —
   1 行で直るが、「SDK 51 時代の残骸を復活させない」方針に反する
4. **ExtensionStorage を使わず、自前の小さなネイティブモジュールで App Group に書く** —
   依存を増やさないが実装が増える

**上流の問題**なので、2 が本筋だと思う。判断は Windows 側にお願いする。

#### 実測でしか分からなかった落とし穴 2 つ

**1. `expo-target.config.js` に `entitlements: {}` を明示しないと拡張側の App Group が生成されない。**
README は「App Group を使えるターゲットは app.json の配列を自動でミラーする」と書いているが、
`entitlements` オブジェクト自体が無いと `generated.entitlements` が書き出されず、
**本体側にだけ入って拡張側は空**になる。ビルドは通るので実機で見るまで気づけない。

**2. `-derivedDataPath` を `ios/` の中に置いてはいけない。**
`ios/build-widget` を指定したら、次の `pod install` が
`invalid byte sequence in UTF-8`（`set_RCTNewArchEnabled_in_info_plist`）で落ちた。
ビルド成果物の**バイナリ plist**（`bplist00`）を post-install フックがテキストとして
読もうとするため。`ios/` の外に出せば直る。

#### この変更で入れたもの

- `app.json`: `ios.appleTeamId` / `ios.entitlements`（App Group）/ `plugins` に `@bacons/apple-targets`（差分 7 行・version と既存 plugin は無変更）
- `apps/mobile/targets/shopping-widget/`: `expo-target.config.js` / `ShoppingWidget.swift`
  （文言・表示規約は Android 版の `WIDGET_DICT` / `shoppingWidgetContent.ts` と 1 語ずつ同一。
  小 = 3 品名 / 中 = 6 行＋「ほか n 品」/「HH:mm 時点」必須 / `widgetURL = daidoko://shopping` /
  version > 1 は案内表示）
- `src/services/widget-snapshot.service.ts`: `pushToIosWidget()` を追加
  （Platform ガード＋try/catch。Android 分岐と既存 `write()` は無変更）

**`pnpm-lock.yaml` と `package.json` は変えていない。証明書・プロビジョニングも触っていない。**

#### 未検証

**シミュレータでのウィジェット表示・タップ遷移は確認できていない。** 上の不具合で
App Group にデータが入らないため、確認しても「アプリを開くと表示されます」しか出ない。
`ExtensionStorage` が解決したら実施する。
