#!/usr/bin/env npx tsx
/**
 * 테스트용 상품 수집 모듈
 *
 * 특정 키워드로 검색하여 400등 이후 상품 50개를 수집하고
 * slot_navertest + keywords_navershopping-test 테이블에 INSERT
 *
 * 사용법:
 *   npx tsx rank-check/test/collect-products-for-test.ts --keyword="검색어"
 *   npx tsx rank-check/test/collect-products-for-test.ts --keyword="검색어" --count=30
 */

import 'dotenv/config';
import { connect } from 'puppeteer-real-browser';
import { createClient } from '@supabase/supabase-js';
import type { Page } from 'puppeteer';
import { humanType, humanScroll } from '../utils/humanBehavior';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 설정
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const SAFE_DELAY_MS = 5000;
const PRODUCTS_PER_PAGE = 40;
const START_PAGE = 11; // 400등 = 10페이지 끝, 11페이지부터 시작
const DEFAULT_COLLECT_COUNT = 50;
const PAGE_NAVIGATION_DELAY = 2000;

// Supabase 초기화
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 환경 변수가 설정되지 않았습니다.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface CollectedProduct {
  mid: string;
  productName: string;
  linkUrl: string;
  rank: number;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);
  let keyword = '';
  let count = DEFAULT_COLLECT_COUNT;

  for (const arg of args) {
    if (arg.startsWith('--keyword=')) {
      keyword = arg.split('=').slice(1).join('=').replace(/^["']|["']$/g, '');
    } else if (arg.startsWith('--count=')) {
      count = parseInt(arg.split('=')[1], 10);
    }
  }

  return { keyword, count };
}

async function enterShoppingTab(page: Page, keyword: string): Promise<boolean> {
  console.log('🧭 네이버 메인 진입');
  try {
    await page.goto('https://www.naver.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
  } catch (error) {
    console.log('⚠️ 네이버 진입 실패', error);
    return false;
  }

  await delay(SAFE_DELAY_MS);

  const searchInput = await page.waitForSelector('input[name="query"]', { timeout: 15000 }).catch(() => null);
  if (!searchInput) {
    console.log('❌ 검색 입력창을 찾을 수 없습니다.');
    return false;
  }

  await searchInput.click({ clickCount: 3 });
  await humanType(page, keyword);
  await page.keyboard.press('Enter');

  console.log('⏳ 검색 결과 대기 중...');
  try {
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch {
    // SPA라서 네비게이션 이벤트 없을 수 있음
  }
  await delay(3000);

  console.log('🛒 쇼핑탭으로 이동');
  let clicked = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    clicked = await page.evaluate(() => {
      const link = document.querySelector<HTMLAnchorElement>('a[href*="search.shopping.naver.com"]');
      if (!link) return false;
      link.removeAttribute('target');
      link.click();
      return true;
    });
    if (clicked) break;
    console.log(`   ⏳ 쇼핑탭 대기 중... (${attempt}/5)`);
    await delay(2000);
  }

  if (!clicked) {
    console.log('❌ 쇼핑탭 링크가 없습니다.');
    return false;
  }

  await delay(SAFE_DELAY_MS + 800);

  if (!page.url().includes('search.shopping.naver.com')) {
    console.log('⚠️ 쇼핑탭 URL이 확인되지 않았습니다.');
    return false;
  }

  return true;
}

// 특정 페이지로 이동 (버튼 클릭만, 재시도 포함)
async function navigateToPage(page: Page, targetPage: number): Promise<boolean> {
  const paginationSelector = 'a.pagination_btn_page__utqBz, a[class*="pagination_btn"]';

  // 페이지네이션 영역으로 스크롤
  await page.evaluate(() => {
    const pagination = document.querySelector('[class*="pagination"]');
    if (pagination) {
      pagination.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      window.scrollTo(0, document.body.scrollHeight - 500);
    }
  });
  await delay(500);

  try {
    await page.waitForSelector(paginationSelector, { timeout: 10000, visible: true });
  } catch {
    console.log(`   ⚠️ 페이지네이션 영역 로드 실패`);
    return false;
  }

  const buttonExists = await page.evaluate((nextPage) => {
    const buttons = document.querySelectorAll('a.pagination_btn_page__utqBz, a[class*="pagination_btn"]');
    for (const btn of buttons) {
      if (btn.textContent?.trim() === String(nextPage)) {
        return true;
      }
    }
    return false;
  }, targetPage);

  if (!buttonExists) {
    console.log(`   ⚠️ ${targetPage}페이지 버튼이 없음`);
    return false;
  }

  // 최대 3회 재시도
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // evaluate로 직접 클릭 (더 안정적)
      const clicked = await page.evaluate((nextPage) => {
        const buttons = document.querySelectorAll('a.pagination_btn_page__utqBz, a[class*="pagination_btn"]');
        for (const btn of buttons) {
          if (btn.textContent?.trim() === String(nextPage)) {
            (btn as HTMLElement).click();
            return true;
          }
        }
        return false;
      }, targetPage);

      if (clicked) {
        await delay(PAGE_NAVIGATION_DELAY);
        return true;
      }
    } catch (error) {
      if (attempt < 3) {
        console.log(`   ⚠️ ${targetPage}페이지 클릭 재시도 (${attempt}/3)`);
        await delay(1000);
      }
    }
  }

  console.log(`   ⚠️ ${targetPage}페이지 이동 실패`);
  return false;
}

