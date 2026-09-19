//
//  MenuWidget.swift
//  献立ウィジェット（W2-iOS・docs/ウィジェット設計.md §2 / §10）
//
//  **アプリの DB は読まない。** App Group の UserDefaults に、アプリが書き出した
//  スナップショット JSON（キー `widget_snapshot`）が 1 本だけ入っている。
//  契約は apps/mobile/src/utils/widgetSnapshot.ts の WidgetSnapshot（version 1）。
//
//  表示規約は Android 版（src/widgets/MenuWidget.tsx / menuWidgetContent.ts）と同じ:
//    小 = 今日の一品 ＋ 副菜 2 件
//    中 = 今日の一品 ＋ 副菜 4 件（**iOS は横長なので 2 列に割る**・§8-5）
//    大 = 週間一覧（7 日）＋ 各日の副菜
//    特大 = 大と同じ（**iPad 専用**。だいどこは iPhone 専用なので実際には出ない・§11-2）
//    どれも「HH:mm 時点」を必ず出す（古い表示だと利用者に分かるように）
//    文言は snapshot.locale で ja/en を描き分ける（ウィジェットはアプリの i18n を読めない）
//
//  **文言は menuWidgetContent.ts の MENU_DICT と 1 字ずつ揃えてある。**
//  片方だけ直すと、同じアプリが OS で違う顔になる。
//

import SwiftUI
import WidgetKit

// MARK: - 契約

// **ShoppingWidget.swift と同じ値を持つ。** どちらも file-private なので共有していない
// （動いているウィジェットに触る改変を避けた）。**片方を変えたら必ずもう片方も変えること。**
// 大元は app.json の `ios.entitlements['com.apple.security.application-groups']`。
private let appGroupIdentifier = "group.com.daidoko.app"
private let snapshotKey = "widget_snapshot"
private let supportedSnapshotVersion = 1

/// 1 日に出す主菜以外の枠の上限。JS 側 `WIDGET_MENU_SIDES_MAX` と揃える。
private let menuSidesMax = 4

/// 週の各日の副菜（週間一覧で描く）。`WidgetMenuWeekDay['sides']` に対応。
private struct WeekDaySide: Decodable {
  let label: String
  let title: String
}

/// 週間表示の 1 日分。`WidgetMenuWeekDay` に対応。
private struct MenuWeekDay: Decodable {
  let title: String?
  let recipeId: String?
  let doneAt: String?
  let isToday: Bool
  let sides: [WeekDaySide]?
}

/// 今日（または次）の日の、主菜以外の枠。`WidgetMenuSide` に対応。
private struct MenuSide: Decodable {
  let label: String
  let title: String
  let recipeId: String?
  let doneAt: String?
}

/// 献立の中身。JS 側の `WidgetSnapshot['menu']` に対応。
/// **省略可フィールドは必ず Optional で持つ**（旧アプリが書いた JSON も読めるように・§1）。
private struct MenuSection: Decodable {
  let kind: String?
  let title: String?
  let recipeId: String?
  let week: [MenuWeekDay]?
  let requestedDays: Int?
  let mealTime: String?
  let sides: [MenuSide]?
}

/// アプリが書き出すスナップショット。`shopping` は献立ウィジェットでは読まないので持たない
/// （増えたフィールドを知らなくても壊れないよう、Decodable は部分一致でよい）。
private struct MenuWidgetSnapshot: Decodable {
  let version: Int
  let writtenAt: String
  let locale: String
  let menu: MenuSection
}

// MARK: - 文言

/// **menuWidgetContent.ts の MENU_DICT と同じ文言**に揃える。
private struct MenuDictionary {
  let today: String
  let next: String
  let week: String
  let asOf: (String) -> String
  let undecided: String
  let noMenu: String
  let noSnapshot: String
  let shortfall: (Int) -> String
  let otherSides: (Int) -> String
  /// 朝/昼のときだけ見出しに付ける印。**夕は無印**（snapshot に mealTime が無い = 夕）
  let mealSuffix: (String) -> String

