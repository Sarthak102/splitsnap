'use client';

import { useState, type FormEvent } from 'react';
import { formatRupees } from '@/lib/bill';
import type { Seat } from '@/hooks/useBill';
import Logo from '../Logo';

type Props = {
  hostName: string;
  totalPaise: number;
  seats: Seat[];
  busy: boolean;
  error: string;
  onError: (message: string) => void;
  onJoin: (name: string) => void;
  onTakeSeat: (userId: string) => void;
};

export default function JoinForm({ hostName, totalPaise, seats, busy, error, onError, onJoin, onTakeSeat }: Props) {
  const [name, setName] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return onError('Enter your name so friends can see who claimed what.');
    onJoin(name);
  }

  return (
    <form onSubmit={submit} noValidate className="receipt-wrap">
      <div className="receipt">
        <header className="masthead">
          <Logo />
          <h1 className="small-title">Join the bill</h1>
          <p>{hostName} is splitting {formatRupees(totalPaise)}.</p>
        </header>
        <section>
          <label>Your name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="given-name" />
          </label>
          <button type="submit" className="spaced" disabled={busy}>{busy ? 'Joining…' : 'Join'}</button>
          {error && <p className="note error" role="alert">{error}</p>}
        </section>
        {seats.length > 0 && (
          <section>
            <h2>Already on this bill?</h2>
            <p className="note">Changed phone or browser? Tap your name to carry on.</p>
            <div className="actions spaced">
              {seats.map((seat) => (
                <button type="button" className="quiet" key={seat.user_id} disabled={busy}
                  onClick={() => onTakeSeat(seat.user_id)}>{seat.name}</button>
              ))}
            </div>
          </section>
        )}
      </div>
    </form>
  );
}
