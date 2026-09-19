//
//  DaidokoWidgetBundle.swift
//  だいどこのウィジェット一式（docs/ウィジェット設計.md §2）
//
//  **1 つの拡張ターゲットに複数のウィジェットを載せるときは、`@main` を
//  個々の `Widget` ではなくこの `WidgetBundle` に付ける。**
//  ターゲットを増やすのではなくバンドルに足す理由（設計 §6）:
//    - 拡張ターゲットが増えると App Group・entitlements・署名の設定が増え、
//      §8 の「静かに壊れる」系の罠（entitlements が空になる等）を踏む面が広がる
//    - 利用者から見ると、ギャラリーには同じ「だいどこ」の下に 2 つ並ぶだけで同じ
//
//  **ウィジェットを足したらここに 1 行足す。** 足し忘れるとビルドは通るのに
//  ギャラリーに出てこない（どこにもエラーが出ないので気づきにくい）。
//

import SwiftUI
import WidgetKit

@main
struct DaidokoWidgetBundle: WidgetBundle {
  var body: some Widget {
    ShoppingWidget()
    MenuWidget()
  }
}
