/**
 * レシートから読み取った「数量 × 単位」を、在庫（pantry）に入れられる形に正規化する。
 *
 * 在庫は **同名(正規化)×同単位で数量を合算する**（`docs/買い物リスト・在庫設計.md` §6 / §7-1）。
 * つまり単位の表記ゆれ（「ｇ」「グラム」「g」）をそのまま入れると、同じ品物が別行に
 * 積み上がって合算されない。ここで表記を1つに寄せる。
 *
 * 読めなかったものは **null のまま通す**。1 で埋めると「家に無いものが在庫にある」状態を
 * 静かに作る（在庫は合算なので、間違いが消えずに積もる）。
 */

/** レシートの単位表記 → 在庫で使う表記。 */
const UNIT_ALIASES: Record<string, string> = {
  // 個数
  個: '個',
  コ: '個',
  こ: '個',
  ケ: '個',
  ヶ: '個',
  本: '本',
  ほん: '本',
  袋: '袋',
  ふくろ: '袋',
  パック: 'パック',
  ぱっく: 'パック',
  p: 'パック',
  pk: 'パック',
  pack: 'パック',
  枚: '枚',
  尾: '尾',
  缶: '缶',
  束: '束',
  玉: '玉',
  丁: '丁',
  箱: '箱',
  房: '房',
  株: '株',
  // 重さ（kg はグラムに寄せて合算できるようにする）
  g: 'g',
  グラム: 'g',
  ぐらむ: 'g',
  kg: 'kg',
  キロ: 'kg',
  キログラム: 'kg',
  きろ: 'kg',
  // 容量（L はミリリットルに寄せる）
  ml: 'ml',
  cc: 'ml',
  ミリリットル: 'ml',
  l: 'L',
  リットル: 'L',
  りっとる: 'L',
};

/** 「単位」ではなく数え方・金額の付帯表記。数量は活かし、単位としては捨てる。 */
const NON_UNIT_TOKENS = new Set(['点', '品', '入', '円', '個入', 'x', '×', '*', '%', '割', '本入']);

/** 単位ごとの上限。値引き額・単価・レジ番号が数量欄に紛れ込むのを弾く。 */
const MAX_COUNT_QUANTITY = 99;
const MAX_MEASURED_QUANTITY = 100_000;
/** 在庫画面の単位入力（maxLength=6）に合わせる。 */
const MAX_UNIT_LENGTH = 6;

const MEASURED_UNITS = new Set(['g', 'ml']);

export interface ReceiptQuantity {
  quantity: number | null;
  unit: string | null;
}

function canonicalUnit(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const nfkc = typeof raw.normalize === 'function' ? raw.normalize('NFKC') : raw;
  // 「/個」「（本）」のような飾りを落とす
  const cleaned = nfkc.replace(/[()（）[\]【】/／・,、.。:：\s]/g, '').trim();
  if (!cleaned) return null;

  const alias = UNIT_ALIASES[cleaned] ?? UNIT_ALIASES[cleaned.toLowerCase()];
  if (alias) return alias;
  if (NON_UNIT_TOKENS.has(cleaned)) return null;
  // 数字・通貨が混じるものは単位ではない（「198円」「@128」など）
  if (/[\d¥$@￥]/.test(cleaned)) return null;
  return cleaned.slice(0, MAX_UNIT_LENGTH);
}

/**
 * 数量と単位を在庫に入れられる形へ。単位が読めても数量が怪しければ数量だけ落とす
 * （単位は残す — 利用者が確認画面で直せる手がかりになる）。
 */
export function normalizeReceiptQuantity(
  quantity: number | null | undefined,
  unit: string | null | undefined,
): ReceiptQuantity {
  let canonical = canonicalUnit(unit);
  let value = typeof quantity === 'number' && Number.isFinite(quantity) ? quantity : null;

  // kg / L はグラム・ミリリットルに寄せる（同じ品物が別単位に分かれて合算されないように）。
  // 数量が読めないときは換算のしようがないので表記だけ残す。
  if (value != null && (canonical === 'kg' || canonical === 'L')) {
    value *= 1000;
    canonical = canonical === 'kg' ? 'g' : 'ml';
  }

  if (value != null) {
    const rounded = Math.round(value * 1000) / 1000;
    const max =
      canonical != null && MEASURED_UNITS.has(canonical)
        ? MAX_MEASURED_QUANTITY
        : MAX_COUNT_QUANTITY;
    value = rounded > 0 && rounded <= max ? rounded : null;
  }

  return { quantity: value, unit: canonical };
}

/** 確認画面の数量入力（自由記述）を数量に戻す。空欄・読めない値は null（＝数量未管理）。 */
export function parseQuantityInput(text: string): number | null {
  const nfkc = typeof text.normalize === 'function' ? text.normalize('NFKC') : text;
  const trimmed = nfkc.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 1000) / 1000;
}

/** 数量を入力欄に出す文字列にする（null＝空欄＝数量未管理）。 */
export function formatQuantityInput(quantity: number | null): string {
  return quantity == null ? '' : String(quantity);
}
