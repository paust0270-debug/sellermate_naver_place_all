/**
 * 고급 봇탐지 우회 유틸리티
 *
 * - 베지어 곡선 마우스 이동
 * - 자연스러운 스크롤 패턴
 * - 인간적인 타이핑 속도
 */

import type { Page } from 'puppeteer';

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
 *
 * @param page - Puppeteer 페이지
 * @param fromX - 시작 X 좌표
 * @param fromY - 시작 Y 좌표
 * @param toX - 도착 X 좌표
 * @param toY - 도착 Y 좌표
 * @param steps - 이동 단계 수 (기본 25)
 */
export async function humanMouseMove(
  page: Page,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  steps = 25
): Promise<void> {
  // 제어점 랜덤 생성 (자연스러운 곡선)
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
    await delay(10 + Math.random() * 15); // 10~25ms 랜덤 딜레이
  }
}

// ========== 자연스러운 스크롤 ==========

/**
 * 자연스러운 스크롤 패턴 (랜덤 거리 + 읽는 듯한 멈춤)
 *
 * @param page - Puppeteer 페이지
 * @param totalDistance - 총 스크롤 거리 (px)
 */
export async function humanScroll(page: Page, totalDistance: number): Promise<void> {
  let scrolled = 0;

  while (scrolled < totalDistance) {
    // 랜덤 스크롤 거리 (300~600px)
    const scrollAmount = 300 + Math.random() * 300;
    const actualScroll = Math.min(scrollAmount, totalDistance - scrolled);

    await page.evaluate((y) => window.scrollBy(0, y), actualScroll);
    scrolled += actualScroll;

    // 랜덤 딜레이 (50~150ms, 더 빠른 스크롤)
    await delay(50 + Math.random() * 100);

    // 3% 확률로 잠시 멈춤 (5% → 3%, 읽는 척 빈도 추가 감소)
    if (Math.random() < 0.03) {
      await delay(200 + Math.random() * 300); // 300~800ms → 200~500ms
    }
  }
}

// ========== 자연스러운 타이핑 ==========

/**
 * 자연스러운 타이핑 (랜덤 속도 + 가끔 멈춤)
 *
 * @param page - Puppeteer 페이지
 * @param text - 입력할 텍스트
 */
export async function humanType(page: Page, text: string): Promise<void> {
  for (const char of text) {
    await page.keyboard.type(char);

    // 랜덤 딜레이 (50~150ms)
    await delay(50 + Math.random() * 100);

    // 5% 확률로 잠시 멈춤 (생각하는 척)
    if (Math.random() < 0.05) {
      await delay(200 + Math.random() * 300);
    }
  }
}

// ========== 자연스러운 클릭 ==========

/**
 * 자연스러운 클릭 (마우스 이동 후 클릭)
 *
 * @param page - Puppeteer 페이지
 * @param x - 클릭 X 좌표
 * @param y - 클릭 Y 좌표
 */
export async function humanClick(page: Page, x: number, y: number): Promise<void> {
  // 현재 마우스 위치 가져오기 (또는 랜덤 시작점)
  const startX = Math.random() * 200;
  const startY = Math.random() * 200;

  // 베지어 곡선으로 이동
  await humanMouseMove(page, startX, startY, x, y);

  // 약간의 딜레이 후 클릭
  await delay(50 + Math.random() * 100);
  await page.mouse.click(x, y);
}
