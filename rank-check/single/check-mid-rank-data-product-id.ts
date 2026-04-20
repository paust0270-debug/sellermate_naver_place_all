#!/usr/bin/env npx tsx
/**
 * data-product-id 셀렉터 사용 순위 체크
 *
 * Android APK와 동일한 로직:
 * - data-product-id 속성으로 정확한 MID 추출
 * - puppeteer-real-browser로 봇 감지 회피
 * - 페이지별 URL 방식으로 페이지네이션
 */

import "dotenv/config";
import { connect } from "puppeteer-real-browser";

const KEYWORD = process.argv[2] || "장난감";
const TARGET_MID = process.argv[3] || "85786220552";

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log(`🔍 키워드: ${KEYWORD}`);
  console.log(`🎯 타겟 MID: ${TARGET_MID}`);
  console.log(`📱 셀렉터: data-product-id (Android APK 방식)\n`);

  const { page, browser } = await connect({
    headless: false,
    turnstile: true,
    fingerprint: true,
  });

  try {
    let foundRank = -1;
    const MAX_PAGES = 15;

    // 페이지별로 직접 URL 접근 (pagingIndex 파라미터 사용)
    for (let currentPage = 1; currentPage <= MAX_PAGES; currentPage++) {
      // URL 생성 (Android APK 방식)
      const searchUrl = `https://msearch.shopping.naver.com/search/all` +
        `?query=${encodeURIComponent(KEYWORD)}` +
        `&pagingIndex=${currentPage}` +
        `&sort=rel` +
        `&viewType=list` +
        `&productSet=total`;

      console.log(`${currentPage}페이지: ${searchUrl.substring(0, 80)}...`);

      // 페이지 로드
      await page.goto(searchUrl, {
        waitUntil: "domcontentloaded",
        timeout: 15000
      });

      // 상품 로딩 대기
      try {
        await page.waitForSelector('[data-product-id]', { timeout: 3000 });
      } catch (e) {
        console.log(`   ⚠️  data-product-id 셀렉터 타임아웃`);
      }

      await delay(500);

      // MID 추출 및 검색 (Android APK 로직)
      const result = await page.evaluate((targetMid: string, pageNum: number) => {
        const mids: string[] = [];

        // 1. data-product-id 속성 사용 (Android APK 방식)
        const productElements = document.querySelectorAll('[data-product-id]');
        productElements.forEach((el) => {
          const mid = el.getAttribute('data-product-id');
          if (mid && !mids.includes(mid)) {
            mids.push(mid);
          }
        });

        // 2. Fallback: nvMid URL 패턴
        if (mids.length === 0) {
          const links = document.querySelectorAll('a[href*="nvMid="]');
          links.forEach((link) => {
            const href = (link as HTMLAnchorElement).href;
            const match = href.match(/nvMid=(\d+)/);
            if (match && !mids.includes(match[1])) {
              mids.push(match[1]);
            }
          });
        }

        // 타겟 MID 찾기
        const idx = mids.indexOf(targetMid);
        if (idx !== -1) {
          const rank = (pageNum - 1) * 40 + idx + 1;
          return {
            found: true,
            rank,
            pageRank: idx + 1,
            total: mids.length,
            method: productElements.length > 0 ? 'data-product-id' : 'nvMid'
          };
        }

        return {
          found: false,
          rank: null,
          pageRank: null,
          total: mids.length,
          method: productElements.length > 0 ? 'data-product-id' : 'nvMid'
        };
      }, TARGET_MID, currentPage);

      console.log(`   → ${result.total}개 상품 확인 (${result.method} 방식)`);

      if (result.found && result.rank) {
        console.log(`\n✅ MID ${TARGET_MID} 발견!`);
        console.log(`   현재 순위: ${result.rank}위 (${currentPage}페이지 ${result.pageRank}번째)`);
        console.log(`   추출 방식: ${result.method}`);
        foundRank = result.rank;
        break;
      }

      // 다음 페이지로 (delay만 넣고 URL 직접 접근)
      await delay(1500);
    }

    if (foundRank < 0) {
      console.log(`\n❌ ${MAX_PAGES}페이지 (${MAX_PAGES * 40}위)까지 순위권 밖`);
    }

    await browser.close();
  } catch (e: any) {
    console.error("에러:", e.message);
    await browser.close();
  }
}

main();
