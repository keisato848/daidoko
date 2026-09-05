# iOS 1.13.1 ストアスクショ撮影指示書（macOS・Mac セッション向け）

対象: App Store 用スクリーンショット **ja / en 各 8 枚**（計 16 枚）を 1.13.1 構成で撮り直す。
構成・並び順は `README.md` の表（正 = `scripts/release/update-appstore-screenshots.mjs` の ORDER）。
背景: 1.13.1 は ASC へバイナリアップロード済みで、**審査提出はスクショ刷新後**。ASC のスクショは
バージョン単位なので、1.13.1 に添付すれば公開もバージョンと同時（未公開 UI の先出しにならない）。

**ASC への反映（update-appstore-screenshots.mjs 本実行）はこの作業に含めない。**
撮影 → リポジトリへコミット → ユーザー承認 → 反映はメインループ、の順。

## 0. 前提

- ブランチ **`shots/ios-1.13.1`** を pull して作業する（撮影 PNG のコミットも同ブランチ）。
- リポジトリは iCloud 同期の外に置く（`.claude/skills/ios-release` §0 — 実害の記録あり）。
- リポジトリルートで `pnpm install`（`apps/mobile` 内では実行しない）。
- シミュレータ: **iPhone 16 Pro Max（6.9"・1320×2868）/ iOS 18.6**（2026-09-05 に Mac 実測で
  動作確認済み。`simctl install` がタイムアウトするなら Xcode SDK とランタイム不一致の罠 —
  `../SUBMISSION.md`「Mac 側でスクショを撮るとき」）。
- **Boot は 1 台だけ**にし、以後のコマンドは `--udid` を明示する（複数 Boot だと別サイズを撮る
  事故 — ios-release §2 の罠）。`xcrun simctl erase` 後に Simulator ウィンドウが最小化されたら
  Dock のアイコンをクリックして復帰（同 §2）。

## 1. ビルド（ストアショット用・言語ごとに使い回す）

```bash
xcrun simctl boot "iPhone 16 Pro Max" ; open -a Simulator
EXPO_PUBLIC_ENABLE_SAMPLE_DATA=1 EXPO_PUBLIC_DISABLE_COACH_MARKS=1 \
  pnpm --filter mobile exec expo run:ios --configuration Release
```

- `ios/` が古い prebuild のままだと起動即死 →「"だいどこ" で開きますか?」連発 → 全ショット
  同一画像、になる（README の 2026-08-13 教訓）。ネイティブ依存が増えた形跡があれば先に
  `pnpm --filter mobile exec expo prebuild -p ios --clean`。1.13.x は ShoppingWidget の
  App Extension ターゲットが増えている（シミュレータビルドは通常どおり通るはず）。
- Intel Mac は `ONLY_ACTIVE_ARCH=YES` でコンパイルが半分になる（`../SUBMISSION.md`）。
- **ビルドとシミュレータ操作を同時に走らせない**（8GB Intel 機ではデーモンが死ぬ — 同上）。
- 撮影前の健全性確認: `xcrun simctl launch <udid> com.daidoko.app` → 30 秒後にプロセスが
  生きているか。死んでいるならスクショ以前の問題（README の教訓ブロック参照）。

## 2. 全体の流れ

**ja を通しで終えてから en**。各言語とも同じ順:

1. erase → 言語設定 → アプリ再インストール → 初回起動（＝この言語で seed が入る）
2. §3 の在庫仕込み＋献立を組む（`05` の準備）
3. §4 の manual ショット: BYOK 設定 → `08` → `12` → **BYOK キー削除**
4. §5 の自動ラン（`07` を含む — キー削除後でないと `07` が化ける）
5. §6 の検証

言語切り替えの要点（`../listing-en.md` 末尾の注記）: **seed は初回起動時の言語で確定し、
DB が空のときしか走らない**。やり直しは erase から。

```bash
xcrun simctl erase <udid>   # アプリごと消える。この後シミュレータの言語を設定して再インストール
# 言語設定は Settings アプリからでも、次の defaults でもよい（設定後に一度シミュレータを再起動）:
xcrun simctl spawn <udid> defaults write .GlobalPreferences.plist AppleLanguages -array ja
xcrun simctl spawn <udid> defaults write .GlobalPreferences.plist AppleLocale ja_JP
#   en のとき: -array en ／ AppleLocale en_US
```

