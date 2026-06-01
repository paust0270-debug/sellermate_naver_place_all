#!/usr/bin/env npx tsx
import { verifySupabaseInstall } from '../utils/verify-supabase-install';

verifySupabaseInstall(process.cwd()).then((result) => {
  if (!result.ok) {
    console.error('❌', result.message);
    process.exit(1);
  }
  console.log('✅', result.message);
});
