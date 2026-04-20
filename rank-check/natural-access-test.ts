/**
 * 자연스러운 접근 패턴 테스트
 * - 네이버 메인 → 쇼핑 검색 → 상품 클릭
 * - Referer 헤더 자동 설정
 */

import 'dotenv/config';
import { connect } from 'puppeteer-real-browser';

async function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log("=".repeat(60));
  console.log("🔍 자연스러운 접근 패턴 테스트");
  console.log("=".repeat(60));

  let browser: any = null;
  let page: any = null;

  try {
    console.log("\n🌐 PRB 브라우저 시작 중...");

    const connection = await connect({
      headless: false,
      turnstile: true,
      fingerprint: true,
    });

    browser = connection.browser;
    page = connection.page;

    console.log("✅ PRB 브라우저 연결 성공!");

    // Step 1: 네이버 메인 방문 (쿠키 획득)
    console.log("\n📍 Step 1: 네이버 메인 방문");
    await page.goto("https://www.naver.com", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    await delay(2000);
    console.log("   ✅ 네이버 메인 로드 완료");

    // Step 2: 네이버 쇼핑으로 이동
    console.log("\n📍 Step 2: 네이버 쇼핑 검색");
    await page.goto("https://search.shopping.naver.com/search/all?query=무선충전기", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    await delay(3000);

    const pageContent = await page.evaluate(() => document.body.innerText || "");
    if (pageContent.includes("보안 확인")) {
      console.log("   🛑 쇼핑 검색에서 캡챠 발생!");
    } else {
      console.log("   ✅ 쇼핑 검색 정상 로드");
    }

    // Step 3: 스마트스토어 상품 페이지로 이동 (Referer 포함)
    console.log("\n📍 Step 3: 스마트스토어 상품 페이지 접속");

    // Referer 헤더 설정
    await page.setExtraHTTPHeaders({
      'Referer': 'https://search.shopping.naver.com/'
    });

    await page.goto("https://smartstore.naver.com/sinjimall_store/products/11485001902", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    await delay(3000);

    const storeContent = await page.evaluate(() => document.body.innerText || "");
    const storeTitle = await page.title();

    console.log(`   📄 페이지 제목: ${storeTitle}`);

    if (storeContent.includes("보안 확인") || storeContent.includes("영수증")) {
      console.log("   🛑 스마트스토어에서 캡챠 발생!");
    } else if (storeContent.includes("구매") || storeContent.includes("장바구니")) {
      console.log("   ✅ 스마트스토어 정상 접속! (캡챠 없음)");

      // MID 추출 시도
      const mid = await page.evaluate(() => {
        const html = document.documentElement.outerHTML;
        const match = html.match(/nvMid["\s:=]+(\d{10,})/);
        return match ? match[1] : null;
      });

      if (mid) {
        console.log(`   🆔 MID: ${mid}`);
      }
    } else {
      console.log("   ⚠️ 알 수 없는 상태");
    }

    console.log("\n" + "=".repeat(60));
    console.log("⏳ 10초 후 브라우저 종료...");
    await delay(10000);

  } catch (error: any) {
    console.error(`\n❌ 에러: ${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
    console.log("👋 테스트 완료!");
  }
}

main().catch(console.error);
