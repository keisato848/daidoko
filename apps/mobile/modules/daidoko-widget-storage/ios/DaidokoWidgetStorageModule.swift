//
//  DaidokoWidgetStorageModule.swift
//  App Group への書き出しと、ウィジェットの再読み込み（W1-iOS・#238）
//
//  **なぜ自前で持つのか**（docs/ウィジェット設計.md §7）:
//  `@bacons/apple-targets` の ExtensionStorage は autolinking に拾われず
//  Pod に入らなかった（`expo-module.config.json` が旧い `"platforms": ["ios"]`
//  単数表記のため。SDK 54 の autolinking は `"apple"` を期待する）。しかも
//  JS 側がネイティブ不在時に **no-op のスタブへ落ちる**実装なので、例外も
//  ログも出ずに「書けたつもり」になる。ターゲット生成（apple-targets）は
//  実証済みなのでそのまま使い、**書き込みだけをここで持つ**。
//
//  やることは 2 つだけ:
//    - App Group の UserDefaults へ文字列を置く
//    - WidgetCenter に再読み込みを促す（無いとタイムラインの間隔まで反映されない）
//

import ExpoModulesCore
import WidgetKit

public class DaidokoWidgetStorageModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DaidokoWidgetStorage")

    /// App Group の UserDefaults へ文字列を書く。
    /// `suiteName` が entitlement に無いと `UserDefaults(suiteName:)` は nil を返すので、
    /// **黙って成功したことにせず false を返す**（JS 側が警告を出せるように）。
    Function("setString") { (key: String, value: String, appGroup: String) -> Bool in
      guard let defaults = UserDefaults(suiteName: appGroup) else {
        return false
      }
      defaults.set(value, forKey: key)
      return true
    }

    /// 読み戻し。実機・シミュレータでの確認用（本体の動作には要らない）。
    Function("getString") { (key: String, appGroup: String) -> String? in
      UserDefaults(suiteName: appGroup)?.string(forKey: key)
    }

    /// ホーム画面のウィジェットへ再読み込みを促す。
    /// `kind` を渡せばそのウィジェットだけ、無ければ全部。
    Function("reloadWidgets") { (kind: String?) -> Void in
      if let kind, !kind.isEmpty {
        WidgetCenter.shared.reloadTimelines(ofKind: kind)
      } else {
        WidgetCenter.shared.reloadAllTimelines()
      }
    }
  }
}
