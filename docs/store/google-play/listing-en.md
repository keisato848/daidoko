# Google Play Listing (EN)

更新日: 2026-09-05
対象ビルド: Android 1.13.1（予定）
反映方法: androidpublisher API（edits.listings）で CLI 更新

**日本語版の訳ではない。** listing-ja.md は決定変更 B（2026-08-28 利用者確定）で
主語を「お店の味」から「献立」へ書き直し済みで、こちらと同じ製品像を語っている。
訳ではなく**同じ訴求の別文面**なので、どちらかを直すときは必ず両方を見ること。

背景: `docs/store/なぜインストールされないか-2026-08-26.md` の実測で、Play の分類器が
このアプリを店舗系（外食・デリバリー）と誤分類していたと判明した（原因は掲載文の語彙）。
提供価値は変わらない。変えたのは訴求の主語だけ。

過大な主張をしないこと。**アレルゲンの検出はしていない**（`docs/privacy-policy.md` §7）ので、
「アレルギー対応」に読める書き方をしない。

**開示の 5 件は 2026-09-01 に実装と突き合わせて直した。根拠と「戻さないこと」は
`listing-ja.md` の同名の節にまとめてある** — 送信範囲・グループ削除の範囲・オフラインで
動かないものの一覧・家族共有の通知（FCM 未設定で飛ばない）を書き換える前に必ず読むこと。
**同じ日の第 2 次で、`listing-ja.md` の「さらに直した開示」も足した** — 共有の停止が
ソフト削除であること（サーバー上の控えは消えない）、Web 共有の停止経路が 2 つあること
（レシピ 1 品＝レシピの画面のメニュー / レシピ帖＝設定）、そして
**「The screen says so before you send」が成立するのは実装側に開示を足したから**
（食材名の名寄せだけは画面ではなく設定の説明＋プライバシーポリシーで担保）。

**詳しい説明は 4000 字が上限で余裕が少ない。** 開示を正確にするぶんを作るため、
「Who it is for」は重複していた行を落として 1 行にまとめ、2 段落目の言い回しも詰めた
（本文の他の節が同じ語を持っている）。増やすときは日本語版に無い厚みから削ること。
2026-09-01 第 3 次（AI 注記に名寄せの例外を追記）の時点で 3982 字（残り 18 字）。

**第 4 次（2026-09-01・#266 の AI 由来注記を書き戻し）**: 根拠・引用の一致確認・
「戻さないこと」は `listing-ja.md` の同名の節を見ること（Play/ASC の 4 面共通）。
18 字では文が入らないため、ここでも意味を削らない軽い言い回し詰め（barcode/receipt・
email address→email・short ad→ad・expiry の言い回し）で計 43 字を確保してから
"AI-made recipes come with a check-yourself note" を追加。3989 字（残り 11 字）。

**第 5 次（2026-09-02・独立監査で発見・戻さないこと）**: 根拠は `listing-ja.md` の同名の節
（Android の OS 標準クラウドバックアップに DB が含まれる・iOS の iCloud バックアップにも既定で
含まれる・SAF 外部保存先への自動書き出し。3 つとも「共有」を経ない端末外コピー）。
"your data stays on your device" を "we do not send your data to our servers" に、
バックアップの 1 行に OS バックアップ/SAF の開示を追加（+83 字）。11 字の余裕では足りないため、
重複していた 2 文目「DAIDOKO keeps that loop in one place.」（Building your recipe
collection 1 文目と同じ主張）を削除し、"too" の重複語・冗長な修飾を数か所削って計 92 字を捻出。
**3984 字（残り 16 字）**。次に増やすときも同じやり方（意味を保ったまま冗長な語を削る）で余白を作ること。

**1.13.1 追記（2026-09-05）**: 冷蔵庫からレシピ・朝昼夕・AI 一括生成・献立ウィジェット・
グループ別共有・家族更新の通知（permissions 行の "all sent from your own device" は FCM 導入で
偽になったため削除）を反映。根拠と「書かないこと」（「撮るだけで作れる」を使わない対比構造・
冷蔵庫の never stored の裏取り・「自動で届く」の対象限定）は `listing-ja.md` の「1.13.1 追記」参照。
4000 字上限は既存方針どおり冗長語の圧縮で確保（削った箇所は git 差分参照）。最終 3981 字（md 生テキスト。送信時は \*\* を剥がすため update-play-listing.mjs --dry-run 実測で 3969 字）。

## ストア刷新 Phase 2（2026-09-19・戻さないこと）

`docs/store/刷新案-2026-09-17.md` §2 の確定案を落とした。**訳ではなく同じ訴求で書いた別文面**という
既存方針は維持している（ja を直すときは必ず両方を見ること）。アプリ名は変えない。

**変えたもの:** 短い説明（旧 77 字 → 59 字。上限 80 に対して余裕がゼロだったので改稿の余地を作った）／
詳しい説明の冒頭／相談（Talk it through with AI）の 1 行を ■ Plan today's meals に追加／
無料枠とデータの持ち出しを**並び替えだけ**で前方へ（みさ。文言は動かしていない）。

