/**
 * だいどこ v0.5 手動テストスクリプト
 * 実行: node e2e/manual-test.mjs
 */

import { chromium } from "playwright";

const BASE = "http://localhost:8082";
const HYDRATION_WAIT = 3000;

const results = [];
const pageErrors = [];

function log(section, status, detail = "") {
  const icon = status === "PASS" ? "✅" : status === "FAIL" ? "❌" : "⚠️ ";
  const line = `${icon} [${section}] ${detail}`;
  console.log(line);
  results.push({ section, status, detail });
}

async function hasText(page, text, timeout = 5000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ timeout });
    return true;
  } catch {
    return false;
  }
}

async function clickTab(page, label) {
  try {
    await page.getByText(label, { exact: true }).first().click();
    await page.waitForTimeout(2000);
    return true;
  } catch {
    return false;
  }
}

async function screenshot(page, name) {
  await page
    .screenshot({ path: `e2e/screenshots/${name}.png` })
    .catch(() => {});
}

// ────────────────────────────────────────────
// S01: ホーム画面
// ────────────────────────────────────────────
async function testHome(page) {
  await page.goto(BASE, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(HYDRATION_WAIT);

  for (const tab of ["ホーム", "レシピ", "追加", "設定"]) {
    const ok = await hasText(page, tab);
    log("S01 Home", ok ? "PASS" : "FAIL", `タブ「${tab}」`);
  }

  for (const filter of ["今週", "今月", "すべて"]) {
    const ok = await hasText(page, filter);
    log("S01 Home", ok ? "PASS" : "WARN", `フィルター「${filter}」`);
  }

  const hasBrand = await hasText(page, "DAIDOKO");
  log("S01 Home", hasBrand ? "PASS" : "WARN", "DAIDOKOブランド表示");

  const seedTitles = ["肉じゃが", "味噌汁", "唐揚げ", "炊き込みご飯", "豚汁", "ハンバーグ"];
  let found = 0;
  for (const title of seedTitles) {
    if (await hasText(page, title, 2000)) found++;
  }
  if (found > 0) {
    log("S01 Home", "PASS", `タイムラインエントリ ${found}件確認`);
  } else {
    log("S01 Home", "WARN", "タイムラインエントリが見つからない（シードデータなし?）");
  }

  await screenshot(page, "home");
}

// ────────────────────────────────────────────
// S04: レシピ一覧 + 検索
// ────────────────────────────────────────────
async function testRecipeList(page) {
  await page.goto(BASE, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(HYDRATION_WAIT);

  if (!(await clickTab(page, "レシピ"))) {
    log("S04 RecipeList", "FAIL", "レシピタブクリック失敗");
    return;
  }

  const seedTitles = ["肉じゃが", "味噌汁", "唐揚げ", "炊き込みご飯", "豚汁", "ハンバーグ"];
  let foundCount = 0;
  for (const title of seedTitles) {
    if (await hasText(page, title, 2000)) foundCount++;
  }
  log(
    "S04 RecipeList",
    foundCount >= 3 ? "PASS" : foundCount > 0 ? "WARN" : "FAIL",
    `レシピカード ${foundCount}/6件確認`
  );

  const hasTagAll = await hasText(page, "すべて", 2000);
  log("S04 RecipeList", hasTagAll ? "PASS" : "WARN", "タグフィルター「すべて」");

  await screenshot(page, "recipe-list");

  // 検索入力（placeholder="レシピを探す"）
  const searchInput = page.locator('input[placeholder="レシピを探す"]');
  const hasSearch = await searchInput.isVisible().catch(() => false);
  if (hasSearch) {
    log("S04 RecipeList", "PASS", "検索入力欄存在");

    await searchInput.fill("豚汁");
    await page.waitForTimeout(1000);
    const afterSearch = await hasText(page, "豚汁", 2000);
    log("S04 RecipeList", afterSearch ? "PASS" : "WARN", "「豚汁」で絞り込み");

    await searchInput.fill("");
    await page.waitForTimeout(500);
    const restored = await hasText(page, "肉じゃが", 2000);
    log("S04 RecipeList", restored ? "PASS" : "WARN", "検索クリアで全件表示");
  } else {
    log("S04 RecipeList", "FAIL", "検索入力欄が見つからない");
  }
}

// ────────────────────────────────────────────
// S05: レシピ詳細 + 編集/削除メニュー
// ────────────────────────────────────────────
async function testRecipeDetail(page) {
  await page.goto(BASE, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(HYDRATION_WAIT);

  if (!(await clickTab(page, "レシピ"))) {
    log("S05 Detail", "FAIL", "レシピタブクリック失敗");
    return;
  }

  let clicked = false;
  for (const title of ["肉じゃが", "豚汁", "唐揚げ", "味噌汁"]) {
    try {
      const el = page.getByText(title, { exact: true }).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click();
        await page.waitForTimeout(2000);
        clicked = true;
        log("S05 Detail", "PASS", `「${title}」詳細に遷移`);
        break;
      }
    } catch {}
  }

  if (!clicked) {
    log("S05 Detail", "WARN", "レシピカードをクリックできずスキップ");
    return;
  }

  const hasMaterials = await hasText(page, "材料");
  log("S05 Detail", hasMaterials ? "PASS" : "WARN", "材料タブ");

  const hasStepsTab = await hasText(page, "手順");
  log("S05 Detail", hasStepsTab ? "PASS" : "WARN", "手順タブ");

  const hasCookBtn = await hasText(page, "調理開始");
  log("S05 Detail", hasCookBtn ? "PASS" : "FAIL", "「調理開始」ボタン");

  const hasBack = await hasText(page, "戻る");
  log("S05 Detail", hasBack ? "PASS" : "WARN", "「戻る」ナビゲーション");

  await screenshot(page, "recipe-detail");
}

// ────────────────────────────────────────────
// S08 → S11: レシピ追加フロー
// ────────────────────────────────────────────
async function testAddRecipe(page) {
  await page.goto(BASE, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(HYDRATION_WAIT);

  if (!(await clickTab(page, "追加"))) {
    log("S08 Add", "FAIL", "追加タブクリック失敗");
    return;
  }

  const hasManual = await hasText(page, "手動で入力");
  const hasUrl = await hasText(page, "URLから取り込み");
  const hasOcr = await hasText(page, "写真から読み取り");

  log("S08 Add", hasManual ? "PASS" : "FAIL", "「手動で入力」ボタン");
  log("S08 Add", hasUrl ? "PASS" : "WARN", "「URLから取り込み」ボタン");
  log("S08 Add", hasOcr ? "PASS" : "WARN", "「写真から読み取り」ボタン");

  await screenshot(page, "add-method");

  if (!hasManual) return;

  await page.getByText("手動で入力", { exact: false }).first().click();
  await page.waitForTimeout(3000);

  await screenshot(page, "recipe-new");

  const allInputs = await page.locator("input").all();
  log(
    "S11 NewRecipe",
    allInputs.length > 0 ? "PASS" : "FAIL",
    `入力欄 ${allInputs.length}個`
  );

  if (allInputs.length > 0) {
    const titleInput = allInputs[0];
    await titleInput.fill("テスト料理");
    await page.waitForTimeout(300);
    const val = await titleInput.inputValue().catch(() => "");
    log("S11 NewRecipe", val === "テスト料理" ? "PASS" : "FAIL", "タイトル入力");
  }

  for (const label of ["材料を追加", "手順を追加", "保存", "キャンセル"]) {
    const ok = await hasText(page, label, 3000);
    log("S11 NewRecipe", ok ? "PASS" : "WARN", `「${label}」ボタン`);
  }
}

// ────────────────────────────────────────────
// S06: 料理中モード + タイマー
// ────────────────────────────────────────────
async function testCookMode(page) {
  await page.goto(BASE, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(HYDRATION_WAIT);

  if (!(await clickTab(page, "レシピ"))) {
    log("S06 Cook", "FAIL", "レシピタブクリック失敗");
    return;
  }

  let clicked = false;
  for (const title of ["豚汁", "肉じゃが", "唐揚げ"]) {
    try {
      const el = page.getByText(title, { exact: true }).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click();
        await page.waitForTimeout(2000);
        clicked = true;
        break;
      }
    } catch {}
  }

  if (!clicked) {
    log("S06 Cook", "WARN", "レシピに遷移できずスキップ");
    return;
  }

  const cookBtn = page.getByText("調理開始", { exact: false }).first();
  if (!(await cookBtn.isVisible().catch(() => false))) {
    log("S06 Cook", "WARN", "「調理開始」ボタンが見つからずスキップ");
    return;
  }
  await cookBtn.click();
  await page.waitForTimeout(2000);

  const hasStepCounter = await page
    .locator("text=/\\d+\\s*\\/\\s*\\d+/")
    .first()
    .isVisible()
    .catch(() => false);
  log("S06 Cook", hasStepCounter ? "PASS" : "WARN", "ステップカウンター (N/M形式)");

  const hasPrev = await hasText(page, "前へ");
  const hasNext = await hasText(page, "次へ");
  log("S06 Cook", hasPrev && hasNext ? "PASS" : "WARN", "前へ/次へナビゲーション");

  const hasHint = await hasText(page, "材料を表示", 2000);
  log("S06 Cook", hasHint ? "PASS" : "WARN", "材料表示ヒント");

  await screenshot(page, "cook-mode");

  // 全ステップを次へしてタイマー探す
  let timerFound = false;
  for (let i = 0; i < 4; i++) {
    const nextBtn = page.getByText("次へ", { exact: false }).first();
    if (!(await nextBtn.isVisible().catch(() => false))) break;
    await nextBtn.click();
    await page.waitForTimeout(1000);
    if (await hasText(page, "タイマー", 1500)) {
      timerFound = true;
      await screenshot(page, "cook-timer");
      break;
    }
  }
  log("S06 Cook", timerFound ? "PASS" : "WARN", "タイマーウィジェット（設定済み手順があれば表示）");
}

// ────────────────────────────────────────────
// S15: 設定画面
// ────────────────────────────────────────────
async function testSettings(page) {
  await page.goto(BASE, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(HYDRATION_WAIT);

  if (!(await clickTab(page, "設定"))) {
    log("S15 Settings", "FAIL", "設定タブクリック失敗");
    return;
  }

  for (const section of ["アカウント", "家族", "データ", "アプリ"]) {
    const ok = await hasText(page, section);
    log("S15 Settings", ok ? "PASS" : "WARN", `「${section}」セクション`);
  }

  for (const item of ["プロフィール編集", "家族グループ", "バックアップ", "バージョン"]) {
    const ok = await hasText(page, item, 2000);
    log("S15 Settings", ok ? "PASS" : "WARN", `「${item}」項目`);
  }

  await screenshot(page, "settings");
}

// ────────────────────────────────────────────
// メイン
// ────────────────────────────────────────────
async function main() {
  const { mkdir } = await import("fs/promises");
  await mkdir("e2e/screenshots", { recursive: true });

  console.log("=".repeat(60));
  console.log("  だいどこ v0.5 手動テスト（修正版）");
  console.log(`  ${new Date().toLocaleString("ja-JP")}`);
  console.log("=".repeat(60) + "\n");

  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(`[console.error] ${msg.text()}`);
  });

  try {
    console.log("── S01: ホーム画面");
    await testHome(page);

    console.log("\n── S04: レシピ一覧 + 検索");
    await testRecipeList(page);

    console.log("\n── S05: レシピ詳細");
    await testRecipeDetail(page);

    console.log("\n── S08→S11: レシピ追加フォーム");
    await testAddRecipe(page);

    console.log("\n── S06: 料理中モード");
    await testCookMode(page);

    console.log("\n── S15: 設定画面");
    await testSettings(page);
  } finally {
    await browser.close();
  }

  console.log("\n" + "=".repeat(60));
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const warned = results.filter((r) => r.status === "WARN").length;
  console.log(`  PASS: ${passed}  FAIL: ${failed}  WARN: ${warned}`);

  if (failed > 0) {
    console.log("\n  ❌ 失敗項目:");
    results
      .filter((r) => r.status === "FAIL")
      .forEach((r) => console.log(`     [${r.section}] ${r.detail}`));
  }
  if (warned > 0) {
    console.log("\n  ⚠️  警告項目:");
    results
      .filter((r) => r.status === "WARN")
      .forEach((r) => console.log(`     [${r.section}] ${r.detail}`));
  }
  if (pageErrors.length > 0) {
    console.log("\n  ページエラー:");
    [...new Set(pageErrors)]
      .slice(0, 10)
      .forEach((e) => console.log(`     ❌ ${e}`));
  }

  console.log("\n  スクリーンショット: e2e/screenshots/");
  console.log("=".repeat(60));
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("テスト実行エラー:", e);
  process.exit(1);
});
