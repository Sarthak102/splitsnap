'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useBill } from '@/hooks/useBill';
import { formatRupees } from '@/lib/bill';
import { summarizeBill, withShared, withUnits } from '@/lib/billSummary';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import type { Bill, Item } from '@/lib/types';
import { upiLink } from '@/lib/upi';
import Confetti from '../Confetti';
import CopyButton from '../CopyButton';
import Logo from '../Logo';
import EditBillForm from './EditBillForm';
import GuestPanel from './GuestPanel';
import HostPanel from './HostPanel';
import ItemRow from './ItemRow';
import JoinForm from './JoinForm';

export default function BillView({ token }: { token: string }) {
  const { view, userId, busy, error, setError, run, changeClaims } = useBill(token);

  if (view.state === 'loading') return <p className="loading" role="status">Loading the bill…</p>;
  if (view.state === 'error') {
    return <p className="note error loading" role="alert">This bill didn&apos;t load. Check your connection and refresh.</p>;
  }
  if (view.state === 'missing') {
    return <p className="loading">This bill link isn&apos;t valid, or the bill is over 30 days old. Ask your friend for a new one.</p>;
  }
  if (view.state === 'join') {
    return (
      <JoinForm hostName={view.hostName} totalPaise={view.totalPaise} seats={view.seats} busy={busy} error={error}
        onError={setError}
        onJoin={(name) => run('join_bill', { p_token: token, p_name: name })}
        onTakeSeat={(user) => run('take_seat', { p_token: token, p_user: user })} />
    );
  }

  return (
    <OpenBill bill={view.bill} userId={userId} busy={busy} error={error} onError={setError} run={run} changeClaims={changeClaims} />
  );
}

type OpenBillProps = {
  bill: Bill;
  userId: string;
  busy: boolean;
  error: string;
  onError: (message: string) => void;
  run: ReturnType<typeof useBill>['run'];
  changeClaims: ReturnType<typeof useBill>['changeClaims'];
};

