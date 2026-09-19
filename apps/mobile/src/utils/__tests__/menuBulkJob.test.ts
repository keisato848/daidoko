import {
  MENU_BULK_PENDING_TTL_MS,
  assignGeneratedToSlots,
  bulkJobParts,
  decideJobTransition,
  emptySlotCountsByKind,
  parsePendingMenuBulkJob,
  parsePendingMenuBulkResult,
} from '../menuBulkJob';

/**
 * 一括生成の非同期ジョブ（R34）と枠つき生成（PR-5b）の判断。
 * サービス層は jest で実行できないので、守るべき規則は全部ここで固定する。
 */
const DEFS = [
  { slotId: 'main', slotKind: 'main' },
  { slotId: 'soup', slotKind: 'soup' },
  { slotId: 'side', slotKind: 'side' },
  { slotId: 'side-2', slotKind: 'side' },
];

describe('emptySlotCountsByKind — 頼む品数', () => {
  it('種類ごとに、空いている (day, 枠) を数える。同じ種類の 2 枠は足す', () => {
    expect(
      emptySlotCountsByKind({
        totalDays: 2,
        slotDefs: DEFS,
        existingSlots: [{ day: 1, slotId: 'soup' }],
      }),
    ).toEqual({ soup: 1, side: 4 });
  });

  it('主菜と、手入力専用（autoFill:false）の枠は数えない', () => {
    expect(
      emptySlotCountsByKind({
        totalDays: 3,
        slotDefs: [
          { slotId: 'main', slotKind: 'main' },
          { slotId: 'soup', slotKind: 'soup', autoFill: false },
        ],
        existingSlots: [],
      }),
    ).toEqual({});
  });

  it('主菜 1 枠の設定では何も頼まない（既存利用者の一括生成は従来と同じ）', () => {
    expect(
      emptySlotCountsByKind({
        totalDays: 7,
        slotDefs: [{ slotId: 'main', slotKind: 'main' }],
        existingSlots: [],
      }),
    ).toEqual({});
  });
});

describe('bulkJobParts — サーバーへ頼む part', () => {
  const base = { existingTitles: ['肉じゃが'], pantry: ['豆腐'] };

  it('主菜（不足日数ぶん）＋ 空きのある種類ごとに 1 part', () => {
    const parts = bulkJobParts({
      shortfallDays: 2,
      emptyCountsByKind: { soup: 3, side: 5 },
      slotDefs: DEFS,
      baseRequest: base,
      mainTitles: ['唐揚げ'],
    });
    expect(parts.map((p) => [p.key, p.request.days])).toEqual([
      ['main', 2],
      ['soup', 3],
      ['side', 5],
    ]);
  });

  it('**主菜の part には slotKind も mainTitles も付けない**（旧サーバーと同じ要求の形）', () => {
    const [main, soup] = bulkJobParts({
      shortfallDays: 1,
      emptyCountsByKind: { soup: 1 },
      slotDefs: DEFS,
      baseRequest: base,
      mainTitles: ['唐揚げ'],
    });
    expect(main?.request).toEqual({ ...base, days: 1 });
    expect(soup?.request).toEqual({ ...base, days: 1, slotKind: 'soup', mainTitles: ['唐揚げ'] });
  });

  it('主菜が足りていれば主菜の part は作らない（副菜以降だけ頼める）', () => {
    const parts = bulkJobParts({
      shortfallDays: 0,
      emptyCountsByKind: { soup: 2 },
      slotDefs: DEFS,
      baseRequest: base,
      mainTitles: [],
    });
    expect(parts.map((p) => p.key)).toEqual(['soup']);
    expect(parts[0]?.request).not.toHaveProperty('mainTitles'); // 空なら付けない
  });

  it('1 part は 7 品まで', () => {
    const parts = bulkJobParts({
      shortfallDays: 9,
      emptyCountsByKind: { side: 14 },
      slotDefs: DEFS,
      baseRequest: base,
      mainTitles: [],
    });
    expect(parts.map((p) => p.request.days)).toEqual([7, 7]);
  });

  it('全体で 4 part まで。超えた種類は定義順で後ろを落とす', () => {
    const parts = bulkJobParts({
      shortfallDays: 1,
      emptyCountsByKind: { soup: 1, side: 1, salad: 1, dessert: 1 },
      slotDefs: [
        ...DEFS,
        { slotId: 'salad', slotKind: 'salad' },
        { slotId: 'dessert', slotKind: 'dessert' },
      ],
      baseRequest: base,
      mainTitles: [],
    });
    expect(parts.map((p) => p.key)).toEqual(['main', 'soup', 'side', 'salad']);
  });

  it('空きの無い種類・手入力専用の種類は頼まない', () => {
    const parts = bulkJobParts({
      shortfallDays: 0,
      emptyCountsByKind: { soup: 0, side: 2 },
      slotDefs: [
        { slotId: 'soup', slotKind: 'soup' },
        { slotId: 'side', slotKind: 'side', autoFill: false },
      ],
      baseRequest: base,
      mainTitles: [],
    });
    expect(parts).toEqual([]);
  });
});

