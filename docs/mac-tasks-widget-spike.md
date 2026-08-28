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

結果（バージョン番号そのまま）を本ファイル末尾の「## 結果」に書く。

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

（ここに追記）
