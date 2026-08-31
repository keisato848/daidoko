//
//  ShoppingWidget.swift
//  買い物リストウィジェット（W1-iOS・docs/ウィジェット設計.md §2）
//
//  **アプリの DB は読まない。** App Group の UserDefaults に、アプリが書き出した
//  スナップショット JSON（キー `widget_snapshot`）が 1 本だけ入っている。
//  契約は apps/mobile/src/utils/widgetSnapshot.ts の WidgetSnapshot（version 1）。
//
//  表示規約は Android 版（src/widgets/ShoppingListWidget.tsx /
//  shoppingWidgetContent.ts）と同じ:
//    小 = 未購入 N 品 ＋ 上位 3 品名
//    中 = 6 行 ＋「ほか n 品」
//    どちらも「HH:mm 時点」を必ず出す（古い表示だと利用者に分かるように）
//    文言は snapshot.locale で ja/en を描き分ける（ウィジェットはアプリの i18n を読めない）
//

import SwiftUI
import WidgetKit

// MARK: - 契約

/// App Group の識別子。app.json の
/// `ios.entitlements['com.apple.security.application-groups']` と揃える。
private let appGroupIdentifier = "group.com.daidoko.app"

/// スナップショットの格納キー。widget-snapshot.service.ts の書き出し先と揃える。
private let snapshotKey = "widget_snapshot"

/// 読める契約の版。**これより新しいものは中身を推測せず案内に落とす**
/// （設計 §6-1: 壊れた形で見せるより素直に案内する）。
private let supportedSnapshotVersion = 1

/// 買い物リストの中身。JS 側の `WidgetSnapshot['shopping']` に対応。
private struct ShoppingSection: Decodable {
  let remaining: Int
  let names: [String]
}

/// アプリが書き出すスナップショット。`menu` は W1 では読まないので持たない
/// （増えたフィールドを知らなくても壊れないよう、Decodable は部分一致でよい）。
private struct WidgetSnapshot: Decodable {
  let version: Int
  let writtenAt: String
  let locale: String
  let shopping: ShoppingSection
}

// MARK: - 文言

/// ウィジェット内だけの小さな辞書。**Android 版の WIDGET_DICT と同じ文言**に揃える
/// （shoppingWidgetContent.ts）。片方だけ直すと、同じアプリが OS で違う顔になる。
private struct Dictionary {
  let title: String
  let remaining: (Int) -> String
  let more: (Int) -> String
  let asOf: (String) -> String
  let allDone: String
  let noSnapshot: String

  static let ja = Dictionary(
    title: "買い物リスト",
    remaining: { "未購入 \($0) 品" },
    more: { "ほか \($0) 品" },
    asOf: { "\($0) 時点" },
    allDone: "買うものはありません",
    noSnapshot: "アプリを開くと表示されます"
  )

  static let en = Dictionary(
    title: "Shopping List",
    remaining: { "\($0) to buy" },
    more: { "+\($0) more" },
    asOf: { "as of \($0)" },
    allDone: "Nothing to buy",
    noSnapshot: "Open the app to see your list"
  )

  static func of(_ locale: String) -> Dictionary {
    locale == "en" ? .en : .ja
  }
}

// MARK: - 表示内容の組み立て

/// 画面に出すもの。組み立てを View から分けておくと、描画に触らず値を追える。
private struct WidgetContent {
  let title: String
  /// 「未購入 N 品」。0 件・未取得なら nil
  let countLabel: String?
  let lines: [String]
  /// 「ほか n 品」。中サイズで溢れたときだけ
  let moreLabel: String?
  /// 「HH:mm 時点」。スナップショットが無いときだけ nil
  let timeLabel: String?
  /// 案内 1 行（未取得・買うものなし）。無ければ nil
  let emptyMessage: String?
}

/// サイズごとの品名の件数（設計 §2・Android の WIDGET_PREVIEW_COUNT と同じ）。
private func previewCount(for family: WidgetFamily) -> Int {
  family == .systemSmall ? 3 : 6
}

