import { formatRupees } from '@/lib/bill';
import type { BillSummary } from '@/lib/billSummary';
import type { Bill, Member } from '@/lib/types';
import { appLinks } from '@/lib/upi';
import PayQr from './PayQr';

type Props = {
  bill: Bill;
  me: Member;
  summary: BillSummary;
  link: string;
  busy: boolean;
  onPaid: (paid: boolean, method?: 'upi' | 'cash') => void;
};

export default function GuestPanel({ bill, me, summary, link, busy, onPaid }: Props) {
  const { equal, unclaimedPaise, waitingFor, isFinal } = summary;
  const total = summary.totals[me.user_id] ?? 0;
  const canPay = total > 0 && isFinal;

  return (
    <div className="receipt-wrap" id="pay">
      <div className="receipt">
        <h2>Your share</h2>
        <p className="share">{formatRupees(total)}</p>
        {total === 0 && !equal && unclaimedPaise > 0 && <p className="note">Claim what you had to see your share.</p>}
        {total === 0 && !equal && unclaimedPaise === 0 && <p className="note">You have nothing to pay.</p>}
        {waitingFor > 0 && !me.paid_at && (
          <p className="note">This isn&apos;t final yet. You can pay once all {bill.people_count} people have joined.</p>
        )}
        {waitingFor === 0 && !equal && total > 0 && unclaimedPaise > 0 && (
          <p className="note">This can still change. You can pay once every item is claimed.</p>
        )}
        {canPay && !me.paid_at && (
          <>
            <p className="note">Paying {bill.host_name} at {bill.host_vpa}</p>
            <div className="apps">
              {appLinks(link).map((app) => <a key={app.label} className="button" href={app.href}>Pay with {app.label}</a>)}
            </div>
            <a className="button quiet spaced" href={link}>Open another UPI app</a>
            <section>
              <h2>Paying with GPay?</h2>
              <p className="note">
                GPay only accepts the QR code. Press and hold it to save it, then in GPay open the scanner and choose it from your gallery.
              </p>
              <PayQr link={link} amount={formatRupees(total)} />
            </section>
            <section className="actions">
              <button type="button" disabled={busy} onClick={() => onPaid(true, 'upi')}>I&apos;ve paid</button>
              <button type="button" className="quiet" disabled={busy} onClick={() => onPaid(true, 'cash')}>I&apos;m paying cash</button>
            </section>
          </>
        )}
        {me.paid_at && !me.confirmed_at && (
          <>
            <p className="note" role="status">Waiting for {bill.host_name} to confirm your {me.paid_method === 'cash' ? 'cash' : 'payment'}.</p>
            <button type="button" className="quiet spaced" disabled={busy} onClick={() => onPaid(false)}>I haven&apos;t paid yet</button>
          </>
        )}
        {me.confirmed_at && <p className="stamp" role="status">Paid</p>}
      </div>
    </div>
  );
}
