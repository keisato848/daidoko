/**
 * 家族共有の招待リンク `https://<server>/j/:code` が**ブラウザで開かれたとき**の受け皿
 * （docs/クラウド同期設計.md §2-2b）。
 *
 * 本命は App Links / Universal Links でアプリが直接開くこと（#198 と同じ仕組み）。
 * このページに来るのは
 *   - アプリ未インストール（→ ストアへ）
 *   - App Links の検証ファイルが未設定・未検証で、OS がブラウザに渡した（→ `daidoko://` で開き直す）
 * の 2 通り。招待コードはリンク自体に入っているので、ページ上にも出して手入力の逃げ道を残す。
 *
 * - サーバー側でコードの実在は確かめない（DB を引くと「有効なコードか」を総当たりで
 *   探れる面になる。参加時に `POST /sync/groups/join` が判定するので十分）
 * - noindex・OGP なし（プレビューにコードを載せない）
 */
import { INVITE_ALPHABET, INVITE_CODE_LENGTH, normalizeInviteCode } from './sync-auth.js';
import { PAGE_CSS, escapeHtml } from './share-page.js';

const CODE_PATTERN = new RegExp(`^[${INVITE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`);

/** 招待コードとして形が正しければ正規化して返す。違えば null */
export function parseInvitePathCode(raw: string): string | null {
  const code = normalizeInviteCode(raw);
  return CODE_PATTERN.test(code) ? code : null;
}

/** Accept-Language の先頭が en なら en。他は日本語（既定） */
export function pickInviteLocale(acceptLanguage: string | undefined): 'ja' | 'en' {
  return /^\s*en\b/i.test(acceptLanguage ?? '') ? 'en' : 'ja';
}

const STRINGS = {
  ja: {
    title: '家族共有への招待',
    lead: 'だいどこアプリでこのリンクを開くと、家族の共有グループに参加できます。',
    codeLabel: '招待コード（24時間有効）',
    openApp: 'アプリで開く',
    install: 'アプリをインストール',
    manual: 'アプリの「家族グループ」でこのコードを直接入力しても参加できます。',
    footer:
      '心当たりのない招待は開かないでください。参加するとレシピ・買い物リスト・在庫がグループの端末と共有されます。',
  },
  en: {
    title: 'Invitation to family sharing',
    lead: 'Open this link with the DAIDOKO app to join the family share group.',
    codeLabel: 'Invite code (valid for 24h)',
    openApp: 'Open in the app',
    install: 'Install the app',
    manual: 'You can also type this code under “Family group” in the app.',
    footer:
      'Do not open invitations you were not expecting. Joining shares recipes, the shopping list and the pantry with the group’s devices.',
  },
} as const;

export function renderInvitePage(code: string, locale: 'ja' | 'en', storeUrl: string): string {
  const s = STRINGS[locale];
  const safeCode = escapeHtml(code);
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${s.title} | DAIDOKO</title>
<style>${PAGE_CSS}
  .invite-code { font-family: Georgia, 'Times New Roman', serif; font-size: 34px; letter-spacing: 0.3em;
                 color: #F0E2C8; text-align: center; padding: 18px 0; margin: 8px 0 4px;
                 border: 1px solid #2E2418; border-radius: 12px; background: #17120C; }
  .cta.secondary { background: transparent; color: #C9A16A; border: 1px solid #C9A16A; margin-top: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">DAIDOKO</div>
  <h1>${s.title}</h1>
  <p>${s.lead}</p>
  <h2>${s.codeLabel}</h2>
  <div class="invite-code">${safeCode}</div>
  <a class="cta" href="daidoko://j/${safeCode}">${s.openApp}</a>
  <a class="cta secondary" href="${escapeHtml(storeUrl)}">${s.install}</a>
  <p class="cta-sub">${s.manual}</p>
  <p class="footer">${s.footer}</p>
</div>
</body>
</html>`;
}