1.12.3 の撮影記録は言語切り替えの方法を残していないので、上の defaults が効かなければ
Settings アプリで切り替えて構わない。**確認方法**: 初回起動後、蔵書のレシピ名が
日本語（肉じゃが…）/ 英語（Nikujaga…）になっているか。

erase 後の再インストールは再ビルド不要（§1 のビルド成果物を使い回す）:

```bash
xcrun simctl install <udid> apps/mobile/ios/build/Build/Products/Release-iphonesimulator/*.app
# パスが違うときはビルドログの「Installing …」行か DerivedData を確認
```

## 3. `05-menu-plan.png` のデータ仕込み（各言語で 1 回）

base seed は在庫を 1 行も作らないため、仕込み無しで組むと「あと◯品買えば」系の理由が出て
**献立の売り（いまある材料から組む）と正反対の画**になる（Play README「直し方」の失敗記録）。

```bash
node scripts/release/seed-pantry-for-shots.mjs --udid <udid> --lang ja   # en は --lang en
```

（冪等。実行すると既存の献立プランも消すので、この後で必ず組み直す）

1. `xcrun simctl openurl <udid> daidoko://menu` → **「献立を組む」**（en: Plan meals）を押す。
   日数は **3 日分**・時間帯チップは既定の**「夕」のまま**（1.13.1 の新 UI。チップが写るのが
   Android 版 `05` との揃え）
2. 期待する結果: Day 1 = 肉じゃが「玉ねぎの期限が近いから」/ Day 2 = 味噌汁「いまある5品で
   作れるから」/ Day 3 = 唐揚げ「いまある7品で作れるから」（en も同旨）。
   ずれたら Play 版 README（`../../google-play/phone-screenshots/README.md`）の
   「直し方」節と `seed-pantry-for-shots.mjs` のコメントを見て原因を潰す
3. 組んだ献立は `menu_plans`（v19）に保存され terminate 後も復元されるので、
   以後 `05` は自動ラン（§5）で撮れる

タップは座標でなくアクセシビリティ要素名で（AppleScript の `item i of els` の罠 —
ios-release §2「シミュレータ操作の罠」）。

## 4. manual ショット（`08` → `12` → キー削除、の順を守る）

**順序が重要**: BYOK キーがあるうちに AI を使う 2 枚を撮り（無料枠を消費しない）、
**キーを削除してから** `07` を含む自動ランへ進む。BYOK が残っていると `07` の無料枠表示が
「自分のAIキー・使い放題」に化ける（`.claude/skills/update-store-listing` の既知罠）。

### 4-0. 共通: ステータスバー固定と撮影コマンド

```bash
xcrun simctl status_bar <udid> override --time 9:41 --batteryState charged \
  --batteryLevel 100 --wifiBars 3 --cellularBars 4 --dataNetwork wifi
xcrun simctl io <udid> screenshot --type=png <出力先>
xcrun simctl status_bar <udid> clear      # manual ぶんを撮り終えたら
```

### 4-1. BYOK（自分の Gemini キー）を設定

- `xcrun simctl openurl <udid> daidoko://ai-key` → 既存のキーを入力して保存。
  **キーの値をログ・会話・スクショに出さない**（キー入力画面は撮影対象外）。

### 4-2. `08-photo-recipe-result.png`（AI 結果画面）

1. 素材（リポジトリ同梱の実写）: `scripts/release/promo-assets/mentai-kamatama-udon.jpg`
   ```bash
   xcrun simctl addmedia <udid> scripts/release/promo-assets/mentai-kamatama-udon.jpg
   ```
2. `xcrun simctl openurl <udid> daidoko://recipes/import-photo` → ギャラリーから選ぶ →
   レシピを作成（AI 実行・BYOK なので無料枠は減らない）
3. 結果フォームで: レシピ名が**先頭から**読めているか確認し、キーボードを閉じてから撮影
4. 撮ったら**キャンセルで破棄**（保存すると蔵書に増えて `01` `02` と食い違う）
5. en では下書きも英語で返る（クライアントが locale をサーバー/Gemini に渡す）

### 4-3. `12-fridge-to-recipe.png`（冷蔵庫の確認シート・1.13.1 新機能）

