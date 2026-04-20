#!/usr/bin/env npx tsx
/**
 * Supabase abTestProducts 테이블 전체에 대해 정확한 네이버 쇼핑 순위를 측정합니다.
 * - data-shp-contents-* 속성 기반으로 전체/오가닉 순위를 모두 계산
 * - AJAX 페이지 전환 검증 (pagingIndex/첫 MID/랭크 변화)
 * - 최대 15페이지(600위)까지 검색
 */

import { connect } from "puppeteer-real-browser";
import * as fs from "fs";
import { findAccurateRank, RankResult } from "../accurate-rank-checker";

const SUPABASE_URL = "https://hdtjkaieulphqwmcjhcx.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkdGprYWlldWxwaHF3bWNqaGN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2Mzg3OTMzNSwiZXhwIjoyMDc5NDU1MzM1fQ.Jn6RiB8H-_pEZ9BW9x9Mqt4fW-XTj0M3gEAShWDjOtE";

interface Product {
  id: number;
  mid: string;
  keyword: string;
  productName: string;
  currentRank: number | null;
  workType: string;
}

interface BatchResultRow {
  id: number;
  keyword: string;
  mid: string;
  productName: string;
  workType: string;
  currentRank: number | null;
  totalRank: number | null;
  organicRank: number | null;
  isAd: boolean | null;
  page: number | null;
  pagePosition: number | null;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getSuccessProducts(): Promise<Product[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/abTestProducts?select=id,mid,keyword,productName,currentRank,workType&trafficSuccess=eq.true&order=id.asc`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  );

  if (!res.ok) {
    throw new Error(`Supabase 조회 실패: ${res.status}`);
  }

  return res.json();
}

async function updateFinalRank(productId: number, rankResult: RankResult | null, currentRank: number | null) {
  const storedRank = rankResult ? resolveStoredRank(rankResult) : null;
  const rankChange =
    storedRank !== null && currentRank !== null ? currentRank - storedRank : storedRank !== null ? null : null;

  const body: Record<string, any> = {
    finalRank: storedRank ?? -1,
    checkedAt: new Date().toISOString(),
    errorMessage: rankResult ? null : "NOT_FOUND_WITHIN_15_PAGES",
  };

  if (rankChange !== null) {
    body.rankChange = rankChange;
  }

  await fetch(`${SUPABASE_URL}/rest/v1/abTestProducts?id=eq.${productId}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
}

function resolveStoredRank(result: RankResult): number {
  if (!result.isAd && result.organicRank > 0) {
    return result.organicRank;
  }
  return result.totalRank;
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("정확 쇼핑 순위 체크 (Supabase abTestProducts)");
  console.log(`실행 시각: ${new Date().toLocaleString("ko-KR")}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const products = await getSuccessProducts();
  if (!products.length) {
    console.log("대상 상품이 없습니다.");
    return;
  }
  console.log(`대상 상품: ${products.length}개\n`);

  const { page, browser } = await connect({
    headless: false,
    turnstile: true,
    fingerprint: true,
  });

  const rows: BatchResultRow[] = [];

  for (let index = 0; index < products.length; index++) {
    const product = products[index];
    console.log(
      `[${index + 1}/${products.length}] ${product.productName.substring(0, 40)}… | 키워드: "${product.keyword}" | MID: ${
        product.mid
      }`
    );

    try {
      const rankResult = await findAccurateRank(page as any, product.keyword, product.mid);

      if (rankResult) {
        console.log(
          `   → 전체 ${rankResult.totalRank}위 / 오가닉 ${
            rankResult.organicRank > 0 ? `${rankResult.organicRank}위` : "광고"
          } / ${rankResult.page}페이지 ${rankResult.pagePosition}번째`
        );
        await updateFinalRank(product.id, rankResult, product.currentRank);

        rows.push({
          id: product.id,
          keyword: product.keyword,
          mid: product.mid,
          productName: product.productName,
          workType: product.workType,
          currentRank: product.currentRank,
          totalRank: rankResult.totalRank,
          organicRank: rankResult.organicRank > 0 ? rankResult.organicRank : null,
          isAd: rankResult.isAd,
          page: rankResult.page,
          pagePosition: rankResult.pagePosition,
        });
      } else {
        console.log("   → 600위 밖 또는 캡챠로 미계측");
        await updateFinalRank(product.id, null, product.currentRank);
        rows.push({
          id: product.id,
          keyword: product.keyword,
          mid: product.mid,
          productName: product.productName,
          workType: product.workType,
          currentRank: product.currentRank,
          totalRank: null,
          organicRank: null,
          isAd: null,
          page: null,
          pagePosition: null,
        });
      }
    } catch (error: any) {
      console.log(`   → 오류 발생: ${error.message || error}`);
    }

    if (index > 0 && index % 5 === 0) {
      console.log("⏸️ 10초 휴식\n");
      await delay(10000);
    } else {
      await delay(2600);
    }
  }

  await browser.close();

  const filename = `rank-check-accurate-${new Date().toISOString().slice(0, 10)}.json`;
  fs.writeFileSync(filename, JSON.stringify(rows, null, 2));
  console.log(`\n📁 ${filename} 저장 완료`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

main().catch(err => {
  console.error("🚨 배치 순위 체크 실패:", err);
});
