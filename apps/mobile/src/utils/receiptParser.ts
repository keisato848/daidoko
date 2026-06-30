/**
 * Best-effort parse of receipt OCR text into purchasable item names.
 *
 * Japanese receipts list product names (often abbreviated / half-width katakana)
 * with a trailing price, mixed with non-item lines (subtotal, tax, change,
 * points, store info). This keeps lines that look like "<name> ... <price>" and
 * drops the rest. It is intentionally conservative-ish but imperfect — the UI
 * lets the user review/edit before adding to the pantry.
 * See docs/買い物リスト・在庫設計.md §5.6.
 */
export interface ReceiptItem {
  name: string;
  price: number | null;
}

// Lines containing any of these are not products (totals, tax, payment, meta).
const EXCLUDE_KEYWORDS = [
  '合計',
  '小計',
  '中計',
  '税',
  '釣',
  '預',
  '現金',
  'クレジット',
  'カード',
  '電子マネー',
  'マネー',
  'ポイント',
  'point',
  'ポイ',
  '領収',
  'レシート',
  '登録番号',
  '責任者',
  'TEL',
  '電話',
  'お買上',
  '買上',
  '点数',
  '値引',
  '割引',
  '対象',
  '内税',
  '外税',
  '軽減',
  '標準税率',
  'お預',
  'おつり',
  'お釣',
  '釣銭',
  '番号', // 事業者番号 / 登録番号 / 電話番号
  '責', // 責任者 / レジ責
  'セルフ', // セルフレジ
  '単価',
  'レジ',
  '小銭',
  '釣り',
  'クーポン', // アプリクーポン等
  'クーボン', // OCR 誤読（ポ→ボ）
];

/** A quantity×unit-price fragment like "2コX単", "3×@98", "2点 x". */
const QTY_FRAGMENT = /^\d+\s*[コ個点]?\s*[×xX]/;

// A character that makes a token look like a real product name (kana/kanji/latin).
const NAME_CHAR = /[぀-ヿ一-鿿ｦ-ﾟA-Za-zＡ-Ｚａ-ｚ]/;

/** Trailing price like "¥1,280", "128円", "*128", "＊128", "128 *", or a bare "128". */
const TRAILING_PRICE = /[¥￥*※＊]?\s*([0-9,]+)\s*円?\s*[*※＊]?$/;

export function parseReceipt(rawText: string): ReceiptItem[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const items: ReceiptItem[] = [];

  for (const line of lines) {
    if (EXCLUDE_KEYWORDS.some((keyword) => line.includes(keyword))) continue;

    let name = line;
    let price: number | null = null;

    const priceMatch = line.match(TRAILING_PRICE);
    if (priceMatch && priceMatch.index !== undefined && priceMatch.index > 0) {
      const parsed = Number(priceMatch[1].replace(/,/g, ''));
      price = Number.isFinite(parsed) ? parsed : null;
      name = line.slice(0, priceMatch.index).trim();
    }

    // Strip trailing quantity tokens ("x2", "×2", "3個", "2本", "1ｺ").
    name = name
      .replace(/\s*[x×]\s*\d+$/i, '')
      .replace(/\s*\d+\s*(個|本|袋|ｺ|コ|点|枚|缶|パック|ﾊﾟｯｸ)$/u, '')
      .trim();

    // Remove reduced-tax-rate marks (＊ * ※) left anywhere in the name.
    name = name.replace(/[*※＊]/g, '').trim();

    if (QTY_FRAGMENT.test(name)) continue; // quantity×unit-price fragment

    const compact = name.replace(/\s/g, '');
    if (compact.length < 2) continue; // too short
    if (!NAME_CHAR.test(name)) continue; // no real name char (pure digits/symbols)

    // Drop lines that are mostly digits (dates, phone, register/barcode numbers).
    const digits = name.replace(/\D/g, '').length;
    if (digits / compact.length > 0.5) continue;

    items.push({ name, price });
  }

  return items;
}
