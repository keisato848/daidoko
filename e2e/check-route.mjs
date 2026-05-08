import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

// 直接 /recipes/new にアクセス
await page.goto("http://localhost:8082/recipes/new", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: "e2e/screenshots/direct-new.png" });

const inputs = await page.locator("input").count();
const hasLoading = await page.getByText("読み込み中").isVisible().catch(() => false);
const hasForm = await page.getByText("レシピ作成").isVisible().catch(() => false);
const url = page.url();

console.log("URL:", url);
console.log("input要素数:", inputs);
console.log("読み込み中表示:", hasLoading);
console.log("レシピ作成フォーム:", hasForm);

await browser.close();
