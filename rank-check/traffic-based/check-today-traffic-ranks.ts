#!/usr/bin/env npx tsx
/**
 * 오늘 트래픽 성공 상품 순위 체크
 *
 * Supabase abTestProducts 테이블에서:
 * - status = 'completed' (트래픽 완료)
 * - executedAt이 오늘 날짜인 상품들
 *
 * 메인 키워드로 네이버 쇼핑탭에서 순위 확인
 */

import { connect } from "puppeteer-real-browser";
import * as fs from "fs";

const SUPABASE_URL = "https://hdtjkaieulphqwmcjhcx.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkdGprYWlldWxwaHF3bWNqaGN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2Mzg3OTMzNSwiZXhwIjoyMDc5NDU1MzM1fQ.Jn6RiB8H-_pEZ9BW9x9Mqt4fW-XTj0M3gEAShWDjOtE";

interface AbTestProduct {
  id: number;
  mid: string;
  keyword: string;
  productName: string;
  currentRank: number | null;
  finalRank: number | null;
  rankChange: number | null;
  workType: string;
  status: string;
  trafficCount: number;
  successCount: number;
  executedAt: string | null;
  checkedAt: string | null;
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * 오늘 날짜 범위 계산 (UTC 기준)
 */
function getTodayRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

/**
 * Supabase에서 오늘 트래픽 완료된 상품 조회
 */
async function getTodayCompletedProducts(): Promise<AbTestProduct[]> {
  const { start, end } = getTodayRange();

  // status가 completed이고 executedAt이 오늘인 상품
  const url = `${SUPABASE_URL}/rest/v1/abTestProducts?select=*&status=eq.completed&executedAt=gte.${start}&executedAt=lt.${end}&order=id.asc`;

  console.log(`조회 기간: ${start} ~ ${end}`);

  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Supabase 조회 실패: ${res.status}`);
  }

  return res.json();
}

/**
 * 메인 키워드로 네이버 쇼핑탭에서 순위 체크
 */
async function checkRankByKeyword(
  page: any,
  keyword: string,
  mid: string
): Promise<number | null> {
  try {
    // 1. 네이버 모바일 접속
    await page.goto("https://m.naver.com/", { waitUntil: "domcontentloaded", timeout: 15000 });
    await delay(1500);

    // 2. 메인 키워드 검색
    const searchDone = await page.evaluate((kw: string) => {
      const input = document.querySelector('input[type="search"], input[name="query"]') as HTMLInputElement;
      if (input) {
        input.value = kw;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const form = input.closest('form');
        if (form) {
          form.submit();
          return true;
        }
      }
      return false;
    }, keyword);

    if (!searchDone) {
      console.log("    검색 입력 실패");
      return null;
    }

    await delay(2500);

    // 3. 쇼핑 탭 클릭
    const shoppingClicked = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('a'));
      for (const tab of tabs) {
        const text = tab.textContent || '';
        const href = tab.href || '';
        if (text.includes('쇼핑') || href.includes('shopping.naver')) {
          (tab as HTMLElement).click();
          return true;
        }
      }
      return false;
    });

    if (!shoppingClicked) {
      console.log("    쇼핑탭 없음 - 검색 결과 내 쇼핑 영역에서 확인");
    }

    await delay(2500);

    // 4. 스크롤하면서 MID 찾기 (최대 200위까지)
    let foundRank: number | null = null;
    let totalProducts = 0;

    for (let scroll = 0; scroll < 15 && foundRank === null; scroll++) {
      const result = await page.evaluate((targetMid: string) => {
        const links = Array.from(document.querySelectorAll("a"));

        // 스마트스토어/브랜드스토어 상품 링크만 필터
        const productLinks = links.filter((link: any) => {
          const href = link.href || "";
          return (href.includes("smartstore.naver.com") || href.includes("brand.naver.com"))
                 && href.includes("/products/");
        });

        // 중복 제거 (같은 href)
        const uniqueLinks: HTMLAnchorElement[] = [];
        const seen = new Set<string>();
        for (const link of productLinks) {
          const href = (link as HTMLAnchorElement).href;
          if (!seen.has(href)) {
            seen.add(href);
            uniqueLinks.push(link as HTMLAnchorElement);
          }
        }

        // MID 찾기
        for (let i = 0; i < uniqueLinks.length; i++) {
          const href = uniqueLinks[i].href;
          if (href.includes(targetMid)) {
            return { found: true, rank: i + 1, total: uniqueLinks.length };
          }
        }

        return { found: false, rank: null, total: uniqueLinks.length };
      }, mid);

      totalProducts = result.total;

      if (result.found && result.rank) {
        foundRank = result.rank;
        break;
      }

      // 더 스크롤
      await page.evaluate(() => window.scrollBy(0, 1000));
      await delay(1200);
    }

    if (foundRank === null) {
      console.log(`    순위권 밖 (${totalProducts}개 상품 중 미발견)`);
    }

    return foundRank;

  } catch (e: any) {
    console.log(`    Error: ${e.message}`);
    return null;
  }
}

/**
 * Supabase에 순위 업데이트
 */
async function updateRankResult(
  id: number,
  finalRank: number | null,
  currentRank: number | null
): Promise<void> {
  const rankChange = (currentRank && finalRank) ? (currentRank - finalRank) : null;

  await fetch(`${SUPABASE_URL}/rest/v1/abTestProducts?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      finalRank: finalRank || -1, // -1 = 순위권 밖
      rankChange,
      checkedAt: new Date().toISOString(),
    }),
  });
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("오늘 트래픽 완료 상품 순위 체크");
  console.log(`실행 시각: ${new Date().toLocaleString("ko-KR")}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // 1. 오늘 완료된 상품 조회
  const products = await getTodayCompletedProducts();

  if (products.length === 0) {
    console.log("오늘 트래픽 완료된 상품이 없습니다.");
    return;
  }

  console.log(`대상 상품: ${products.length}개\n`);

  // 2. 브라우저 시작
  const { page, browser } = await connect({
    headless: false,
    turnstile: true,
    fingerprint: true,
  });

  const results: {
    id: number;
    name: string;
    keyword: string;
    mid: string;
    before: number | null;
    after: number | null;
    change: number | null;
    workType: string;
  }[] = [];

  // 3. 각 상품 순위 체크
  for (let i = 0; i < products.length; i++) {
    const product = products[i];

    console.log(`[${i + 1}/${products.length}] ${product.productName.substring(0, 35)}...`);
    console.log(`    키워드: "${product.keyword}" | MID: ${product.mid}`);
    console.log(`    작업 전: ${product.currentRank ?? "미확인"}위 | 작업유형: ${product.workType}`);

    const newRank = await checkRankByKeyword(page, product.keyword, product.mid);

    if (newRank !== null) {
      const change = product.currentRank ? (product.currentRank - newRank) : null;
      const changeStr = change !== null
        ? (change > 0 ? `↑${change}` : change < 0 ? `↓${Math.abs(change)}` : "→0")
        : "N/A";

      console.log(`    → 현재: ${newRank}위 (${changeStr})\n`);

      await updateRankResult(product.id, newRank, product.currentRank);

      results.push({
        id: product.id,
        name: product.productName.substring(0, 40),
        keyword: product.keyword,
        mid: product.mid,
        before: product.currentRank,
        after: newRank,
        change,
        workType: product.workType,
      });
    } else {
      console.log(`    → 순위권 밖 또는 측정 실패\n`);

      await updateRankResult(product.id, null, product.currentRank);

      results.push({
        id: product.id,
        name: product.productName.substring(0, 40),
        keyword: product.keyword,
        mid: product.mid,
        before: product.currentRank,
        after: null,
        change: null,
        workType: product.workType,
      });
    }

    // 브라우저 쉬기 (봇 감지 방지)
    if (i > 0 && i % 5 === 0) {
      console.log("  [5개 체크 완료 - 10초 휴식]\n");
      await delay(10000);
    } else {
      await delay(3000);
    }
  }

  await browser.close();

  // 4. 결과 요약
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("순위 변화 요약");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const measured = results.filter(r => r.after !== null);
  const notFound = results.filter(r => r.after === null);

  // 순위 상승 상품
  const improved = measured.filter(r => r.change !== null && r.change > 0);
  const declined = measured.filter(r => r.change !== null && r.change < 0);
  const unchanged = measured.filter(r => r.change !== null && r.change === 0);

  console.log(`측정 성공: ${measured.length}개 | 순위권 밖: ${notFound.length}개\n`);

  if (improved.length > 0) {
    console.log("🎯 순위 상승:");
    improved
      .sort((a, b) => (b.change || 0) - (a.change || 0))
      .forEach(r => {
        console.log(`  [${r.id}] ${r.before}위 → ${r.after}위 (↑${r.change}) - ${r.workType}`);
        console.log(`      "${r.keyword}" | ${r.name}`);
      });
    console.log("");
  }

  if (declined.length > 0) {
    console.log("📉 순위 하락:");
    declined.forEach(r => {
      console.log(`  [${r.id}] ${r.before}위 → ${r.after}위 (↓${Math.abs(r.change!)}) - ${r.workType}`);
    });
    console.log("");
  }

  // 통계
  if (measured.length > 0) {
    const avgChange = measured
      .filter(r => r.change !== null)
      .reduce((sum, r) => sum + (r.change || 0), 0) / measured.filter(r => r.change !== null).length;

    console.log("📊 통계:");
    console.log(`  상승: ${improved.length}개 | 하락: ${declined.length}개 | 변동없음: ${unchanged.length}개`);
    console.log(`  평균 변화: ${avgChange > 0 ? "+" : ""}${avgChange.toFixed(1)}위`);

    // workType별 통계
    const byWorkType = new Map<string, { improved: number; declined: number; total: number }>();
    for (const r of measured) {
      if (!byWorkType.has(r.workType)) {
        byWorkType.set(r.workType, { improved: 0, declined: 0, total: 0 });
      }
      const stat = byWorkType.get(r.workType)!;
      stat.total++;
      if (r.change && r.change > 0) stat.improved++;
      if (r.change && r.change < 0) stat.declined++;
    }

    console.log("\n📊 작업유형별 통계:");
    for (const [type, stat] of byWorkType) {
      const rate = ((stat.improved / stat.total) * 100).toFixed(0);
      console.log(`  ${type}: ${stat.improved}/${stat.total} 상승 (${rate}%)`);
    }
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // 결과 저장
  const filename = `rank-check-${new Date().toISOString().slice(0, 10)}.json`;
  fs.writeFileSync(filename, JSON.stringify(results, null, 2));
  console.log(`\n✓ ${filename} 저장 완료`);
}

main().catch(console.error);
