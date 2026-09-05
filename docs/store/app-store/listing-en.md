# App Store 掲載情報（EN）

作成日: 2026-08-27
更新日: 2026-09-05（1.13.1 — 冷蔵庫からレシピ・時間帯別献立・AI 一括生成・グループ別共有を追記し、whatsNew を 1.13.1 へ。2026-09-02 は「データは端末の中だけ」の反例を修正）
対象ビルド: iOS 1.13.1 / build 10035（App ID `6800964382`・ASC へアップロード済み・**審査提出はスクショ刷新後**。1.13.0 は 2026-09-03 提出→公開済み）
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
AI 機能・URL 取り込みに加えて、**Web 共有の公開/停止・共有リンクの取り込み・リワード広告**も
通信が要る（2026-09-01 の実装突き合わせで判明。以前は「AI と URL 取り込みだけ」と書いていた）。

**開示（AI の送信範囲・グループ削除で消える範囲・オフラインの範囲・家族共有の通知）の根拠と
「戻さないこと」は `../google-play/listing-ja.md` の「実装と突き合わせて直した開示」にある。**
**同じ日の第 2 次「さらに直した開示」も併せて読むこと** — ①共有の停止は**ソフト削除**
（止めても控えはサーバーに残る）なので「消えます」と書かない ②Web 共有の停止経路は 2 つ
（レシピ 1 品＝レシピ詳細のメニュー / レシピ帖＝設定。`web-shares.tsx` は帖しか一覧しない）
③**「The screen says so before you send」が成立するのは実装側に開示を足したから**
（食材名の名寄せだけは画面ではなく設定の説明とプライバシーポリシー §3.2 で担保）
④献立の AI 並べ替えは 1.13.0 では無効なので書かない。

**2026-09-01 第 3 次（戻さないこと）**: AI 注記の「送信することは画面に書いてあります」
（英語版は "The screen says so before you send"）は名寄せの例外を含まない全称断定だった
（`privacy-policy.md` §3.2 と食い違う）。ja/en とも短く例外を足した — 名寄せだけは操作なし
に自動送信され、案内は画面ではなく設定とプライバシーポリシーにある、という区別を残すこと。

**2026-09-01 第 4 次（#266 の AI 由来注記を書き戻し・戻さないこと）**: 根拠・引用の一致確認・
「戻さないこと」は `../google-play/listing-ja.md` の同名の節を見ること（Play/ASC の 4 面共通）。
説明は 33 字しか余裕が無かったため、ja に無い「オフラインで動く」の長い箇条書き（208 字・ja の
説明本文には存在しない）を 89 字に削って確認バッジの 1 文（115 字）を作った。「バージョンごとの
新機能（1.13.0）」は 4000 字上限に対して余裕が大きいので、そのまま段落を追加した。

**説明は 4000 字が上限。** 開示を正確にしたぶん、重複していた「Who it is for」の 3 行を落とした
（Apple は説明文を検索索引に使わないので ASO の損は無い）。2026-09-01 の第 2 次で Web 共有の
停止経路を足すため、「Who it is for」を 1 行に畳み、2 段落目の言い回しも詰めた。
第 3 次（AI 注記に名寄せの例外を追記）の時点で 3972 字（残り 28 字）。第 4 次の時点で 3967 字。

**第 5 次（2026-09-02・独立監査で発見・戻さないこと）**: 根拠は `../google-play/listing-ja.md`
の同名の節（Android の OS 標準クラウドバックアップに DB が含まれる・iOS の iCloud バックアップにも
既定で含まれる・SAF 外部保存先への自動書き出し。3 つとも「共有」を経ない端末外コピー）。
"your data stays on your device" を "we do not send your data to our servers" に、
バックアップの 1 行に OS バックアップ/SAF の開示を追加。33 字の余裕では足りないため、
重複していた 2 文目「DAIDOKO keeps that loop in one place.」を削除し、"too" の重複語・
冗長な修飾（expiry の言い回し・meal-prep の一文）を数か所削って余白を確保した。
**3975 字（残り 25 字）**。

**1.13.1 追記（2026-09-05）**: Play 英語版の 1.13.1 改稿（`../google-play/listing-en.md`）と
同じ訴求で、冷蔵庫からレシピ・朝昼夕・AI 一括生成・グループ別共有を反映した。
**移植しなかったもの（iOS の実態・根拠は `listing-ja.md` の「1.13.1 追記」）**:
家族更新のプッシュ通知（iOS は APNs 受信未検証）・ウィジェット（iOS 版検証中）・
「no amounts read」（2d43567 で数量欄が付き偽になった — Play 側も要修正）。
4000 字上限は既存方針どおり冗長語の圧縮で確保した（冒頭 2 段落・meal-prep の一文・
auto-plan の "with a notification"・"from the server" 等を圧縮。削った箇所は git 差分参照）。
**最終 3987 字（残り 13 字・`**` 剥がし後の実測 = 反映スクリプトと同じ抽出）。\*\*

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

