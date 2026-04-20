#!/usr/bin/env npx tsx
/**
 * MID 순위 확인 - 클릭 기반 페이지 이동
 * 네이버 메인 → 키워드 검색 → 쇼핑 더보기 → 페이지 클릭
 */

import { connect } from "puppeteer-real-browser";

const KEYWORD = process.argv[2] || "장난감";
const TARGET_MID = process.argv[3] || "21435512812";

async function main() {
  console.log(`🔍 키워드: ${KEYWORD}`);
  console.log(`🎯 타겟 MID: ${TARGET_MID}\n`);

  const { browser, page } = await connect({
    headless: false,
    turnstile: true,
  });

  try {
    // 1. 네이버 메인 → 검색
    await page.goto("https://www.naver.com/");
    await new Promise((r) => setTimeout(r, 1500));

    const searchInput = await page.$('input[name="query"]');
    await searchInput?.click();
    await page.keyboard.type(KEYWORD, { delay: 80 });
    await page.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 3000));
    console.log("1. 통합검색 완료");

    // 2. 쇼핑 더보기 클릭
    await page.evaluate(() => {
      const link = document.querySelector('a[href*="search.shopping.naver.com"]');
      if (link) {
        link.removeAttribute("target");
        (link as HTMLAnchorElement).click();
      }
    });
    await new Promise((r) => setTimeout(r, 4000));
    console.log(`2. 쇼핑 검색 진입: ${page.url()}`);

    // CAPTCHA 확인
    let blocked = await page.evaluate(() =>
      document.body.innerText.includes("보안 확인")
    );
    if (blocked) {
      console.log("❌ CAPTCHA!");
      await browser.close();
      return;
    }

    let totalMids = 0;
    let foundRank = -1;
    let currentPage = 1;

    // 3. 페이지별 확인 (최대 10페이지)
    while (currentPage <= 10 && foundRank === -1) {
      console.log(`\n📄 페이지 ${currentPage} 확인 중...`);

      // 스크롤해서 모든 상품 로드
      for (let s = 0; s < 5; s++) {
        await page.evaluate(() => window.scrollBy(0, 600));
        await new Promise((r) => setTimeout(r, 400));
      }

      // MID 추출
      const mids = await page.evaluate(() => {
        const results: string[] = [];
        document.querySelectorAll("a").forEach((a) => {
          const href = (a as HTMLAnchorElement).href || "";
          const patterns = [
            /nv_mid=(\d+)/,
            /nvMid=(\d+)/,
            /product\?p=(\d+)/,
            /catalog\/(\d+)/,
            /products\/(\d+)/,
          ];
          for (const p of patterns) {
            const m = href.match(p);
            if (m && !results.includes(m[1])) results.push(m[1]);
          }
        });
        return results;
      });

      console.log(`   ${mids.length}개 MID 발견`);

      // 타겟 찾기
      const idx = mids.indexOf(TARGET_MID);
      if (idx >= 0) {
        foundRank = totalMids + idx + 1;
        console.log(`\n✅ MID ${TARGET_MID} 발견!`);
        console.log(`   현재 순위: ${foundRank}위 (페이지 ${currentPage}, 위치 ${idx + 1})`);
        break;
      }

      totalMids += mids.length;

      // 다음 페이지 버튼 클릭
      const nextClicked = await page.evaluate((nextPage: number) => {
        // 페이지 번호 버튼 찾기
        const buttons = document.querySelectorAll('a[class*="pagination"], button[class*="page"], a[href*="pagingIndex"]');
        for (const btn of buttons) {
          const text = btn.textContent?.trim();
          if (text === String(nextPage)) {
            (btn as HTMLElement).click();
            return true;
          }
        }

        // 또는 "다음" 버튼
        const nextBtn = document.querySelector('a[class*="next"], button[class*="next"]');
        if (nextBtn) {
          (nextBtn as HTMLElement).click();
          return true;
        }

        return false;
      }, currentPage + 1);

      if (!nextClicked) {
        console.log(`   → 다음 페이지 버튼 없음`);
        break;
      }

      await new Promise((r) => setTimeout(r, 3000));

      // CAPTCHA 재확인
      blocked = await page.evaluate(() =>
        document.body.innerText.includes("보안 확인")
      );
      if (blocked) {
        console.log(`   → 페이지 ${currentPage + 1}에서 CAPTCHA!`);
        break;
      }

      currentPage++;
    }

    if (foundRank === -1) {
      console.log(`\n❌ MID ${TARGET_MID} 못 찾음`);
      console.log(`   총 ${totalMids}개 확인 (${currentPage}페이지까지)`);
    }

    await new Promise((r) => setTimeout(r, 5000));
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
