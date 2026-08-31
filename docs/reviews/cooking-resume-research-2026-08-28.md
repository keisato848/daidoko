# 料理中モードの離脱/復帰 — 競合・技術調査（2026-08-28）

> 発端: 「料理モード中に別画面へ行くと手順が消えるのがうざい。ホームから復帰できるとよさそう。
> 競合他社しだいかな」（ユーザー）。Web 公開情報のみの調査で、実機インストール確認はしていない。
> 「記述が見つからない」は「機能が無い」の証明ではない。

## 結論（この調査から下した判断）

1. **復帰導線は空白地帯。** 国内アプリに「進行中の調理へ戻る」導線の記述は皆無。
   海外も Paprika（ピン留め＋進捗保持）と Mela（マルチレシピセッション）のみで、
   音楽アプリ型の Now Cooking ミニバーを持つ例は確認できなかった → だいどこの差別化になる
2. **iOS Live Activities は当面不可。** 公式 expo-widgets は SDK 57+ alpha（当方 SDK 54）、
   SDK 54 世代の expo-live-activity はアーカイブ済み。ネイティブ拡張＋prebuild＋新ビルドが必須
3. **JS だけで作れるのは**: アプリ内 pill（タブバー直上）＋ホーム復帰カード＋
   Android sticky 通知（expo-notifications 導入済み。ただし Android 14+ ではユーザーが消せる）
4. → **1.12.3 では pill ＋ホームカードを実装**（cooking-session.store）。
   sticky 通知と Live Activities/Live Updates は将来の拡張（受け皿ライブラリは監視）

## 国内競合（日本のレシピアプリ）

**要約**: 料理中モード（S06）の手順位置は cook.tsx:55 の useState のみで、画面を離れると消える（設計書 349 行の「ステップ番号を保存」は未実装。タイマーだけは zustand timer.store が絶対終了時刻＋OS 通知つきで所有し画面離脱を生き延びる。keep-awake あり）。出口は ✕=router.back()・完了→log→ホーム・タブバー表示のままタブ移動可で、再入は常にステップ 1 から。ホームには「hasStock のときだけ出す導線」「wantList>0 の棚」という状態条件カードの既存パターンが ListHeaderComponent 内にあり、永続フラグは app_meta テーブル・画面をまたぐ揮発状態は zustand という置き場の慣例が確立している。

### cook.tsx — 手順位置(step index)

currentStep は cook.tsx:55 の useState(0) のみで保持。永続化なし（src 全体を grep しても currentStep はこのファイル以外に無く、app_meta キーも無い）。画面を離れて（unmount して）再入すると 0 に戻る。ただしタブ切替では recipes スタックが unmount されないため、タブを往復するだけなら位置は残る（推測: React Navigation のタブは各スタックをマウント維持する標準挙動に基づく）。同一レシピのタイマーが動いていれば jumpToTimerStep（cook.tsx:138-143）でタイマーのあるステップへだけは復帰できる。

出典: C:\Projects\daidoko-modal-wt\apps\mobile\app\(tabs)\recipes\[id]\cook.tsx:55,138-143

### cook.tsx — タイマー実装

カウントダウンと OS 通知のライフサイクルは zustand の timer.store が所有（timer.store.ts:58-186）。残り時間は絶対終了時刻 \_endsAt から導出し（start: 123 行、tick: 155-171 行）、JS がバックグラウンドで止まっても自己補正。context={recipeId, stepId, stepNumber}（20-24 行）。store がモジュールグローバルなので画面離脱・ステップ移動でも消えない。cook.tsx:66-69 で「別レシピの調理開始時のみ clear」。別ステップで動作中はチップ表示（cook.tsx:100-104, 176-187）、切替時は確認ダイアログ（cook.tsx:122-134）、完了で clear（cook.tsx:145-148）。timerSec 未設定の手順は本文から extractPrimaryStepTimer で検出して提案・DB 未保存（cook.tsx:106-109, #77）。TimerWidget は store の純ビュー（TimerWidget.tsx:1-7）。

出典: C:\Projects\daidoko-modal-wt\apps\mobile\src\stores\timer.store.ts:58-186 / apps\mobile\app\(tabs)\recipes\[id]\cook.tsx:59,66-69,111-136,145-148

### cook.tsx — keep-awake

