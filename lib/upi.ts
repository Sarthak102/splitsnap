type Payment = { vpa: string; name: string; paise: number; note: string };

// Encoded by hand because URLSearchParams turns "@" into %40 and spaces into "+".
export function upiLink({ vpa, name, paise, note }: Payment): string {
  // Some UPI apps reject names outside basic Latin text.
  const payee = name.replace(/[^ -~]/g, '').trim() || 'SplitSnap';
  return `upi://pay?pa=${vpa}&pn=${encodeURIComponent(payee)}&am=${(paise / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
}

// GPay is left out on purpose: it declines links to personal UPI IDs, so GPay users pay by QR.
export const appLinks = (link: string) => [
  { label: 'PhonePe', href: link.replace('upi://pay?', 'phonepe://pay?') },
  { label: 'Paytm', href: link.replace('upi://pay?', 'paytmmp://pay?') },
];
