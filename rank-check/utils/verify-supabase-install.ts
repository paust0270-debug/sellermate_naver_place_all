import { createClient } from '@supabase/supabase-js';
import {
  isLegacyJwtServiceKey,
  loadProjectEnvFile,
} from './load-project-env';

export type VerifySupabaseResult = {
  ok: boolean;
  message: string;
};

export async function verifySupabaseInstall(
  installDir: string
): Promise<VerifySupabaseResult> {
  const env = loadProjectEnvFile(installDir);
  const url = (env.SUPABASE_URL || '').trim();
  const key = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!url || !key) {
    return {
      ok: false,
      message: 'SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 비어 있습니다.',
    };
  }

  if (isLegacyJwtServiceKey(key)) {
    return {
      ok: false,
      message: 'Legacy JWT service_role 키(eyJ…) — sb_secret_ 키로 교체하세요.',
    };
  }

  try {
    const base = url.replace(/\/$/, '');
    const res = await fetch(`${base}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (res.status === 401) {
      return {
        ok: false,
        message:
          'Invalid API key (HTTP 401) — Supabase Dashboard → Project Settings → API Keys에서 service_role(sb_secret_) 키를 다시 복사해 deploy/local.env 에 넣고 EXE를 재빌드하세요.',
      };
    }
    if (!res.ok && res.status !== 404) {
      return { ok: false, message: `REST probe failed (HTTP ${res.status})` };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `REST 연결 실패: ${msg}` };
  }

  const supabase = createClient(url, key);
  const { error } = await supabase
    .from('sellermate_keywords_navershopping')
    .select('id')
    .limit(1);

  if (error) {
    const msg = error.message || '';
    if (
      error.code === 'PGRST205' ||
      msg.includes('Could not find the table') ||
      msg.includes('schema cache')
    ) {
      return {
        ok: true,
        message: 'Supabase 인증 OK (API 키 유효, 테이블명은 런타임에서 확인)',
      };
    }
    if (msg.includes('Legacy API keys are disabled')) {
      return {
        ok: false,
        message:
          'Legacy JWT 비활성화됨 — Dashboard에서 sb_secret_ service_role 키를 발급해 deploy/local.env 에 넣으세요.',
      };
    }
    return { ok: false, message: msg };
  }

  return { ok: true, message: 'Supabase 연결 OK' };
}