あり。cook.tsx:63 で useKeepAwake() を呼ぶ。実体は src/hooks/useKeepAwake.ts:194-214（cat 連結表示のため実ファイルでは 8-27 行相当）— expo-keep-awake の activateKeepAwakeAsync を動的 import で有効化し、unmount 時に deactivate。web では no-op。

出典: C:\Projects\daidoko-modal-wt\apps\mobile\src\hooks\useKeepAwake.ts / apps\mobile\app\(tabs)\recipes\[id]\cook.tsx:63

### 画面遷移 — cook の入口と出口

入口はレシピ詳細 [id].tsx:721 の「調理開始」CTA → router.push(`/(tabs)/recipes/${id}/cook`)。出口は (1) ✕ボタン = router.back()（cook.tsx:154）確認ダイアログ無し、(2) 最終ステップ「完成」= timer.clear() して router.push(log)（cook.tsx:145-148）→ log 保存後はホームへ push（log.tsx:129,135,145）または refine へ replace（log.tsx:124-127）、(3) タブバー — FULLSCREEN_CHILD_ROUTES は ['import-photo','consult'] のみ（(tabs)/\_layout.tsx:11,62-64）で '[id]/cook' が無いため料理中もタブバーは表示されたままで、タブ移動が可能。BackHandler / beforeRemove は cook.tsx に無く、Android の戻るキーも無確認で pop する。再入時は新規マウントで currentStep=0・loadData 再取得、同一レシピのタイマーだけ store 経由で継続。

出典: C:\Projects\daidoko-modal-wt\apps\mobile\app\(tabs)\recipes\[id].tsx:717-724 / [id]\cook.tsx:154 / [id]\log.tsx:110-145 / (tabs)\_layout.tsx:11,53-66

### ホーム index.tsx — 状態に応じて出るカードの既存パターン

FlatList の ListHeaderComponent（index.tsx:339-423）内に条件付きブロックを並べる構造。実例: (1)「在庫で作れるレシピ」ボタン = hasStock && <PressableScale>（index.tsx:372-383）。hasStock は loadTimeline の Promise.all で getInStockNormalizedNames() を読み useState に保持（index.tsx:115-131）。コメントに「在庫に何か入っているときだけ出す。使っていない人のホームは変えない」という設計方針あり（116-119 行）。(2)「再現したい」棚 = wantList.length > 0 && 横スクロール ScrollView のカード列（index.tsx:385-417、データは pinned_at / getWantToCookRecipes）。(3) MonthlyStats = monthlyStats.count > 0 のとき（index.tsx:418-420）。読み直しは useFocusEffect（142-146 行）＋ useSyncRefresh（149-153 行）。

出典: C:\Projects\daidoko-modal-wt\apps\mobile\app\(tabs)\index.tsx:115-131,339-423

### 状態管理 — zustand ストア一覧と置き場の慣例

ストアは apps/mobile/src/stores/ に 4 つ: timer.store.ts（調理タイマー・画面をまたぐ一時状態）、unitSystem.store.ts（単位系。起動時に app_meta から読み、以後メモリ保持・変更時に app_meta へ書き戻すハイブリッド）、dialog.store.ts（ダイアログキュー）、sync.store.ts（同期の合図。lastAppliedAt/joined のみ）。zustand persist ミドルウェアの使用は 0 件（grep 'persist(' が空）。慣例: 再起動をまたぐ永続フラグは SQLite の app_meta テーブル（schema.ts:321-325）＋ services/app-meta.service.ts（getAppMeta/setAppMeta, 14-31 行）— coach-marks・usage・review-request・low-stock・launch_camera・cloud_inference_consent 等が使用。画面をまたぐが再起動で消えてよい一時状態は zustand（timer.store がその代表で、ヘッダコメントに『ステップ移動や widget unmount を生き延びるため store が所有』と明記）。

出典: C:\Projects\daidoko-modal-wt\apps\mobile\src\stores\ / src\services\app-meta.service.ts:14-31 / src\db\schema.ts:321-325

### docs/画面設計.md — S06 の設計記述

S06 は一覧表 82 行目（P0）と 320 行目の「### S06 調理モード」節。機能（343-349 行）: スワイプ or ボタンでステップ移動 / タイマー付きステップは自動でタイマー起動オファー / 最終ステップ→完了→S07 / 画面タップで材料オーバーレイ / **「画面ロック中も続きから再開できる（ステップ番号を保存）」（349 行）**。351-360 行にタイマー継続動作（2026-07 実装、store 所有・チップ・切替確認・絶対終了時刻・OS 通知・人数ステッパー）、362-367 行に本文自動検出（#77）。TimerWidget は 734 行のコンポーネント表にも記載。

