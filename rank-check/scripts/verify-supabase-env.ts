#!/usr/bin/env npx tsx
/**
 * Supabase .env 연결 확인 (다중 PC 배포 시 D:\naverrank\.env 점검용)
 *   npx tsx rank-check/scripts/verify-supabase-env.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import { loadProjectEnvFile } from '../utils/load-project-env';

const rootDir = process.cwd();
const fileEnv = loadProjectEnvFile(rootDir);
const url = (fileEnv.SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
const key = (fileEnv.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const envPath = path.join(rootDir, '.env');

function mask(s: string, visible = 8): string {
  if (s.length <= visible) return '***';
  return `${s.slice(0, visible)}…(${s.length} chars)`;
}

function logFetchCause(err: unknown): void {
  const e = err as Error & { cause?: unknown };
  console.error('   → 인터넷, 방화벽, 프록시, .env URL 오타를 확인하세요.');
  if (e.cause) {
    console.error(`   → 원인: ${e.cause}`);
  }
}

async function probeRest(): Promise<void> {
  const base = url.replace(/\/$/, '');
  const res = await fetch(`${base}/rest/v1/`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  console.log(`  REST probe: HTTP ${res.status}`);
}

async function main(): Promise<void> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Supabase 환경 점검');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  cwd: ${rootDir}`);
  console.log(`  .env: ${fs.existsSync(envPath) ? envPath : '(없음)'}`);

  if (!url || !key) {
    console.error('\n❌ SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 비어 있습니다.');
    console.error('   정상 PC의 .env를 복사하세요 (sb_secret_ 키).');
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

  try {
    await probeRest();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('❌ Supabase REST 연결 실패:', msg);
    logFetchCause(err);
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const { error } = await supabase.from('sellermate_keywords_navershopping').select('id').limit(1);

  if (error) {
    console.error('❌ Supabase 조회 실패:', error.message);
    if (String(error.message).includes('fetch failed')) {
      logFetchCause(error);
    }
    process.exit(1);
  }

  console.log('✅ Supabase 연결 OK (sellermate_keywords_navershopping 조회 성공)\n');
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('❌ 점검 중 예외:', msg);
  if (msg.includes('fetch failed')) {
    logFetchCause(e);
  }
  process.exit(1);
});
