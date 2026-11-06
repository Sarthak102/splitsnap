'use client';

import { useState, type FormEvent } from 'react';
import { isValidVpa, parseRupees } from '@/lib/bill';
import type { Bill } from '@/lib/types';
import ItemEditor, { lineError, linesForSave, newLine, type Line } from '../ItemEditor';

type Props = {
  bill: Bill;
  busy: boolean;
  error: string;
  onError: (message: string) => void;
  onSave: (args: Record<string, unknown>) => void;
  onCancel: () => void;
};

const toLines = (bill: Bill): Line[] => bill.items.map((item) => newLine({
  id: item.id,
  name: item.name,
  quantity: String(Number(item.quantity)),
  rupees: (item.price_paise / 100).toFixed(2),
}));

export default function EditBillForm({ bill, busy, error, onError, onSave, onCancel }: Props) {
  const [vpa, setVpa] = useState(bill.host_vpa);
  const [total, setTotal] = useState((bill.total_paise / 100).toFixed(2));
  const [lines, setLines] = useState(() => toLines(bill));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!isValidVpa(vpa)) return onError('Enter your UPI ID, like name@okaxis.');
    const totalPaise = parseRupees(total);
    const problem = lineError(lines, totalPaise);
    if (problem) return onError(problem);
    onSave({ p_bill: bill.id, p_host_vpa: vpa, p_total_paise: totalPaise, p_items: linesForSave(lines) });
  }

  return (
    <form onSubmit={submit} noValidate className="receipt-wrap">
      <div className="receipt">
        <h1 className="small-title">Edit the bill</h1>
        <p className="note">If you change an item&apos;s quantity, people will need to claim that item again.</p>
        <section>
          <label>Your UPI ID
            <input value={vpa} onChange={(e) => setVpa(e.target.value)} maxLength={129}
              autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </label>
          <ItemEditor lines={lines} total={total} onLines={setLines} onTotal={setTotal} />
        </section>
        {error && <p className="note error" role="alert">{error}</p>}
        <section className="actions">
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
          <button type="button" className="quiet" disabled={busy} onClick={onCancel}>Keep the bill as it is</button>
        </section>
      </div>
    </form>
  );
}
