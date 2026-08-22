import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // better-sqlite3（ネイティブモジュール）は vitest 既定の worker threads と
    // 相性が悪く、Linux CI で segfault する。プロセス分離（forks）なら安全。
    pool: 'forks',
    // 実 PostgreSQL のテストは、全ファイル並列で CPU が詰まると 1 往復 1 秒を超える。
    // 既定の 5 秒だと **単体では通るのに全体では落ちる**（docs/品質基準.md §2.3）
    testTimeout: 20_000,
  },
});
