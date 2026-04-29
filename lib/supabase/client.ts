import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

// ============================================================
// Supabase clients
// - browserClient: for Next.js dashboard (anon key, RLS enforced)
// - serviceClient: for backend agents + n8n (service role, RLS bypassed)
//   Use serviceClient ONLY inside server-side code / API routes.
// ============================================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const browserClient = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey
);

// serviceClient is server-only (uses SUPABASE_SERVICE_ROLE_KEY).
// Lazy getter prevents the browser bundle from instantiating it.
let _serviceClient: ReturnType<typeof createClient<Database>> | null = null;

export function getServiceClient() {
  if (_serviceClient) return _serviceClient;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set — only call getServiceClient() from server-side code.");
  _serviceClient = createClient<Database>(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _serviceClient;
}

// Convenience alias — use in API routes / server actions only
export const serviceClient = new Proxy({} as ReturnType<typeof createClient<Database>>, {
  get(_target, prop) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (getServiceClient() as any)[prop];
  },
});

// Sets the RLS context for a given client_id on a service-role query.
export function withClientContext(clientId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (getServiceClient() as any).rpc("set_config", {
    setting: "app.current_client_id",
    value: clientId,
  });
}