出典: C:\Projects\daidoko-modal-wt\docs\画面設計.md:82,320-367,734

### 設計と実装のギャップ（料理中モード）

(1) 設計 349 行「ステップ番号を保存」して再開できる、は未実装 — currentStep は useState のみで保存箇所が存在しない（keep-awake で画面ロック自体を防いでいるだけ）。(2) 設計 345 行「スワイプ or ボタン」のうちスワイプは未実装 — cook.tsx にジェスチャ/PanResponder は無く、前へ/次へボタンのみ（cook.tsx:221-242）。(3) タイマーの「自動起動オファー」は自動ではなく開始ボタン表示（cook.tsx:203-214）。いずれもコードの grep/通読に基づく事実。

出典: C:\Projects\daidoko-modal-wt\apps\mobile\app\(tabs)\recipes\[id]\cook.tsx:55,203-214,221-242 / docs\画面設計.md:345,349

## 海外競合

**要約**: 主要アプリはほぼ全て step-by-step の調理モード（1画面1ステップ+ステップ内タイマー+画面スリープ抑止）を持つが、「別画面へ行っても進行中の調理へ戻る」導線を明示的に持つのは Paprika（Pins: 消し込み・現在ステップを保持し下部ツールバーに常駐）と Mela（Cook Mode に複数レシピを追加して切替）だけだった。Crouton の Live Activities / Dynamic Island 利用は事実として確認: ステップ内タイマーが Dynamic Island に出て、長押しでレシピサムネイル・タイマー調整・ステップ完了ボタン、ロック画面ではステップ文付きタイマーカードがスタックし、Apple Watch にもステップを出す（Pestle も同系の実装で現在ステップのスニペットをロック画面に表示）。アプリ内に音楽アプリ型の「Now Cooking」ミニバーを持つ例は確認できず、永続化は「ピン留め」「マルチレシピセッション」「OS の Live Activity へ外出し」の3パターンに収斂していた（この総括部分は帰納的推測）。

### Crouton — step-by-step mode

事実: 「Step by step mode. Focus on one recipe step at a time as you cook」を公式に掲げる。1画面1ステップ、スワイプまたは画面下の矢印で移動。ステップ内の材料名をタップすると分量がその場で表示される。TrueDepth カメラでのハンズフリー操作（右ウインクで次へ、左ウインクで前へ）あり。iPad では左に材料・右に手順の2ペイン。

出典: https://apps.apple.com/us/app/crouton-recipe-manager/id1461650987 / https://www.macstories.net/reviews/crouton-review-an-elegant-modern-recipe-manager-and-cooking-aid/

### Crouton — Live Activities / Dynamic Island（確認済み）

事実: 手順内の時間表記が黄色でハイライトされ、タップでそのステップ用タイマーを開始。アプリを離れるとタイマーが Dynamic Island に表示される。長押しで展開するとレシピのサムネイル、タイマー調整ボタン、『そのステップを完了にする』ボタンが出る（ボタンはアプリを開く）。ロック画面ではタイマーを開始したステップごとの Live Activity カードがスタック表示され、カウントダウンと対象ステップ文が見える。複数タイマー時は最初のタイマー終了後に次が現れる。さらに 2024.6 リリースノートに『New Live Activities on Apple Watch, view timers, steps and doneness all on your wrist』とあり Watch でもステップ表示。

出典: https://www.macstories.net/reviews/ios-16-1-and-apps-with-live-activities-the-macstories-roundup-part-1/ / https://apps.apple.com/us/app/crouton-recipe-manager/id1461650987

### Crouton — アプリ内のセッション永続化

推測: アプリ内の別画面へ移動した際の『進行中の調理に戻る』バー/インジケーターは、公式説明・MacStories レビュー・screensdesign の UI 分解のいずれにも記述が見つからなかった。永続化の実体は Live Activity（OS 側）に置いている可能性が高い。無いとは断定できない（未確認）。

出典: https://screensdesign.com/showcase/crouton-recipe-manager

### Paprika — Cook mode