// 1페이지에서 목표 페이지까지 순차 이동
async function navigateToTargetPage(page: Page, targetPage: number): Promise<boolean> {
  console.log(`\n🚀 ${targetPage}페이지까지 이동 중...`);

  for (let currentPage = 2; currentPage <= targetPage; currentPage++) {
    // 10페이지 단위로 점프 가능 여부 확인 (10, 20, 30...)
    const jumpPage = Math.floor(currentPage / 10) * 10;
    if (jumpPage > 0 && jumpPage >= currentPage - 9 && currentPage <= jumpPage) {
      // 10페이지 단위로 점프
      if (currentPage === jumpPage || (currentPage > jumpPage && currentPage <= jumpPage + 1)) {
        console.log(`   ➡️ ${currentPage}페이지로 이동...`);
        const success = await navigateToPage(page, currentPage);
        if (!success) {
          console.log(`   ❌ ${currentPage}페이지 이동 실패`);
          return false;
        }
      }
    } else {
      console.log(`   ➡️ ${currentPage}페이지로 이동...`);
      const success = await navigateToPage(page, currentPage);
      if (!success) {
        console.log(`   ❌ ${currentPage}페이지 이동 실패`);
        return false;
      }
    }
  }

  console.log(`   ✅ ${targetPage}페이지 도착`);
  return true;
}

async function goToPageAndCollect(page: Page, targetPage: number): Promise<CollectedProduct[]> {
  const paginationSelector = 'a.pagination_btn_page__utqBz, a[class*="pagination_btn"]';

  try {
    await page.waitForSelector(paginationSelector, { timeout: 10000, visible: true });
  } catch {
    console.log(`   ⚠️ 페이지네이션 영역 로드 실패`);
    return [];
  }

  // 버튼 존재 확인
  const buttonExists = await page.evaluate((nextPage) => {
    const buttons = document.querySelectorAll('a.pagination_btn_page__utqBz, a[class*="pagination_btn"]');
    for (const btn of buttons) {
      if (btn.textContent?.trim() === String(nextPage)) {
        return true;
      }
    }
    return false;
  }, targetPage);

  if (!buttonExists) {
    console.log(`   ⚠️ ${targetPage}페이지 버튼이 없음`);
    return [];
  }

  // API 응답 인터셉트 설정
  const apiResponsePromise = page.waitForResponse(
    (response) => {
      const url = response.url();
      return url.includes('/api/search/all') && url.includes(`pagingIndex=${targetPage}`);
    },
    { timeout: 30000 }
  );

  // 버튼 클릭
  try {
    const pageButton = await page.evaluateHandle((nextPage) => {
      const buttons = document.querySelectorAll('a.pagination_btn_page__utqBz, a[class*="pagination_btn"]');
      for (const btn of buttons) {
        if (btn.textContent?.trim() === String(nextPage)) {
          return btn;
        }
      }
      return null;
    }, targetPage);

    if (!pageButton) {
      return [];
    }

    await (pageButton.asElement() as any).click();
    console.log(`   버튼 클릭, API 응답 대기 중...`);
  } catch (error) {
    console.log(`   ⚠️ 버튼 클릭 실패: ${error}`);
    return [];
  }

  // API 응답 파싱
  try {
    const response = await apiResponsePromise;
    console.log(`   ✅ API 응답 수신`);

    const json = await response.json();
    if (!json.shoppingResult?.products) {
      console.log(`   ⚠️ API 응답에 products 없음`);
      return [];
    }

    const products: CollectedProduct[] = [];
    const apiProducts = json.shoppingResult.products;

    for (let i = 0; i < apiProducts.length; i++) {
      const p = apiProducts[i];
      const mid = p.id || p.nvMid || '';
      const totalRank = p.rank || (targetPage - 1) * PRODUCTS_PER_PAGE + i + 1;
      const productName = p.productTitle || p.title || '상품명 없음';

      // 광고 상품 스킵
      const isAd = p.adcrType !== undefined && p.adcrType !== null;
      if (isAd) {
        continue;
      }

      // MID 없으면 스킵
      if (!mid) {
        continue;
      }

      // URL 추출 (우선순위: mallProductUrl > productUrl > link > 네이버쇼핑 URL 생성)
      let linkUrl = p.mallProductUrl || p.productUrl || p.link || '';
      if (!linkUrl) {
        // URL 없으면 네이버쇼핑 상품 페이지 URL 생성
        linkUrl = `https://search.shopping.naver.com/product/${mid}`;
      }

      products.push({
        mid,
        productName,
        linkUrl,
        rank: totalRank,
      });
    }

    console.log(`   수집: ${products.length}개 상품 (${products[0]?.rank || '?'}위~${products[products.length - 1]?.rank || '?'}위)`);
    return products;

  } catch (error) {
    console.log(`   ⚠️ API 응답 타임아웃 또는 파싱 실패: ${error}`);
    return [];
  }
}

