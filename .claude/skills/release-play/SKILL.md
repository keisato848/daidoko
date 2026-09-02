---
name: release-play
description: Google Play へのアプリリリース一式。バージョンバンプ → develop→main リリース PR → EAS production ビルド → AAB 検証（16KB）→ 本番構成の実機 E2E → eas submit で production トラックへ CLI 提出。
---

# Google Play リリースパイプライン

詳細・トラブルシューティングは `docs/リリース手順.md` §0・§2・§5 を参照。
サーバー側に変更がある場合は先に `deploy-server` スキルで Railway を更新しておく。

## 手順

1. **バンプ**: `apps/mobile/app.json` の `version` / `android.versionCode` を更新
   （app.json が唯一のソース。`android/` は gitignore された prebuild 生成物）
   → feature ブランチ → PR → develop へマージ
2. **リリース PR**: `gh pr create --base main --head develop --title "release: x.y.z (versionCode N)"`
   → `gh pr checks <PR> --watch` で CI グリーン確認 → `gh pr merge <PR> --merge`（**develop は削除しない**）
3. **EAS ビルド**（main から）:
   ```
   git checkout main && git pull
   cd apps/mobile
   pnpm exec eas build -p android --profile production --non-interactive --no-wait
   ```
   → `pnpm exec eas build:view <BUILD_ID> --json` を 60 秒間隔でポーリング（FINISHED / artifacts.buildUrl）
4. **AAB 検証**: artifact を `Temp/eas-aab-<versionCode>/` にダウンロード →
   `python scripts/release/check-elf-align.py <aab>` で 16KB アライメント全 PASS を確認
5. **本番構成の実機 E2E**（マージ前検証の原則・省略しない）:
   - ローカル release ビルドは**必ず** `node scripts/agent/build-android.mjs`（生 gradlew は失敗する）
   - `adb reverse --remove-all` で localhost ブリッジを排除（API 既定 = Railway 本番）
   - 実機で AI 機能（食べた・名寄せ等）を操作し `railway logs --service daidoko` で 200 を裏どり
6. **ペルソナレビュー**（スクショ確定後・提出前 / advisory・ブロックしない）:
   `Workflow persona-review` を `args={version, jaDir, enDir}` で実行し、レポートを
   `docs/reviews/persona/<version>.md` へ保存（`docs/開発ハーネス.md` §8）。
   high の指摘はユーザーに提示して「直してから出すか」を仰ぐ
7. **提出**（外向きアクション — ユーザーの明示承認を確認してから）:
   ```
   cd apps/mobile
   pnpm exec eas submit -p android --profile production --path <AABパス> --non-interactive
   ```
   認証は `eas.json` の `submit.production`（キー: `C:\secure\play-service-account.json`）
8. 提出後にユーザーへ案内: データセーフティ（Console UI のみ）・ストア掲載（`update-store-listing` スキル）・審査待ち

## 既知の落とし穴

- **AD_ID 拒否**: 広告未使用リリースは `app.json android.blockedPermissions` に `com.google.android.gms.permission.AD_ID`（広告を出すリリースでは外して申告変更）
- **permission エラー**: サービスアカウントが Play Console に未招待（ユーザーと権限 → リリース権限）
- **versionCode**: バリデーション拒否では未消費 — 同じ番号で再提出可
- **submit 前のゲートは 2 段ある**（2026-09-02 の 1.13.0 で両方踏んだ）。`eas submit` を叩くと
  まず「`v<version>-play-<versionCode>` の git タグが無い」で止まり、タグを打つと次に
  「実機検証記録が無い」で止まる。**タグは検証記録の `headCommit` に打つ**（HEAD ではない。
  提出後に docs だけ進むことがあるので、後から「何を出したか」を辿れるのは検証済みコミット）
- **検証記録は「今のワークツリーに実在するか」で見られる。** 別セッションが記録を
  `release/1.13.0` へ push していても、自分のワークツリーが古いブランチのままだと
  `docs/verification/<v>-<code>.json` が無い扱いで弾かれる（記録は他人が作ることがある）。
  `git fetch && git checkout -B submit/<version> origin/release/<version>` で合わせてから submit する
- **pre-commit Prettier**: 変更ファイルを `prettier --write` してから commit