事実: 炎アイコンでフルスクリーンの step-by-step モードに入る。スワイプで次ステップ、手順中の時間表記は青くハイライトされタップでタイマー開始（自動検出）、材料はチェックで消し込み、現在のステップをハイライトできる。設定『Keep Screen On』でレシピ表示中は画面スリープを自動無効化。

出典: https://www.paprikaapp.com/help/ios/

### Paprika — Pins（調査対象中で最も明確な調理セッション永続化）

事実: 『You can pin active recipes to easily switch between them while you are cooking』。ピン留めしたレシピは下部ツールバー（および左サイドバー）に常駐し、別画面へ行っても1タップで戻れる。かつ『Paprika will keep track of the ingredients you have crossed off and the current directions you have highlighted, so you don't lose your place』— 材料の消し込みと現在ステップのハイライトがレシピ単位で保持される。複数レシピ並行調理も同じ仕組みでカバー。調理完了時に手動で Unpin。

出典: https://www.paprikaapp.com/help/ios/

### Mela — Cook Mode（複数レシピのセッション）

事実: フルスクリーンで手順と材料のみを大きめフォント表示、現在ステップ以外は減光（dimmed）。材料はタップで消し込み。公式サイトに『you can add more recipes to the cook mode and easily switch between them』とあり、献立単位で複数レシピを1つの調理セッションに追加して切替できる。タイマーも Cook Mode 内から開始・管理。

出典: https://mela.recipes/ / https://mela.recipes/help/

### Mela — Live Activities

推測気味の事実: 検索結果の要約に『Timers come with support for Live Activities (iOS 16.1+)』とあったが、公式サイトの取得内容では直接確認できなかった。タイマーの Live Activity 対応はある可能性が高いが、Crouton のような『ステップ表示付き』かは未確認。

出典: https://mwm.ai/apps/mela-recipe-manager/1548466041

### Kitchen Stories — cooking mode

事実: 各ステップに写真（またはビデオ）付きの step-by-step 表示。ステップごとにタイマーが組み込まれ、レシピ表示中は画面がロックされない。材料や道具を確認するためのスクロール往復を減らす構成が売り。セッション永続化・『調理に戻る』導線の記述は見つからなかった（推測: 無いか、少なくとも売りにしていない）。

出典: https://pages.kitchenstories.com/en/app / https://www.makeuseof.com/kitchen-stories-best-app-learning-delicious-recipes/

### SideChef — step-by-step mode

事実: 全レシピがステップ分解され、各ステップに写真か動画が付く。音声コマンド（hands-free voice commands）でステップ送りができ、ステップ内蔵タイマーあり。Alexa / Google Home / Bixby / スマート家電（オーブン等）連携が差別化点。セッション永続化の公開情報は見つからず（推測: 記述なし）。

出典: https://www.sidechef.com/faq/ / https://apps.apple.com/us/app/side%D1%81hef-easy-cooking-recipes/id905229928

### BBC Good Food — Cook Mode

事実: この app の『Cook Mode』は主に『レシピを開いている間、画面をスリープさせない』機能で、step-by-step の動画・チュートリアルを併載。Crouton/Paprika 型の1ステップ全画面ガイドや音声操作、セッション永続化の記述は見つからなかった。『Cook Mode』という同じ名前でも中身が薄いパターンの代表例。

出典: https://play.google.com/store/apps/details?id=uk.co.bbc.goodfood2&hl=en_US

### Samsung Food — Smart Cook Mode

事実: 『Start Cooking』をタップするとカード式のステップ表示をスワイプで進める。各ステップに必要な材料・器具が併記され、ステージごとにタイマーを設定できる。AI がレシピから要点ステップを生成する Smart Cook Mode は任意レシピに対しては有料（Food+）。対応家電へのオーブン予熱・設定転送あり。画面遷移後の復帰導線については記述なし（未確認）。

出典: https://www.androidauthority.com/samsung-food-3517054/ / https://apps.apple.com/us/app/samsung-food-meal-planner/id1133637674

### Pestle（その他・Live Activities のもう1つの実例）

事実: 音声コマンド（'Next'/'Previous'、語はカスタマイズ可）でステップ移動、Siri 音声でステップ読み上げ、『how much flour?』のような分量の問い返しにも応答。ステップ内の材料・時間が緑でハイライト。Live Activity はタイマーを最大2つ同時表示し、ロック画面に現在ステップの手順スニペットを表示、ステップ完了も組み込む。SharePlay で FaceTime 越しの共同調理も可能。

