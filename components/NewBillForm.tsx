'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { formatRupees, isValidVpa, parseRupees, type ParsedBill } from '@/lib/bill';
import { toJpeg } from '@/lib/photo';
import { ensureSession, supabase } from '@/lib/supabase';
import ItemEditor, { lineError, linesForSave, newLine, type Line } from './ItemEditor';
import Logo from './Logo';

type RecentBill = { join_token: string; host_name: string; total_paise: number; created_at: string };

const DRAFT_KEY = 'splitsnap-draft';
const TIP_KEY = 'splitsnap-install-tip-seen';
const PARSE_TIMEOUT_MS = 125_000;

export default function NewBillForm() {
  const router = useRouter();
  const photoInput = useRef<HTMLInputElement>(null);
  const [hostName, setHostName] = useState('');
  const [hostVpa, setHostVpa] = useState('');
  const [lines, setLines] = useState<Line[] | null>(null);
  const [total, setTotal] = useState('');
  const [people, setPeople] = useState(2);
  const [recent, setRecent] = useState<RecentBill[]>([]);
  const [showInstallTip, setShowInstallTip] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // A refresh or a phone discarding the tab shouldn't lose a bill that took a scan to read.
  useEffect(() => {
    try {
      const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null');
      if (!draft) return;
      /* eslint-disable react-hooks/set-state-in-effect -- sessionStorage only exists after hydration */
      setHostName(draft.hostName);
      setHostVpa(draft.hostVpa);
      setPeople(draft.people);
      setTotal(draft.total);
      setLines(draft.lines?.map((line: Line) => newLine({ ...line, key: undefined })) ?? null);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      sessionStorage.removeItem(DRAFT_KEY);
    }
  }, []);

  useEffect(() => {
    (async () => {
      // Only someone who has used the app has a session, so a first visit makes no account.
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      const { data: bills } = await supabase.from('bills')
        .select('join_token, host_name, total_paise, created_at')
        .order('created_at', { ascending: false })
        .limit(5);
      setRecent(bills ?? []);
    })();
  }, []);

  useEffect(() => {
    try {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      const installed = (navigator as Navigator & { standalone?: boolean }).standalone;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the browser only exists after hydration
      if (ios && !installed && !localStorage.getItem(TIP_KEY)) setShowInstallTip(true);
    } catch {
      // Blocked storage only means the tip doesn't show.
    }
  }, []);

  function dismissInstallTip() {
    setShowInstallTip(false);
    try {
      localStorage.setItem(TIP_KEY, '1');
    } catch {
      // Blocked storage means the tip comes back next time.
    }
  }

  useEffect(() => {
    try {
      if (hostName || hostVpa || lines) {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ hostName, hostVpa, people, total, lines }));
      }
    } catch {
      // Private browsing can refuse storage; the form still works without a draft.
    }
  }, [hostName, hostVpa, people, total, lines]);

  async function scan(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError('');
    setScanning(true);
    try {
      let photo: Blob;
      try {
        photo = await toJpeg(file);
      } catch {
        setError("We couldn't open that photo. Try a JPEG or PNG, or add the items by hand.");
        return;
      }
      const session = await ensureSession();
      const response = await fetch('/api/parse', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'content-type': 'image/jpeg' },
        body: photo,
        signal: AbortSignal.timeout(PARSE_TIMEOUT_MS),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error);
        return;
      }
      const bill = body as ParsedBill;
      setLines(bill.items.map((item) => newLine({
        name: item.name,
        quantity: String(item.quantity),
        rupees: (item.pricePaise / 100).toFixed(2),
      })));
      setTotal((bill.totalPaise / 100).toFixed(2));
    } catch {
      setError("Scanning didn't finish. Try again, or add the items by hand.");
    } finally {
      setScanning(false);
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setError('');

    if (!hostName.trim()) return setError('Enter your name so friends know who to pay.');
    if (!isValidVpa(hostVpa)) return setError('Enter your UPI ID, like name@okaxis.');
    const problem = lines ? lineError(lines, parseRupees(total)) : 'Add the items on the bill.';
    if (problem) return setError(problem);

    setCreating(true);
    try {
      await ensureSession();
      const { data, error: rpcError } = await supabase.rpc('create_bill', {
        p_host_name: hostName,
        p_host_vpa: hostVpa,
        p_total_paise: parseRupees(total),
        p_items: linesForSave(lines!),
        p_people: people,
      });
      if (rpcError) {
        console.error('create_bill failed', rpcError);
        setError(rpcError.message === 'rate_limited'
          ? "You've created a lot of bills recently. Try again in a while."
          : "We couldn't save the bill. Check your connection and try again.");
        return;
      }
      // This page stays mounted behind the bill, so Start a new bill has to find it empty.
      sessionStorage.removeItem(DRAFT_KEY);
      setHostName('');
      setHostVpa('');
      setPeople(2);
      setLines(null);
      setTotal('');
      router.push(`/b/${data}`);
    } catch {
      setError("We couldn't save the bill. Check your connection and try again.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
    <form onSubmit={create} noValidate className="receipt-wrap">
      <div className="receipt">
        <header className="masthead">
          <Logo />
          <h1>SplitSnap</h1>
          <p>Scan the bill, tap what you ate, pay your friend back.</p>
        </header>

        <section>
          <h2>Who&apos;s collecting the money?</h2>
          <label>Your name
            <input value={hostName} onChange={(e) => setHostName(e.target.value)} maxLength={60} autoComplete="name" />
          </label>
          <label>Your UPI ID
            <input value={hostVpa} onChange={(e) => setHostVpa(e.target.value)} maxLength={129} placeholder="name@okaxis"
              autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </label>
        </section>

        <section>
          <h2>How many people are splitting?</h2>
          <div className="stepper-row">
            <span>Count yourself too</span>
            <div className="stepper" role="group" aria-label="Number of people">
              <button type="button" aria-label="One fewer person" disabled={people <= 2} onClick={() => setPeople(people - 1)}>−</button>
              <output>{people}</output>
              <button type="button" aria-label="One more person" disabled={people >= 30} onClick={() => setPeople(people + 1)}>+</button>
            </div>
          </div>
        </section>

        <section>
          <h2>What&apos;s on the bill?</h2>
          <input ref={photoInput} className="file-input" type="file" accept="image/*" onChange={scan} tabIndex={-1} aria-label="Bill photo" />
          <div className="actions">
            <button type="button" onClick={() => photoInput.current?.click()} disabled={scanning || creating}>
              {scanning ? 'Reading your bill…' : 'Scan a bill photo'}
            </button>
            {!lines && (
              <button type="button" className="quiet" onClick={() => setLines([newLine()])} disabled={scanning}>
                Add items by hand
              </button>
            )}
          </div>
          {scanning && <p className="note" role="status">This can take up to a minute. Keep this page open.</p>}
          {!scanning && !lines && !error && (
            <p className="note">Your photo goes to an AI service to read the items. We don&apos;t store it.</p>
          )}

          {lines && <ItemEditor lines={lines} total={total} onLines={setLines} onTotal={setTotal} />}
        </section>

        {error && <p className="note error" role="alert">{error}</p>}

        {lines && (
          <section>
            <button type="submit" disabled={creating || scanning}>{creating ? 'Creating…' : 'Create bill'}</button>
          </section>
        )}
      </div>
    </form>

    {showInstallTip && (
      <div className="receipt-wrap">
        <div className="receipt">
          <h2>Keep it on your phone</h2>
          <p className="note">In Safari, tap Share, then Add to Home Screen.</p>
          <button type="button" className="quiet spaced" onClick={dismissInstallTip}>Got it</button>
        </div>
      </div>
    )}

    {recent.length > 0 && (
      <div className="receipt-wrap">
        <div className="receipt">
          <h2>Your recent bills</h2>
          <ul className="people">
            {recent.map((bill) => (
              <li key={bill.join_token}>
                <Link href={`/b/${bill.join_token}`}>
                  {bill.host_name}&apos;s bill
                  <small>{new Date(bill.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small>
                </Link>
                <span>{formatRupees(bill.total_paise)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    )}
    </>
  );
}
