'use client';

import { useMemo } from 'react';
import { qrCanvas } from '@/lib/qr';

export default function PayQr({ link, amount }: { link: string; amount: string }) {
  // A PNG rather than an SVG so it can be pressed and saved to the phone's gallery for GPay.
  const src = useMemo(() => qrCanvas(link).toDataURL('image/png'), [link]);
  // eslint-disable-next-line @next/next/no-img-element -- a generated data URL, nothing for next/image to optimise
  return <img className="qr" src={src} alt={`UPI QR code for ${amount}`} />;
}
