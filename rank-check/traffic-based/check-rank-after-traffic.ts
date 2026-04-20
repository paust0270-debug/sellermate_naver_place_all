#!/usr/bin/env npx tsx
/**
 * 트래픽 완료 후 순위 체크
 * 완료된 상품들의 현재 순위를 확인하고 변화량 계산
 */

import { connect } from "puppeteer-real-browser";
import * as fs from "fs";

const SUPABASE_URL = "https://hdtjkaieulphqwmcjhcx.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkdGprYWlldWxwaHF3bWNqaGN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2Mzg3OTMzNSwiZXhwIjoyMDc5NDU1MzM1fQ.Jn6RiB8H-_pEZ9BW9x9Mqt4fW-XTj0M3gEAShWDjOtE";

interface Product {
  id: number;
  productName: string;
  mid: string;
  keyword: string;
  currentRank: number;
  finalRank: number | null;
  workType: string;
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// 순위 체크 (풀네임으로 검색)
async function checkRank(page: any, keyword: string, mid: string, productName: string): Promise<number | null> {
  try {
    // 모바일 네이버 검색 - 상품 풀네임 사용
    const searchQuery = productName.substring(0, 50); // 풀네임 앞 50자

    await page.goto("https://m.naver.com/", { waitUntil: "domcontentloaded", timeout: 15000 });
    await delay(2000);

    // 검색
    const searchFound = await page.evaluate((searchTerm: string) => {
      const input = document.querySelector('input[type="search"], input[name="query"]') as HTMLInputElement;
      if (input) {
        input.value = searchTerm;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const form = input.closest('form');
        if (form) {
          form.submit();
          return true;
        }
      }
      return false;
    }, searchQuery);

    if (!searchFound) {
      console.log("  검색 입력 실패");
      return null;
    }

    await delay(3000);

    // 쇼핑 탭 클릭
    const shoppingClicked = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('a'));
      for (const tab of tabs) {
        if (tab.textContent?.includes('쇼핑') || tab.href?.includes('shopping')) {
          (tab as HTMLElement).click();
          return true;
        }
      }
      return false;
    });

    if (!shoppingClicked) {
      console.log("  쇼핑탭 없음");
      return null;
    }

    await delay(3000);

    // 스크롤하면서 MID 찾기
    let rank: number | null = null;

    for (let scroll = 0; scroll < 20 && rank === null; scroll++) {
      const result = await page.evaluate((targetMid: string, scrollIndex: number) => {
        const links = Array.from(document.querySelectorAll("a"));
        const smartstoreLinks = links.filter((link: any) => {
          const href = link.href || "";
          return (href.includes("smartstore.naver.com") || href.includes("brand.naver.com"))
                 && href.includes("/products/");
        });

        // MID가 URL에 있는지 확인
        for (let i = 0; i < smartstoreLinks.length; i++) {
          const link = smartstoreLinks[i] as HTMLAnchorElement;
          if (link.href.includes(targetMid)) {
            return { found: true, position: i + 1 + (scrollIndex * 40) };
          }
        }

        return { found: false, position: null };
      }, mid, scroll);

      if (result.found) {
        rank = result.position;
        break;
      }

      // 스크롤
      await page.evaluate(() => window.scrollBy(0, 1000));
      await delay(1000);
    }

    return rank;

  } catch (e: any) {
    console.log("  Error:", e.message);
    return null;
  }
}

// Supabase에 순위 업데이트
async function updateFinalRank(id: number, finalRank: number, rankChange: number): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/abTestProducts?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      finalRank,
      rankChange,
      checkedAt: new Date().toISOString()
    }),
  });
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("트래픽 완료 상품 순위 체크");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // 완료된 상품 로드
  const products: Product[] = JSON.parse(fs.readFileSync("completed-products.json", "utf-8"));
  console.log(`대상 상품: ${products.length}개\n`);

  const { page, browser } = await connect({
    headless: false,
    turnstile: true,
    fingerprint: true,
  });

  const results: any[] = [];

  for (const product of products) {
    console.log(`[${product.id}] ${product.productName.substring(0, 40)}...`);
    console.log(`   검색: "${product.productName.substring(0, 50)}" | MID: ${product.mid}`);
    console.log(`   작업 전: ${product.currentRank}위`);

    const newRank = await checkRank(page, product.keyword, product.mid, product.productName);

    if (newRank !== null) {
      const change = product.currentRank - newRank; // 양수 = 상승
      const changeStr = change > 0 ? `↑${change}` : change < 0 ? `↓${Math.abs(change)}` : "→0";

      console.log(`   → 현재: ${newRank}위 (${changeStr})\n`);

      await updateFinalRank(product.id, newRank, change);

      results.push({
        id: product.id,
        name: product.productName.substring(0, 40),
        before: product.currentRank,
        after: newRank,
        change,
      });
    } else {
      console.log(`   → 순위 측정 실패\n`);
    }

    await delay(2000);
  }

  await browser.close();

  // 결과 요약
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("순위 변화 요약");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // 50위 이상 상승한 상품
  const bigWinners = results.filter(r => r.change >= 50);
  if (bigWinners.length > 0) {
    console.log("🎯 50위 이상 상승:");
    bigWinners.forEach(r => {
      console.log(`  [${r.id}] ${r.before}위 → ${r.after}위 (↑${r.change})`);
      console.log(`      ${r.name}`);
    });
  } else {
    console.log("50위 이상 상승한 상품 없음");
  }

  console.log("");

  // 전체 통계
  const avgChange = results.reduce((sum, r) => sum + r.change, 0) / results.length;
  const improved = results.filter(r => r.change > 0).length;
  const declined = results.filter(r => r.change < 0).length;
  const unchanged = results.filter(r => r.change === 0).length;

  console.log(`측정 성공: ${results.length}개`);
  console.log(`상승: ${improved}개 | 하락: ${declined}개 | 변동없음: ${unchanged}개`);
  console.log(`평균 변화: ${avgChange > 0 ? '+' : ''}${avgChange.toFixed(1)}위`);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // 결과 저장
  fs.writeFileSync("rank-check-results.json", JSON.stringify(results, null, 2));
  console.log("\n✓ rank-check-results.json 저장");
}

main().catch(console.error);