- 素材: **kei 提供の実冷蔵庫写真**を読み取りに**のみ**使う。
  リポジトリに冷蔵庫/食材のテスト写真アセットは**存在しない**（2026-09-05 に全探索済み —
  `assets/e2e/` は料理イラスト・`seed-photos/` は完成料理のみ。イラストはプロンプトの
  「冷蔵庫や食材の写真でなければ items 空」に落ちるリスクが高い）。
  確認シートには**写真自体は写らず品目名だけが出る**ため、掲載物に生活情報は載らない。
  **写真はリポジトリにコミットしない**。撮影後にシミュレータの写真ライブラリと
  作業フォルダから削除する。

1. `xcrun simctl addmedia <udid> <冷蔵庫写真のパス>`（読み取りは 1 回で最大 2 枚 =
   `MAX_FRIDGE_IMAGES`。品目が薄ければ 2 枚に増やして撮り直す）
2. `xcrun simctl openurl <udid> daidoko://fridge` → 「ギャラリーから選ぶ」→ 読み取り
   （AI 1 回・BYOK なので無料枠は減らない）
3. **確認シート（review）の状態で撮る**: 品目リスト＋「たぶん」バッジ（1〜2 件）＋
   下部の「在庫に追加（n）」が写るのが狙い。品目 8〜12 件が画になる。
   少なすぎる・バッジが 1 つも無い場合は写真を替えて再読み取り（BYOK なら追加消費なし）
4. 撮ったら**「在庫に追加」を押さずに ✕ で閉じる**（在庫が変わると `05` の献立の理由が
   変わり、撮り直しになる）
5. 後始末: Photos アプリから冷蔵庫写真を削除（en 側の erase でも消えるが、残さないのが原則）

### 4-4. BYOK キーを削除

- `daidoko://ai-key` → キーを削除。**削除しても無料枠は減っていない**
  （BYOK 中の生成は `recordCloudInference` を通らない — update-store-listing スキル）。

## 5. 自動ショット（`01` `02` `05` `06` `07` `10`）

```bash
node scripts/release/capture-ios-screenshots.mjs --udid <udid>                 # ja（既定 out）
node scripts/release/capture-ios-screenshots.mjs --udid <udid> \
  --out docs/store/app-store/phone-screenshots-en                              # en
```

- 既定で extras（`03` `04`）と manual（`08` `12`）は撮らない。`05` `12` を含む 1.13.1 構成は
  スクリプトの SHOTS / ORDER に反映済み（このブランチ）
- cook 画面の調理セッションは各ショット前にスクリプトが自動で消す（`--keep-cooking-session`
  でオプトアウト。1.13.1 で Android 版ガードを移植）
- 全ショット同一画像は自動で FAILED になる（openurl 確認ダイアログ/起動即死 — README）
- 初回起動直後はシードでスピナーが写ることがある。**PNG サイズで見分けて**（20KB 台は
  スピナー — Play en README の実測）`--wait 18000` で撮り直す

## 6. 検証と受け渡し

1. 16 枚すべて **1320×2868**・相互に別画像・スピナー/ダイアログ/Now Cooking pill 無し
2. 機械検証（アップロードはしない）:
   ```bash
   node scripts/release/update-appstore-screenshots.mjs --lang ja --dry-run
   node scripts/release/update-appstore-screenshots.mjs --lang en --dry-run
   ```
3. PNG を `shots/ios-1.13.1` へコミット（Conventional Commits・**冷蔵庫写真を混ぜない**）して push
4. **ストア公開物なのでユーザーに 16 枚を提示して承認を得る**。ASC への反映（本実行）は
   承認後にメインループが行う

## 7. この撮影で守ること（Android 版との差分）

- **iOS には献立ウィジェット・ショートカットが無い**が、8 枚はすべてアプリ内画面
  （`05` はアプリ内の献立画面）なので構成はそのまま成立する。ウィジェットが写る素材を
  足さないこと（iOS 版ウィジェットは検証中 — `../listing-ja.md`「Android 版との差分」）
- OCR 入口は iOS でも表示される（README の訂正節）。掲載 8 枚に OCR 画面が無いのは訴求順位の話
- `08`/`12` の料理・写真素材は Play 版（カルパッチョ・実冷蔵庫）と一致しなくてよい
  （ストアごとのセットは独立。Play も ja/en で素材が違う前例あり）
- `10` は seed の recipe-7（ふわとろスクランブルエッグトースト）になり、1.12.3 までの
  カルパッチョから変わる（自動化の帰結。Play en 版と同じ絵柄）
