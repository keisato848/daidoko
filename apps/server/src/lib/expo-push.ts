/**
 * Expo のプッシュトークンの書式。**これ以外は保存も送信もしない** — 任意の文字列を
 * `to` に入れて Expo へ投げると、他人のトークンや不正な宛先を中継できてしまう（sync と共用）
 */
export const EXPO_PUSH_TOKEN_PATTERN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;

export interface ExpoPushMessage {
  to: string;
  /** 題名と本文。**両方とも無い push は「見えない通知」**（data だけ）で、端末の背景タスクを起こす */
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  /** iOS で背景タスクを起こすための印（Expo が `content-available: 1` に直す） */
  _contentAvailable?: boolean;
  channelId?: string;
  priority?: string;
}

export interface ExpoPushResult {
  deadTokens: string[]; // DeviceNotRegistered だったトークン
}

export async function sendExpoPush(messages: ExpoPushMessage[]): Promise<ExpoPushResult> {
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });

  // 届かないトークンは消す（#207）。応答の tickets は送った順に並ぶ
  const body = (await res.json().catch(() => null)) as {
    data?: { status?: string; details?: { error?: string } }[];
  } | null;

  const deadTokens = (body?.data ?? [])
    .map((ticket, index) =>
      ticket?.status === 'error' && ticket.details?.error === 'DeviceNotRegistered'
        ? messages[index]?.to
        : undefined,
    )
    .filter((token): token is string => typeof token === 'string');

  return { deadTokens };
}