出典: https://www.macstories.net/reviews/ios-16-1-and-apps-with-live-activities-the-macstories-roundup-part-1/ / https://9to5mac.com/2022/01/21/pestle-cooking-app-for-ios-release/

### Yummly（参考）

事実: ハンズフリーの Yummly Voice を備えた guided cooking の代表例だったが、すでにサービス終了している（2026 年時点の代替紹介記事が shutdown を明記）。

出典: https://mealthinker.com/blog/yummly-alternative

### America's Test Kitchen（その他）

事実: Cook Mode に step-by-step の動画/大判写真スライドショーを備える。台所で読みやすい大きな表示が目的。永続化の記述なし。

出典: https://apps.apple.com/us/app/americas-test-kitchen/id1365223384

### パターン総括: 調理セッション永続化の業界内の解

推測（調査からの帰納）: 『進行中の調理に戻る』問題への解は3通りに分かれる。(a) Paprika 型 = ピン留め+レシピ単位の進捗保持（消し込み・現在ステップ）を下部ツールバーから常時到達可能にする。(b) Mela 型 = Cook Mode 自体を複数レシピのセッションにして、その中で切替させる（外に出る前提を弱くする）。(c) Crouton/Pestle 型 = 永続化を OS の Live Activities / Dynamic Island に外出しし、アプリ外からも現在ステップ・タイマーに戻れるようにする。音楽アプリの『Now Playing』バーのようなアプリ内ミニバーを明示的に持つ例は今回の調査では確認できなかった — だいどこ S06 でそれをやるなら差別化点になり得る。

出典: 本調査の総合（上記各ソース）

## OS 標準パターンと Expo での実現可能性

**要約**: iOS Live Activities は Widget Extension のネイティブターゲットが必須で JS のみでは不可能 — 公式 expo-widgets は SDK 57+ の alpha（だいどこは SDK 54）、SDK 54 世代の expo-live-activity はアーカイブ済みのため 9/1 までは対象外。Android は expo-notifications の sticky: true（導入済み ~0.32.17）で常駐通知が今すぐ JS のみで作れる（Android 14+ ではユーザーが消せる点に注意）が、Android 16 Live Updates (ProgressStyle) は expo-live-updates というネイティブモジュール追加が要り枠外。3 日で現実的なのは音楽アプリの now playing bar 型のアプリ内 pill（タブバー直上・JS Tabs なので絶対配置で可）+ ホーム復帰カード + sticky 通知の組み合わせで、cook.tsx の currentStep を timer.store と同型の Zustand store へ昇格させるのが唯一の前提作業。

### expo-widgets（Expo 公式・iOS Live Activities）

公式の expo-widgets は React コンポーネントで Live Activity（Lock Screen / Dynamic Island / Widget）を書ける新モジュールだが、SDK 57 が対象で 2026-03-04 時点 alpha。config plugin が prebuild 時に Widget Extension ターゲットと App Group を自動生成する。Expo Go 不可・dev build 必須。だいどこは SDK 54 なので使うには SDK アップグレードが前提 = 3日枠では不可能。

出典: https://expo.dev/blog/home-screen-widgets-and-live-activities-in-expo / https://docs.expo.dev/versions/latest/sdk/widgets/

### software-mansion-labs/expo-live-activity（SDK54 世代の選択肢）

Swift 不要の config plugin 方式で startActivity/updateActivity/stopActivity を JS から呼べ、Dynamic Island 対応（iOS 16.2+、prebuild + dev build 必須、レイアウトは既定テンプレのみで色・画像・タイマー表示等の調整に限定）。ただし 2026-06-01 にアーカイブ済みで expo-widgets への移行が推奨されており、新規採用は非推奨。

出典: https://github.com/software-mansion-labs/expo-live-activity

### iOS Live Activities の結論

どの経路でも Widget Extension というネイティブターゲットの追加 + prebuild + 新規ビルド（EAS か macOS）+ iOS 実機検証が必須で、JS のみでは絶対に実現できない。開発環境が Windows・現行 SDK 54・候補ライブラリがアーカイブ済み、という条件から 9/1 までの実装は非現実的（これは事実からの判断＝推測）。expo-apple-targets で自前 SwiftUI を書く道もあるがさらに重い。

出典: https://github.com/akshayjadhav4/live-activity-rn-demo

