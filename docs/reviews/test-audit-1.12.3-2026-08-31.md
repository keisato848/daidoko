<!-- 生成: merged-main-test-audit ワークフロー（実行 4 + 監査 3 + 統合）
     問い: テストはすべて通っているか / 緑だが壊れていないか
     実行: 2026-08-31 / 対象 main = 1.12.3（PR #254/#257/#258 マージ後） -->

# だいどこ 1.12.3 統合後 main — テスト状況レポート

## 1. テストはすべて通っているか → **YES**（ただし品質ゲート 1 本が環境要因で赤）

| 対象            | 結果                                                    |
| --------------- | ------------------------------------------------------- |
| mobile (jest)   | **118/118 suites, 938/938 tests PASS**（358s）          |
| server (vitest) | **25/25 files, 263 passed / 21 skipped (284)**（49.6s） |
| shared (vitest) | **3/3 files, 25/25 tests PASS**（17.4s）                |
| typecheck       | PASS（shared / server / mobile）                        |
| lint            | PASS（`--max-warnings 0`）                              |
| format:check    | **FAIL（511 files）— 環境要因**                         |

- `format:check` の 511 件は改行コード問題。`.prettierrc` が `endOfLine: lf` を要求する一方、`core.autocrlf=true` かつ `.gitattributes` 不在でチェックアウト時に全テキストが CRLF 化しており、本ブランチで未変更の `README.md` / `tsconfig.json` / `package.json` まで巻き込まれている。**コードの問題ではない。** 恒久対処は `.gitattributes` に `* text=auto eol=lf` を足して再正規化するか、当ワークツリーだけ `core.autocrlf=input`。`pnpm format` の実行は 511 ファイルの無意味 diff になるので非推奨。
- mobile 末尾の `A worker process has failed to exit gracefully` はティアダウン漏れ／未 unref タイマーの疑い。結果は失敗扱いではない。

---

## 2. 監査指摘

### blocker（2 件）— **9/1 提出前に直す必要はない。提出後に着手でよい**

いずれも「#254 で入った出荷コードにテストが無い」という **テスト不足**であり、動作不具合の証拠ではない。実機検証で動作は確認済み。ただし _(1)_ は次に触ったときに沈黙で壊れる場所なので、提出直後に片付けること。

1. **`apps/mobile/src/services/notification.service.ts:155-206` — 調理常駐通知 4 関数がカバレッジ 0%**
   `hasNotificationPermission` / `presentCookingNotification` / `dismissCookingNotification` / `addCookingResumeTapListener` の約 50 行が未到達（実測 43.52% lines）。唯一の間接呼び出し元 `cooking-session.store.test.ts:18-21` が `jest.mock` でサービスごと差し替えているため、store の 7 件が緑でも通知側は 1 行も走らない。
   気づけない壊れ方: `content.data` の type と listener の突き合わせがズレると通知タップが無反応／`identifier` を外すと手順ごとに通知が積まれる／`AndroidImportance.LOW` を上げると 1 手順ごとに鳴る／`getPermissionsAsync` を `requestPermissionsAsync` に戻すと調理開始の瞬間に権限ダイアログが復活。
   **兄弟の低在庫通知には同じテストが既にある**（`expect(call.content.data).toEqual({ type: 'low-stock' })` と listener 分岐テスト）ので、設計上の必然ではなく単なる漏れ。`jest.mock('../../db/client', () => ({ isNativePlatform: true }))` は既に敷かれており、`Platform.OS = 'android'` の手本も `client-ocr.provider.test.ts:22` にある＝**書ける**。

2. **`apps/mobile/src/services/recipe.service.ts:261` — `setStepPhoto` がテスト 0 件、かつ現状の書き方では jest で原理的にテスト不能**
   `isNativePlatform` 早期 return の先が `await import('drizzle-orm')` など動的 import 3 連で、品質基準 §2.3 が名指しする形をそのまま踏んでいる。隣の `setRecipePinned` は mock 経路を持つのに `setStepPhoto` には無く、web/jest では黙って何もしない。
   最悪ケース: `toStoredPhotoPath()` を外して絶対パスを書くと、2026-08-13 の事故が再発（iOS の documentDirectory UUID が再インストールで変わり `<Image>` がエラーも出さず空白になる）。**Android エミュレータでは原理的に再現しない iOS 限定の沈黙故障。**
   対処は §2.3 の既定どおり、規則を分岐の手前の純関数へ出して native / mock 双方から呼ぶ（手本: `services/recipe-update.ts` の `resolveRecipeUpdate`）。

### warn（8 件）

**A. 実際に挙動が壊れているもの（1 件・提出前に判断が要る）**

- **`CookingResumeBar.tsx:22` — `'/cook'` が既存ルート `(tabs)/cookable` に誤爆**。`usePathname()` が `/cookable` を返し `includes('/cook')` が true になるため、通常画面なのに Now Cooking pill だけが消える。cookable はホーム（`index.tsx:405`）と在庫（`pantry.tsx:288`）から到達する実ルートで、**「在庫から作れる料理を探す」＝調理直前の、復帰導線が最も要る画面**で欠ける。借り元の `app-open-ad.service.ts` は誤爆しても「広告を出さない」＝安全側だが、こちらは機能が消える。前方一致にするかルート名判定へ。修正は 1 行。

**B. ストア掲載物の陳腐化（1 件・9/1 提出に直結）**

