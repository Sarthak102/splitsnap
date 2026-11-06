'use client';

import { useEffect, useState } from 'react';
import { formatRupees } from '@/lib/bill';
import { personCharges, personLines, type BillSummary } from '@/lib/billSummary';
import { qrCanvas } from '@/lib/qr';
import { receiptImage } from '@/lib/receiptImage';
import type { Bill, Member } from '@/lib/types';
import { upiLink } from '@/lib/upi';
import PayQr from './PayQr';

type BillImage = { url: string; file: File };

type Props = {
  bill: Bill;
  guest: Member;
  summary: BillSummary;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onEditItems: () => void;
  onRun: (fn: string, args: Record<string, unknown>) => void;
  onError: (message: string) => void;
};

function statusText(guest: Member, picked: boolean) {
  const phone = guest.offline ? 'No phone. ' : '';
  if (guest.confirmed_at) return `${phone}Paid${guest.paid_method === 'cash' ? ' in cash' : ''}`;
  if (guest.paid_at) return `${phone}${guest.paid_method === 'cash' ? 'Paying cash' : 'Says they paid'}`;
  return `${phone}${picked ? 'Not paid yet' : "Hasn't picked anything"}`;
}

export default function PersonRow({ bill, guest, summary, open, busy, onToggle, onEditItems, onRun, onError }: Props) {
  const [image, setImage] = useState<BillImage | null>(null);
  const { equal, locked, isFinal } = summary;
  const amount = summary.totals[guest.user_id] ?? 0;
  const lines = personLines(bill, summary, guest.user_id);
  const charges = personCharges(summary, guest.user_id);
  const payable = isFinal && amount > 0 && !guest.paid_at;
  const link = upiLink({ vpa: bill.host_vpa, name: bill.host_name, paise: amount, note: 'SplitSnap' });

  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url); }, [image]);

  async function makeImage() {
    try {
      const blob = await receiptImage({
        personName: guest.name,
        hostName: bill.host_name,
        hostVpa: bill.host_vpa,
        lines,
        chargesPaise: charges,
        totalPaise: amount,
        qr: isFinal && amount > 0 ? qrCanvas(link) : null,
      });
      const file = new File([blob], `${guest.name.replace(/[^\w-]+/g, '-')}-bill.png`, { type: 'image/png' });
      setImage({ url: URL.createObjectURL(blob), file });
    } catch (imageError) {
      console.error('Could not create bill image', imageError);
      onError("The bill image didn't work. Try again.");
    }
  }

  // Phones only allow sharing straight after a tap, so the image has to exist before this runs.
  async function send(file: File) {
    try {
      await navigator.share({ files: [file] });
    } catch (shareError) {
      if ((shareError as Error).name !== 'AbortError') onError('Sharing is blocked here. Press and hold the bill to save it.');
    }
  }

  const person = { p_bill: bill.id, p_user: guest.user_id };

  return (
    <li className="person">
      <button type="button" className="person-head" aria-expanded={open}
        onClick={() => { onToggle(); setImage(null); }}>
        <span>
          {guest.name}: {formatRupees(amount)}
          <small>{statusText(guest, equal || lines.length > 0)}</small>
        </span>
        <span className="chevron" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>

      {guest.paid_at && (
        <div className="person-actions">
          <button type="button" className={guest.confirmed_at ? 'quiet' : ''} disabled={busy}
            onClick={() => onRun('confirm_paid', { ...person, p_confirmed: !guest.confirmed_at })}>
            {guest.confirmed_at ? 'Undo' : 'Confirm'}
          </button>
          {(!guest.confirmed_at || guest.offline) && (
            <button type="button" className="quiet" disabled={busy} onClick={() => onRun('reject_paid', person)}>Not received</button>
          )}
        </div>
      )}

      {open && (
        <div className="person-panel">
          {lines.length === 0 ? (
            <p className="note">{guest.name} hasn&apos;t picked anything yet.</p>
          ) : (
            <div className="sums">
              {lines.map((line) => (
                <p className="sum" key={line.label}><span>{line.label}</span><span>{formatRupees(line.paise)}</span></p>
              ))}
              {charges !== 0 && (
                <p className="sum"><span>{charges > 0 ? 'Tax and charges' : 'Discount'}</span><span>{formatRupees(Math.abs(charges))}</span></p>
              )}
              <p className="sum person-total"><span>Total</span><span>{formatRupees(amount)}</span></p>
            </div>
          )}
          {payable && <PayQr link={link} amount={formatRupees(amount)} />}
          {!isFinal && <p className="note">The QR appears once everyone has joined and every item is claimed.</p>}

          <div className="actions spaced">
            <button type="button" onClick={makeImage}>Share {guest.name}&apos;s bill</button>
            {!equal && !locked && (
              <button type="button" className="quiet" onClick={onEditItems}>
                {lines.length === 0 ? 'Add their items' : 'Change their items'}
              </button>
            )}
            {payable && (
              <button type="button" className="quiet" disabled={busy} onClick={() => onRun('host_got_cash', person)}>Got cash</button>
            )}
            {!locked && (
              <button type="button" className="quiet" disabled={busy} onClick={() => onRun('remove_member', person)}>Remove from bill</button>
            )}
          </div>

          {image && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- a generated blob, nothing for next/image to optimise */}
              <img className="bill-image" src={image.url} alt={`${guest.name}'s bill`} />
              {navigator.canShare?.({ files: [image.file] }) ? (
                <button type="button" className="spaced" onClick={() => send(image.file)}>Send</button>
              ) : (
                <p className="note">Press and hold the bill to save or share it.</p>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}
