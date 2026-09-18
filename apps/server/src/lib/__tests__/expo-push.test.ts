import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendExpoPush } from '../expo-push.js';

describe('sendExpoPush', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends push notifications successfully', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        data: [{ status: 'ok' }, { status: 'ok' }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const messages = [
      { to: 'ExpoPushToken[1]', title: 'T1', body: 'B1' },
      { to: 'ExpoPushToken[2]', title: 'T2', body: 'B2', data: { type: 'sync' } },
    ];

    const result = await sendExpoPush(messages);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
    expect(result.deadTokens).toEqual([]);
  });

  it('identifies DeviceNotRegistered tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        data: [
          { status: 'ok' },
          { status: 'error', details: { error: 'DeviceNotRegistered' } },
          { status: 'error', details: { error: 'MessageTooBig' } },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const messages = [
      { to: 'Token1', title: 'T', body: 'B' },
      { to: 'Token2', title: 'T', body: 'B' }, // This one is dead
      { to: 'Token3', title: 'T', body: 'B' }, // This has another error
    ];

    const result = await sendExpoPush(messages);
    expect(result.deadTokens).toEqual(['Token2']);
  });

  it('通信エラーはそのまま投げる（ベストエフォートで握るのは呼び出し元 notifyGroupDevices の役目）', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', fetchMock);

    const messages = [{ to: 'Token1', title: 'T', body: 'B' }];
    await expect(sendExpoPush(messages)).rejects.toThrow('Network error');
  });

  it('handles non-JSON response gracefully', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
    });
    vi.stubGlobal('fetch', fetchMock);

    const messages = [{ to: 'Token1', title: 'T', body: 'B' }];
    const result = await sendExpoPush(messages);
    expect(result.deadTokens).toEqual([]);
  });
});
