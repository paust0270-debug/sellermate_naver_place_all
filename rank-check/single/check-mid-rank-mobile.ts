#!/usr/bin/env npx tsx
/**
 * 모바일 쇼핑에서 MID 순위 확인
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
    let totalMids = 0;
    let foundRank = -1;

    // 모바일 쇼핑 페이지별 확인 (6페이지부터 = 200위권)
    for (let pageNum = 1; pageNum <= 15; pageNum++) {
      const url = `https://msearch.shopping.naver.com/search/all?query=${encodeURIComponent(KEYWORD)}&pagingIndex=${pageNum}`;

      await page.goto(url, { waitUntil: "domcontentloaded" });
      await new Promise((r) => setTimeout(r, 3000));

      // CAPTCHA 확인
      const blocked = await page.evaluate(() =>
        document.body.innerText.includes("보안 확인") ||
        document.body.innerText.includes("일시적으로 제한")
      );

      if (blocked) {
        console.log(`페이지 ${pageNum}: ❌ CAPTCHA/차단`);
        break;
      }

      // MID 추출
      const mids = await page.evaluate(() => {
        const results: string[] = [];
        document.querySelectorAll("a").forEach((a) => {
          const href = (a as HTMLAnchorElement).href || "";
          const patterns = [/products\/(\d+)/, /catalog\/(\d+)/, /nvMid=(\d+)/];
          for (const p of patterns) {
            const m = href.match(p);
            if (m && !results.includes(m[1])) results.push(m[1]);
          }
        });
        return results;
      });

      console.log(`페이지 ${pageNum}: ${mids.length}개 MID (${totalMids + 1}~${totalMids + mids.length}위)`);

      // 타겟 찾기
      const idx = mids.indexOf(TARGET_MID);
      if (idx >= 0) {
        foundRank = totalMids + idx + 1;
        console.log(`\n✅ MID ${TARGET_MID} 발견!`);
        console.log(`   현재 순위: ${foundRank}위`);
        break;
      }

      totalMids += mids.length;

      if (mids.length === 0) {
        console.log(`   → 상품 없음`);
        break;
      }
    }

    if (foundRank === -1) {
      console.log(`\n❌ MID ${TARGET_MID} 못 찾음 (${totalMids}개 확인)`);
    }

    await new Promise((r) => setTimeout(r, 3000));
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
