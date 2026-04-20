/**
 * 브라우저 설정 테스트
 * - 실제 Chrome 프로필 사용 (봇 감지 회피)
 */

import { chromium } from "patchright";
import * as path from "path";
import * as os from "os";

const PRODUCT_URL = "https://smartstore.naver.com/sinjimall_store/products/11485001902";

async function main() {
  console.log("🔍 브라우저 설정 테스트 (Chrome 프로필 사용)\n");

  // Chrome 사용자 데이터 디렉토리 (실제 프로필)
  const userDataDir = path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
  const tempUserDataDir = path.join(os.tmpdir(), 'chrome-test-profile');

  console.log(`📂 Chrome 프로필: ${userDataDir}\n`);

  // 방법 1: launchPersistentContext 사용 (실제 프로필)
  try {
    const context = await chromium.launchPersistentContext(tempUserDataDir, {
      headless: false,
      channel: 'chrome',
      args: [
        '--window-size=1200,900',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
      ],
      viewport: { width: 1180, height: 800 },
      locale: 'ko-KR',
    });

    const page = context.pages()[0] || await context.newPage();

    // 스마트스토어 접속
    console.log(`📦 스마트스토어 접속: ${PRODUCT_URL}`);
    await page.goto(PRODUCT_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await new Promise(r => setTimeout(r, 3000));

    const title = await page.title();
    const url = page.url();

    console.log(`📄 제목: ${title}`);
    console.log(`🔗 URL: ${url}`);

    if (title.includes("에러") || title.includes("오류")) {
      console.log("\n❌ 스마트스토어 실패 (에러 페이지)");
    } else {
      console.log("\n✅ 스마트스토어 OK!");

      // MID 추출 시도
      const mid = await page.evaluate(() => {
        const html = document.documentElement.outerHTML;
        const match = html.match(/nvMid["\s:=]+(\d{10,})/);
        return match ? match[1] : null;
      });

      if (mid) {
        console.log(`🆔 MID: ${mid}`);
      }

      // 상품명 추출
      const productName = await page.evaluate(() => {
        const ogTitle = document.querySelector('meta[property="og:title"]');
        return ogTitle?.getAttribute("content") || document.title;
      });
      console.log(`📝 상품명: ${productName}`);
    }

    console.log("\n⏳ 60초 대기 (브라우저에서 직접 확인하세요)...");
    await new Promise(r => setTimeout(r, 60000));

    await context.close();

  } catch (error: any) {
    console.error(`\n❌ 에러: ${error.message}`);
  }

  console.log("👋 완료!");
}

main().catch(console.error);
