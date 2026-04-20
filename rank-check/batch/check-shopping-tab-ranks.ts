#!/usr/bin/env npx tsx
/**
 * 쇼핑탭 순위 체크 - 직접 쇼핑탭 URL 진입
 *
 * 흐름:
 * 1. search.shopping.naver.com/search/all?query=키워드 직접 접속
 * 2. 스크롤해서 상품 로드
 * 3. MID 매칭 (광고 포함)
 * 4. 없으면 → 다음 페이지 (최대 15페이지)
 * 5. 있으면 → (페이지-1)*40 + 순위 = 최종 순위
 */

import { connect } from "puppeteer-real-browser";
import * as fs from "fs";

const SUPABASE_URL = "https://hdtjkaieulphqwmcjhcx.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkdGprYWlldWxwaHF3bWNqaGN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2Mzg3OTMzNSwiZXhwIjoyMDc5NDU1MzM1fQ.Jn6RiB8H-_pEZ9BW9x9Mqt4fW-XTj0M3gEAShWDjOtE";

interface Product {
  id: number;
  mid: string;
  keyword: string;
  productName: string;
  currentRank: number | null;
  finalRank: number | null;
  workType: string;
  trafficSuccess: boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Supabase에서 트래픽 성공 상품 조회
 */
async function getSuccessProducts(): Promise<Product[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/abTestProducts?select=*&trafficSuccess=eq.true&order=id.asc`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  );
  return res.json();
}

/**
 * Supabase에 순위 업데이트
 */
async function updateFinalRank(id: number, finalRank: number | null): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/abTestProducts?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      finalRank: finalRank ?? -1,
    }),
  });
}

/**
 * 쇼핑탭에서 MID로 순위 찾기 - 직접 URL 진입
 */
async function findRankInShoppingTab(
  page: any,
  keyword: string,
  targetMid: string,
  maxPages: number = 15
): Promise<number | null> {

  // 1. 쇼핑탭 직접 접속
  const shoppingUrl = `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(keyword)}&cat_id=&frm=NVSHATC`;
  console.log(`    쇼핑탭 URL: ${shoppingUrl.substring(0, 60)}...`);

  await page.goto(shoppingUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  await delay(3000);

  // 2. 캡챠 확인
  const blocked = await page.evaluate(() =>
    document.body.innerText.includes("보안 확인") ||
    document.body.innerText.includes("일시적으로 제한") ||
    document.body.innerText.includes("자동 입력 방지")
  );
  if (blocked) {
    console.log("    ❌ 캡챠 감지!");
    return null;
  }

  // 3. 페이지별로 MID 찾기
  let currentPage = 1;

  while (currentPage <= maxPages) {
    // 스크롤해서 모든 상품 로드 (여러 번 스크롤)
    for (let s = 0; s < 8; s++) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await delay(400);
    }

    // MID 추출 및 매칭
    const result = await page.evaluate((mid: string, pageNum: number) => {
      const mids: string[] = [];
      const patterns = [/nv_mid[=:](\d+)/, /nvMid[=:](\d+)/, /products\/(\d+)/, /catalog\/(\d+)/];

      // 모든 링크에서 MID 추출
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

    console.log(`    ${currentPage}페이지: ${result.total}개 상품`);

    if (result.found && result.rank) {
      console.log(`    ✓ 발견! ${currentPage}페이지 ${result.pageRank}번째 → 전체 ${result.rank}위`);
      return result.rank;
    }

    // 다음 페이지로 이동
    const hasNextPage = await page.evaluate((nextPage: number) => {
      // 페이지네이션 버튼 찾기
      const pageButtons = document.querySelectorAll('.pagination_num__B3C28, a[class*="pagination"]');
      for (const btn of pageButtons) {
        if (btn.textContent?.trim() === String(nextPage)) {
          (btn as HTMLElement).click();
          return true;
        }
      }

      // next 버튼
      const nextBtn = document.querySelector('.pagination_next__pZuC6, a[class*="next"]');
      if (nextBtn && !(nextBtn as HTMLElement).classList.contains('pagination_disabled__qUdaH')) {
        (nextBtn as HTMLElement).click();
        return true;
      }

      return false;
    }, currentPage + 1);

    if (!hasNextPage) {
      console.log(`    → ${currentPage}페이지까지만 존재`);
      break;
    }

    await delay(2500);
    currentPage++;
  }

  console.log(`    → ${currentPage}페이지까지 확인, 미발견`);
  return null;
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("쇼핑탭 순위 체크 (직접 URL 진입 방식)");
  console.log(`실행 시각: ${new Date().toLocaleString("ko-KR")}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // 1. 상품 조회
  const products = await getSuccessProducts();
  console.log(`대상 상품: ${products.length}개\n`);