/// ISO8601 の writtenAt を端末のローカル時刻で "HH:mm" にする。
/// JS 側 `formatSnapshotTime` と同じ結果になるようにする（あちらは `new Date()` の
/// ローカル時刻から getHours/getMinutes を取っている）。
private func formatSnapshotTime(_ writtenAt: String) -> String? {
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

/// スナップショットから表示内容を組む。
///
/// `snapshot` が nil（未書き出し・パース失敗）のときは**ロケールの手掛かりが無い**ので
/// ja 固定で案内を出す（Android 版と同じ扱い）。
private func buildContent(from snapshot: WidgetSnapshot?, family: WidgetFamily) -> WidgetContent {
  guard let snapshot else {
    let dict = Dictionary.ja
    return WidgetContent(
      title: dict.title,
      countLabel: nil,
      lines: [],
      moreLabel: nil,
      timeLabel: nil,
      emptyMessage: dict.noSnapshot
    )
  }

  let dict = Dictionary.of(snapshot.locale)

  // 知らない版は中身を推測しない。ロケールだけは読めているのでそちらで案内する
  guard snapshot.version <= supportedSnapshotVersion else {
    return WidgetContent(
      title: dict.title,
      countLabel: nil,
      lines: [],
      moreLabel: nil,
      timeLabel: nil,
      emptyMessage: dict.noSnapshot
    )
  }

  let limit = previewCount(for: family)
  let lines = Array(snapshot.shopping.names.prefix(limit))
  let overflow = snapshot.shopping.remaining - lines.count

  return WidgetContent(
    title: dict.title,
    countLabel: snapshot.shopping.remaining > 0 ? dict.remaining(snapshot.shopping.remaining) : nil,
    lines: lines,
    moreLabel: family != .systemSmall && overflow > 0 ? dict.more(overflow) : nil,
    timeLabel: formatSnapshotTime(snapshot.writtenAt).map { dict.asOf($0) },
    emptyMessage: snapshot.shopping.remaining == 0 ? dict.allDone : nil
  )
}

// MARK: - 読み出し

/// App Group から読む。**壊れていても落とさない** — nil を返して案内表示に落ちる。
private func loadSnapshot() -> WidgetSnapshot? {
  guard
    let defaults = UserDefaults(suiteName: appGroupIdentifier),
    let raw = defaults.string(forKey: snapshotKey),
    let data = raw.data(using: .utf8)
  else {
    return nil
  }
  return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
}

// MARK: - タイムライン

private struct ShoppingEntry: TimelineEntry {
  let date: Date
  let snapshot: WidgetSnapshot?
}

private struct ShoppingProvider: TimelineProvider {
  func placeholder(in context: Context) -> ShoppingEntry {
    ShoppingEntry(date: Date(), snapshot: nil)
  }

  func getSnapshot(in context: Context, completion: @escaping (ShoppingEntry) -> Void) {
    completion(ShoppingEntry(date: Date(), snapshot: loadSnapshot()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<ShoppingEntry>) -> Void) {
    let entry = ShoppingEntry(date: Date(), snapshot: loadSnapshot())
    // アプリ側が書くたびに ExtensionStorage.reloadWidget() で押し更新するので、
    // ここは保険。Android の updatePeriodMillis（30 分）と歩調を合わせる。
    let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date()
    completion(Timeline(entries: [entry], policy: .after(next)))
  }
}

// MARK: - 配色（docs/brand/ロゴ仕様.md・CLAUDE.md §4）

private enum Brand {
  static let background = Color(red: 0x0A / 255, green: 0x08 / 255, blue: 0x05 / 255)
  static let gold = Color(red: 0xC9 / 255, green: 0xA1 / 255, blue: 0x6A / 255)
  static let text = Color(red: 0xDC / 255, green: 0xC9 / 255, blue: 0xA8 / 255)
}

// MARK: - View

private struct ShoppingWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: ShoppingEntry

  /// 中サイズの 1 列ぶん。品名は 1 行に収め、溢れたら省略する
  private func column(_ names: [String]) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      ForEach(names, id: \.self) { line in
        Text("・\(line)")
          .font(.caption2)
          .foregroundColor(Brand.text)
          .lineLimit(1)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  var body: some View {
    let content = buildContent(from: entry.snapshot, family: family)

    VStack(alignment: .leading, spacing: 4) {
      Text(content.title)
        .font(.caption).bold()
        .foregroundColor(Brand.gold)

      if let countLabel = content.countLabel {
        Text(countLabel)
          .font(.headline)
          .foregroundColor(Brand.text)
      }

      if let emptyMessage = content.emptyMessage {
        Text(emptyMessage)
          .font(.caption)
          .foregroundColor(Brand.text.opacity(0.8))
          .fixedSize(horizontal: false, vertical: true)
      }

      // **中サイズは 2 列に割る。** iOS の systemMedium は縦が約 158pt しかなく、
      // 6 行を 1 列で積むとタイトルと「HH:mm 時点」が上下に押し出される（実測）。
      // Android の中サイズは縦長なので 1 列で入るが、こちらは横に伸ばして辻褄を合わせる。
      // 「6 件見える」という設計 §2 の約束は保つ。
      if family == .systemSmall {
        ForEach(content.lines, id: \.self) { line in
          Text("・\(line)")
            .font(.caption)
            .foregroundColor(Brand.text)
            .lineLimit(1)
        }
      } else {
        let half = (content.lines.count + 1) / 2
        HStack(alignment: .top, spacing: 10) {
          column(Array(content.lines.prefix(half)))
          column(Array(content.lines.dropFirst(half)))
        }
      }

      if let moreLabel = content.moreLabel {
        Text(moreLabel)
          .font(.caption2)
          .foregroundColor(Brand.text.opacity(0.7))
      }

      Spacer(minLength: 0)

      // 設計 §2: 「HH:mm 時点」は必ず出す。いつの姿かが分からないほうが害が大きい
      if let timeLabel = content.timeLabel {
        Text(timeLabel)
          .font(.caption2)
          .foregroundColor(Brand.text.opacity(0.6))
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    // タップで買い物リストへ。Android 版の widgetURL と同じスキーム
    .widgetURL(URL(string: "daidoko://shopping"))
  }
}

// MARK: - Widget

@main
struct ShoppingWidget: Widget {
  private let kind = "ShoppingWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: ShoppingProvider()) { entry in
      if #available(iOS 17.0, *) {
        ShoppingWidgetView(entry: entry)
          .containerBackground(Brand.background, for: .widget)
      } else {
        ShoppingWidgetView(entry: entry)
          .padding()
          .background(Brand.background)
      }
    }
    .configurationDisplayName("買い物リスト")
    .description("買い物リストの未購入品を表示します")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
