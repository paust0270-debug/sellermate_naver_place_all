/**
 * EXE 빌드 시 embedded-install-env.gen.ts 가 생성·번들됨 (deploy/local.env)
 */
export let EMBEDDED_INSTALL_ENV: Record<string, string> | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const gen = require('./embedded-install-env.gen') as {
    EMBEDDED_INSTALL_ENV?: Record<string, string>;
  };
  if (gen?.EMBEDDED_INSTALL_ENV?.SUPABASE_SERVICE_ROLE_KEY) {
    EMBEDDED_INSTALL_ENV = gen.EMBEDDED_INSTALL_ENV;
  }
} catch {
  EMBEDDED_INSTALL_ENV = null;
}