### Android 16 Live Updates（Notification.ProgressStyle）

Android 16 (API 36) の新 API。セグメント付き進捗バー・ステータスバーのチップ・通知ドロワー最上部固定が特徴で、manifest に POST_PROMOTED_NOTIFICATIONS 宣言が必要。フードデリバリー/ナビ/ワークアウトなど『進行中セッション』向けに設計されており、料理モードはまさに想定ユースケース。ただしネイティブ API であり expo-notifications は未対応。

出典: https://proandroiddev.com/live-updates-in-android-16-exploring-the-next-evolution-of-notifications-1a5cf5de2068 / https://medium.com/justeattakeaway-tech/live-updates-and-progress-notifications-for-android-16-at-jet-b0c87eab17b4

### software-mansion-labs/expo-live-updates（Android 16 用 Expo モジュール）

Android Live Updates 専用の Expo モジュールが既に存在。config plugin + prebuild で導入し、startLiveUpdate/updateLiveUpdate/stopLiveUpdate と FCM 連携・進捗バー・deep link 対応。API 36.1 が必要で、16 未満は通常通知に自動フォールバック。ただし『minor で breaking change あり』の early development 段階で、ネイティブモジュール追加 = 新規ビルドが必要なので JS のみの範囲外。将来（v2.1 以降）の本命候補。

出典: https://github.com/software-mansion-labs/expo-live-updates

### expo-notifications の sticky 通知（JS のみで今すぐ可能）

SDK 54 の expo-notifications は NotificationContentInput.sticky: true（Android の setOngoing 相当、スワイプで消せない通知）をサポート。だいどこには expo-notifications ~0.32.17 が導入済みで、タイマー通知の channel・権限フロー・response listener（notification.service.ts）が既にあるため、『料理中セッション進行中』の常駐通知 + タップで cook 画面へ復帰は数時間規模の追加で作れる。ただし進捗バーは非対応。

出典: https://docs.expo.dev/versions/v54.0.0/sdk/notifications/ と C:\Projects\daidoko-modal-wt\apps\mobile\src\services\notification.service.ts

### Android 14+ の ongoing 通知の挙動変更（罠）

Android 14 から FLAG_ONGOING_EVENT の通知もユーザーがスワイプで消せるようになった（例外はメディア再生・通話・デバイスポリシー）。つまり sticky: true はベストエフォートで、消されたら復帰導線が消える。deleteIntent で再表示する回避策はネイティブ実装が必要なので、JS のみ運用では『消されても困らない補助導線』と位置づけるべき。

出典: https://developer.android.com/about/versions/14/behavior-changes-all

### Notifee（FGS + 進捗通知の定番）の現況

Invertase の Notifee は 2026-04-07 にアーカイブ済み。維持フォーク react-native-notify-kit が foreground service + ongoing + 進捗バー + Expo CNG config plugin を提供するが、これもネイティブモジュール追加 = 新規ビルド必須で 3 日 JS-only 枠の外。

出典: https://github.com/marcocrupi/react-native-notify-kit

### アプリ内パターン: ミニプレイヤー/pill（JS のみの本命）

Spotify/Apple Music の now playing bar が原型の『タブバー直上に常駐する pill、タップで全画面へ復帰』パターンは OS 側も公式化が進んでおり、Expo Router native tabs と React Navigation native-bottom-tabs は bottomAccessory API（用途例として mini music player を明記）を提供する。ほか OS 標準の類例は Google マップの『ナビに戻る』バナー、YouTube のミニプレイヤー、Netflix ホームの『続きを見る』カード。

出典: https://docs.expo.dev/router/advanced/native-tabs/ / https://reactnavigation.org/docs/native-bottom-tab-navigator/

### だいどこ側の実装ギャップ（cook.tsx / timer.store.ts）

cook.tsx の currentStep はローカル useState のため画面を離れると位置が消える。一方 timer.store.ts は既に『Zustand が countdown と OS 通知のライフサイクルを持ち、画面遷移を生き延びる』設計で、recipeId/stepId の context も保持している。復帰導線は (a) currentStep を cookingSession store（timer.store と同型）へ昇格、(b) (tabs)/\_layout.tsx は JS Tabs で TAB_BAR_CONTENT_HEIGHT=58 が既知なので直上に pill を絶対配置、(c) 任意で sticky 通知 — の 3 点で成立する。

