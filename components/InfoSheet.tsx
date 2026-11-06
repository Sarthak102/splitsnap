'use client';

import { useRef } from 'react';
import { LOGO_PATHS } from '@/lib/brand';
import Logo from './Logo';

const FEATURES = [
  ['Scan the bill', 'Photograph it and the items fill in. You can fix anything before sharing.'],
  ['Everyone picks their own', 'Friends open your link and tap what they had, and you all see it live.'],
  ['Count or share', 'Use + and − for rotis, or Shared when you split plates.'],
  ['Or split equally', 'One tap, and everyone pays the same.'],
  ['Pay by UPI or cash', 'PhonePe and Paytm open directly. GPay works with the QR code.'],
  ['The host stays in control', "See each person's items, show their QR, share their bill and confirm payments."],
];

function Phone({ children }: { children: React.ReactNode }) {
  return (
    <svg className="step-picture" viewBox="0 0 120 150" aria-hidden="true">
      <rect x="1.5" y="1.5" width="117" height="147" rx="14" fill="#fffbf0" stroke="#1a1410" strokeWidth="3" />
      {children}
    </svg>
  );
}

const SafariPicture = () => (
  <Phone>
    <rect x="14" y="16" width="92" height="9" rx="4" fill="#ddd2bd" />
    <rect x="14" y="36" width="60" height="6" fill="#ddd2bd" />
    <rect x="14" y="48" width="78" height="6" fill="#ddd2bd" />
    <rect x="14" y="60" width="46" height="6" fill="#ddd2bd" />
    <line x1="3" y1="118" x2="117" y2="118" stroke="#1a1410" strokeWidth="1.5" />
    <circle cx="60" cy="133" r="15" fill="#ff5b1f" />
    <path d="M60 124v13M55 129l5-5 5 5M54 133h-2v9h16v-9h-2" fill="none" stroke="#1a1410" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="26" cy="133" r="3" fill="#6a5c4d" />
    <circle cx="94" cy="133" r="3" fill="#6a5c4d" />
  </Phone>
);

const MenuPicture = () => (
  <Phone>
    <rect x="3" y="44" width="114" height="103" fill="#f4e9d3" />
    <rect x="12" y="54" width="96" height="20" fill="#fffbf0" />
    <rect x="18" y="62" width="50" height="5" fill="#ddd2bd" />
    <rect x="9" y="80" width="102" height="28" fill="#ff5b1f" />
    <rect x="16" y="87" width="14" height="14" rx="3" fill="none" stroke="#1a1410" strokeWidth="2.2" />
    <path d="M23 90v8M19 94h8" stroke="#1a1410" strokeWidth="2.2" strokeLinecap="round" />
    <text x="34" y="96.5" fontSize="7" fontWeight="700" fill="#1a1410">Add to Home Screen</text>
    <rect x="12" y="114" width="96" height="20" fill="#fffbf0" />
    <rect x="18" y="122" width="62" height="5" fill="#ddd2bd" />
  </Phone>
);

const ConfirmPicture = () => (
  <Phone>
    <text x="12" y="24" fontSize="10" fill="#6a5c4d">Cancel</text>
    <rect x="84" y="11" width="30" height="19" rx="9" fill="#ff5b1f" />
    <text x="99" y="24" fontSize="10" fontWeight="700" textAnchor="middle" fill="#1a1410">Add</text>
    <rect x="42" y="50" width="36" height="36" rx="9" fill="#fffbf0" stroke="#1a1410" strokeWidth="1.5" />
    <g transform="translate(49 57) scale(0.22)" fill="#ff5b1f">
      {LOGO_PATHS.map((path) => <path key={path} d={path} />)}
    </g>
    <text x="60" y="102" fontSize="10" fontWeight="700" textAnchor="middle" fill="#1a1410">SplitSnap</text>
  </Phone>
);

const STEPS = [
  { title: 'Tap Share in Safari', detail: 'On newer iPhones, tap the ••• button first.', picture: <SafariPicture /> },
  { title: 'Choose Add to Home Screen', detail: 'Scroll down the list if you don’t see it.', picture: <MenuPicture /> },
  { title: 'Tap Add', detail: 'SplitSnap now opens like an app.', picture: <ConfirmPicture /> },
];

export default function InfoSheet() {
  const sheet = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button type="button" className="info-button" aria-label="How SplitSnap works" onClick={() => sheet.current?.showModal()}>i</button>
      <dialog ref={sheet} className="info-sheet" onClick={(event) => { if (event.target === sheet.current) sheet.current?.close(); }}>
        <div className="info-body">
          <form method="dialog"><button className="info-close" aria-label="Close">×</button></form>
          <header className="masthead">
            <Logo />
            <h2 className="info-title">How it works</h2>
          </header>

          <section>
            <h3>Add it to your iPhone</h3>
            <ol className="steps">
              {STEPS.map((step) => (
                <li key={step.title}>
                  {step.picture}
                  <span>
                    <b>{step.title}</b>
                    <small>{step.detail}</small>
                  </span>
                </li>
              ))}
            </ol>
            <p className="note">This works in Safari. On Android, open the Chrome menu and choose Add to Home screen.</p>
          </section>

          <section>
            <h3>What you can do</h3>
            <dl className="features">
              {FEATURES.map(([name, detail]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{detail}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </dialog>
    </>
  );
}
