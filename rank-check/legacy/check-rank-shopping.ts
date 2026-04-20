#!/usr/bin/env npx tsx
/**
 * 쇼핑탭 순위 체크 (collect-products-browser.ts 기반)
 *
 * PC 네이버 → 쇼핑 더보기 → 쇼핑탭에서 MID로 순위 확인
 */

import { connect } from "puppeteer-real-browser";

// 테스트 상품
const TEST_KEYWORD = "장난감";
const TEST_MID = "85786220552";  // 인형 뽑기기계
const TEST_NAME = "인형 뽑기기계 장난감 크레인 캡슐뽑기 캡슐토이";
const CURRENT_RANK = 201;

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function checkRankInShopping(
  page: any,
  keyword: string,
  targetMid: string,
  maxPages: number = 15
): Promise<number | null> {

  // 1. PC 네이버 접속
  console.log("[1] PC 네이버 접속...");
  await page.goto("https://www.naver.com/", { waitUntil: "domcontentloaded", timeout: 15000 });
  await delay(1500);

  // 2. 키워드 검색
  console.log(`[2] 키워드 검색: "${keyword}"...`);
  const searchInput = await page.$('input[name="query"]');
  await searchInput?.click();
  await page.keyboard.type(keyword, { delay: 80 });
  await page.keyboard.press("Enter");
  await delay(3000);
  console.log(`    URL: ${page.url().substring(0, 60)}...`);

  // 3. 쇼핑 더보기 클릭
  console.log("[3] 쇼핑 더보기 클릭...");
  await page.evaluate(() => {
    const link = document.querySelector('a[href*="search.shopping.naver.com"]');
    if (link) {
      link.removeAttribute("target");
      (link as HTMLAnchorElement).click();
    }
  });
  await delay(4000);
  console.log(`    쇼핑탭 URL: ${page.url().substring(0, 60)}...`);

  // 4. 캡챠 확인
  const blocked = await page.evaluate(() =>
    document.body.innerText.includes("보안 확인") || document.body.innerText.includes("일시적으로 제한")
  );
  if (blocked) {
    console.log("❌ 캡챠 감지! 중단");
    return null;
  }

  // 5. 페이지별로 MID 찾기
  console.log(`[4] MID ${targetMid} 찾는 중...`);

  let currentPage = 1;

  while (currentPage <= maxPages) {
    // 스크롤해서 모든 상품 로드
    for (let s = 0; s < 5; s++) {
      await page.evaluate(() => window.scrollBy(0, 600));
      await delay(400);
    }

    // 현재 페이지에서 MID 찾기
    const result = await page.evaluate((mid: string, pageNum: number) => {
      const items: string[] = [];

      document.querySelectorAll("a").forEach((a) => {
        const href = (a as HTMLAnchorElement).href || "";
        const patterns = [/nv_mid=(\d+)/, /nvMid=(\d+)/, /catalog\/(\d+)/, /products\/(\d+)/];

        for (const p of patterns) {
          const m = href.match(p);
          if (m) {
            const foundMid = m[1];
            if (!items.includes(foundMid)) {
              items.push(foundMid);
            }
            break;
          }
        }
      });

      // MID 찾기
      const baseRank = (pageNum - 1) * 40;
      for (let i = 0; i < items.length; i++) {
        if (items[i] === mid) {
          return { found: true, rank: baseRank + i + 1, total: items.length };
        }
      }

      return { found: false, rank: null, total: items.length };
    }, targetMid, currentPage);

    console.log(`    페이지 ${currentPage}: ${result.total}개 상품`);

    if (result.found && result.rank) {
      console.log(`    ✓ 발견! ${result.rank}위`);
      return result.rank;
    }

    // 다음 페이지로
    const nextClicked = await page.evaluate((nextPage: number) => {
      const buttons = document.querySelectorAll('a[class*="pagination"], a[href*="pagingIndex"]');
      for (const btn of buttons) {
        if (btn.textContent?.trim() === String(nextPage)) {
          (btn as HTMLElement).click();
          return true;
        }
      }
      const nextBtn = document.querySelector('a[class*="next"]');
      if (nextBtn) {
        (nextBtn as HTMLElement).click();
        return true;
      }
      return false;
    }, currentPage + 1);

    if (!nextClicked) {
      console.log("    → 다음 페이지 없음");
      break;
    }

    await delay(2000);
    currentPage++;
  }

  console.log(`    → ${currentPage}페이지까지 확인, 미발견`);
  return null;
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("쇼핑탭 순위 체크 (PC 네이버)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log(`상품: ${TEST_NAME}`);
  console.log(`키워드: "${TEST_KEYWORD}"`);
  console.log(`MID: ${TEST_MID}`);
  console.log(`작업 전 순위: ${CURRENT_RANK}위\n`);

  const { page, browser } = await connect({
    headless: false,
    turnstile: true,
    fingerprint: true,
  });

  try {
    const rank = await checkRankInShopping(page, TEST_KEYWORD, TEST_MID);

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("결과");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    if (rank !== null) {
      const change = CURRENT_RANK - rank;
      const changeStr = change > 0 ? `↑${change}` : change < 0 ? `↓${Math.abs(change)}` : "→0";

      console.log(`작업 전: ${CURRENT_RANK}위`);
      console.log(`현재:    ${rank}위`);
      console.log(`변화:    ${changeStr}`);
    } else {
      console.log("순위권 밖 또는 캡챠");
    }

    await delay(3000);
  } catch (e: any) {
    console.log(`Error: ${e.message}`);
  }

  await browser.close();
}

main().catch(console.error);