## プロモーションテキスト（135 文字）

Meal-plan from what you already have. AI can now generate a recipe image. Recipes, shopping, pantry and family sharing, all in one app.

## キーワード（95 文字・カンマ区切り・スペースを入れない）

cooking,recipe manager,grocery,fridge,meal prep,expiry,leftovers,copycat,menu planner,inventory

> App 名・サブタイトルに入っている語は Apple が別途索引するので**繰り返さない**
> （DAIDOKO / meal / plan / recipes / pantry / shopping list 等）。

## 説明

"What should I cook tonight?" You open the fridge. DAIDOKO starts from what you already have — a meal plan, then recipes, shopping and pantry, all in one app.

■ Plan today's meals
• Build a 2, 3, 5 or 7-day meal plan from what's in your pantry
• Each day comes with a one-line reason; swap out anything you don't like
• Plan breakfast, lunch and dinner separately
• Anything missing goes straight to your shopping list
• Short on recipes? AI drafts the missing days in one batch — review each before saving
• Optional auto-plan mode: today's plan is ready when you wake up; missing items can be auto-added — undo or turn it off any time

■ Building your recipe collection
• Search by recipe name, tag or ingredient
• Import from a recipe URL or pasted text
• Photograph a dish and AI drafts the ingredients, amounts and steps — review and edit before saving
• Photograph a cookbook page or food package — AI merges front and back into one recipe
• **AI can generate an image** for the recipe, always labeled "This image was created by AI" (3 free a month, separate allowance)
• Recreate a restaurant dish — write how yours turned out and AI narrows the gap, showing what changed
• AI-drafted recipes carry a reminder to check the ingredients, amounts and steps yourself (especially for allergies)
• Cover and step photos, plus a log of what you cooked and when
• Cooking mode shows one step at a time, large, with timers and no ads. Leave and resume from a bar or the home screen; add step photos as you cook

■ Sharing with family and friends
• Turn a recipe into a web page and hand the link only to the people you choose
• Collect several recipes into a single recipe book
• You can stop sharing at any time

■ Shopping and pantry, connected
• Add what a plan or recipe is missing to your shopping list in one tap
• Move what you bought into the pantry — by barcode or by scanning a receipt
• Track expiry dates if you want — nothing required, no nagging reminders
• Snap your fridge — AI reads what's inside, you confirm, and it becomes pantry stock that feeds your meal plan and shopping list (photos are used only for reading, never stored)
• See what you can cook right now, ranked by how much you already have
• Get a reminder when something is running low

■ Shared with the family, automatically
• Share an invite code — no account, no email address
• Recipes, shopping list and pantry arrive on every phone in the family (meal plans stay per-phone)
• Share by group — everything with family, recipes only with a friend
• Choose per item whether the shopping list and pantry are shared or private

■ Where your data lives
• No account, no sign-up. We never hold your email address or phone number
• Unless you share with family or publish a recipe page, we do not send your data to our servers
• Join a family group and only the items you share travel through our server. Delete the group and that synced data is erased
• A published recipe page is separate — deleting the group does not stop it. Stop a single recipe from its own menu, a recipe book from Settings → Recipe books; nobody can open it after that
• Backup, restore, a transfer file for a new phone, plus your OS backup (Android/iCloud) or chosen folder if set — your account, not ours
• AI features include a free monthly allowance (5 a month; AI image generation is separate, 3 a month). Add your own Gemini key for no limit
• Most of the app works offline; AI features, URL import, sharing and ads need a connection

■ Who it is for
• Cooks and households who want recipes, cooking logs, pantry stock and expiry dates in one place, without it becoming a chore

Note on AI: an AI feature sends what it needs (photo, ingredients, recipe, notes, or receipt text) and the screen says so first. Ingredient matching alone runs automatically (see Settings and our privacy policy). Not stored on our servers.

DAIDOKO does not detect allergens. Always check the ingredients yourself, especially if you have food allergies.

## バージョンごとの新機能（1.13.1）

Snap your fridge and AI reads what's inside, ready to add to your pantry — you review every item before anything is added, and you can jump straight to what you can cook with it. Photos are used only for reading and are never stored.

Sharing, reorganized: choose what each group gets — everything with family, recipes only with a friend. A new Sharing overview screen shows what you are sharing with whom.

Shared recipe links now have a pick-up window: only people who open the link within 7 days of sending can view it. Anyone who opened it in time keeps access.

Meal plans can now be built for breakfast, lunch or dinner. Short on recipes? AI drafts the missing days in one batch — review each one before saving.

Take several photos in a row when importing a cookbook page or consulting AI.

Also fixed: photo reads failing with large images, taps that silently did nothing, and other small bugs.

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
