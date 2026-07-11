/**
 * だいどこ AI 利用アラートのメール中継（Google Apps Script）
 *
 * サーバー（apps/server/src/lib/usage-alert.ts）からの JSON POST を受け取り、
 * 自分の Gmail から自分宛てにメールを送る。サーバー側に Google の資格情報を
 * 置かないための中継。無料 Gmail の MailApp 送信枠は 100 通/日（本用途は最大
 * 10 通/日なので十分）。
 *
 * セットアップ（5〜10 分・ブラウザのみ）:
 *   1. https://script.new を開く（habnk1227@gmail.com でログインした状態で）
 *   2. このファイルの内容をエディタに貼り付け、TOKEN を長いランダム文字列に変更
 *   3. 右上「デプロイ」→「新しいデプロイ」→ 種類=ウェブアプリ
 *        - 実行ユーザー: 自分
 *        - アクセスできるユーザー: 全員
 *   4. 表示された「ウェブアプリの URL」（…/exec）をコピー
 *   5. 自分のターミナルで Railway に設定:
 *        railway variable set "USAGE_ALERT_WEBHOOK_URL=<URL>" --service daidoko --skip-deploys
 *        railway variable set "USAGE_ALERT_WEBHOOK_TOKEN=<TOKEN と同じ値>" --service daidoko
 *   6. 動作テスト（自分宛てに1通届けばOK）:
 *        curl -s -L -X POST "<URL>" -H "Content-Type: application/json" \
 *          -d '{"token":"<TOKEN>","subject":"テスト","text":"疎通確認"}'
 *
 * スクリプトを修正したら「デプロイ」→「デプロイを管理」→ 編集 → 新バージョン
 * を選んで更新する（URL は変わらない）。
 */

var TOKEN = 'ここを長いランダム文字列に変更してください';
var RECIPIENT = 'habnk1227@gmail.com';

function doPost(e) {
  var out = ContentService.createTextOutput().setMimeType(ContentService.MimeType.JSON);
  try {
    var body = JSON.parse(e.postData.contents);
    if (!TOKEN || body.token !== TOKEN) {
      return out.setContent(JSON.stringify({ ok: false, error: 'unauthorized' }));
    }
    MailApp.sendEmail(RECIPIENT, String(body.subject || 'だいどこ通知'), String(body.text || ''));
    return out.setContent(JSON.stringify({ ok: true }));
  } catch (err) {
    return out.setContent(JSON.stringify({ ok: false, error: String(err) }));
  }
}