function OpenBill({ bill, userId, busy, error, onError, run, changeClaims }: OpenBillProps) {
  const [actingFor, setActingFor] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [hostLink, setHostLink] = useState('');

  const summary = summarizeBill(bill);
  const { equal, locked, itemsPaise, chargesPaise, claims, totals, unclaimedPaise, waitingFor, isFinal, guests, confirmedPaise, owedPaise } = summary;
  const isHost = bill.host_id === userId;
  const me = bill.members.find((member) => member.user_id === userId);
  const memberName = (id: string) => bill.members.find((member) => member.user_id === id)?.name ?? 'Someone';
  const myTotal = totals[userId] ?? 0;
  const canPay = myTotal > 0 && isFinal;
  const actor = isHost && guests.some((guest) => guest.user_id === actingFor) ? actingFor! : userId;
  const actorArg = actor === userId ? null : actor;
  const billUrl = window.location.href.split('#')[0];

  function setUnits(item: Item, units: number) {
    changeClaims('set_claim', { p_item: item.id, p_units: units, p_for: actorArg },
      (rows) => withUnits(rows, item.id, actor, units));
  }

  function setShared(item: Item, shared: boolean) {
    changeClaims('set_shared', { p_item: item.id, p_shared: shared, p_for: actorArg },
      (rows) => withShared(rows, item.id, actor, shared));
  }

  function chooseFor(id: string) {
    setActingFor(id);
    document.querySelector('.items')?.scrollIntoView({ block: 'center' });
  }

  async function revealHostLink() {
    const { data, error: keyError } = await supabase.rpc('get_host_key', { p_bill: bill.id });
    if (keyError || !data) return onError(friendlyError(keyError?.message ?? ''));
    setHostLink(`${billUrl}#host=${data}`);
  }

  async function saveEdit(args: Record<string, unknown>) {
    if (await run('update_bill', args)) setEditing(false);
  }

  if (editing) {
    return (
      <EditBillForm bill={bill} busy={busy} error={error} onError={onError} onSave={saveEdit}
        onCancel={() => { setEditing(false); onError(''); }} />
    );
  }

  return (
    <>
      <div className="receipt-wrap">
        <div className="receipt">
          <header className="masthead">
            <Logo />
            <h1 className="small-title">{isHost ? 'Your bill' : `${bill.host_name}'s bill`}</h1>
            <p>
              {waitingFor > 0
                ? `${bill.members.length} of ${bill.people_count} people here. Waiting for ${waitingFor} more.`
                : equal ? `Split equally between ${bill.people_count} people.`
                  : unclaimedPaise > 0 ? `${formatRupees(unclaimedPaise)} still unclaimed.` : 'Every item is claimed.'}
            </p>
          </header>

          {isHost && (
            <section>
              <h2>Send this link to your friends</h2>
              <p className="link">{billUrl}</p>
              <CopyButton text={billUrl} label="Copy link" />
              {hostLink ? (
                <>
                  <p className="note">Open this private link on another phone to run the bill from there. Don&apos;t send it to guests.</p>
                  <p className="link spaced">{hostLink}</p>
                  <CopyButton text={hostLink} label="Copy host link" className="quiet" />
                </>
              ) : (
                <button type="button" className="quiet spaced" onClick={revealHostLink}>Move to another phone</button>
              )}
            </section>
          )}

          <section>
            {isHost ? (
              <div className="mode" role="group" aria-label="How to split the bill">
                <button type="button" aria-pressed={!equal} disabled={busy || locked}
                  onClick={() => run('set_split_mode', { p_bill: bill.id, p_mode: 'items' })}>By item</button>
                <button type="button" aria-pressed={equal} disabled={busy || locked}
                  onClick={() => run('set_split_mode', { p_bill: bill.id, p_mode: 'equal' })}>Equally</button>
              </div>
            ) : <h2>{equal ? 'Everyone pays the same' : 'Tap what you had'}</h2>}
            {!equal && (
              <p className="note">Tap items you had. Use + and − to count things like rotis, or Shared if you split plates.</p>
            )}
            {actor !== userId && (
              <div className="acting-for">
                <span>Choosing for {memberName(actor)}</span>
                <button type="button" onClick={() => setActingFor(null)}>Done</button>
              </div>
            )}
            {locked && <p className="note">Someone has paid, so this bill is locked. It unlocks if their payment is undone.</p>}

            <ul className="items">
              {bill.items.map((item) => (
                <ItemRow key={item.id} item={item} itemClaims={claims[item.id] ?? {}} actor={actor} equal={equal} locked={locked}
                  memberName={memberName} onUnits={setUnits} onShared={setShared} />
              ))}
            </ul>

            <div className="sums">
              <p className="sum"><span>Items</span><span>{formatRupees(itemsPaise)}</span></p>
              {chargesPaise !== 0 && (
                <p className="sum">
                  <span>{chargesPaise > 0 ? 'Tax and charges' : 'Discount'}</span>
                  <span>{formatRupees(Math.abs(chargesPaise))}</span>
                </p>
              )}
              <p className="sum grand"><span>Total</span><span>{formatRupees(bill.total_paise)}</span></p>
            </div>

            {isHost && !locked && (
              <div className="actions spaced">
                {!equal && unclaimedPaise > 0 && bill.members.length > 1 && (
                  <button type="button" disabled={busy} onClick={() => run('split_unclaimed', { p_bill: bill.id })}>
                    Split what&apos;s left between everyone
                  </button>
                )}
                <button type="button" className="quiet" disabled={busy} onClick={() => { onError(''); setEditing(true); }}>Edit the bill</button>
              </div>
            )}
          </section>

          {error && <p className="note error" role="alert">{error}</p>}
        </div>
      </div>

      {me && !isHost && (
        <GuestPanel bill={bill} me={me} summary={summary} busy={busy}
          link={upiLink({ vpa: bill.host_vpa, name: bill.host_name, paise: myTotal, note: 'SplitSnap' })}
          onPaid={(paid, method) => run('set_paid', { p_bill: bill.id, p_paid: paid, p_method: method ?? 'upi' })} />
      )}

      {isHost && (
        <HostPanel bill={bill} hostId={userId} summary={summary} busy={busy} error={error}
          onEditItems={chooseFor} onRun={run} onError={onError} />
      )}

      {/* Outside the receipts: their shadow filter would trap the confetti inside the paper. */}
      {(isHost ? owedPaise > 0 && confirmedPaise === owedPaise : !!me?.confirmed_at) && <Confetti />}

      <Link className="new-bill" href="/">Start a new bill</Link>

      {(isHost || (me && !me.confirmed_at)) && (
        <a className="bar" href="#pay">
          <span>
            <small>{isHost ? 'Collected' : canPay ? 'Your share' : 'Your share so far'}</small>
            {formatRupees(isHost ? confirmedPaise : myTotal)}{isHost && ` of ${formatRupees(owedPaise)}`}
          </span>
          <b>{isHost ? 'See people' : me?.paid_at ? 'Paid' : canPay ? 'Pay now' : waitingFor > 0 ? `${waitingFor} to join` : 'Claim all items'}</b>
        </a>
      )}
    </>
  );
}
