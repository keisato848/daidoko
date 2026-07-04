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
   `python C:/tmp/check_elf_align.py <aab>` で 16KB アライメント全 PASS を確認
5. **本番構成の実機 E2E**（マージ前検証の原則・省略しない）:
   - ローカル release ビルドは**必ず** `node scripts/agent/build-android.mjs`（生 gradlew は失敗する）
   - `adb reverse --remove-all` で localhost ブリッジを排除（API 既定 = Railway 本番）
   - 実機で AI 機能（食べた・名寄せ等）を操作し `railway logs --service daidoko` で 200 を裏どり
6. **提出**（外向きアクション — ユーザーの明示承認を確認してから）:
   ```
   cd apps/mobile
   pnpm exec eas submit -p android --profile production --path <AABパス> --non-interactive
   ```
   認証は `eas.json` の `submit.production`（キー: `C:\secure\play-service-account.json`）
7. 提出後にユーザーへ案内: データセーフティ（Console UI のみ）・ストア掲載（`update-store-listing` スキル）・審査待ち

## 既知の落とし穴

- **AD_ID 拒否**: 広告未使用リリースは `app.json android.blockedPermissions` に `com.google.android.gms.permission.AD_ID`（広告を出すリリースでは外して申告変更）
- **permission エラー**: サービスアカウントが Play Console に未招待（ユーザーと権限 → リリース権限）
- **versionCode**: バリデーション拒否では未消費 — 同じ番号で再提出可
- **pre-commit Prettier**: 変更ファイルを `prettier --write` してから commit
