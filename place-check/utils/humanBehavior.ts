/**
 * 고급 봇탐지 우회 유틸리티
 *
 * - 베지어 곡선 마우스 이동
 * - 자연스러운 스크롤 패턴
 * - 인간적인 타이핑 속도
 */

import type { Page } from 'puppeteer';

/**
 * tsx/esbuild가 page.evaluate 콜백 변환 시 __name 변수를 주입하는데,
 * 브라우저 컨텍스트에는 없어 ReferenceError 발생.
 * addInitScript로 페이지 로드 전에 __name을 정의하여 해결.
 */
const POLYFILL_SCRIPT = `window.__name = function(f){return f;};`;

export async function injectEvaluatePolyfill(page: Page): Promise<void> {
  const fn = (page as any).evaluateOnNewDocument ?? (page as any).addInitScript;
  if (typeof fn !== 'function') return;
  await fn.call(page, POLYFILL_SCRIPT);
}

// ========== 유틸 함수 ==========
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ========== 베지어 곡선 마우스 이동 ==========
interface Point {
  x: number;
  y: number;
}

/**
 * 3차 베지어 곡선의 점 계산
 */
function bezierPoint(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/**
 * 베지어 곡선을 따라 마우스 이동 (자연스러운 인간 움직임)
 */
export async function humanMouseMove(
  page: Page,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  steps = 25
): Promise<void> {
  const cp1: Point = {
    x: fromX + (toX - fromX) * 0.25 + (Math.random() - 0.5) * 100,
    y: fromY + (toY - fromY) * 0.25 + (Math.random() - 0.5) * 100,
  };
  const cp2: Point = {
    x: fromX + (toX - fromX) * 0.75 + (Math.random() - 0.5) * 100,
    y: fromY + (toY - fromY) * 0.75 + (Math.random() - 0.5) * 100,
  };

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const pt = bezierPoint(t, { x: fromX, y: fromY }, cp1, cp2, { x: toX, y: toY });
    await page.mouse.move(pt.x, pt.y);
    await delay(10 + Math.random() * 15);
  }
}

export async function humanScroll(page: Page, totalDistance: number): Promise<void> {
  let scrolled = 0;
  while (scrolled < totalDistance) {
    const scrollAmount = 300 + Math.random() * 300;
    const actualScroll = Math.min(scrollAmount, totalDistance - scrolled);
    await page.evaluate((y) => window.scrollBy(0, y), actualScroll);
    scrolled += actualScroll;
    await delay(50 + Math.random() * 100);
    if (Math.random() < 0.03) {
      await delay(200 + Math.random() * 300);
    }
  }
}

export async function humanType(page: Page, text: string): Promise<void> {
  for (const char of text) {
    await page.keyboard.type(char);
    await delay(50 + Math.random() * 100);
    if (Math.random() < 0.05) {
      await delay(200 + Math.random() * 300);
    }
  }
}

export async function humanClick(page: Page, x: number, y: number): Promise<void> {
  const startX = Math.random() * 200;
  const startY = Math.random() * 200;
  await humanMouseMove(page, startX, startY, x, y);
  await delay(50 + Math.random() * 100);
  await page.mouse.click(x, y);
}

export async function humanClickWithWander(page: Page, x: number, y: number): Promise<void> {
  const wanderX = 350 + Math.random() * 500;
  const wanderY = 250 + Math.random() * 250;
  const startX = Math.random() * 150;
  const startY = Math.random() * 150;
  await humanMouseMove(page, startX, startY, wanderX, wanderY);
  await delay(400 + Math.random() * 600);
  await humanMouseMove(page, wanderX, wanderY, x, y);
  await delay(80 + Math.random() * 120);
  await page.mouse.click(x, y);
}
