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

## やらないこと

- main / release ブランチへの実装コミット（スパイク結果の追記だけ）
- 証明書・プロビジョニングの変更（EAS 管理のまま）
- pnpm overrides・patch-package の追加（SDK 51 時代の残骸を復活させない）

## 結果

### フェーズ 1: 環境チェック（2026-08-29 実測）

**要件はすべて満たしています。** ローカル反復は可能です。

| 項目 | 要件 | 実測 | 判定 |
| --- | --- | --- | --- |
| macOS | 15 (Sequoia) 以上 | 15.7.9 (24G830) | ✅ |
| Xcode | 16 以上 | 16.4 (16F6) | ✅ |
| CocoaPods | 1.16.2 以上 | 1.17.0 | ✅ |
| Node | 20+ | v22.23.2 | ✅ |
| pnpm | — | 9.0.0 | ✅ |

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
