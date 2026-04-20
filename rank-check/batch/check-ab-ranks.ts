#!/usr/bin/env npx tsx
/**
 * A/B 테스트 완료 상품 순위 체크 (기존 naverBot 사용)
 */

import { NaverShoppingBot } from "./server/services/naverBot";
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

async function getCompletedProducts(): Promise<Product[]> {
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
      checkedAt: new Date().toISOString(),
    }),
  });
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("A/B 테스트 완료 상품 순위 체크");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const products = await getCompletedProducts();
  console.log(`대상 상품: ${products.length}개\n`);

  // Use HTTP-only mode (no Puppeteer) to avoid request interception errors
  const bot = new NaverShoppingBot(false, "advanced-http");

  const results: any[] = [];

  for (const product of products) {
    console.log(`[${product.id}] ${product.productName.substring(0, 40)}...`);
    console.log(`   키워드: "${product.keyword}" | MID: ${product.mid}`);
    console.log(`   작업 전: ${product.currentRank}위`);

    try {
      // NaverBot의 checkRank 사용
      const task = { id: product.id };
      const campaign = {
        keyword: product.keyword,
        productId: product.mid,
      };

      const result = await bot.checkRank(task as any, campaign as any, {
        keyword: product.keyword,
        productId: product.mid,
        platformProductId: product.mid,
      } as any);

      if (result.rank && result.rank > 0) {
        const newRank = result.rank;
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
        console.log(`   → 순위 측정 실패: ${result.error || "순위권 밖"}\n`);
      }
    } catch (e: any) {
      console.log(`   → Error: ${e.message}\n`);
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  // HTTP mode - no browser to close

  // 결과 요약
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("순위 변화 요약");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // 50위 이상 상승
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
  if (results.length > 0) {
    const avgChange = results.reduce((sum, r) => sum + r.change, 0) / results.length;
    const improved = results.filter(r => r.change > 0).length;
    const declined = results.filter(r => r.change < 0).length;
    const unchanged = results.filter(r => r.change === 0).length;

    console.log(`측정 성공: ${results.length}개`);
    console.log(`상승: ${improved}개 | 하락: ${declined}개 | 변동없음: ${unchanged}개`);
    console.log(`평균 변화: ${avgChange > 0 ? "+" : ""}${avgChange.toFixed(1)}위`);
  } else {
    console.log("측정 성공한 상품 없음");
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // 결과 저장
  fs.writeFileSync("rank-check-results.json", JSON.stringify(results, null, 2));
  console.log("\n✓ rank-check-results.json 저장");
}

main().catch(console.error);
