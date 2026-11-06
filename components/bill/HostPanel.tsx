'use client';

import { useState, type FormEvent } from 'react';
import { formatRupees } from '@/lib/bill';
import type { BillSummary } from '@/lib/billSummary';
import type { Bill } from '@/lib/types';
import PersonRow from './PersonRow';

type Props = {
  bill: Bill;
  hostId: string;
  summary: BillSummary;
  busy: boolean;
  error: string;
  onEditItems: (userId: string) => void;
  onRun: (fn: string, args: Record<string, unknown>) => Promise<boolean>;
  onError: (message: string) => void;
};

export default function HostPanel({ bill, hostId, summary, busy, error, onEditItems, onRun, onError }: Props) {
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const [newPerson, setNewPerson] = useState('');
  const { locked, waitingFor, guests, confirmedPaise, owedPaise } = summary;

  async function addPerson(event: FormEvent) {
    event.preventDefault();
    if (!newPerson.trim()) return onError('Enter their name.');
    if (await onRun('add_person', { p_bill: bill.id, p_name: newPerson })) setNewPerson('');
  }

  return (
    <div className="receipt-wrap" id="pay">
      <div className="receipt">
        <h2>Collected {formatRupees(confirmedPaise)} of {formatRupees(owedPaise)}</h2>
        <div className="stepper-row">
          <span>People splitting</span>
          <div className="stepper" role="group" aria-label="Number of people">
            <button type="button" aria-label="One fewer person" disabled={busy || locked || bill.people_count <= bill.members.length}
              onClick={() => onRun('set_people', { p_bill: bill.id, p_people: bill.people_count - 1 })}>−</button>
            <output>{bill.people_count}</output>
            <button type="button" aria-label="One more person" disabled={busy || locked || bill.people_count >= 30}
              onClick={() => onRun('set_people', { p_bill: bill.id, p_people: bill.people_count + 1 })}>+</button>
          </div>
        </div>
        {waitingFor > 0 && (
          <p className="note">Waiting for {waitingFor} more. If someone isn&apos;t coming, lower the number. If they have no phone, add them below.</p>
        )}

        <ul className="people">
          {guests.map((guest) => (
            <PersonRow key={guest.user_id} bill={bill} guest={guest} summary={summary} busy={busy}
              open={openPerson === guest.user_id}
              onToggle={() => setOpenPerson(openPerson === guest.user_id ? null : guest.user_id)}
              onEditItems={() => { setOpenPerson(null); onEditItems(guest.user_id); }}
              onRun={onRun} onError={onError} />
          ))}
        </ul>

        {!locked && waitingFor > 0 && (
          <form className="add-person" onSubmit={addPerson} noValidate>
            <label>Add someone with no phone
              <input value={newPerson} onChange={(e) => setNewPerson(e.target.value)} maxLength={60} />
            </label>
            <button type="submit" className="quiet" disabled={busy}>Add</button>
          </form>
        )}
        {error && <p className="note error" role="alert">{error}</p>}
        <p className="note">Your own share is {formatRupees(summary.totals[hostId] ?? 0)}. Check your UPI app before confirming a payment.</p>
      </div>
    </div>
  );
}
