#!/usr/bin/env npx tsx
/**
 * 특정 MID의 현재 순위 확인 (배치 스크립트 방식 사용)
 */

import "dotenv/config";
import { connect } from "puppeteer-real-browser";

const KEYWORD = process.argv[2] || "장난감";
const TARGET_MID = process.argv[3] || "21435512812";

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function findRankInShopping(
  page: any,
  keyword: string,
  targetMid: string,
  maxPages: number = 15
): Promise<number | null> {

  // 1. PC 네이버 접속
  await page.goto("https://www.naver.com/", { waitUntil: "domcontentloaded", timeout: 15000 });
  await delay(1500);

  // 2. 키워드 검색
  const searchInput = await page.$('input[name="query"]');
  if (!searchInput) {
    console.log("검색창 못 찾음");
    return null;
  }
  await searchInput.click();
  await page.keyboard.type(keyword, { delay: 50 });
  await page.keyboard.press("Enter");
  await delay(3000);

  // 3. 쇼핑 더보기 클릭
  const shoppingClicked = await page.evaluate(() => {
    const link = document.querySelector('a[href*="search.shopping.naver.com"]');
    if (link) {
      link.removeAttribute("target");
      (link as HTMLAnchorElement).click();
      return true;
    }
    return false;
  });

  if (!shoppingClicked) {
    console.log("쇼핑 더보기 링크 없음");
    return null;
  }

  await delay(4000);

  // 3.5. 쇼핑탭 URL 확인
  const currentUrl = page.url();
  console.log(`쇼핑탭 URL: ${currentUrl.substring(0, 60)}...\n`);

  if (!currentUrl.includes("search.shopping.naver.com")) {
    console.log("⚠️ 쇼핑탭 진입 실패");
    return null;
  }

  // 4. 캡챠 확인
  const blocked = await page.evaluate(() =>
    document.body.innerText.includes("보안 확인") ||
    document.body.innerText.includes("일시적으로 제한") ||
    document.body.innerText.includes("자동 입력 방지")
  );
  if (blocked) {
    console.log("❌ 캡챠 감지!");
    return null;
  }

  // 5. 페이지별로 MID 찾기
  let currentPage = 1;

  while (currentPage <= maxPages) {
    // 스크롤해서 모든 상품 로드 (충분히 스크롤)
    for (let s = 0; s < 10; s++) {
      await page.evaluate(() => window.scrollBy(0, 500));
      await delay(300);
    }

    // MID 추출 및 매칭
    const result = await page.evaluate((mid: string, pageNum: number) => {
      const mids: string[] = [];
      const patterns = [/nv_mid[=:](\d+)/, /nvMid[=:](\d+)/, /products\/(\d+)/, /catalog\/(\d+)/];

      document.querySelectorAll("a").forEach((a) => {
        const href = (a as HTMLAnchorElement).href || "";
        for (const p of patterns) {
          const m = href.match(p);
          if (m && !mids.includes(m[1])) {
            mids.push(m[1]);
            break;
          }
        }
      });

      // 타겟 MID 찾기
      const idx = mids.indexOf(mid);
      if (idx !== -1) {
        const rank = (pageNum - 1) * 40 + idx + 1;
        return { found: true, rank, pageRank: idx + 1, total: mids.length };
      }

      return { found: false, rank: null, pageRank: null, total: mids.length };
    }, targetMid, currentPage);

    console.log(`${currentPage}페이지: ${result.total}개 상품`);

    if (result.found && result.rank) {
      console.log(`✓ 발견! ${result.pageRank}번째 (전체 ${result.rank}위)`);
      return result.rank;
    }

    // 다음 페이지로
    const nextClicked = await page.evaluate((nextPage: number) => {
      // 쇼핑탭 페이지네이션 셀렉터
      const selectors = [
        '.pagination_num__B3C28',
        'a[class*="pagination"]',
        'a[href*="pagingIndex"]'
      ];

      for (const sel of selectors) {
        const buttons = document.querySelectorAll(sel);
        for (const btn of buttons) {
          if (btn.textContent?.trim() === String(nextPage)) {
            (btn as HTMLElement).click();
            return true;
          }
        }
      }

      // next 버튼 찾기
      const nextSelectors = ['.pagination_next__pZuC6', 'a[class*="next"]'];
      for (const sel of nextSelectors) {
        const nextBtn = document.querySelector(sel);
        if (nextBtn && !(nextBtn as HTMLElement).classList.contains('pagination_disabled__qUdaH')) {
          (nextBtn as HTMLElement).click();
          return true;
        }
      }
      return false;
    }, currentPage + 1);

    if (!nextClicked) {
      console.log(`→ ${currentPage}페이지까지만 존재`);
      break;
    }

    await delay(2500);
    currentPage++;
  }

  console.log(`→ ${currentPage}페이지까지 확인, 미발견`);
  return null;
}

async function main() {
  console.log(`🔍 키워드: ${KEYWORD}`);
  console.log(`🎯 타겟 MID: ${TARGET_MID}\n`);

  const { page, browser } = await connect({
    headless: false,
    turnstile: true,
    fingerprint: true,
  });

  try {
    const rank = await findRankInShopping(page, KEYWORD, TARGET_MID);

    if (rank) {
      console.log(`\n✅ 최종 순위: ${rank}위`);
    } else {
      console.log(`\n❌ 순위권 밖`);
    }

    await browser.close();
  } catch (e: any) {
    console.error("에러:", e.message);
    await browser.close();
  }
}

main();
