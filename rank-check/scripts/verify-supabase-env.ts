#!/usr/bin/env npx tsx
/**
 * Supabase .env 연결 확인 (다중 PC 배포 시 D:\naverrank\.env 점검용)
 *   npx tsx rank-check/scripts/verify-supabase-env.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL?.trim() || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';

function mask(s: string, visible = 8): string {
  if (s.length <= visible) return '***';
  return `${s.slice(0, visible)}…(${s.length} chars)`;
}

async function main(): Promise<void> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Supabase 환경 점검');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  cwd: ${process.cwd()}`);

  if (!url || !key) {
    console.error('\n❌ SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 비어 있습니다.');
    console.error('   D:\\naverrank\\.env (또는 설치 폴더 .env)를 정상 PC와 동일하게 맞추세요.');
    process.exit(1);
  }

  if (key.startsWith('eyJ')) {
    console.error('\n❌ Legacy JWT service_role 키(eyJ…)입니다.');
    console.error('   Supabase 대시보드 → API Keys → sb_secret_… 로 교체하세요.');
    process.exit(1);
  }

  if (!url.startsWith('https://') || !url.includes('supabase')) {
    console.warn(`\n⚠️ SUPABASE_URL 형식이 이상할 수 있습니다: ${url}`);
  }

  console.log(`\n  URL: ${url}`);
  console.log(`  KEY: ${mask(key)}\n`);

  const supabase = createClient(url, key);
  const { error } = await supabase.from('sellermate_keywords_navershopping').select('id').limit(1);

  if (error) {
    console.error('❌ Supabase REST 요청 실패:', error.message);
    if (String(error.message).includes('fetch failed') || String(error.message).includes('Failed to fetch')) {
      console.error('');
      console.error('   → 네트워크/DNS/방화벽이 *.supabase.co 를 막는 경우가 많습니다.');
      console.error('   → .env URL·키가 다른 PC와 동일한지 확인하세요.');
      console.error('   → 브라우저에서 Supabase 대시보드 접속되는지 확인하세요.');
    }
    process.exit(1);
  }

  console.log('✅ Supabase 연결 OK (sellermate_keywords_navershopping 조회 성공)\n');
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('❌ 점검 중 예외:', msg);
  if (msg.includes('fetch failed')) {
    console.error('   → 인터넷, 방화벽, 프록시, .env URL 오타를 확인하세요.');
  }
  process.exit(1);
});
