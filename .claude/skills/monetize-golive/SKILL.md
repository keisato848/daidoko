---
name: monetize-golive
description: 広告有効化リリース（収益化方針A）の実行手順。AdMob 承認確認 → ADMOB_ENABLED/AD_ID 切替 → 広告有効ビルドのエミュE2E → Play 広告申告・データセーフティ → バンプ→EAS→提出まで。RevenueCat キーは投入しない（課金は保留）。
---

# 広告有効化リリース（方針A: 広告のみ・課金なし）

背景と依存表は `docs/リリース手順.md` §6-0。前提 = **AdMob アプリ確認の承認**（要審査のうちは配信制限、
未承認のまま本番リリースするとポリシーリスク）。

## 0. 大原則

- **RevenueCat キー（EXPO_PUBLIC_REVENUECAT_API_KEY）は入れない** — 課金は方針Aで保留。
  Play 側に商品が無い状態でキーを入れると購入ボタンが実体化して必ず失敗する（edit-guard が ask で守る）
- **Google Payments 販売アカウントも送信しない**（送信→課金有効化は自宅住所の公開・不可逆）

## 1. 事前確認

1. AdMob コンソールでだいどこの承認ステータス = 準備完了（console-browser-ops Skill §4）
2. app-ads.txt が配信中: `curl -s https://keisato848.github.io/app-ads.txt` に pub-2633806931583277 行

## 2. 設定切替（コード側・リリース手順 §6-2）

1. `apps/mobile/eas.json` build.production.env に `"EXPO_PUBLIC_ADMOB_ENABLED": "true"` を追加
   （ユニット ID は配線済み: ca-app-pub-2633806931583277/2276751496）
2. `apps/mobile/app.json` の `android.blockedPermissions` から `com.google.android.gms.permission.AD_ID` を**削除**
3. **AD_ID トリプルチェック**: (a) blockedPermissions 削除 ↔ (b) Play 広告申告=はい ↔ (c) データセーフティ広告ID申告
   — 3点が揃わないと提出拒否（実績あり）

## 3. 広告有効ビルドのエミュレータ E2E（emulator-verify Skill 併用）

```bash
EXPO_PUBLIC_ADMOB_ENABLED=true EXPO_PUBLIC_FREE_DAILY_LIMIT=0 \
  node scripts/agent/build-android.mjs --prebuild --arch x86_64   # app.json 変更を反映するため --prebuild 必須
```

- エミュレータは `-dns-server 8.8.8.8,1.1.1.1` で起動（広告・UMP はネット必須）
- 確認項目（テストID構成では 2026-07-05 検証済み。本番IDでの再確認）:
  ペイウォールに「広告を見て1回ぶん」→ リワード広告表示 → Reward granted → +1回付与 → 設定の残数反映。
  本番ユニットは**テストデバイス登録**でテスト広告が出る
- UMP 同意フォームは GDPR 圏のみ表示（日本では出ない。確認したい場合は AdsConsent の debugGeography で EEA 偽装）

## 4. Play Console 申告（console-browser-ops Skill §2/§3）

広告=はい、データセーフティに広告ID/デバイスID 追加 → **審査送信はユーザー承認後**。

## 5. リリース（release-play Skill と同じ流れ）

versionCode バンプ（例 1.4.0 / 10011）→ develop→main PR → main から EAS production ビルド →
`python scripts/release/check-elf-align.py <aab>`（16KB）→ AAB の AndroidManifest に
`com.google.android.gms.permission.AD_ID` が**含まれている**ことを確認 → `eas submit`（ユーザー承認）。

## 6. リリース後

- AdMob ダッシュボードでリクエスト/マッチ率を確認（配信開始まで最大1時間）
- サーバーの `INFER_GLOBAL_DAILY_LIMIT` を見直す（広告で AI 利用が伸びる場合の引き上げ — 広告が原資）
