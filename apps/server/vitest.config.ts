import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // better-sqlite3（ネイティブモジュール）は vitest 既定の worker threads と
    // 相性が悪く、Linux CI で segfault する。プロセス分離（forks）なら安全。
    pool: 'forks',
  },
});
