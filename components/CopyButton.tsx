'use client';

import { useEffect, useState } from 'react';
import { copyText } from '@/lib/clipboard';

const COPIED_MS = 2000;

type Props = {
  text: string;
  label: string;
  className?: string;
};

export default function CopyButton({ text, label, className }: Props) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (status === 'idle') return;
    const timer = setTimeout(() => setStatus('idle'), COPIED_MS);
    return () => clearTimeout(timer);
  }, [status]);

  return (
    <button type="button" className={className} aria-live="polite"
      onClick={async () => setStatus((await copyText(text)) ? 'copied' : 'failed')}>
      {status === 'copied' ? 'Copied' : status === 'failed' ? 'Press and hold the link to copy' : label}
    </button>
  );
}
