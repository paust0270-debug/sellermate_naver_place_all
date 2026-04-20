#!/usr/bin/env npx tsx
/**
 * A/B 테스트 상품 순위 체크
 *
 * 트래픽 완료된 상품들의 현재 순위를 체크하고
 * finalRank를 업데이트합니다.
 *
 * 사용법:
 *   npx tsx check-ab-rank.ts            # 트래픽 완료 상품만
 *   npx tsx check-ab-rank.ts --all      # 모든 상품
 */

const SUPABASE_URL = "https://hdtjkaieulphqwmcjhcx.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkdGprYWlldWxwaHF3bWNqaGN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2Mzg3OTMzNSwiZXhwIjoyMDc5NDU1MzM1fQ.Jn6RiB8H-_pEZ9BW9x9Mqt4fW-XTj0M3gEAShWDjOtE";

const args = process.argv.slice(2);
const checkAll = args.includes("--all");

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// Supabase에서 상품 조회
async function getProducts(): Promise<any[]> {
  let url = `${SUPABASE_URL}/rest/v1/abTestProducts?select=*&order=id.asc`;

  if (!checkAll) {
    // 트래픽 성공 완료된 상품만
    url += `&trafficSuccess=eq.true`;
  }

  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });

  return res.json();
}

// finalRank 업데이트
async function updateFinalRank(productId: number, finalRank: number, rankChange: number): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/abTestProducts?id=eq.${productId}`, {
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
    }),
  });
}

// 순위 체크 (HTTP 요청)
async function checkRank(keyword: string, mid: string): Promise<number | null> {
  const { default: axios } = await import("axios");

  const headers = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9",
    Referer: "https://msearch.shopping.naver.com/",
  };

  // 최대 10페이지까지 검색 (400등까지)
  for (let page = 1; page <= 10; page++) {
    try {
      const url = `https://msearch.shopping.naver.com/search/all?query=${encodeURIComponent(keyword)}&pagingIndex=${page}&pagingSize=40`;

      const res = await axios.get(url, {
        headers,
        timeout: 15000,
        validateStatus: s => s < 500,
      });

      if (res.status !== 200) {
        console.log(`   HTTP ${res.status}`);
        continue;
      }

      const html = res.data;

      // MID 위치 찾기
      const midPattern = new RegExp(`nvMid=(${mid})|"nvMid":"${mid}"`, "i");
      const match = html.match(midPattern);

      if (match) {
        // HTML에서 해당 MID 앞에 있는 nvMid 개수 세기
        const beforeMid = html.substring(0, match.index);
        const nvMidMatches = beforeMid.match(/nvMid=/g) || [];
        const rank = (page - 1) * 40 + nvMidMatches.length + 1;
        return rank;
      }

      await delay(1000);
    } catch (error: any) {
      console.log(`   Error page ${page}: ${error.message}`);
    }
  }

  return null; // 400등 이내에 없음
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 A/B 테스트 순위 체크");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  대상: ${checkAll ? "모든 상품" : "트래픽 완료 상품"}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const products = await getProducts();
  console.log(`📦 대상 상품: ${products.length}개\n`);

  if (products.length === 0) {
    console.log("✅ 체크할 상품이 없습니다.");
    return;
  }

  const results: any[] = [];
  let improved = 0;
  let same = 0;
  let declined = 0;
  let notFound = 0;

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    console.log(`[${i + 1}/${products.length}] ${product.productName.substring(0, 35)}...`);
    console.log(`   키워드: ${product.keyword} | MID: ${product.mid}`);
    console.log(`   초기 순위: ${product.currentRank}위 | 타입: ${product.workType}`);

    const newRank = await checkRank(product.keyword, product.mid);

    if (newRank !== null) {
      const change = product.currentRank - newRank; // 양수면 순위 상승

      await updateFinalRank(product.id, newRank, change);

      const arrow = change > 0 ? "↑" : change < 0 ? "↓" : "→";
      console.log(`   현재 순위: ${newRank}위 (${arrow}${Math.abs(change)})`);

      if (change > 0) improved++;
      else if (change < 0) declined++;
      else same++;

      results.push({
        mid: product.mid,
        productName: product.productName,
        keyword: product.keyword,
        workType: product.workType,
        experimentCase: product.experimentCase,
        initialRank: product.currentRank,
        finalRank: newRank,
        change,
      });
    } else {
      console.log(`   현재 순위: 400등 밖`);
      notFound++;
    }

    // API 제한 방지
    await delay(2000);
    console.log("");
  }

  // 결과 요약
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 순위 체크 결과");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  체크 완료: ${products.length}개`);
  console.log(`  순위 상승: ${improved}개`);
  console.log(`  순위 유지: ${same}개`);
  console.log(`  순위 하락: ${declined}개`);
  console.log(`  400등 밖: ${notFound}개`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // 타입별 분석
  if (results.length > 0) {
    const byType: Record<string, number[]> = { 통검: [], 쇼검: [] };
    results.forEach(r => {
      if (byType[r.workType]) {
        byType[r.workType].push(r.change);
      }
    });

    console.log("📈 타입별 순위 변동:");
    for (const [type, changes] of Object.entries(byType)) {
      if (changes.length > 0) {
        const avg = changes.reduce((a, b) => a + b, 0) / changes.length;
        const improved = changes.filter(c => c > 0).length;
        console.log(`  ${type}: 평균 ${avg > 0 ? "+" : ""}${avg.toFixed(1)}등 (상승 ${improved}/${changes.length})`);
      }
    }
    console.log("");

    // 상위 변수 조합 (순위 상승 기준)
    const sortedResults = results.sort((a, b) => b.change - a.change);
    console.log("🏆 최고 성과 변수 조합 (TOP 5):");
    sortedResults.slice(0, 5).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.workType} | ${r.experimentCase}`);
      console.log(`     ${r.initialRank}위 → ${r.finalRank}위 (${r.change > 0 ? "+" : ""}${r.change})`);
    });
  }
}

main().catch(console.error);