  if (products.length === 0) {
    console.log("트래픽 성공 상품 없음");
    return;
  }

  // 2. 브라우저 시작
  const { page, browser } = await connect({
    headless: false,
    turnstile: true,
    fingerprint: true,
  });

  const results: {
    id: number;
    name: string;
    before: number | null;
    after: number | null;
    change: number | null;
  }[] = [];

  // 3. 각 상품 순위 체크
  for (let i = 0; i < products.length; i++) {
    const product = products[i];

    console.log(`[${i + 1}/${products.length}] ${product.productName.substring(0, 35)}...`);
    console.log(`    키워드: "${product.keyword}" | MID: ${product.mid}`);
    console.log(`    작업 전: ${product.currentRank ?? "미확인"}위`);

    const newRank = await findRankInShoppingTab(page, product.keyword, product.mid);

    if (newRank !== null) {
      const change = product.currentRank ? (product.currentRank - newRank) : null;
      const changeStr = change !== null
        ? (change > 0 ? `↑${change}` : change < 0 ? `↓${Math.abs(change)}` : "→0")
        : "N/A";

      console.log(`    결과: ${newRank}위 (${changeStr})\n`);

      await updateFinalRank(product.id, newRank);

      results.push({
        id: product.id,
        name: product.productName.substring(0, 40),
        before: product.currentRank,
        after: newRank,
        change,
      });
    } else {
      console.log(`    결과: 순위권 밖 또는 캡챠\n`);

      await updateFinalRank(product.id, null);

      results.push({
        id: product.id,
        name: product.productName.substring(0, 40),
        before: product.currentRank,
        after: null,
        change: null,
      });
    }

    // 캡챠 방지: 3개마다 긴 휴식
    if (i > 0 && (i + 1) % 3 === 0) {
      console.log("  [15초 휴식...]\n");
      await delay(15000);
    } else {
      await delay(3000);
    }
  }

  await browser.close();

  // 4. 결과 요약
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("결과 요약");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const measured = results.filter(r => r.after !== null);
  const notFound = results.filter(r => r.after === null);
  const improved = measured.filter(r => r.change !== null && r.change > 0);
  const declined = measured.filter(r => r.change !== null && r.change < 0);

  console.log(`측정 성공: ${measured.length}개 | 순위권 밖/캡챠: ${notFound.length}개\n`);

  if (improved.length > 0) {
    console.log("🎯 순위 상승:");
    improved
      .sort((a, b) => (b.change || 0) - (a.change || 0))
      .forEach(r => {
        console.log(`  [${r.id}] ${r.before}위 → ${r.after}위 (↑${r.change})`);
        console.log(`      ${r.name}`);
      });
    console.log("");
  }

  if (declined.length > 0) {
    console.log("📉 순위 하락:");
    declined.forEach(r => {
      console.log(`  [${r.id}] ${r.before}위 → ${r.after}위 (↓${Math.abs(r.change!)})`);
    });
    console.log("");
  }

  // 통계
  if (measured.length > 0) {
    const validChanges = measured.filter(r => r.change !== null);
    if (validChanges.length > 0) {
      const avgChange = validChanges.reduce((sum, r) => sum + (r.change || 0), 0) / validChanges.length;
      const maxUp = Math.max(...validChanges.map(r => r.change || 0));

      console.log("📊 통계:");
      console.log(`  상승: ${improved.length}개 | 하락: ${declined.length}개`);
      console.log(`  평균 변화: ${avgChange > 0 ? "+" : ""}${avgChange.toFixed(1)}위`);
      console.log(`  최대 상승: ${maxUp}위`);
    }
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // 결과 저장
  const filename = `rank-check-shopping-${new Date().toISOString().slice(0, 10)}.json`;
  fs.writeFileSync(filename, JSON.stringify(results, null, 2));
  console.log(`\n✓ ${filename} 저장 완료`);
}

main().catch(console.error);
