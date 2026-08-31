// @ts-check
const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');
const reactHooks = require('eslint-plugin-react-hooks');

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.expo/**', '**/coverage/**'],
  },
  {
    /**
     * **`scripts/**` は今まで lint も typecheck も無かった。** ここで最低限だけ掛ける。
     *
     * ただし **`no-use-before-define` は 2026-09-01 の TDZ 事故を捕まえない。**
     * 実測した（`docs/品質基準.md` §2.3 の事故）:
     *
     * | 形 | eslint | 実行 |
     * | --- | --- | --- |
     * | 宣言より前に参照（教科書的） | 検出する | 落ちる |
     * | **事故の形**（宣言は関数より前・呼び出しだけが先） | **素通り** | `ReferenceError` |
     *
     * 危ないのは**参照の位置ではなく呼び出しの順序**なので、このルールの守備範囲外。
     * 事故の形を機械で捕まえるのは `scripts/agent/check-script-tdz.mjs`（CI で実行）。
     * ここはその手前の安い網で、**これがあるから安全とは考えないこと。**
     */
    files: ['scripts/**/*.{mjs,js}', 'e2e/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly', fetch: 'readonly' },
    },
    rules: {
      'no-use-before-define': ['error', { functions: false, variables: true, classes: true }],
      'no-undef': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react-hooks': reactHooks,
    },
    rules: {
      // TypeScript strict rules
      ...tseslint.configs['recommended'].rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // React Hooks
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // General
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  /**
   * 移行済みの領域に**日本語を直接書かせない**（`docs/多言語対応設計.md` §9）。
   *
   * 949 件を辞書へ移したあとで 1 件でも直書きが混ざると、その画面だけ
   * 英語版で日本語が出る。目視では気づけないので lint で止める。
   *
   * 意図的に日本語のままにしたい行（DB の過去の値との比較、日本語の見出しを
   * 拾う正規表現など）は `// eslint-disable-next-line no-restricted-syntax` と
   * `// i18n-ignore` を添えて理由を書くこと。
   */
  {
    files: ['apps/mobile/app/**/*.{ts,tsx}', 'apps/mobile/src/**/*.{ts,tsx}'],
    ignores: [
      // 辞書そのもの
      'apps/mobile/src/i18n/**',
      // 日本語そのものを処理するロジック・サンプルデータ（設計 §7・P5）
      'apps/mobile/src/db/seed.ts',
      'apps/mobile/src/e2e/**',
      'apps/mobile/src/constants/licenses.ts',
      // レシートの単位表記（「個」「ｇ」）を在庫の表記へ寄せる対応表。画面の文言ではなく保存値
      'apps/mobile/src/utils/receiptQuantity.ts',
      'apps/mobile/src/utils/recipeTextParser.ts',
      'apps/mobile/src/utils/recipeTextNormalizer.ts',
      'apps/mobile/src/utils/stepTimer.ts',
      'apps/mobile/src/utils/itemMatch.ts',
      'apps/mobile/src/utils/itemName.ts',
      'apps/mobile/src/utils/kana.ts',
      'apps/mobile/src/utils/recipeEmoji.ts',
      'apps/mobile/src/services/recipe-photo-inference.service.ts',
      // AI プロンプト本体。モデルへの指示であって画面には出ない
      'apps/mobile/src/services/vision-recipe.provider.ts',
      'apps/mobile/src/services/recipe-refine.provider.ts',
      'apps/mobile/src/services/recipe-consult.provider.ts',
      'apps/mobile/src/services/meal-vision.provider.ts',
      'apps/mobile/src/services/receipt-vision.provider.ts',
      'apps/mobile/src/services/name-resolve.provider.ts',
      // 紙面読み取りのプロンプト。サーバー `lib/recipe-page.ts` の写し（BYOK はサーバーを通らない）
      'apps/mobile/src/services/recipe-page.provider.ts',
      'apps/mobile/src/services/ai-output-locale.ts',
      // テストは期待値として日本語を書く
      '**/__tests__/**',
      '**/__mocks__/**',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/[\\u3040-\\u309F\\u30A0-\\u30FF\\u4E00-\\u9FFF]/]',
          message:
            '日本語を直接書かないでください。src/i18n/locales/ja に足して t() で引きます（docs/多言語対応設計.md §9）。',
        },
        {
          selector: 'TemplateElement[value.raw=/[\\u3040-\\u309F\\u30A0-\\u30FF\\u4E00-\\u9FFF]/]',
          message:
            '日本語を直接書かないでください。src/i18n/locales/ja に足して t() で引きます（docs/多言語対応設計.md §9）。',
        },
        {
          selector: 'JSXText[value=/[\\u3040-\\u309F\\u30A0-\\u30FF\\u4E00-\\u9FFF]/]',
          message:
            '日本語を直接書かないでください。src/i18n/locales/ja に足して t() で引きます（docs/多言語対応設計.md §9）。',
        },
      ],
    },
  },

  /**
   * **OS 標準のダイアログを出させない**（`docs/画面設計.md` §7）。
   *
   * `Alert.alert` は Android では Material、iOS では `UIAlertController` の見た目で出て、
   * 暗い背景とゴールドの世界観から浮く。67 箇所を自前のダイアログへ移したあとで
   * 1 箇所でも戻ると、その操作だけ OS のダイアログが出る。目視では気づけないので lint で止める。
   */
  {
    files: ['apps/mobile/app/**/*.{ts,tsx}', 'apps/mobile/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['Alert'],
              message:
                'OS 標準のダイアログは使いません。src/services/dialog.service の dialog.alert / confirm / choose を使ってください（docs/画面設計.md §7）。',
            },
          ],
        },
      ],
    },
  },
];
