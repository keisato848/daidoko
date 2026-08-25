# FCM を設定して同期の変更通知を動かす（#207）

> **アプリとサーバーのコードは既に完成している。** 足りないのは FCM の設定だけ。
> 端末が Expo Push トークンを取得できず `sync_devices.expo_push_token` が NULL のまま、
> という状態を解消する作業。

## 費用

**かからない。**

| 使うもの                       | 料金                                         |
| ------------------------------ | -------------------------------------------- |
| Firebase プロジェクト（Spark） | ¥0                                           |
| **FCM（Cloud Messaging）**     | **¥0・無制限**（Google は FCM に課金しない） |
| Expo Push サービス             | ¥0                                           |

課金が起きうるのは Firestore / Functions / Storage を**有効にしたとき**だけ。
**この作業では Cloud Messaging しか使わない。** 請求先を紐づけなければ課金され得ない。

## やらないこと（意図的）

**Google Analytics for Firebase の SDK は入れない。**
入れるとアプリが解析データを収集するようになり、**Play のデータセーフティと
App Store の App Privacy を書き換える必要が出る**（2026-08 に審査を通したばかり）。
申告と実装が食い違うと公開が止まる。

**AdMob ↔ Firebase の連携もしない**（2026-08-26 ユーザー決定）。
連携自体は無料で無害だが、**SDK を入れるまで見えるものがほとんど増えない**ので、
いま繋いでも得るものが無い。必要になったら Analytics SDK の導入と一緒にやる。

つまりこの作業で触るのは **Cloud Messaging だけ**。AdMob には一切触らない。

## 秘密の置き場所

`google-services.json` は **API キーを含むのでリポジトリに入れない**（2026-08-26 ユーザー決定）。
既存の秘密と同じ `C:/secure/` に置く。`app.json` からは絶対パスで参照する。

## 手順

> **ブラウザ操作セッションへの依頼文は `docs/browser-tasks-firebase.md` にある。**
> 手順 1〜3（コンソール作業）はそちらを渡せばよい。

### 1. Firebase プロジェクトを作る（利用者・ブラウザ）

1. https://console.firebase.google.com/ → プロジェクトを追加
2. 名前は何でもよい（例: `daidoko`）
3. **Google アナリティクスは「有効にしない」**（上の「やらないこと」）

### 2. Android アプリを登録して `google-services.json` を取る（利用者・ブラウザ）

1. プロジェクト概要 → Android アイコン
2. **パッケージ名: `com.daidoko.app`**（一字でも違うと通知が届かない）
3. SHA-1 は**この時点では不要**（FCM だけなら要らない）
4. `google-services.json` をダウンロードし、**`C:/secure/google-services.json`** に置く

### 3. app.json に配線する（こちらで実施）

```json
"android": { "googleServicesFile": "C:/secure/google-services.json", ... }
```

**config plugin の変更なので `--prebuild` が必須。** ローカル検証ビルドも EAS ビルドも作り直す。

### 4. EAS に FCM v1 の資格情報を登録する（利用者・1 回だけ）

FCM へ実際に送るのは **Expo Push** で、だいどこのサーバーは `exp.host` へ投げるだけ
（`apps/server/src/routes/sync.ts`）。だから鍵の置き場所は **EAS であって Railway ではない。**
**`eas credentials` は TTY が要るので利用者の端末で実行する。**

```powershell
cd C:\Projects\daidoko\apps\mobile
pnpm exec eas credentials -p android
# → production → 「Google Service Account」→「Manage your Google Service Account Key for
#    Push Notifications (FCM V1)」→ 新しい鍵をアップロード
```

鍵は Firebase コンソールの
**プロジェクトの設定 → サービス アカウント → 新しい秘密鍵を生成** で作る JSON。
**これもリポジトリに入れない**（`C:/secure/` へ）。

expo.dev の Credentials 画面からアップロードする道もあるが、**秘密鍵のアップロードは
ブラウザ操作セッションに代行させない**（`console-browser-ops` §1）。どちらの経路でも利用者の手で行う。

### 5. 確認（こちらで実施）

1. `--prebuild` 付きでビルドし、実機へ
2. `adb logcat | grep FirebaseApp` に
   `Default FirebaseApp failed to initialize` が**出ないこと**
3. 家族グループに参加した状態で、サーバーの `sync_devices.expo_push_token` が
   **NULL でなくなること**
4. 別端末でレシピを変更 → **通知が届くこと**（サーバーはグループ単位で 5 分デバウンス・
   文面は固定＝中身を持たない。§0-2 の通り名前もデータも載せない）

## 落とし穴

- **パッケージ名の打ち間違い**で `google-services.json` が別アプリのものになると、
  ビルドは通るのに通知だけ来ない（原因が JS 側に見える）
- `--prebuild` を忘れると `google-services.json` が `android/` に取り込まれない
- エミュレータは **Google Play イメージ**でないと FCM が動かない
- 通知の許可は在庫のしきい値設定でしか求めていない（`pantry.tsx`）。
  同期の通知を試すには、先に許可を出しておく必要がある