出典: C:\Projects\daidoko-modal-wt\apps\mobile\app\(tabs)\recipes\[id]\cook.tsx / C:\Projects\daidoko-modal-wt\apps\mobile\src\stores\timer.store.ts / C:\Projects\daidoko-modal-wt\apps\mobile\app\(tabs)\_layout.tsx

### 9/1 までの 3 日で JS だけで作れるか（判断）

作れる範囲は『アプリ内 pill（タブバー直上・タップで cook へ復帰）+ ホームの復帰カード + Android sticky 通知』まで — 全部 JS で、既存の Zustand/通知基盤に乗るため 3 日で十分収まる（推測＝工数見積）。iOS Live Activities と Android 16 Live Updates はいずれもネイティブ拡張 + prebuild + 新規ビルドが必須で 3 日枠外。ただし expo-live-updates / expo-widgets という受け皿は揃いつつあるので、pill の状態モデル（session store）を先に作っておけば後からネイティブ面に露出させる拡張が自然にできる。

出典: 上記各 findings の総合

## リポジトリ現状（当時）

**要約**: 日本の主要レシピアプリで手順を1ステップずつ見せる専用モードを持つのはデリッシュキッチン（キッチンモード=工程別動画ループ）とE・レシピ（横向きステップ表示）で、クックパッド・クラシル・macaroniには見つからず、Nadiaは「アプリ利用中は画面が消えない」仕様のみ。調査の核心である「進行中の調理へ復帰する導線（ホームバナー・カード・通知・ライブアクティビティ）」は、調べた範囲ではどのアプリにも存在の記述が無く、離脱＝モード終了が標準と推測される（＝だいどこS06の差別化余地）。手順連動タイマーもどのアプリにも確認できず、画面点灯維持はNadia（公式明記）以外は第三者記事ベースの情報である点に注意。

### デリッシュキッチン（キッチンモード）

事実: 専用の料理中モード「キッチンモード」あり（2020-02リリース、当時はiOSのみ）。手順ごとに分割された動画が1工程ずつループ再生され、画面左右のタップ/スワイプで前後の手順へ移動。右上に「材料を見る」が常設され、どの工程からもワンタップで分量を確認できる。起動は①全画面動画再生中に画面下部をタップ/上スワイプ、②レシピ詳細の「キッチンモードで料理を始める」ボタンの2経路。

出典: https://everything.every.tv/20200214（公式プレス記事）/ https://help.delishkitchen.tv/hc/ja/articles/360042267853（公式ヘルプ、検索スニペット経由。直接fetchはCloudflareで403）/ https://appllio.com/app-delishkitchen

### デリッシュキッチン（タイマー・スリープ・復帰導線）

事実: 公式ヘルプ・プレス記事・レビュー記事のいずれにも、手順連動タイマー、画面点灯維持、モード離脱後の復帰導線に関する記述は見つからなかった。推測: 工程ごとの動画ループが時間の目安を代替しており、モードはレシピ詳細から入る全画面ビューで、離脱＝終了の設計と思われる。なおAI機能「デリッシュAI」（2024-12、プレミアム向け）はレシピ提案のみで調理中支援ではない（事実）。

出典: https://corp.every.tv/news/20241216 / https://everything.every.tv/20200214

### クックパッド

事実: 1ステップずつ表示する専用モードの記述はApp Store説明文・ヘルプ・レビュー記事のいずれにも見つからなかった（説明文には「料理中も見やすいレシピ」の文言のみ）。第三者レビュー2件が「レシピを開いている間はスリープしない/画面が暗くならない」と記載（公式一次情報は未確認）。復帰導線としては、複数レシピをピンで「留めて」おき後で戻れる機能がApp Store説明に明記されている — これは調理専用の復帰バナーではなく汎用の留め置き機能。推測: 過去の知恵袋には調理中に画面がロックされる不満が複数あり、スリープ抑止は比較的近年の挙動か、条件付きの可能性がある。

出典: https://apps.apple.com/jp/app/id340368403 / https://app-liv.jp/foods/cooking/0071/ / https://m-s-y.com/app/ranking/recipe/ / https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q12172278682

### クラシル

