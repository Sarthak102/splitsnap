import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
);

let accountChecked = false;

// Guests and hosts never see a sign-up form; each browser gets an anonymous account.
export async function ensureSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    if (accountChecked) return data.session;
    // A stored session can outlive its account, and writes would then fail on the missing user.
    const { error } = await supabase.auth.getUser();
    accountChecked = !error;
    if (!error) return data.session;
    await supabase.auth.signOut({ scope: 'local' });
  }
  const { data: created, error } = await supabase.auth.signInAnonymously();
  if (error || !created.session) throw error ?? new Error('Sign-in returned no session');
  return created.session;
}