  static let ja = MenuDictionary(
    today: "今日の一品",
    next: "次の一品",
    week: "今週の献立",
    asOf: { "\($0) 時点" },
    undecided: "未定",
    noMenu: "献立はまだありません",
    noSnapshot: "アプリを開くと表示されます",
    shortfall: { "残り\($0)日分はレシピが足りません" },
    otherSides: { "ほか\($0)品" },
    mealSuffix: { meal in
      switch meal {
      case "breakfast": return "（朝）"
      case "lunch": return "（昼）"
      default: return ""
      }
    }
  )

  static let en = MenuDictionary(
    today: "Today's dish",
    next: "Next dish",
    week: "This week",
    asOf: { "as of \($0)" },
    undecided: "TBD",
    noMenu: "No menu yet",
    noSnapshot: "Open the app to see your menu",
    shortfall: { $0 == 1 ? "Not enough recipes for 1 more day"
      : "Not enough recipes for \($0) more days" },
    otherSides: { "+\($0) more" },
    mealSuffix: { meal in
      switch meal {
      case "breakfast": return " (breakfast)"
      case "lunch": return " (lunch)"
      default: return ""
      }
    }
  )

  static func of(_ locale: String) -> MenuDictionary {
    locale == "en" ? .en : .ja
  }
}

// MARK: - 遷移先

/// タップ先のスキーム。Android 版（menuWidgetContent.ts の MENU_URI / recipeUri）と同じ。
private let menuURI = "daidoko://menu"
private func recipeURI(_ recipeId: String) -> String {
  "daidoko://recipes/\(recipeId)"
}

// MARK: - 表示内容の組み立て

/// 週間一覧の 1 行。`MenuWidgetWeekRow` に対応。
private struct MenuWeekRow: Identifiable {
  let id = UUID()
  let label: String
  let isToday: Bool
  let isDone: Bool
  let isUndecided: Bool
  let uri: String
  /// 「汁物 味噌汁・副菜 冷奴」のように連結済み。週間一覧以外・副菜が無い日は nil
  let sidesText: String?
}

/// 小/中で出す副菜の 1 行。
private struct MenuSideRow: Identifiable {
  let id = UUID()
  let text: String
  let uri: String
  let isDone: Bool
}

/// 画面に出すもの。組み立てを View から分けておくと、描画に触らず値を追える。
private struct MenuContent {
  /// 週間一覧（大・特大）か、今日の一品（小・中）か
  let isWeek: Bool
  let heading: String
  /// 今日の一品の料理名。無ければ nil
  let dishName: String?
  let sides: [MenuSideRow]
  /// 「ほか◯品」。溢れたときだけ
  let sidesOverflowText: String?
  let rows: [MenuWeekRow]
  /// 「残り◯日分はレシピが足りません」。満ちていれば nil
  let shortfallMessage: String?
  /// 案内 1 行（未取得・献立なし）。無ければ nil
  let emptyMessage: String?
  /// 「HH:mm 時点」。スナップショットが無いときだけ nil
  let timeLabel: String?
  /// ウィジェット全体のタップ先
  let uri: String
}

/// ISO8601 の writtenAt を端末のローカル時刻で "HH:mm" にする。
/// JS 側 `formatSnapshotTime` と同じ結果になるようにする。
private func formatMenuSnapshotTime(_ writtenAt: String) -> String? {
  let withFractional = ISO8601DateFormatter()
  withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  let plain = ISO8601DateFormatter()
  plain.formatOptions = [.withInternetDateTime]

  guard let date = withFractional.date(from: writtenAt) ?? plain.date(from: writtenAt) else {
    return nil
  }
  let formatter = DateFormatter()
  formatter.dateFormat = "HH:mm"
  formatter.locale = Locale(identifier: "en_US_POSIX")
  return formatter.string(from: date)
}

