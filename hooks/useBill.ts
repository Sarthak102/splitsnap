'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { friendlyError } from '@/lib/errors';
import { ensureSession, supabase } from '@/lib/supabase';
import type { Bill, ClaimRow } from '@/lib/types';

const POLL_MS = 10_000;

const BILL_QUERY = `id, host_id, host_name, host_vpa, total_paise, split_mode, people_count,
  items(id, name, quantity, price_paise),
  members(user_id, name, offline, paid_method, paid_at, confirmed_at),
  claims(item_id, user_id, units, shared)`;

export type Seat = { user_id: string; name: string };

export type BillView =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'error' }
  | { state: 'join'; hostName: string; totalPaise: number; seats: Seat[] }
  | { state: 'ready'; bill: Bill };

export function useBill(token: string) {
  const [view, setView] = useState<BillView>({ state: 'loading' });
  const [userId, setUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const latestLoad = useRef(0);
  const unsavedClaims = useRef(0);
  const claimQueue = useRef(Promise.resolve());

  const load = useCallback(async () => {
    const thisLoad = ++latestLoad.current;
    const stale = () => thisLoad !== latestLoad.current;
    try {
      const session = await ensureSession();
      setUserId(session.user.id);
      const { data, error: loadError } = await supabase
        .from('bills')
        .select(BILL_QUERY)
        .eq('join_token', token)
        .order('position', { referencedTable: 'items' })
        .maybeSingle();
      if (loadError) throw loadError;
      if (data) {
        // A reply that left before the latest tap would undo it on screen.
        if (!stale() && unsavedClaims.current === 0) setView({ state: 'ready', bill: data });
        return;
      }

      const { data: preview, error: previewError } = await supabase.rpc('bill_preview', { p_token: token });
      if (previewError) throw previewError;
      if (stale()) return;
      if (!preview?.[0]) return setView({ state: 'missing' });
      const { data: seats } = await supabase.rpc('bill_seats', { p_token: token });
      if (!stale()) {
        setView({ state: 'join', hostName: preview[0].host_name, totalPaise: preview[0].total_paise, seats: seats ?? [] });
      }
    } catch (loadError) {
      console.error('Could not load bill', loadError);
      if (!stale()) setView((current) => (current.state === 'ready' ? current : { state: 'error' }));
    }
  }, [token]);

  useEffect(() => {
    (async () => {
      // The host link keeps its key in the #fragment, so it never reaches a server log.
      const hostKey = window.location.hash.match(/^#host=([0-9a-f]+)$/)?.[1];
      if (hostKey) {
        try {
          await ensureSession();
          const { error: hostError } = await supabase.rpc('take_host', { p_token: token, p_key: hostKey });
          if (hostError) setError(friendlyError(hostError.message));
        } finally {
          window.history.replaceState(null, '', window.location.pathname);
        }
      }
      await load();
    })();
  }, [load, token]);

  const billId = view.state === 'ready' ? view.bill.id : null;
  useEffect(() => {
    if (!billId) return;
    const channel = supabase
      .channel(`bill:${billId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bills', filter: `id=eq.${billId}` }, () => load())
      // Catches anything that changed before the feed was ready.
      .on('system', {}, (message) => { if (message.extension === 'postgres_changes' && message.status === 'ok') load(); })
      .subscribe();
    // Phones drop the socket while the app is in the background, for example during a UPI payment.
    const refresh = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', refresh);
    // Backstop for networks that quietly drop the live connection.
    const poll = setInterval(refresh, POLL_MS);
    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', refresh);
      supabase.removeChannel(channel);
    };
  }, [billId, load]);

  // For actions that change who owes what: waits for the server, then reloads.
  const run = useCallback(async (fn: string, args: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    setError('');
    navigator.vibrate?.(10);
    const { error: rpcError } = await supabase.rpc(fn, args);
    if (rpcError) {
      console.error(`${fn} failed`, rpcError);
      setError(friendlyError(rpcError.message));
    }
    await load();
    setBusy(false);
    return !rpcError;
  }, [load]);

  // For tapping items: the screen changes at once and saves run in order behind it. The reload
  // after the last save puts the screen right if the server refused any of them.
  const changeClaims = useCallback((fn: string, args: Record<string, unknown>, change: (claims: ClaimRow[]) => ClaimRow[]) => {
    setError('');
    navigator.vibrate?.(10);
    setView((current) => (current.state === 'ready'
      ? { state: 'ready', bill: { ...current.bill, claims: change(current.bill.claims) } }
      : current));

    unsavedClaims.current += 1;
    claimQueue.current = claimQueue.current.then(async () => {
      const { error: rpcError } = await supabase.rpc(fn, args);
      if (rpcError) {
        console.error(`${fn} failed`, rpcError);
        setError(friendlyError(rpcError.message));
      }
      unsavedClaims.current -= 1;
      if (unsavedClaims.current === 0) await load();
    });
  }, [load]);

  return { view, userId, busy, error, setError, run, changeClaims };
}
