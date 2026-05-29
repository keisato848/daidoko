export interface LicenseItem {
  packageName: string;
  purpose: string;
  license: string;
}

export const LICENSE_ITEMS: LicenseItem[] = [
  {
    packageName: 'Expo / Expo SDK',
    purpose: 'React Native アプリ基盤とネイティブモジュール統合',
    license: 'MIT',
  },
  {
    packageName: 'React / React Native',
    purpose: 'UI レンダリングとモバイルアプリ実行基盤',
    license: 'MIT',
  },
  {
    packageName: 'Expo Router',
    purpose: 'ファイルベースの画面遷移',
    license: 'MIT',
  },
  {
    packageName: 'expo-sqlite',
    purpose: '端末内 SQLite データベース',
    license: 'MIT',
  },
  {
    packageName: 'expo-image-picker',
    purpose: 'カメラ撮影と写真ライブラリ選択',
    license: 'MIT',
  },
  {
    packageName: 'expo-image-manipulator',
    purpose: 'OCR / 写真推測前の画像前処理',
    license: 'MIT',
  },
  {
    packageName: 'expo-file-system',
    purpose: 'バックアップファイルと調理写真の端末内保存',
    license: 'MIT',
  },
  {
    packageName: 'Drizzle ORM',
    purpose: '型安全な SQLite 操作',
    license: 'Apache-2.0',
  },
  {
    packageName: 'TanStack Query',
    purpose: 'サーバー状態管理の基盤',
    license: 'MIT',
  },
  {
    packageName: 'React Hook Form',
    purpose: 'レシピ入力フォーム管理',
    license: 'MIT',
  },
  {
    packageName: 'Zod',
    purpose: '入力値と API 型の検証',
    license: 'MIT',
  },
  {
    packageName: 'Lucide React Native',
    purpose: 'アプリアイコン',
    license: 'ISC',
  },
  {
    packageName: 'Zustand',
    purpose: 'クライアント状態管理',
    license: 'MIT',
  },
  {
    packageName: 'Vitest / Jest / Testing Library',
    purpose: '自動テスト',
    license: 'MIT',
  },
];
