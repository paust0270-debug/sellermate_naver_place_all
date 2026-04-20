#!/usr/bin/env npx tsx
/**
 * 순위 체크 (puppeteer-real-browser 기반)
 *
 * collect-products-browser.ts 로직 기반
 * 메인 키워드로 네이버 쇼핑탭에서 MID 찾아서 순위 반환
 */

import { connect } from "puppeteer-real-browser";

// 테스트용 상품 (Supabase에서 가져온 첫 번째 상품)
const TEST_KEYWORD = "장난감";
const TEST_MID = "85786220552";
const TEST_PRODUCT_NAME = "인형 뽑기기계 장난감 크레인 캡슐뽑기 캡슐토이";
const CURRENT_RANK = 201;

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function checkRankByKeyword(
  page: any,
  keyword: string,
  targetMid: string
): Promise<number | null> {

  // 1. 네이버 모바일 접속
  console.log("[1] 네이버 모바일 접속...");
  await page.goto("https://m.naver.com/", { waitUntil: "domcontentloaded", timeout: 15000 });
  await delay(1500);
  console.log(`    URL: ${page.url()}`);

  // 2. 메인 키워드 검색
  console.log(`[2] 키워드 검색: "${keyword}"...`);
  await page.evaluate((kw: string) => {
    const input = document.querySelector('input[type="search"], input[name="query"]') as HTMLInputElement;
    if (input) {
      input.value = kw;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const form = input.closest('form');
      if (form) form.submit();
    }
  }, keyword);

  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
  await delay(2000);
  console.log(`    URL: ${page.url().substring(0, 60)}...`);

  // 3. 쇼핑 탭 클릭
  console.log("[3] 쇼핑 탭 클릭...");
  const shoppingClicked = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('a'));
    for (const tab of tabs) {
      const text = tab.textContent || '';
      const href = tab.href || '';
      if (text.includes('쇼핑') && !text.includes('더보기')) {
        (tab as HTMLElement).click();
        return true;
      }
    }
    return false;
  });

  if (shoppingClicked) {
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
    await delay(2000);
    console.log(`    → 쇼핑탭 이동 완료`);
    console.log(`    URL: ${page.url().substring(0, 60)}...`);
  } else {
    console.log("    → 쇼핑탭 없음, 현재 페이지에서 검색");
  }

  // 4. 스크롤하면서 MID 찾기
  console.log(`[4] MID ${targetMid} 찾는 중...`);

  let foundRank: number | null = null;
  let totalChecked = 0;

  for (let scroll = 0; scroll < 20 && foundRank === null; scroll++) {
    const result = await page.evaluate((mid: string) => {
      const links = Array.from(document.querySelectorAll("a"));

      // 스마트스토어 상품 링크만 필터
      const productLinks = links.filter((link: any) => {
        const href = link.href || "";
        return (href.includes("smartstore.naver.com") || href.includes("brand.naver.com"))
               && href.includes("/products/");
      });

      // 중복 제거
      const uniqueHrefs = new Set<string>();
      const uniqueLinks: string[] = [];
      for (const link of productLinks) {
        const href = (link as HTMLAnchorElement).href;
        if (!uniqueHrefs.has(href)) {
          uniqueHrefs.add(href);
          uniqueLinks.push(href);
        }
      }

      // MID 찾기
      for (let i = 0; i < uniqueLinks.length; i++) {
        if (uniqueLinks[i].includes(mid)) {
          return { found: true, rank: i + 1, total: uniqueLinks.length };
        }
      }

      return { found: false, rank: null, total: uniqueLinks.length };
    }, targetMid);

    totalChecked = result.total;

    if (result.found && result.rank) {
      foundRank = result.rank;
      console.log(`    → 발견! ${totalChecked}개 중 ${foundRank}번째`);
      break;
    }

    // 스크롤
    await page.evaluate(() => window.scrollBy(0, 800));
    await delay(1000);

    if (scroll % 5 === 4) {
      console.log(`    스크롤 ${scroll + 1}회... (${totalChecked}개 상품 확인)`);
    }
  }

  if (foundRank === null) {
    console.log(`    → 미발견 (${totalChecked}개 상품 확인, 순위권 밖)`);
  }

  return foundRank;
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("순위 체크 테스트 (puppeteer-real-browser)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log(`상품: ${TEST_PRODUCT_NAME}`);
  console.log(`키워드: "${TEST_KEYWORD}"`);
  console.log(`MID: ${TEST_MID}`);
  console.log(`작업 전 순위: ${CURRENT_RANK}위\n`);

  const { page, browser } = await connect({
    headless: false,
    turnstile: true,
    fingerprint: true,
  });

  try {
    const rank = await checkRankByKeyword(page, TEST_KEYWORD, TEST_MID);

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
      console.log("순위권 밖 (200위 이상)");
    }

    await delay(3000);
  } catch (e: any) {
    console.log(`Error: ${e.message}`);
  }

  await browser.close();
}

main().catch(console.error);
