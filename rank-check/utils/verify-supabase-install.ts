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
      return { ok: false, message: 'Invalid API key (HTTP 401)' };
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
    return { ok: false, message: error.message };
  }

  return { ok: true, message: 'Supabase 연결 OK' };
}
