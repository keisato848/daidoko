/**
 * 買い物リストウィジェット（W1-iOS・`docs/ウィジェット設計.md` §2）のターゲット定義。
 *
 * `@bacons/apple-targets` はこのファイルを見て Xcode のターゲットを生やす。
 * **`ios/` は生成物**なので、ここと `*.swift` を直すのが正しい（README「Development」）。
 *
 * **`entitlements` は空でも書く必要がある。** README には
 * 「App Group を使えるターゲットは app.json の配列を自動で写す」とあるが、
 * `entitlements` オブジェクト自体が無いと `generated.entitlements` が
 * 書き出されず、拡張が App Group を読めない（実測。本体側にだけ入って
 * ウィジェット側が空になる）。中身は書かない — プラグインが app.json の
 * `ios.entitlements['com.apple.security.application-groups']` を写す。
 * 値をここにも書くと、片方だけ直したときに静かに食い違う。
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: 'widget',
  name: 'ShoppingWidget',
  // ウィジェットギャラリーに出る名前。ここは Android の label と揃える
  displayName: '買い物リスト',
  // 本体と同じ下限に合わせる（app.json の ios.deploymentTarget 相当）
  deploymentTarget: '16.0',
  entitlements: {},
};