describe('assignGeneratedToSlots — 保存した新レシピを枠へ', () => {
  const created = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      recipeId: `${prefix}${i + 1}`,
      title: `${prefix}${i + 1}`,
    }));

  it('日番号順に 1 品ずつ。同じ種類の 2 枠にも順に配る', () => {
    const rows = assignGeneratedToSlots({
      totalDays: 2,
      slotDefs: DEFS,
      existingSlots: [],
      createdByKind: { soup: created('汁', 2), side: created('副', 3) },
    });
    expect(rows.map((r) => [r.day, r.slotId, r.recipeId])).toEqual([
      [1, 'soup', '汁1'],
      [1, 'side', '副1'],
      [1, 'side-2', '副2'],
      [2, 'soup', '汁2'],
      [2, 'side', '副3'],
    ]);
  });

  it('**既に入っている枠は触らない**（提案を見ている間に手で入れた料理を上書きしない）', () => {
    const rows = assignGeneratedToSlots({
      totalDays: 2,
      slotDefs: [
        { slotId: 'main', slotKind: 'main' },
        { slotId: 'soup', slotKind: 'soup' },
      ],
      existingSlots: [{ day: 1, slotId: 'soup' }],
      createdByKind: { soup: created('汁', 2) },
    });
    expect(rows.map((r) => [r.day, r.recipeId])).toEqual([[2, '汁1']]);
  });

  it('**reason は空文字にしない**（空文字は手入力の印 — 次の「組む」で引き継がれてしまう）', () => {
    const rows = assignGeneratedToSlots({
      totalDays: 1,
      slotDefs: DEFS,
      existingSlots: [],
      createdByKind: { soup: created('汁', 1) },
    });
    expect(rows[0]?.reason).toBe('ai-new:');
    expect(rows[0]?.doneAt).toBeNull();
  });

  it('主菜・手入力専用の枠には入れない。主菜として渡された物も枠へ回さない', () => {
    const rows = assignGeneratedToSlots({
      totalDays: 1,
      slotDefs: [
        { slotId: 'main', slotKind: 'main' },
        { slotId: 'soup', slotKind: 'soup', autoFill: false },
      ],
      existingSlots: [],
      createdByKind: { main: created('主', 1), soup: created('汁', 1) },
    });
    expect(rows).toEqual([]);
  });
});

