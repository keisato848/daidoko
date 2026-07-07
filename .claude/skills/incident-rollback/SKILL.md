---
name: incident-rollback
description: リリース後に問題が発覚したときの巻き戻し・被害最小化の手順。Play は「停止＋前方修正」（バイナリのロールバック不可）、Railway サーバーは旧デプロイの再デプロイ。緊急時の判断基準と外向きアクションの承認ゲート込み。
---

# 障害時の巻き戻し（Play / Railway）

## 大原則

- **Google Play はバイナリのロールバック不可**（versionCode は単調増加のみ）。戦略は
  「**公開停止 or 段階公開の停止 → 修正版を新 versionCode で前方修正**」
- どちらも**外向きアクション** — 実行前にユーザーの明示承認を取る

## 1. Play（アプリ側の障害）

1. **影響の確認**: Play Console → 品質 → Android Vitals（クラッシュ/ANR）、リリースダッシュボード
2. **止血**（症状の深刻度で選択）:
   - 段階公開中なら: 製品版リリース → 段階公開を**一時停止**（それ以上広がらない）
   - 全面公開済みなら止血手段はない → 前方修正を最速で
3. **前方修正**: develop に fix → 実機/エミュレータで再現確認と修正確認（emulator-verify）→
   versionCode を +1 して release-play フローで提出。審査に時間がかかる場合は
   Console の「審査の優先」オプションは無い前提で計画する
4. **サーバー起因なら Play を触らない**（§2 で解決する方が速い）

## 2. Railway（サーバー側の障害）

```bash
railway logs --service daidoko            # まずログで原因を特定
railway deployment list --service daidoko --json   # 直近の SUCCESS デプロイ ID を確認
```

- **設定起因**（環境変数の誤り等）: `railway variables --set` で修正 → 再デプロイ
- **コード起因**: 直前の正常コミットを checkout して `railway up --service daidoko --detach`
  （Railway はローカルディレクトリをビルドするため、**git で戻してから up** すればそれが旧版再デプロイに相当）
- 復旧確認: `/health` 200 → AI エンドポイント疎通（node fetch で日本語 POST — Git Bash curl は CP932 で壊れる）

## 3. ストア掲載・申告の巻き戻し

- 掲載文/スクショ: `docs/store/` の git 履歴から旧版を取り出し `update-play-listing.mjs` / `update-play-screenshots.mjs` で再反映
- データセーフティ申告: 旧申告内容は docs/リリース手順.md §4 に記録がある → console-browser-ops で再申告

## 4. 事後

- 原因と対処を docs/リリース手順.md §5（トラブルシューティング表）へ追記
- 再発をフック/検証で防げるなら scripts/agent/hook-pretool-guard.mjs / release-verify Skill に反映
