---
name: promo-video
description: ストアプロモーション動画（YouTube 埋め込み）を実機/エミュレータから自動収録・編集する。見せるデータ（レシピ・買い物リスト・お店の料理写真）はすべてコード管理（seed.ts / scripts/release/promo-assets/）で、手作業のUI操作やAI推論の実行なしに再現できる。
---

# プロモーション動画の自動生成

collect（データはコード）→ record（screenrecord）→ edit（ffmpeg）→ review（フレーム確認）→ handoff（YouTube アップロードはユーザー作業）の一直線フロー。詳細は `docs/リリース手順.md` §3-4、ストア掲載全般は `update-store-listing` Skill。

## 0. データはコードで管理する（最重要）

動画に映る内容（レシピ・買い物リスト・お店の料理写真）は、**このリポジトリのコミット済みファイルだけから毎回同じように再現できる**ようにしてある。UI をタップして状態を作り込み、それが失われる（`--wipe-data` 一発で消える）という運用はしない。

| 何を見せるか                             | どこで定義しているか                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| 「写真からレシピ」の実演レシピ           | `apps/mobile/src/db/seed.ts` の `recipe-7`（ハムと卵の基本チャーハン）・ingredients・steps |
| その表紙写真                             | `apps/mobile/assets/seed-photos/chahan.jpg`（バンドルアセット、~130KB に圧縮済み）         |
| 買い物リストの中身（肉じゃがの不足材料） | `apps/mobile/src/db/seed.ts` の `seedShoppingItems`                                        |
| フォトピッカーに並ぶ「お店の写真」3枚    | `scripts/release/promo-assets/*.jpg`（record スクリプトが毎回ギャラリーへ push する）      |

**表紙写真の実体コピー**は `apps/mobile/src/db/migrate.ts` の `seedBundledPhotos()` が担当:
`expo-asset` でバンドル画像を解決 → `recipe-photos/` にコピー → `recipes.coverPhotoPath` を更新。
**ネイティブ環境のみ実行**（`isNativePlatform` かつ Jest でない）。Web/Jest では `coverPhotoPath` は
null のままで安全（既存6レシピと同じ挙動）。

**レシピ内容や表紙写真を差し替えたら** `migrate.ts` の `SAMPLE_DATA_VERSION` を bump すること
（既に `sample_data_version` が書き込まれた端末は再シードをスキップするため）。

## 1. 収録の前提（ビルド）

```bash
EXPO_PUBLIC_ENABLE_SAMPLE_DATA=1 EXPO_PUBLIC_DISABLE_COACH_MARKS=1 \
  node scripts/agent/build-android.mjs --arch x86_64
adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

`--wipe-data` した直後のエミュレータでも、起動して数秒待つだけで recipe-7・買い物リスト・
表紙写真が**自動で**揃う（この Skill の担当範囲では adb push はギャラリー写真3枚だけ）。

### エミュレータのロケール（フォトピッカーの言語）

`-wipe-data` するとシステムロケールがリセットされ、Android 標準のフォトピッカー（Google 製・
アプリの外側の UI）が英語表示に戻ることがある。動画に英語 UI が写らないよう、収録前に確認・是正:

```powershell
adb shell settings get system system_locales   # ja-JP でなければ↓
adb shell settings put system system_locales ja-JP
adb reboot                                      # 反映には再起動が必要（broadcast だけでは反映されない）
```

## 2. 収録・編集

```bash
node scripts/release/record-promo-video.mjs [--serial <serial>] [--scenes 01,02]
node scripts/release/edit-promo-video.mjs
# → Temp/promo-video/daidoko-promo.mp4
```

`record-promo-video.mjs` は実行のたびに `scripts/release/promo-assets/*.jpg` をギャラリーへ
push してから収録する（`GALLERY_PHOTOS` 定数）。**push する順序はピッカーの表示順を制御しない**
（実測で確認済み — MediaStore 側の既存インデックス/EXIF 撮影日時に依存する模様）。実機での表示順は
固定で再現されている（mentai-kamatama-udon → mala-udon → chahan）ので、シーン02のタップ座標は
この順を前提にしている。**ギャラリー写真を入れ替えたら、まず手動で一度ピッカーを開いて実際の並びを
スクショで確認してからタップ座標を合わせ直すこと**（push 順から逆算しない）。

### screenrecord の落とし穴（既知）

- 画面が完全静止だとフレームを1枚も書き出さない → 各シーンで意図的にタップ/スワイプを注入
- **フォトピッカー（システム UI）は screenrecord に写らない**。ピッカー〜確認ダイアログの場面は
  `screencap` の静止画を `edit-promo-video.mjs` の `CUTS[].image`（Ken Burns ズームで疑似動画化）
  で表現している
- エミュレータ起動直後のアプリ初回コールドスタートは JS 読込で 10 秒超かかることがあり、そのまま
  録画すると黒画面が写る。収録前に一度対象ルートを開いて温めておく
- 遷移がハードカットの画面（料理中モードの手順送り等）はフレーム数が少なく（2〜5枚）ファイルが
  数十KB程度になるが正常。成功判定の閾値は10KB
- 録画後は必ず `ffprobe -show_entries stream=nb_frames,duration <file>` で `duration > 0` かつ
  複数フレームを確認する

### edit-promo-video.mjs の注意

- `CUTS[].seconds` は各シーンの**実収録尺**に合わせる（screenrecord は要求した `durationMs` より
  短く終わることが多い）。ズレていても ffmpeg はエラーにせず黙って短くクリップするだけなので、
  `ffprobe` で実測してから合わせること
- 中間クリップは `fps=30` で CFR に揃えてから concat している（可変フレームレートのまま concat
  すると最終ファイルの duration メタデータが破損する不具合があったため）

## 3. レビュー

フレームを抽出してユーザーに確認を仰ぐ（実写真・UI言語・キャプション位置に問題がないか）:

```bash
ffmpeg -y -i Temp/promo-video/daidoko-promo.mp4 -vf fps=1 Temp/promo-video/preview/f-%02d.png
```

## 4. 引き渡し

**YouTube へのアップロードは Claude が行わない** — ユーザーが手動で行う
（公開範囲: 一般公開 or 限定公開・広告オフ・年齢制限なし）。アップロード後、Play Console
商品情報の「動画」欄に URL を貼るのもユーザー作業。