### ⚠️ 4000 字の上限に当たった。落としたものを明記する（**Phase 3 で見直す余地あり**）

**en の詳しい説明は 4000 字上限に対して常に残り 10〜20 字で運用されている**（第 3〜5 次の記録参照）。
今回の刷新は冒頭の差し替え（+223 字）と相談の追加（+250 字）で**一度 4600 字・600 字超過**になった。
既存方針（意味を保ったまま冗長語を削る）で圧縮したが**それだけでは 100 字ぶんしか作れず**、
以下を落として **3981 字（残り 19 字）** に収めた。**ja 側には同じ上限が無いので、これは en 固有の判断。**

| 落としたもの                                                        | 理由                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `• Recreate a restaurant dish — write how yours turned out…`（106） | **旧訴求（お店の味）の行。** Q3 で主語を移したので、残すと新しい主語を薄める                     |
| `■ Who it is for` の節まるごと（114）                               | 内容（レシピ・料理記録・在庫・賞味期限をひとつに）は**新しい冒頭が担うようになった**             |
| 相談を独立ブロックにするのをやめ、**1 行に畳んだ**（−78）           | ja は `■ AI と相談しながらつくる` を新設したが、en は上限があるため 1 行に。**訴求の差ではない** |
| `• You decide, every time`（26）                                    | 同じ行の「tap Add するまで変わらない・取り消せる」で同じことが伝わる                             |

**⚠️ ひな指摘「家族推しで一人暮らしが疎外感を持つ」への対応が en から落ちた。**
ja には冒頭に「ひとりでも、家族とでも使えます。」を入れたが、en は当初 `■ Who it is for` に
`Whether you cook alone or with family —` として入れたので、**節ごと落ちた時点で消えた**。
残り 19 字では戻せない。**Phase 3 のペルソナ再レビュー（emma）で、en に一人暮らしへの
目配りが要るかを判断する。** 要るなら、上の表からどれかを戻す代わりに入れること。

### ⚠️ 刷新案 §2 の en 冒頭を、そのままは採用しなかった（**この判断を戻さないこと**）

刷新案 §2 の「詳しい説明の冒頭」後半は、確定案の時点でこう書かれていた:

> Photograph the fridge and it becomes your pantry. The pantry turns into this week's meals.
> Whatever's missing goes on the shopping list. Buy it, and it's back in the pantry.

**これは ja で掲載事故として却下された当初案と、構造が同一だった。**
ja の当初案「撮れ**ば**在庫にな**り**…買え**ば**在庫に戻る」は、けんじのレビュー（P0-1）で
「`listing-ja.md` が 5 次にわたって直してきた修正を丸ごと巻き戻す文」と判定され、
**利用者を主語に書き直された**（刷新案 §1-4）。
ところが **en 側の採用案にはその修正が反映されないまま残っていた。**

- `becomes` / `turns into` / `goes on` / `it's back in` は**すべて自動詞で、利用者が主語の動詞が 1 つも無い**
- 実装は各ホップに**確認シート／選択シート／タップ**がある手動の輪
  （`買い物リスト・在庫設計.md` §10.12.1）。自動で起きると読める英文は**実装と食い違う**
- emma のレビューは**英語としての自然さ**を見たもので、主語の問題は対象外だった。
  **P0-1 は ja にしか適用されていなかった**

→ **利用者を主語にして書き直した。** 前半（`The plan is in a notes app, the list in a chat, …`）は
emma が「ネイティブのコピーライターが書く省略並列」と評価したので**一字も変えていない**。
後半だけを、emma の「4 つの短文に割る」というリズムを保ったまま主語を入れ替えた。
`Every step is yours — nothing moves on its own.` が ja の
「どれもご自身の操作です。勝手に増えたり減ったりはしません。」に対応する。

> **教訓（ペルソナレビュー §P0-1 の警告どおりに再発した）**: 掲載文の修正は
> **ja と en の両方に適用する**。片方のレビュー観点（emma＝英語の自然さ）だけを通すと、
> もう片方の観点（けんじ＝主張と実装の一致）が抜けたまま残る。
> **`audit-listing-claims` は ja / en の両方にかけること。**

### 相談（Talk it through with AI）の 1 行の裏取り

`origin/main` の `bf55128`（#351）を読んで確認した。詳細は `listing-ja.md` の同節。

- `confirmMutate` は追加ボタンの `onPress` からしか呼ばれず、却下は副作用ゼロ
  → `nothing reaches your shopping list until you tap Add` は真
- 追加後に取り消し付きトースト → `you can undo it after` は真
  （**ただしトーストは 8 秒。`any time` のように無期限に読める語へ強めないこと**）
- カタログ登録は `shopping.add` の 1 件のみ・`destructive` は型に存在しない
  → 「AI can do anything for you」の類は書かない

### ウィジェットの言い添えは en には入れていない

