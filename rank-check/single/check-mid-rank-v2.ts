#!/usr/bin/env npx tsx
/**
 * 특정 MID의 현재 순위 확인 (페이지네이션 지원)
 */

import "dotenv/config";
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
    // 네이버 메인 → 검색
    await page.goto("https://www.naver.com/");
    await new Promise((r) => setTimeout(r, 1500));

    const searchInput = await page.$('input[name="query"]');
    await searchInput?.click();
    await page.keyboard.type(KEYWORD, { delay: 80 });
    await page.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 3000));

    // 쇼핑 더보기 클릭
    await page.evaluate(() => {
      const link = document.querySelector('a[href*="search.shopping.naver.com"]');
      if (link) {
        link.removeAttribute("target");
        (link as HTMLAnchorElement).click();
      }
    });
    await new Promise((r) => setTimeout(r, 4000));

    console.log(`URL: ${page.url()}\n`);

    let totalMids = 0;
    let foundRank = -1;

    // 페이지별로 확인 (최대 10페이지 = 400위)
    for (let pageNum = 1; pageNum <= 10; pageNum++) {
      // 페이지 URL
      const pageUrl = `https://search.shopping.naver.com/search/all?where=all&frm=NVSCTAB&query=${encodeURIComponent(KEYWORD)}&pagingIndex=${pageNum}&pagingSize=40`;

      if (pageNum > 1) {
        await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
        await new Promise((r) => setTimeout(r, 3000));
      }

      // CAPTCHA 확인
      const blocked = await page.evaluate(() =>
        document.body.innerText.includes("보안 확인")
      );
      if (blocked) {
        console.log(`❌ 페이지 ${pageNum}: CAPTCHA!`);
        break;
      }

      // 스크롤해서 모든 상품 로드
      for (let s = 0; s < 5; s++) {
        await page.evaluate(() => window.scrollBy(0, 800));
        await new Promise((r) => setTimeout(r, 500));
      }

      // MID 추출
      const mids = await page.evaluate(() => {
        const results: string[] = [];
        const links = Array.from(document.querySelectorAll("a"));

        for (const link of links) {
          const href = link.href || "";
          const patterns = [
            /nv_mid=(\d+)/,
            /nvMid=(\d+)/,
            /product\?p=(\d+)/,
            /catalog\/(\d+)/,
            /products\/(\d+)/,
          ];
          for (const p of patterns) {
            const match = href.match(p);
            if (match && !results.includes(match[1])) {
              results.push(match[1]);
            }
          }
        }
        return results;
      });

      console.log(`페이지 ${pageNum}: ${mids.length}개 MID`);

      // 타겟 찾기
      const idx = mids.indexOf(TARGET_MID);
      if (idx >= 0) {
        foundRank = totalMids + idx + 1;
        console.log(`\n✅ MID ${TARGET_MID} 발견!`);
        console.log(`   현재 순위: ${foundRank}위 (페이지 ${pageNum}, 위치 ${idx + 1})`);
        break;
      }

      totalMids += mids.length;

      if (mids.length === 0) {
        console.log(`   → 상품 없음, 종료`);
        break;
      }
    }

    if (foundRank === -1) {
      console.log(`\n❌ MID ${TARGET_MID} 못 찾음`);
      console.log(`   총 ${totalMids}개 확인 → ${totalMids}위 밖`);
    }

    await new Promise((r) => setTimeout(r, 3000));
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
