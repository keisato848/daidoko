# App Store 掲載情報（EN）

作成日: 2026-08-27
対象ビルド: iOS 1.12.1 / build 10031（App ID `6800964382`）
反映方法: App Store Connect API（`appStoreVersionLocalizations` / `appInfoLocalizations`）

**App Store に英語ロケールを新設するための原稿**（それまで ASC は `ja` のみ）。
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

## App 名（29 文字）

DAIDOKO: AI Recipe from Photo

> Play の英語名と揃えた。

## サブタイトル（25 文字）

Cook the restaurant taste

## プロモーションテキスト（146 文字）

Photograph a dish you had out, and AI drafts the recipe. Say how yours turned out and it fixes just that one thing, moving closer to the original.

## キーワード（100 文字・カンマ区切り・スペースを入れない）

meal,cooking,recipe manager,pantry,grocery,shopping list,fridge,meal prep,leftovers,homemade,copycat

> App 名・サブタイトルに入っている語は Apple が別途索引するので**繰り返さない**
> （DAIDOKO / AI / photo / restaurant 等）。

## 説明

You had something wonderful at a restaurant. A week later you can almost taste it, but you have no idea how to make it.

DAIDOKO closes that gap. Photograph the dish, and AI works out the ingredients, amounts and steps — as a recipe you can actually cook in a home kitchen, with what your supermarket sells. Cook it, say how yours turned out, and the recipe moves closer to the original.

■ From a photo to a recipe
• One photo is all it takes — AI drafts the ingredients, amounts and steps
• Add the restaurant name or a note about the taste for a closer result
• Amounts and timings a photo cannot settle come back as a guide, not as fact
• Every AI-made recipe carries a note saying the AI estimated it
• You always review and edit the draft before it is saved

■ Getting closer to the taste
• After cooking, write how it turned out ("too sweet", "needs more heat")
• AI adjusts the recipe from your notes — and shows you exactly what changed
• Anything not in that list is left untouched, so your recipe stays yours
• Every version is kept, so you can look back at how it developed

■ Building your collection
• Search by recipe name, tag or ingredient
• Import from a recipe URL or pasted text
• For a cookbook page or a food package, just photograph it — AI reads it, front and back merged into a single recipe
• Cover photos and per-step photos
• Cooking mode shows one step at a time, large, with timers and no ads

■ Sharing with family and friends
• Turn a recipe into a web page and hand the link only to the people you choose
• Collect several recipes into a single recipe book
• You can stop sharing at any time

■ Kitchen, shopping and pantry
• Add the ingredients you are missing to your shopping list in one tap — items you already have stay on the list, so you can decide what to add
• Move what you bought into the pantry — by barcode or by scanning a receipt
• See which recipes you can cook right now, ranked by how much you already have
• Get a reminder when something is running low

■ Where your data lives
• No account, no sign-up. We never hold your email address or phone number
• Unless you share with family, your data stays on your device
• Join a family group and only the items you share travel through our server
• Backup, restore and a transfer file for moving to a new phone
• AI features include a free allowance, then a short ad unlocks one more. Add your own Gemini key for no limit
• Your recipes, shopping list, pantry and cooking mode work offline; only the AI features and URL import need a connection

■ Who it is for
• Anyone who wants to recreate a restaurant dish at home
• Cooks who want their recipes in one place, not scattered across screenshots and links
• Households that want recipes, shopping and what is in the fridge to work together
• People who want to follow a recipe while cooking without ads in the way

Note on AI: your photo, or the ingredient names you selected, is sent for analysis only when you use an AI feature. You are told before it happens, and nothing is stored on our servers.

DAIDOKO does not detect allergens. Always check the ingredients yourself, especially if you have food allergies.

## バージョンごとの新機能

Fixed a bug where editing and saving a recipe cleared its reading, breaking kana search.

Fixed a bug where "get closer to the restaurant taste" dropped the restaurant name.

Fixed a black preview right after choosing a cover photo. The photo itself was always saved correctly.

Fixed overlapping text when an ingredient or recipe name is long.

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