describe('parsePendingMenuBulkJob — 投入の控え', () => {
  const NOW = Date.parse('2026-09-19T12:00:00.000Z');
  const job = {
    jobId: 'job-1',
    mealTime: 'dinner',
    submittedAt: '2026-09-19T11:00:00.000Z',
    hasPushToken: true,
  };

  it('往復できる', () => {
    expect(parsePendingMenuBulkJob(JSON.stringify(job), NOW)).toEqual(job);
  });

  it('空文字（消した印）・壊れた JSON・形の違う値は null', () => {
    for (const raw of ['', '{', '[]', '"x"', JSON.stringify({ ...job, jobId: '' })]) {
      expect(parsePendingMenuBulkJob(raw, NOW)).toBeNull();
    }
    expect(parsePendingMenuBulkJob(null, NOW)).toBeNull();
    expect(parsePendingMenuBulkJob(JSON.stringify({ ...job, mealTime: 'brunch' }), NOW)).toBeNull();
  });

  it('**古すぎる控えは捨てる**（「生成中」を永久に出し続けない）', () => {
    const old = { ...job, submittedAt: new Date(NOW - MENU_BULK_PENDING_TTL_MS - 1).toISOString() };
    expect(parsePendingMenuBulkJob(JSON.stringify(old), NOW)).toBeNull();
    const fresh = {
      ...job,
      submittedAt: new Date(NOW - MENU_BULK_PENDING_TTL_MS + 1000).toISOString(),
    };
    expect(parsePendingMenuBulkJob(JSON.stringify(fresh), NOW)).not.toBeNull();
  });

  it('hasPushToken は true のときだけ真（欠けていたら「通知なし」側に倒す）', () => {
    const rest = { jobId: job.jobId, mealTime: job.mealTime, submittedAt: job.submittedAt };
    expect(parsePendingMenuBulkJob(JSON.stringify(rest), NOW)?.hasPushToken).toBe(false);
  });
});

describe('parsePendingMenuBulkResult — 受け取った結果', () => {
  it('入れ物の形だけ見る。壊れた part は落とす', () => {
    const raw = JSON.stringify({
      mealTime: 'lunch',
      parts: [{ key: 'main', drafts: [{ title: 'A' }] }, { key: 1, drafts: [] }, 'x'],
      failedKinds: ['soup', 3],
    });
    expect(parsePendingMenuBulkResult(raw)).toEqual({
      mealTime: 'lunch',
      parts: [{ key: 'main', drafts: [{ title: 'A' }] }],
      failedKinds: ['soup'],
    });
  });

  it('空文字・壊れた値は null', () => {
    for (const raw of [null, '', '{', JSON.stringify({ mealTime: 'dinner' })]) {
      expect(parsePendingMenuBulkResult(raw)).toBeNull();
    }
  });
});

describe('decideJobTransition — サーバーの返事 → 次の一手', () => {
  it('まだ・通信できない → 控えを残す（次の機会にもう一度聞く）', () => {
    expect(decideJobTransition({ kind: 'pending' })).toEqual({ action: 'keep' });
    expect(decideJobTransition({ kind: 'unreachable' })).toEqual({ action: 'keep' });
  });

  it('404 → 控えを消す（消さないと「生成中」が永久に出る）', () => {
    expect(decideJobTransition({ kind: 'gone' })).toEqual({ action: 'expire' });
  });

  it('failed → 失敗として閉じる', () => {
    expect(decideJobTransition({ kind: 'failed', retryable: false })).toEqual({
      action: 'fail',
      retryable: false,
    });
  });

  it('done → 成功した part を保存し、作れなかった種類を控える', () => {
    expect(
      decideJobTransition({
        kind: 'done',
        parts: [
          { key: 'main', ok: true, recipes: ['a', 'b'] },
          { key: 'soup', ok: false },
        ],
      }),
    ).toEqual({
      action: 'store',
      result: { parts: [{ key: 'main', drafts: ['a', 'b'] }], failedKinds: ['soup'] },
    });
  });

  it('done でも中身が空なら失敗（空の提案シートを開かない）。0 品の part は作れなかった側', () => {
    expect(
      decideJobTransition({ kind: 'done', parts: [{ key: 'main', ok: true, recipes: [] }] }),
    ).toEqual({ action: 'fail', retryable: true });
    expect(
      decideJobTransition({
        kind: 'done',
        parts: [
          { key: 'main', ok: true, recipes: ['a'] },
          { key: 'side', ok: true, recipes: [] },
        ],
      }),
    ).toMatchObject({ action: 'store', result: { failedKinds: ['side'] } });
  });
});