/// 週間一覧を出すサイズか。
///
/// **`.systemExtraLarge` は iPad にしか無い**（iPhone のギャラリーには出ない）。
/// 設計どおり「副菜まで各日に出す」のは特大だけなので、iPhone では
/// 週間一覧に副菜が出ない。これは端末の制約であって出し分けの手抜きではない。
private func isWeekFamily(_ family: WidgetFamily) -> Bool {
  if #available(iOS 15.0, *), family == .systemExtraLarge { return true }
  return family == .systemLarge
}

/// 週間一覧の各行に副菜まで出すか。
///
/// **Android は「特大」だけで出すが、iOS は `systemLarge` でも出す。**
/// `.systemExtraLarge` は iPad 専用で、**だいどこは iPhone 専用で出荷している**ため
/// （`app.json` の `ios.supportsTablet: false` / `TARGETED_DEVICE_FAMILY = 1`）、
/// 特大に寄せると**どの端末でも副菜が見えない死んだ枝**になる。
/// iPhone の最大サイズに出すことで初めて利用者の目に入る（設計 §11-2・利用者判断 2026-09-19）。
private func showsWeekSides(_ family: WidgetFamily) -> Bool {
  if #available(iOS 15.0, *), family == .systemExtraLarge { return true }
  return family == .systemLarge
}

/// スナップショットから表示内容を組む。**Android の `buildMenuWidgetContent` と同じ判断**。
private func buildMenuContent(
  from snapshot: MenuWidgetSnapshot?,
  family: WidgetFamily
) -> MenuContent {
  let week = isWeekFamily(family)

  // スナップショットが無い（未書き出し・パース失敗）ときは**ロケールの手掛かりが無い**ので
  // ja 固定で案内を出す（Android 版・ShoppingWidget と同じ扱い・設計 §6-1）
  guard let snapshot else {
    let dict = MenuDictionary.ja
    return MenuContent(
      isWeek: week,
      heading: week ? dict.week : dict.today,
      dishName: nil,
      sides: [],
      sidesOverflowText: nil,
      rows: [],
      shortfallMessage: nil,
      emptyMessage: dict.noSnapshot,
      timeLabel: nil,
      uri: menuURI
    )
  }

  let dict = MenuDictionary.of(snapshot.locale)

  // 知らない版は中身を推測しない。ロケールだけは読めているのでそちらで案内する
  guard snapshot.version <= supportedSnapshotVersion else {
    return MenuContent(
      isWeek: week,
      heading: week ? dict.week : dict.today,
      dishName: nil,
      sides: [],
      sidesOverflowText: nil,
      rows: [],
      shortfallMessage: nil,
      emptyMessage: dict.noSnapshot,
      timeLabel: nil,
      uri: menuURI
    )
  }

  let timeLabel = formatMenuSnapshotTime(snapshot.writtenAt).map { dict.asOf($0) }
  // 朝/昼のときだけ見出しに印（§10.13）。夕（mealTime 無し）は空文字で従来どおり
  let suffix = dict.mealSuffix(snapshot.menu.mealTime ?? "")

  if week {
    let days = snapshot.menu.week ?? []
    let withSides = showsWeekSides(family)
    let rows: [MenuWeekRow] = days.map { day in
      let undecided = day.title == nil
      var sidesText: String? = nil
      if withSides, let sides = day.sides, !sides.isEmpty {
        sidesText = sides.map { "\($0.label) \($0.title)" }.joined(separator: "・")
      }
      return MenuWeekRow(
        label: day.title ?? "—",
        isToday: day.isToday,
        isDone: day.doneAt != nil,
        isUndecided: undecided,
        uri: day.recipeId.map { recipeURI($0) } ?? menuURI,
        sidesText: sidesText
      )
    }
    // 実の献立が 1 つも無い（全部未定 or 空）なら案内に一本化する
    let hasAnyDish = rows.contains { !$0.isUndecided }
    // 要求日数が無い（旧アプリ・旧プラン）なら不足行を出さない
    let shortfall = snapshot.menu.requestedDays.map { $0 - days.count } ?? 0
    return MenuContent(
      isWeek: true,
      heading: dict.week + suffix,
      dishName: nil,
      sides: [],
      sidesOverflowText: nil,
      rows: rows,
      shortfallMessage: hasAnyDish && shortfall > 0 ? dict.shortfall(shortfall) : nil,
      emptyMessage: hasAnyDish ? nil : dict.noMenu,
      timeLabel: timeLabel,
      uri: menuURI
    )
  }

  // 小/中 = 今日の一品
  let heading = (snapshot.menu.kind == "next" ? dict.next : dict.today) + suffix
  let dishName = snapshot.menu.title
  let maxSides = family == .systemSmall ? 2 : menuSidesMax
  let rawSides = snapshot.menu.sides ?? []
  let sides = rawSides.prefix(maxSides).map { side in
    MenuSideRow(
      text: "\(side.label)  \(side.title)",
      uri: side.recipeId.map { recipeURI($0) } ?? menuURI,
      isDone: side.doneAt != nil
    )
  }
  let overflow = max(0, rawSides.count - maxSides)

  return MenuContent(
    isWeek: false,
    heading: heading,
    dishName: dishName,
    sides: Array(sides),
    sidesOverflowText: overflow > 0 ? dict.otherSides(overflow) : nil,
    rows: [],
    shortfallMessage: nil,
    emptyMessage: dishName == nil ? dict.noMenu : nil,
    timeLabel: timeLabel,
    uri: snapshot.menu.recipeId.map { recipeURI($0) } ?? menuURI
  )
}

