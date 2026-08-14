/**
 * 公開している法務文書の URL。
 *
 * **ストアに登録している値と一致させること。** ズレるとユーザーが読む文書と
 * ストアが提示する文書が食い違い、審査でも指摘され得る。
 * - プライバシーポリシー … App Store Connect の「App のプライバシーポリシー URL」／
 *   Play Console のストア掲載に登録済みの gist と同じもの
 * - 利用規約 … 独自の EULA を用意していないので **Apple 標準 EULA**。
 *   App Store Connect でも既定でこれが適用される（`ビジネス` → 使用許諾契約 =
 *   「Apple の標準使用許諾契約」）。独自 EULA に切り替えるならここも差し替える。
 *
 * 自動更新サブスクの画面にこの 2 つへの**機能するリンク**を置くことは
 * App Store の審査ガイドライン 3.1.2 の要求事項。
 */

export const PRIVACY_POLICY_URL =
  'https://gist.github.com/keisato848/49fb9a73f3a1c9952548388f288c383c';

export const EULA_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