async function getNextSlotSequence(): Promise<number> {
  const { data, error } = await supabase
    .from('slot_navertest')
    .select('slot_sequence')
    .order('slot_sequence', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.slot_sequence) {
    return 1;
  }

  return data.slot_sequence + 1;
}

async function insertToDatabase(keyword: string, products: CollectedProduct[]): Promise<number> {
  let insertedCount = 0;
  let slotSequence = await getNextSlotSequence();

  console.log(`\n💾 데이터베이스 저장 시작 (slot_sequence: ${slotSequence}~)`);

  for (const product of products) {
    try {
      // Step 1: slot_navertest INSERT
      const { data: slotData, error: slotError } = await supabase
        .from('slot_navertest')
        .insert({
          customer_id: 'test',
          customer_name: '테스트',
          keyword: keyword,
          link_url: product.linkUrl,
          slot_type: '네이버test',
          status: '작동중',
          product_name: product.productName,
          mid: product.mid,
          slot_sequence: slotSequence,
          start_rank: product.rank,
          current_rank: product.rank,
        })
        .select('id, slot_sequence')
        .single();

      if (slotError) {
        console.log(`   ⚠️ slot_navertest INSERT 실패: ${slotError.message}`);
        continue;
      }

      // Step 2: keywords_navershopping-test INSERT
      const { error: keywordError } = await supabase
        .from('keywords_navershopping-test')
        .insert({
          keyword: keyword,
          link_url: product.linkUrl,
          slot_id: slotData.id,
          slot_sequence: slotData.slot_sequence,
          slot_type: '네이버test',
          current_rank: product.rank,
          mid: product.mid,
          product_name: product.productName,
          start_rank: product.rank,
        });

      if (keywordError) {
        console.log(`   ⚠️ keywords_navershopping-test INSERT 실패: ${keywordError.message}`);
        // 실패해도 slot은 이미 생성됨
      }

      insertedCount++;
      slotSequence++;
      console.log(`   ✅ [${insertedCount}] ${product.productName.substring(0, 30)}... (${product.rank}위)`);

    } catch (error: any) {
      console.log(`   ❌ 저장 에러: ${error.message}`);
    }
  }

  return insertedCount;
}

async function main() {
  const { keyword, count } = parseArgs();

  if (!keyword) {
    console.error('❌ --keyword 인자가 필요합니다.');
    console.log('사용법: npx tsx rank-check/test/collect-products-for-test.ts --keyword="검색어"');
    process.exit(1);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦 테스트용 상품 수집');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🔍 키워드: ${keyword}`);
  console.log(`📊 수집 목표: ${count}개 (400등 이후)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 브라우저 시작
  console.log('🌐 브라우저 시작...');
  const connection = await connect({
    headless: false,
    turnstile: true,
    fingerprint: true,
  });

  const browser = connection.browser;
  const page = connection.page;

  try {
    // 쇼핑탭 진입
    const shoppingReady = await enterShoppingTab(page, keyword);
    if (!shoppingReady) {
      console.log('❌ 쇼핑탭 진입 실패');
      await browser.close();
      process.exit(1);
    }

    // 스크롤로 페이지 안정화
    await humanScroll(page, 3000);
    await delay(2000);

    // 먼저 10페이지까지 이동 (400등 도달)
    const navigated = await navigateToTargetPage(page, 10);
    if (!navigated) {
      console.log('❌ 10페이지 이동 실패');
      await browser.close();
      process.exit(1);
    }

    // 400등 이후 상품 수집 (11페이지부터)
    const collectedProducts: CollectedProduct[] = [];
    let currentPage = START_PAGE;

    while (collectedProducts.length < count && currentPage <= 15) {
      console.log(`\n📄 ${currentPage}페이지 수집 중...`);

      const randomDelay = 1000 + Math.random() * 1000;
      await delay(randomDelay);

      const products = await goToPageAndCollect(page, currentPage);

      for (const product of products) {
        if (collectedProducts.length >= count) break;
        collectedProducts.push(product);
      }

      console.log(`   누적: ${collectedProducts.length}/${count}개`);
      currentPage++;

      await delay(SAFE_DELAY_MS);
    }

    // 브라우저 종료
    await browser.close();
    console.log('\n🌐 브라우저 종료');

    if (collectedProducts.length === 0) {
      console.log('❌ 수집된 상품이 없습니다.');
      process.exit(1);
    }

    // 데이터베이스 저장
    const insertedCount = await insertToDatabase(keyword, collectedProducts);

    // 결과 출력
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 수집 결과');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ 수집된 상품: ${collectedProducts.length}개`);
    console.log(`💾 저장된 상품: ${insertedCount}개`);
    console.log(`📁 테이블: slot_navertest, keywords_navershopping-test`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error: any) {
    console.error('\n🚨 에러:', error.message);
    await browser.close();
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('🚨 치명적 에러:', error.message);
  process.exit(1);
});
