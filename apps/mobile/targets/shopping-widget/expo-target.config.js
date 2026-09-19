/**
 * だいどこのウィジェット拡張（`docs/ウィジェット設計.md` §2）のターゲット定義。
 *
 * **このターゲットは 2 つのウィジェットを載せている**（買い物リスト W1-iOS ＋ 献立 W2-iOS）。
 * エントリポイントは `DaidokoWidgetBundle.swift` の `@main` だけで、
 * 個々の `Widget` には `@main` を付けない。**ウィジェットを足すときも
 * ターゲットは増やさずバンドルに足す**（拡張が増えるほど App Group・entitlements・
 * 署名まわりで §8 の「静かに壊れる」罠を踏む面が広がるため）。
 *
 * `name` は Xcode のターゲット名なので変えない（`ios/` の生成物・ディレクトリ名と結び付く）。
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
  // 拡張そのものの表示名。**ギャラリーに並ぶ個々の名前は各 Widget の
  // `configurationDisplayName`**（「買い物リスト」「献立」）なので、ここはアプリ名にする。
  // 2 つ載せた時点で「買い物リスト」は実態と合わなくなった。
  displayName: 'だいどこ',
  // 本体と同じ下限に合わせる（app.json の ios.deploymentTarget 相当）
  deploymentTarget: '16.0',
  entitlements: {},
};
