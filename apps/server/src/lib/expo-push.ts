export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
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
