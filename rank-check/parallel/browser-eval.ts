import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const parallelDir = dirname(fileURLToPath(import.meta.url));

let findRankScriptSource: string | null = null;

function loadFindRankScript(): string {
  if (!findRankScriptSource) {
    findRankScriptSource = readFileSync(
      join(parallelDir, 'browser', 'find-rank-by-product-id.js'),
      'utf8'
    );
  }
  return findRankScriptSource;
}

/** tsx/esbuild __name 주입 없이 브라우저에서 실행 */
export async function evaluateString<T>(page: unknown, fnBody: string): Promise<T> {
  const p = page as { evaluate: (expr: string) => Promise<T> };
  return p.evaluate(fnBody);
}

export type FindRankOnPageResult = {
  found: boolean;
  pageRank: number | null;
  nvMid: string | null;
  contentsId: string | null;
  catalogNvMid: string | null;
  chnlProdNo: string | null;
  productName: string | null;
  isAd: boolean;
  productIndex: number | null;
  wishCount: number | null;
  reviewCount: number | null;
  starCount: number | null;
  monthCount: number | null;
  productImageUrl: string | null;
  price: number | null;
  shippingFee: number | null;
  keywordName: string | null;
  tradeName: string | null;
};

export async function runFindRankByProductIdOnPage(
  page: unknown,
  targetProductId: string | null
): Promise<FindRankOnPageResult> {
  const script = loadFindRankScript();
  const arg = JSON.stringify(targetProductId);
  return evaluateString<FindRankOnPageResult>(
    page,
    `(() => { ${script}; return findRankByProductIdOnPage(${arg}); })()`
  );
}
