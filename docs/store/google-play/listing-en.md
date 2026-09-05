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

## アプリ名（28 字）

- DAIDOKO: Meal Plan & Recipes

## 短い説明（77 字）

Snap your fridge — it becomes pantry, meal plan and the family shopping list.

## 詳しい説明

"What should I cook tonight?" You open the fridge. DAIDOKO starts from what you already have — a meal plan, then recipes, shopping and pantry, all in one app.

■ Plan today's meals
• Build a 2, 3, 5 or 7-day meal plan from what's in your pantry
• Each day comes with a one-line reason; swap out what you don't like
• Plan breakfast, lunch and dinner separately
• Anything missing goes straight to your shopping list
• Short on recipes? AI drafts the missing days in one batch — review each before saving
• Optional auto-plan mode: today's plan is ready when you wake up; missing items can be auto-added — undo or turn it off any time

■ Building your recipe collection
• Search by recipe name, tag or ingredient
• Import from a recipe URL or pasted text — unlimited, no AI allowance used
• Photograph a dish and AI drafts the ingredients, amounts and steps — review and edit before saving
• Photograph a cookbook page or food package — AI merges front and back into one recipe
• **AI can generate an image**, always labeled "This image was created by AI" (3 free a month, separate allowance)
• Recreate a restaurant dish — write how yours turned out and AI narrows the gap, showing what changed
• AI-made recipes come with a check-yourself note
• Cover and step photos, plus a log of what you cooked and when
• Cooking mode shows one step at a time, large, with timers and no ads

■ Shopping and pantry, connected
• Add what a plan or recipe is missing to your shopping list in one tap
• Check today's plan and your shopping list from a home-screen widget (Android)
• Move what you bought into the pantry — by barcode or receipt scan
• Track expiry dates if you want — nothing required, no nagging reminders
• Snap your fridge — AI reads what's inside, you confirm, and it becomes pantry stock that feeds your meal plan and shopping list (no amounts read; photos never stored)
• See what you can cook right now, ranked by how much you already have
• Get a reminder when something is running low

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
• Join a family group and only the items you share travel through our server.
Delete the group and that synced data is erased
• A published recipe page is separate — deleting the group does not stop it. Stop a single recipe from its own menu, a recipe book from Settings → Recipe books; nobody can open it after that
• Backup, restore, a transfer file for a new phone, plus your OS backup (Android/iCloud) or chosen folder if set — your account, not ours
• AI features include a free allowance (5 a month); an ad unlocks one more.
Add your own Gemini key for no limit

■ Who it is for
• Cooks and households who want recipes, cooking logs, pantry stock and expiry dates in one place

■ Permissions
• Camera: photographing dishes, reading text, scanning barcodes
• Photos and media: choosing an image from your library
• Notifications: low-stock and meal-plan reminders, cooking timers, and family update alerts

Note on AI: an AI feature sends what it needs (photo, ingredients, recipe, notes, or receipt text) and the screen says so first. Ingredient matching alone runs automatically (see Settings and our privacy policy). Not stored on our servers.

DAIDOKO does not detect allergens. Always check the ingredients yourself, especially if you have food allergies.