- **`#254` が掲載スクショに写る画面を 3 つ変えたのに撮り直していない**。Play ja/en・App Store ja/en の 4 セットが陳腐化。(a) `04-cooking-mode` はタブバーが消えた（掲載中の 04 には写っている）、(b) `07-photo-to-recipe` は「代わりに手動入力する」見出しを削除（#251 が 1.12.3 用に撮り直したばかりの画面）、(c) `03` / `04` に撮影チップ追加、(d) `06` の disabled ボタンが無彩色化。直近撮影は Play `d365835`(#251) / `c2c997d`(#248)、App Store `9f0af7f`(#256) でいずれも `532fc41`(#254) の直前。

**C. 撮影パイプラインの穴（2 件）**

- `capture-store-screenshots.mjs:111` — セッション消去が「各ショットの起動前」のみ。フルランは偶然きれいに終わるが、SKILL.md が公式に勧める `--shots 04` で終わると調理セッションが app_meta に残り、**その後に人手で撮る 08 / 10 に pill が写り込む**。README は自動回避すると読める書き方なのに実装が manual をカバーしていない。最後にもう一度 `clearCookingSession()`（または finally 節）を。
- `capture-store-screenshots.mjs:75`(info) — 実機向け WARN が案内する「04 を最後に撮る」は `--shots` では実現不可（出力順は常に SHOTS 定義順）。実際は 2 回に分けるしかないので文面修正が要る。

**D. テストが実質何も守っていないもの（4 件）**

- `cooking-session.store.test.ts:18-21` — 差し替えた 2 つの `jest.fn` に対する `expect` が 1 つも無く、通知ライフサイクルを丸ごと消しても 7 件緑。
- `__mocks__/expo-notifications.js:17` — 手動モックが実物と乖離。`AndroidImportance` の値が別物（モック `HIGH:4` は実物では `LOW`）、#254 が使う `LOW` と `dismissNotificationAsync` がモックに無い。テストを書いた瞬間に「`importance: undefined`」を正解として固定するか、`TypeError` を実装側 `catch{}` が握り潰して緑になる。**通知テストを書く前にモックを実物へ追随させること。**
- `tab-bar-safe-area.test.tsx:38-45` / `:102-121` — #254 の変更は「落ちないようモックを広げた」だけ。`CookingResumeBar` は常に null を返し `bottomOffset` の結線が無検証（固定値に戻してもグリーン）。また route に state を渡していないため `FULLSCREEN_CHILD_ROUTES` の分岐が一度も通らず、`'[id]/cook'` を配列ごと空にしても 4 件緑（branch 75% の未到達分がこれ）。
- `apps/mobile/package.json:70` — **これらが全部素通りした根本原因**。品質基準 §2.2 の閾値は mobile にはどこにも実装されていない。`"test": "jest --passWithNoTests"`（`--coverage` 無し）、`coverageThreshold` 無し、CI の mobile 側は `pnpm -r test` を素で回すだけ（`--coverage` は server のみ、しかも `continue-on-error: true`）。CI が実際に守るのは Q-1/2/3/5 のみで **Q-4 は不在**。閾値を CI に入れるか、`docs/品質基準.md` §2.2 に「mobile は未強制」と明記して文書と実態の乖離を消すかのどちらかが要る。

### info（5 件）

- `CookingResumeBar.tsx:22` と `_layout.tsx:17` で全画面ルート一覧が **パス片とルート名の二重管理**。整合はコメントだけ、両方ともテスト未到達。
- `cook.tsx:93` — 手順 0 件のレシピを cook で開くと `begin()` 後に早期 return で loading のまま止まり、「完成」ボタンが無いので `end()` に到達できず **12 時間消えない pill＋復帰カード＋常駐通知**が残る。`recipe.schema.ts:45` が `min(1)` なので通常経路では起きない（同期・帖取り込み経由の理論上の可達性のみ、未再現）。`begin()` を `steps.length > 0` の後ろへ。
- `cooking-session.store.ts:85` — `begin` が同レシピ再開時に `prev.startedAt` を引き継ぐため、経過時間は「最終操作から」ではなく「最初の開始から」。13 時間前に始めて 1 分前まで操作したセッションは次回起動で捨てられる。仕様意図がテストで表明されていない。
- `recipeEmoji.test.ts:17` — 味噌汁 🍜→🍲 の変更で `'miso soup'` と `'soup'` が同値になり、assertion が実装のコピーに退化（該当行を消しても緑）。
- `unitSystem.ts:48-55` — **5 項目中唯一「薄いが在る」**（97.67% lines、変更と同時にテスト 2 件追加）。残る穴は新設ガード 2 本（`eighths <= 0` / `>= 8`）と cups 経路との相互作用（`0.1L` → `3/8 cups`、英語としては "cup"）。表示のみ・imperial 限定だが掲載スクショに写る面。

### 問題なし

- server / shared のテスト・カバレッジ構成: 問題なし。
- typecheck / lint: 問題なし。

---

## 3. 9/1 提出への影響

**テストとコードは提出可能な状態。** blocker 2 件はいずれもテスト不足であり実機検証で動作は確認済みなので、提出をブロックしない。`format:check` の赤も改行コードの環境要因で中身は無関係。

**提出前に片付けるべき実務は 2 つだけ**: (1) 掲載スクショ 4 セット（Play ja/en・App Store ja/en）の撮り直し — #254 が 04 / 07 / 03 / 06 を実際に変えており、特に 07 は #251 で 1.12.3 用に撮ったばかりの画面が既に古い。(2) `CookingResumeBar` の `/cookable` 誤爆（1 行修正）— 直すなら撮影前に入れて、実機検証の再記録も同時に済ませる。

**提出後に回すもの**: notification.service と setStepPhoto のテスト（`__mocks__/expo-notifications.js` の実物追随が先）、`capture-store-screenshots.mjs` の finally 掃除、そして mobile のカバレッジゲート不在を CI に実装するか docs に明記するかの決着。