// MARK: - 読み出し

/// App Group から読む。**壊れていても落とさない** — nil を返して案内表示に落ちる。
private func loadMenuSnapshot() -> MenuWidgetSnapshot? {
  guard
    let defaults = UserDefaults(suiteName: appGroupIdentifier),
    let raw = defaults.string(forKey: snapshotKey),
    let data = raw.data(using: .utf8)
  else {
    return nil
  }
  return try? JSONDecoder().decode(MenuWidgetSnapshot.self, from: data)
}

// MARK: - タイムライン

private struct MenuEntry: TimelineEntry {
  let date: Date
  let snapshot: MenuWidgetSnapshot?
}

private struct MenuProvider: TimelineProvider {
  func placeholder(in context: Context) -> MenuEntry {
    MenuEntry(date: Date(), snapshot: nil)
  }

  func getSnapshot(in context: Context, completion: @escaping (MenuEntry) -> Void) {
    completion(MenuEntry(date: Date(), snapshot: loadMenuSnapshot()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<MenuEntry>) -> Void) {
    let entry = MenuEntry(date: Date(), snapshot: loadMenuSnapshot())
    // アプリ側が書くたびに reloadWidget() で押し更新するので、ここは保険。
    // Android の updatePeriodMillis（30 分）と歩調を合わせる。
    let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date()
    completion(Timeline(entries: [entry], policy: .after(next)))
  }
}

// MARK: - 配色（docs/brand/ロゴ仕様.md・CLAUDE.md §4）

// ShoppingWidget.swift の Brand と同じ値。**片方を変えたら必ずもう片方も変えること。**
private enum MenuBrand {
  static let background = Color(red: 0x0A / 255, green: 0x08 / 255, blue: 0x05 / 255)
  static let gold = Color(red: 0xC9 / 255, green: 0xA1 / 255, blue: 0x6A / 255)
  static let text = Color(red: 0xDC / 255, green: 0xC9 / 255, blue: 0xA8 / 255)
}

// MARK: - View

private struct MenuWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: MenuEntry

  /// 副菜の 1 行。調理済みは薄く描く（Android と同じ規約）
  private func sideLine(_ side: MenuSideRow) -> some View {
    Text(side.text)
      .font(.caption2)
      .foregroundColor(MenuBrand.text.opacity(side.isDone ? 0.45 : 0.85))
      .lineLimit(1)
  }

