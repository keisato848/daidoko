---
name: update-store-listing
description: Google Play ストア掲載（ja-JP の短い説明・詳しい説明）を CLI で更新する。docs/store/google-play/listing-ja.md を単一ソースとして androidpublisher API で反映。
---

# Play ストア掲載の CLI 更新

詳細は `docs/リリース手順.md` §3。プライバシーポリシーの公開反映は §4（main の docs/privacy-policy.md が公開 URL）。

## 手順

1. `docs/store/google-play/listing-ja.md` の「## 短い説明」（80字以内）「## 詳しい説明」（4000字以内・プレーンテキスト、■/・で整形）を編集
2. **公開文面なので必ずユーザーに文面を提示して承認を得る**
3. ドライラン: `node scripts/release/update-play-listing.mjs --dry-run`（文字数チェック＋内容表示）
4. 反映: `node scripts/release/update-play-listing.mjs`
   - タイトル・動画は Play 側の現行値を自動維持
   - 認証キー: `C:\secure\play-service-account.json`（`PLAY_SERVICE_ACCOUNT_KEY` で上書き可・値は出力しない）
   - `COMMITTED edit: <id>` が出れば完了
5. listing-ja.md の変更を PR で develop にマージ（リポジトリ記録と Play の同期を保つ）

## 注意

- スクリーンショット・グラフィックの差し替えは未スクリプト化（Play Console UI で実施）
- データセーフティフォームは API 非対応（Console UI のみ）— 回答ガイドは `docs/リリース手順.md` §4
