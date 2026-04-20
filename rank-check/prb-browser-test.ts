/**
 * PRB(puppeteer-real-browser) + persistentContext 테스트
 */

import { connect } from 'puppeteer-real-browser';
import * as path from 'path';
import * as os from 'os';

async function main() {
  console.log("=".repeat(60));
  console.log("🔍 PRB + persistentContext 테스트");
  console.log("=".repeat(60));

  let browser: any = null;
  let page: any = null;

  // 고정 프로필 경로 (쿠키/세션 유지)
  const userDataDir = path.join(os.tmpdir(), 'prb-rank-checker-profile');
  console.log(`\n📁 프로필 경로: ${userDataDir}`);

  try {
    console.log("🌐 PRB 브라우저 시작 중...");

    const connection = await connect({
      headless: false,
      turnstile: true,
      fingerprint: true,
      customConfig: {
        userDataDir: userDataDir,
      },
    });

    browser = connection.browser;
    page = connection.page;

    console.log("✅ PRB 연결 성공!");

    // Step 1: 네이버 메인 (쿠키 획득)
    console.log("\n📍 Step 1: 네이버 메인 방문");
    await page.goto("https://www.naver.com", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    await new Promise(r => setTimeout(r, 2000));
    console.log("   ✅ 네이버 메인 완료");

    // Step 2: 네이버 쇼핑 검색
    console.log("\n📍 Step 2: 네이버 쇼핑 검색");
    await page.goto("https://search.shopping.naver.com/search/all?query=무선충전기", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    await new Promise(r => setTimeout(r, 3000));

    let content = await page.evaluate(() => document.body.innerText?.substring(0, 100) || "");
    if (content.includes("보안")) {
      console.log("   🛑 쇼핑에서 캡챠!");
    } else {
      console.log("   ✅ 쇼핑 검색 완료");
    }

    // Step 3: 스마트스토어 (Referer 포함)
    console.log("\n📍 Step 3: 스마트스토어 접속");
    await page.goto("https://smartstore.naver.com/sinjimall_store/products/11485001902", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    await new Promise(r => setTimeout(r, 3000));

    const title = await page.title();
    content = await page.evaluate(() => document.body.innerText?.substring(0, 200) || "");

    console.log(`   제목: ${title}`);

    if (content.includes("보안") || content.includes("영수증")) {
      console.log("\n🛑 캡챠 발생!");
    } else if (content.includes("구매") || title.includes("스토어")) {
      console.log("\n✅ 정상 접속!");
    }

    console.log("\n⏳ 15초 대기...");
    await new Promise(r => setTimeout(r, 15000));

  } catch (error: any) {
    console.error(`\n❌ 에러: ${error.message}`);
  } finally {
    if (browser) await browser.close();
    console.log("👋 완료!");
  }
}

main().catch(console.error);