ja では「ホーム画面に貼れる小さな画面（ウィジェット）」と言い添えた（のりこ 63 歳が
「ウィジェットが分からない」と詰まったため）。**en では `home-screen widget` のままにした** —
英語圏では widget は日常語で、同じ補足は冗長になる。**ja 固有の配慮**であり、en へ機械的に運ばない。

### keywords（**反映は次バージョン申請とセット**）

`copycat` を外す。emma によれば "copycat recipe" は英語圏で**実在する強い検索語**だが、
**呼びたい客層がずれている**（特定の店の 1 品を再現したい人 ＝ 旧訴求の残骸）。
空いた枠に `meal planner` / `weekly meal plan` / `pantry tracker` / `grocery list` / `fridge inventory`。
**2026-09-18 時点の ASC の実値に `copycat` はまだ残っている**（`docs/store/phase2-撮影準備-2026-09-18.md` §1-1）。
iOS は `appStoreVersions` が全件 `READY_FOR_SALE` なので、**次バージョンを作るまで変更できない**。

### まだ書いていない行（実装待ち・🚧）

献立の週ビュー・「済み」の家族同期・献立ウィジェットは ja と同じく**未記載**。
`Recipes, shopping list and pantry arrive on every phone in the family (meal plans stay per-phone)`
の行は**現行のまま**にしてある（献立は端末ごと、が現時点の正直な前提）。

## アプリ名（28 字）

- DAIDOKO: Meal Plan & Recipes

## 短い説明（59 字）

Meals, groceries, fridge, recipes, family — all in one app.

## 詳しい説明

Cooking doesn't live in one app. The plan is in a notes app, the list in a chat, the recipes in screenshots, the fridge in your head.

DAIDOKO puts it in one place. Photograph the fridge, check what it read, and add it to your pantry. Plan the week from what's there. Send what's missing to your list. Tap what you bought back in. Every step is yours — nothing moves on its own.

■ Plan today's meals
• Build a 2, 3, 5 or 7-day meal plan from your pantry
• Each day comes with a one-line reason; swap out what you don't like
• Plan breakfast, lunch and dinner separately
• Anything missing goes straight to your shopping list
• Short on recipes? AI drafts the missing days — review each before saving
• Optional auto-plan mode: today's plan is ready when you wake up; missing items can be auto-added — undo or turn off any time
• Not sure what to make? Talk it through with AI — a confirmation card appears, nothing reaches your shopping list until you tap Add, and you can undo it after

■ Building your recipe collection
• Search by recipe name, tag or ingredient
• Import from a recipe URL or pasted text — unlimited, no AI allowance
• Photograph a dish and AI drafts ingredients, amounts and steps — review and edit before saving
• Photograph a cookbook page or food package — AI merges front and back
• **AI can generate an image**, always labeled "This image was created by AI" (3 free a month, separate allowance)
• AI-made recipes come with a check-yourself note
• Cover and step photos, plus a log of what you cooked
• Cooking mode shows one step at a time, large, with timers and no ads

■ Shopping and pantry, connected
• Add what a plan or recipe is missing to your list in one tap
• Check today's plan and your shopping list from a home-screen widget (Android)
• Move what you bought into the pantry — barcode or receipt scan
• Track expiry dates if you want — nothing required, no nagging
• Snap your fridge — AI reads what's inside; confirm, and it joins your pantry for meal plans and shopping (no amounts read; photos never stored)
• See what you can cook now, ranked by what you have
• Get a reminder when stock runs low

■ Shared with the family, automatically
• Share an invite code — **no account, no email address**
• Recipes, shopping list and pantry arrive on every phone in the family (meal plans stay per-phone)
• Share by group — everything with family, recipes only with a friend
• Share the shopping list and pantry per item, or keep items private
• Meal plan, recipes, shopping, pantry and cooking mode work offline and catch up later
• Needs a connection: AI, URL import, publishing or opening a shared recipe page, and ads for more AI

■ Where your data lives
• No account, no sign-up. We never hold your email or phone number
• **Unless you share with family or publish a recipe page, we do not send your data to our servers**
• AI features include a free allowance (5 a month); an ad unlocks one more.
Add your own Gemini key for no limit
• Backup, restore, a transfer file for a new phone, plus your OS backup (Android/iCloud) or chosen folder if set — your account, not ours
• Join a family group and only the items you share travel through our server.
Delete the group and that synced data is erased
• A published recipe page is separate — deleting the group doesn't stop it. Stop a recipe from its own menu, a recipe book from Settings → Recipe books; nobody can open it after

■ Permissions
• Camera: photographing dishes, reading text, scanning barcodes
• Photos and media: choosing an image from your library
• Notifications: low-stock and meal-plan reminders, cooking timers, family update alerts

Note on AI: an AI feature sends what it needs (photo, ingredients, recipe, notes, or receipt text) and the screen says so first. Ingredient matching alone runs automatically (see Settings and our privacy policy). Not stored on our servers.

DAIDOKO does not detect allergens. Always check the ingredients yourself, especially if you have food allergies.
