/**
 * 家族共有の招待リンク受け皿 `/j/:code`（docs/クラウド同期設計.md §2-2b）。
 * アプリが入っていればここには来ない（App Links）。来たときの表示は lib/invite-page.ts。
 */
import { Hono } from 'hono';

import { parseInvitePathCode, pickInviteLocale, renderInvitePage } from '../lib/invite-page.js';
import { renderNotFoundPage, storeUrlForUserAgent } from '../lib/share-page.js';

const invitePageRouter = new Hono();

invitePageRouter.get('/:code', (c) => {
  c.header('X-Robots-Tag', 'noindex');
  const code = parseInvitePathCode(c.req.param('code'));
  if (!code) return c.html(renderNotFoundPage(), 404);
  return c.html(
    renderInvitePage(
      code,
      pickInviteLocale(c.req.header('accept-language')),
      storeUrlForUserAgent(c.req.header('user-agent')),
    ),
  );
});

export { invitePageRouter };
