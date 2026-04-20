/**
 * 1회성 테스트 스크립트
 * - 스마트스토어 URL에서 MID 추출
 * - 상품명 추출
 * - 키워드 검색 순위 확인
 *
 * launchPersistentContext 사용 (봇 감지 회피)
 */

import { chromium } from "patchright";
import * as path from "path";
import * as os from "os";
import { findAccurateRank } from "./accurate-rank-checker";

// ========== 설정 ==========
const PRODUCT_URL = "https://smartstore.naver.com/sinjimall_store/products/11485001902";
const KEYWORD = "무선충전기";
const MAX_PAGES = 15;
// ==========================

async function main() {
  console.log("=".repeat(60));
  console.log("🔍 1회성 순위 테스트 스크립트");
  console.log("=".repeat(60));
  console.log(`\n📎 상품 URL: ${PRODUCT_URL}`);
  console.log(`🔑 키워드: ${KEYWORD}\n`);

  // 임시 Chrome 프로필 경로
  const tempUserDataDir = path.join(os.tmpdir(), 'chrome-rank-checker');

  // launchPersistentContext 사용 (봇 감지 회피)
  const context = await chromium.launchPersistentContext(tempUserDataDir, {
    headless: false,
    channel: 'chrome',
    args: [
      '--window-size=1200,900',
      '--window-position=100,100',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    viewport: { width: 1180, height: 800 },
    locale: 'ko-KR',
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    // Step 1: MID 추출
    console.log("\n" + "─".repeat(40));
    console.log("📦 Step 1: MID 추출");
    console.log("─".repeat(40));

    console.log(`📦 상품 페이지 방문: ${PRODUCT_URL.substring(0, 60)}...`);

    // API 요청에서 MID 인터셉트
    let catalogMid: string | null = null;

    const requestHandler = (request: any) => {
      const url = request.url();
      let match = url.match(/[?&]nvMid=(\d{10,})/);
      if (match && !catalogMid) {
        catalogMid = match[1];
        return;
      }
      match = url.match(/[?&]productId=(\d{10,})/);
      if (match && !catalogMid) {
        catalogMid = match[1];
        return;
      }
      match = url.match(/\/catalog\/(\d{10,})/);
      if (match && !catalogMid) {
        catalogMid = match[1];
      }
    };

    page.on('request', requestHandler);

    // 상품 페이지 방문
    await page.goto(PRODUCT_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await new Promise(r => setTimeout(r, 2000));

    // 스크롤로 추가 API 트리거
    await page.evaluate(() => window.scrollBy(0, 500));
    await new Promise(r => setTimeout(r, 1500));

    page.removeListener('request', requestHandler);

    // API에서 못 찾으면 페이지 소스에서 찾기
    if (!catalogMid) {
      catalogMid = await page.evaluate(() => {
        const html = document.documentElement.outerHTML;

        let match = html.match(/nvMid["\s:=]+(\d{10,})/);
        if (match) return match[1];

        match = html.match(/catalogId["\s:=]+(\d{10,})/);
        if (match) return match[1];

        match = html.match(/"productId"\s*:\s*"?(\d{10,})"?/);
        if (match) return match[1];

        return null;
      });
    }

    if (!catalogMid) {
      console.log("❌ MID 추출 실패!");
      await context.close();
      return;
    }

    console.log(`\n✅ 추출된 MID: ${catalogMid}`);

    // Step 2: 상품명 추출
    console.log("\n" + "─".repeat(40));
    console.log("📝 Step 2: 상품명 추출");
    console.log("─".repeat(40));

    const productName = await page.evaluate(() => {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) {
        return ogTitle.getAttribute("content")?.replace(/ : .*$/, "") || null;
      }
      return document.title?.replace(/ : .*$/, "") || null;
    });

    console.log(`✅ 상품명: ${productName || "(추출 실패)"}`);

    // Step 3: 순위 체크
    console.log("\n" + "─".repeat(40));
    console.log("🏆 Step 3: 순위 체크");
    console.log("─".repeat(40));

    const result = await findAccurateRank(page, KEYWORD, catalogMid, MAX_PAGES);

    // 결과 출력
    console.log("\n" + "=".repeat(60));
    console.log("📊 최종 결과");
    console.log("=".repeat(60));

    console.log(`\n📎 상품 URL: ${PRODUCT_URL}`);
    console.log(`🔑 키워드: ${KEYWORD}`);
    console.log(`🆔 MID: ${catalogMid}`);
    console.log(`📝 상품명: ${productName || "(추출 실패)"}`);

    if (result) {
      if (result.blocked) {
        console.log(`\n🛑 차단됨 (CAPTCHA)`);
      } else if (result.found) {
        console.log(`\n🏆 순위 정보:`);
        console.log(`   전체 순위: ${result.totalRank}위`);
        console.log(`   오가닉 순위: ${result.organicRank > 0 ? result.organicRank + "위" : "-"}`);
        console.log(`   페이지: ${result.page}페이지 / ${result.pagePosition}번째`);
        console.log(`   광고 여부: ${result.isAd ? "광고" : "일반"}`);
      } else {
        console.log(`\n❌ ${MAX_PAGES}페이지 내에서 순위를 찾지 못했습니다.`);
      }
    } else {
      console.log(`\n⚠️ 순위 체크 실패`);
    }

    console.log("\n" + "=".repeat(60));

  } catch (error: any) {
    console.error(`\n❌ 에러 발생: ${error.message}`);
  } finally {
    console.log("\n⏳ 10초 후 브라우저 종료...");
    await new Promise((r) => setTimeout(r, 10000));
    await context.close();
    console.log("👋 완료!");
  }
}

main().catch(console.error);
