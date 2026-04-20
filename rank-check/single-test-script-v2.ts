/**
 * 1회성 테스트 스크립트 v2
 * - API 방식으로 MID 추출 시도
 * - 키워드 검색 순위 확인
 */

import { chromium } from "patchright";
import { findAccurateRank } from "./accurate-rank-checker";

// ========== 설정 ==========
const PRODUCT_URL = "https://smartstore.naver.com/sinjimall_store/products/11485001902";
const KEYWORD = "무선충전기";
const MAX_PAGES = 15;
// ==========================

// 스마트스토어 URL에서 상품번호 추출
function extractChannelProductNo(url: string): string | null {
  const match = url.match(/products\/(\d+)/);
  return match ? match[1] : null;
}

// 네이버 쇼핑에서 키워드+스토어명으로 상품 검색하여 MID 찾기
async function findMidBySearch(page: any, keyword: string, storeName: string): Promise<{mid: string, productName: string} | null> {
  console.log(`🔍 "${keyword}" + "${storeName}"로 상품 검색 중...`);

  const searchUrl = `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(keyword + " " + storeName)}`;

  await page.goto(searchUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await new Promise(r => setTimeout(r, 3000));

  // 스크롤하여 상품 로드
  await page.evaluate(() => window.scrollBy(0, 1000));
  await new Promise(r => setTimeout(r, 2000));

  // 첫 번째 상품 정보 추출
  const result = await page.evaluate(() => {
    const anchor = document.querySelector('a[data-shp-contents-id]');
    if (!anchor) return null;

    const mid = anchor.getAttribute('data-shp-contents-id');

    // 상품명 찾기
    let productName = "상품명 없음";
    let parent: Element | null = anchor;
    for (let i = 0; i < 5 && parent; i++) {
      parent = parent.parentElement;
      if (!parent) break;
      const titleEl = parent.querySelector('[class*="title"], strong, .product_title__Mmw2K');
      if (titleEl && titleEl.textContent) {
        productName = titleEl.textContent.trim();
        break;
      }
    }

    return { mid, productName };
  });

  return result;
}

// 스마트스토어 API로 상품 정보 조회
async function getProductInfoFromAPI(channelProductNo: string): Promise<{mid: string, productName: string} | null> {
  try {
    // 네이버 쇼핑 API 시도
    const apiUrl = `https://search.shopping.naver.com/api/search/all?query=${channelProductNo}&origQuery=${channelProductNo}&pagingIndex=1&pagingSize=40`;

    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://search.shopping.naver.com/',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.log(`⚠️ API 응답 실패: ${response.status}`);
      return null;
    }

    const json = await response.json();
    const products = json.shoppingResult?.products || [];

    // channelProductNo가 일치하는 상품 찾기
    for (const p of products) {
      if (p.channelProductNo === channelProductNo || p.mallProductId === channelProductNo) {
        return {
          mid: p.id || p.nvMid,
          productName: p.productTitle || p.title,
        };
      }
    }

    // 첫 번째 상품 반환 (대안)
    if (products.length > 0) {
      console.log(`⚠️ 정확한 매칭 실패, 첫 번째 검색 결과 사용`);
      return {
        mid: products[0].id || products[0].nvMid,
        productName: products[0].productTitle || products[0].title,
      };
    }

    return null;
  } catch (error: any) {
    console.log(`❌ API 에러: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("🔍 1회성 순위 테스트 스크립트 v2");
  console.log("=".repeat(60));
  console.log(`\n📎 상품 URL: ${PRODUCT_URL}`);
  console.log(`🔑 키워드: ${KEYWORD}\n`);

  // URL에서 상품번호 추출
  const channelProductNo = extractChannelProductNo(PRODUCT_URL);
  console.log(`📋 상품번호 (channelProductNo): ${channelProductNo}`);

  // URL에서 스토어명 추출
  const storeMatch = PRODUCT_URL.match(/smartstore\.naver\.com\/([^\/]+)/);
  const storeName = storeMatch ? storeMatch[1].replace(/_/g, ' ') : '';
  console.log(`🏪 스토어명: ${storeName}`);

  const browser = await chromium.launch({
    headless: false,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--no-sandbox",
    ],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "ko-KR",
  });

  const page = await context.newPage();

  try {
    // Step 1: MID 추출 (여러 방법 시도)
    console.log("\n" + "─".repeat(40));
    console.log("📦 Step 1: MID 추출");
    console.log("─".repeat(40));

    let mid: string | null = null;
    let productName: string | null = null;

    // 방법 1: 네이버 쇼핑에서 키워드+스토어명으로 검색
    console.log("\n[방법 1] 네이버 쇼핑 검색으로 MID 찾기...");
    const searchResult = await findMidBySearch(page, KEYWORD, storeName);

    if (searchResult) {
      mid = searchResult.mid;
      productName = searchResult.productName;
      console.log(`✅ 검색 결과에서 MID 발견: ${mid}`);
      console.log(`   상품명: ${productName}`);
    }

    if (!mid) {
      // 방법 2: API로 직접 조회
      console.log("\n[방법 2] API로 상품번호 검색...");
      if (channelProductNo) {
        const apiResult = await getProductInfoFromAPI(channelProductNo);
        if (apiResult) {
          mid = apiResult.mid;
          productName = apiResult.productName;
          console.log(`✅ API에서 MID 발견: ${mid}`);
        }
      }
    }

    if (!mid) {
      // 방법 3: 스마트스토어 직접 접속 재시도 (쿠키 설정 후)
      console.log("\n[방법 3] 스마트스토어 직접 접속 재시도...");

      // 먼저 네이버 메인 방문하여 쿠키 획득
      await page.goto("https://www.naver.com/", { waitUntil: "domcontentloaded" });
      await new Promise(r => setTimeout(r, 2000));

      // 스마트스토어 접속
      await page.goto(PRODUCT_URL, { waitUntil: "networkidle", timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));

      const pageTitle = await page.title();
      console.log(`   페이지 제목: ${pageTitle}`);

      if (!pageTitle.includes("에러")) {
        // MID 추출 시도
        mid = await page.evaluate(() => {
          const html = document.documentElement.outerHTML;

          // nvMid 패턴
          let match = html.match(/nvMid["\s:=]+(\d{10,})/);
          if (match) return match[1];

          // catalogId 패턴
          match = html.match(/catalogId["\s:=]+(\d{10,})/);
          if (match) return match[1];

          // productId 패턴
          match = html.match(/"productId"\s*:\s*"?(\d{10,})"?/);
          if (match) return match[1];

          return null;
        });

        productName = await page.evaluate(() => {
          const ogTitle = document.querySelector('meta[property="og:title"]');
          if (ogTitle) return ogTitle.getAttribute("content");
          return document.title?.replace(/ : .*$/, "") || null;
        });

        if (mid) {
          console.log(`✅ 페이지에서 MID 발견: ${mid}`);
        }
      }
    }

    if (!mid) {
      console.log("\n❌ 모든 방법으로 MID 추출 실패!");
      console.log("   수동으로 MID를 입력하거나 URL을 확인해주세요.");
      await browser.close();
      return;
    }

    console.log(`\n✅ 최종 MID: ${mid}`);
    console.log(`✅ 상품명: ${productName || "(추출 실패)"}`);

    // Step 2: 순위 체크
    console.log("\n" + "─".repeat(40));
    console.log("🏆 Step 2: 순위 체크");
    console.log("─".repeat(40));

    // 새 페이지에서 순위 체크
    const rankPage = await context.newPage();

    const result = await findAccurateRank(rankPage, KEYWORD, mid, MAX_PAGES);

    await rankPage.close();

    // 결과 출력
    console.log("\n" + "=".repeat(60));
    console.log("📊 최종 결과");
    console.log("=".repeat(60));

    console.log(`\n📎 상품 URL: ${PRODUCT_URL}`);
    console.log(`🔑 키워드: ${KEYWORD}`);
    console.log(`🆔 MID: ${mid}`);
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
    await browser.close();
    console.log("👋 완료!");
  }
}

main().catch(console.error);
