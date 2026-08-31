# App Store 掲載情報（EN）

作成日: 2026-08-27
更新日: 2026-08-29（決定変更 B — 訴求の主語を「お店の味」→「献立」へ。詳細は下記）
対象ビルド: iOS 1.13.0（予定）（App ID `6800964382`・公開中は 1.12.0 / 10029・ASC の直前作業は 1.12.3 / 10033）
反映方法: App Store Connect API（`appStoreVersionLocalizations` / `appInfoLocalizations`）

**App Store に英語ロケールを新設するための原稿**（それまで ASC は `ja` のみ）。

**決定変更 B（2026-08-28 利用者確定）で書き直した。** 前バージョン（お店の味の再現を主語に
した文面）は、`docs/store/なぜインストールされないか-2026-08-26.md` の実測により逆効果と
判明した（Play の分類器がこのアプリを店舗系＝外食・デリバリーと誤分類。原因は掲載文の語彙）。
実検索語（Apple サジェスト実測）は「献立アプリ」「冷蔵庫管理アプリ」「賞味期限管理アプリ」
「レシピ管理」「レシピ保存」「買い物リスト」「作り置き」「料理記録アプリ」「食材管理」。
提供価値は変わらない。変えたのは訴求の主語だけ。

Play の英語版（`../google-play/listing-en.md`）と**同じ訴求**で書く。ただし App Store は
項目とフィールド長が違うので、丸写しではなく下記の枠に収める。

**日本語版（`listing-ja.md`）とは訳ではなく、同じ製品像の別文面。どちらかを直すときは
必ず両方を見ること。**掲載面は Play ja/en・ASC ja/en の 4 つある。

過大な主張をしないこと。**アレルゲンの検出はしていない**（`docs/privacy-policy.md` §7）ので、
「アレルギー対応」に読める書き方をしない。**「すべてオフラインで動く」とも書かない** —
AI 機能と URL 取り込みは通信が要る（Play 版で 1.12.0 のときに直した）。

## フィールドの上限（App Store Connect）

| 項目                   | 上限     | 審査なしで変更可 |
| ---------------------- | -------- | ---------------- |
| App 名                 | 30 文字  | いいえ           |
| サブタイトル           | 30 文字  | いいえ           |
| プロモーションテキスト | 170 文字 | **はい**         |
| キーワード             | 100 文字 | いいえ           |
| 説明                   | 4000字   | いいえ           |
| バージョンごとの新機能 | 4000字   | いいえ           |

## App 名（28 文字）

DAIDOKO: Meal Plan & Recipes

> Play の英語名と揃えた。

## サブタイトル（28 文字）

From pantry to shopping list

## プロモーションテキスト（138 文字）

Meal-plan from what you already have. No photo yet? AI can now generate one. Recipes, shopping, pantry and family sharing, all in one app.

## キーワード（93 文字・カンマ区切り・スペースを入れない）

cooking,recipe manager,pantry,grocery,shopping list,fridge,meal prep,expiry,leftovers,copycat

> App 名・サブタイトルに入っている語は Apple が別途索引するので**繰り返さない**
> （DAIDOKO / meal / plan / recipes / pantry / shopping list 等）。

## 説明

"What should I cook tonight?" You open the fridge and answer the same question again. DAIDOKO starts from what you already have — a meal plan, then recipes, shopping and pantry, all in one app instead of scattered across screenshots and links.

Cooking is a chore with a lot of moving parts: find a recipe, plan the week, shop, put things away, and start over. DAIDOKO keeps that whole loop in one place.

■ Plan today's meals
• Build a 2, 3, 5 or 7-day meal plan from what's in your pantry
• Each day comes with a one-line reason; swap out anything you don't like
• Anything missing goes straight to your shopping list
• Optional auto-plan mode: today's plan is ready when you wake up, with a notification. Missing ingredients can be added automatically too — undo or turn it off any time

■ Building your recipe collection
• Search by recipe name, tag or ingredient
• Import from a recipe URL or pasted text
• Just photograph a dish and AI drafts the ingredients, amounts and steps; you always review and edit before saving
• No photo yet? **AI can generate an image** for the recipe (clearly labeled "AI-generated image"; 3 free a month)
• Recreate a restaurant dish, too — write how yours turned out and AI narrows the gap, showing exactly what changed
• Cover photos, per-step photos, and a cooking log of what you made and when
• Cooking mode shows one step at a time, large, with timers and no ads

■ Sharing with family and friends
• Turn a recipe into a web page and hand the link only to the people you choose
• Collect several recipes into a single recipe book
• You can stop sharing at any time

■ Shopping and pantry, connected
• Add what a meal plan or recipe is missing to your shopping list in one tap
• Move what you bought into the pantry — by barcode or by scanning a receipt
• Track expiry dates if you want to — nothing is required, and we don't nag you with reminders
• See which recipes you can cook right now, ranked by how much you already have — handy for using up meal-prep batches, too
• Get a reminder when something is running low

■ Shared with the family, automatically
• Share an invite code — no account, no email address
• Meal plans, recipes, shopping list and pantry arrive on every phone in the family automatically
• Choose per item whether the shopping list and pantry are shared or private

■ Where your data lives
• No account, no sign-up. We never hold your email address or phone number
• Unless you share with family, your data stays on your device
• Join a family group and only the items you share travel through our server
• Backup, restore and a transfer file for moving to a new phone
• AI features include a free monthly allowance (5 a month). Add your own Gemini key for no limit
• Your meal plan, recipes, shopping list, pantry and cooking mode work offline; only the AI features and URL import need a connection

■ Who it is for
• Anyone tired of staring into the fridge every night
• Cooks who want their recipes and cooking log in one place
• Households managing pantry stock, expiry dates or meal prep without it becoming a chore
• Families who want a meal plan, shopping and pantry to work together
• People who want to follow a recipe while cooking without ads in the way

Note on AI: your photo, or the ingredient names you selected, is sent for analysis only when you use an AI feature. You are told before it happens, and nothing is stored on our servers.

DAIDOKO does not detect allergens. Always check the ingredients yourself, especially if you have food allergies.

## バージョンごとの新機能（1.13.0）

Meal plans: pick 2–7 days and DAIDOKO suggests dishes from what you already have. Swap any day you don't like.

New opt-in auto mode: wake up to today's plan, with an optional morning reminder. Missing ingredients can be added to your shopping list automatically — and undone in one tap.

Recipes without a photo can now get an AI-generated image (clearly labeled as AI-made).

The free AI allowance is now 5 uses per month.

Also fixed: kana search breaking after edits, restaurant names being lost, a black cover-photo preview, and overlapping text for long names.

Fixed the labels on the bottom tab bar being cut off at the edge of the screen on some devices.

Made the free-usage note on "Photo to recipe" easier to read, and spelled out what happens when you run out: watch an ad to continue, or use your own AI key for unlimited use. Also removed a field that only made sense in Japanese from the English recipe form.

## URL・その他

日本語版（`listing-ja.md`）の「URL・その他」と同じものを使う。
サポート URL / マーケティング URL / プライバシーポリシー URL / 著作権 / カテゴリは
ロケールをまたぐか、日本語版で設定済みのものが引き継がれる。

## スクリーンショット

**ロケールごとに別セット**（`appScreenshotSets`）。英語のスクショは
`docs/store/app-store/phone-screenshots-en/` に置き、
`node scripts/release/update-appstore-screenshots.mjs --lang en` で入れる。

**撮影は macOS 必須**（`capture-ios-screenshots.mjs`）。英語のシードデータは
**空の DB のときしか走らない**ので、`xcrun simctl erase` してから
英語ロケールで起動すること。