  /// 週間一覧の 1 行。今日は金色、調理済みは薄く、未定はグレーの「—」
  private func weekLine(_ row: MenuWeekRow) -> some View {
    VStack(alignment: .leading, spacing: 1) {
      Text(row.label)
        .font(row.isToday ? .caption.bold() : .caption)
        .foregroundColor(
          row.isUndecided
            ? MenuBrand.text.opacity(0.4)
            : (row.isToday ? MenuBrand.gold : MenuBrand.text.opacity(row.isDone ? 0.45 : 1))
        )
        .lineLimit(1)

      if let sidesText = row.sidesText {
        Text(sidesText)
          .font(.caption2)
          .foregroundColor(MenuBrand.text.opacity(0.6))
          .lineLimit(1)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  var body: some View {
    let content = buildMenuContent(from: entry.snapshot, family: family)

    VStack(alignment: .leading, spacing: 4) {
      Text(content.heading)
        .font(.caption.bold())
        .foregroundColor(MenuBrand.gold)
        .lineLimit(1)

      if let message = content.emptyMessage {
        Text(message)
          .font(.caption2)
          .foregroundColor(MenuBrand.text.opacity(0.7))
          .lineLimit(2)
      } else if content.isWeek {
        VStack(alignment: .leading, spacing: 2) {
          ForEach(content.rows) { row in
            weekLine(row)
          }
        }

        if let shortfall = content.shortfallMessage {
          Text(shortfall)
            .font(.caption2)
            .foregroundColor(MenuBrand.text.opacity(0.6))
            .lineLimit(1)
        }
      } else {
        // 今日の一品。**中サイズは iOS だと縦が約 158pt しかない**ので、
        // 料理名と副菜を上下に積まず 2 列に割る（§8-5 の中サイズの罠）
        if family == .systemSmall {
          Text(content.dishName ?? "")
            .font(.headline)
            .foregroundColor(MenuBrand.text)
            .lineLimit(2)

          ForEach(content.sides) { side in
            sideLine(side)
          }

          if let more = content.sidesOverflowText {
            Text(more)
              .font(.caption2)
              .foregroundColor(MenuBrand.text.opacity(0.7))
          }
        } else {
          HStack(alignment: .top, spacing: 10) {
            Text(content.dishName ?? "")
              .font(.headline)
              .foregroundColor(MenuBrand.text)
              .lineLimit(3)
              .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .leading, spacing: 2) {
              ForEach(content.sides) { side in
                sideLine(side)
              }
              if let more = content.sidesOverflowText {
                Text(more)
                  .font(.caption2)
                  .foregroundColor(MenuBrand.text.opacity(0.7))
              }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
          }
        }
      }

      Spacer(minLength: 0)

      // 設計 §2: 「HH:mm 時点」は必ず出す。いつの姿かが分からないほうが害が大きい
      if let timeLabel = content.timeLabel {
        Text(timeLabel)
          .font(.caption2)
          .foregroundColor(MenuBrand.text.opacity(0.6))
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    // タップ先。Android 版の widgetURL と同じスキーム
    .widgetURL(URL(string: content.uri))
  }
}

// MARK: - Widget

struct MenuWidget: Widget {
  private let kind = "MenuWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: MenuProvider()) { entry in
      if #available(iOS 17.0, *) {
        MenuWidgetView(entry: entry)
          .containerBackground(MenuBrand.background, for: .widget)
      } else {
        MenuWidgetView(entry: entry)
          .padding()
          .background(MenuBrand.background)
      }
    }
    .configurationDisplayName("献立")
    .description("今日の一品と今週の献立を表示します")
    // **`.systemExtraLarge` は iPad だけに出る**（iPhone のギャラリーには並ばない）。
    // 宣言しておくと iPad で週間＋副菜が使え、iPhone では自動的に候補から外れる。
    .supportedFamilies(MenuWidget.families)
  }

  private static var families: [WidgetFamily] {
    if #available(iOS 15.0, *) {
      return [.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge]
    }
    return [.systemSmall, .systemMedium, .systemLarge]
  }
}