事実: 専用の料理中モードの記述は、App Store説明文（バージョン履歴含む）・サポートFAQ・複数のレビュー記事のいずれにも見つからなかった。調理中の閲覧は1分程度のレシピ動画が担い、0.5/1.5倍速・5秒巻き戻し・自動再生設定で「料理のペースに合わせる」設計。タイマー・画面点灯維持・復帰導線の記述も見つからず。推測: 動画プレイヤー自体が実質の料理中モードであり、ステップ分割型のモードは持たない。

出典: https://apps.apple.com/jp/app/id1059134258 / https://support.kurashiru.com/hc/ja/categories/360002217591 / https://app-tatsujin.com/kurashiru-app-guide-for-beginners/

### Nadia

事実: App Store公式説明文に「料理中に画面が消えない：Nadiaアプリをご利用いただいている間は、画面が消えない仕様」と明記。専用モードではなくアプリ利用中は常時スリープ抑止という割り切り。1ステップずつの専用モード・タイマー・復帰導線の記述は見つからなかった。

出典: https://apps.apple.com/jp/app/id973084539 / https://play.google.com/store/apps/details?id=jp.co.oceans_corp.nadia

### macaroni

事実: レシピ動画で工程を解説するメディア型アプリで、料理中専用モード・タイマー・スリープ抑止・復帰導線の記述はレビュー記事・公式サイトのいずれにも見つからなかった。推測: 調理支援UIには投資しておらず、メディア/ポイ活寄りの設計。

出典: https://good-apps.jp/media/app/17156 / https://macaro-ni.jp/movie

### E・レシピ（その他で発見）

事実: 「クッキングモード」あり。レシピの「クッキングモードで見る」をタップすると横向き・大画面で下準備〜作り方をステップ表示し、調理中に画面が暗くならない。工程写真付き。複数の第三者記事が独立に記載しており確度は高い（公式ヘルプでの直接確認はしていない）。

出典: https://appget.com/c/get/4122/ / https://yanai-ke.com/erecipe/ / https://smartlog.jp/155383

### Tasty 日本語版（その他で発見）

事実（第三者記事1件のみ・要注意）: 「調理中はスリープしない専用モードで、画面をタップするだけで工程を進められる」との記載。ステップ送り型の料理中モード＋スリープ抑止の組み合わせ。

出典: https://smartlog.jp/155383

### パターン: 復帰導線（調査の核心）

事実: 公式ヘルプ・ストア説明文・プレスリリース・レビュー/UX記事を横断して調べた範囲で、日本の主要レシピアプリに『進行中の調理へ復帰させるホームバナー・カード・プッシュ通知・iOSライブアクティビティ』の存在を示す記述は1件も見つからなかった。ライブアクティビティのバナー活用は汎用キッチンタイマーアプリの領分に留まる。推測: 各社の料理中モードは「レシピ詳細から入る全画面ビュー」で、離脱すると調理セッションは消える設計が標準。『調理中』という状態を永続化して復帰導線を出すUXは空白地帯であり、だいどこ（S06料理中モード）の差別化ポイントになり得る。

出典: 本調査の横断結果（各アプリの項の出典参照）+ https://mobile-hoken.com/blog/9431（ライブアクティビティの一般解説）

### パターン: タイマーと画面点灯維持

事実: 対象5アプリのいずれにも手順に紐づく内蔵タイマーの記述は見つからなかった（タイマーは独立したキッチンタイマーアプリ文化が強い）。画面点灯維持は3方式に分かれる: ①アプリ利用中は常時抑止（Nadia、公式明記）②レシピ表示中に抑止（クックパッド、第三者記事のみ）③専用モード内で抑止（E・レシピ/Tasty、第三者記事）。ユーザー側ではOSの自動ロック設定変更で自衛する記事が多数あり、スリープ問題は依然として現役の不満点。

出典: https://apps.apple.com/jp/app/id973084539 / https://news.mynavi.jp/article/20200912-ipadiphonehacks/ / https://milltalk.jp/boards/73915

### 調査の限界

注意: 本調査はWeb上の公開情報（ストア説明・公式ヘルプ・プレス・第三者レビュー）のみで、実機インストールでの確認はしていない。Zendesk系ヘルプ（cookpad.support / help.delishkitchen.tv / support.kurashiru.com）はCloudflareでfetch不可のため検索スニペット経由。「記述が見つからなかった」は「機能が無い」の証明ではなく、特に復帰導線のような細部はストア説明に書かれない可能性がある。確定させたい項目は実機確認を推奨。

出典: 本調査プロセス
