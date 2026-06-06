import { createClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase com service_role — bypass de RLS.
 * USAR APENAS NO SERVER. Nunca importar em código de client.
 */
export function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
