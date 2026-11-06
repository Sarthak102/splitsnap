import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appLinks, upiLink } from './upi.ts';

test('upiLink keeps the UPI ID readable and encodes text', () => {
  assert.equal(
    upiLink({ vpa: 'asha.rao@okaxis', name: 'Asha Rao', paise: 12350, note: 'Dinner & tip' }),
    'upi://pay?pa=asha.rao@okaxis&pn=Asha%20Rao&am=123.50&cu=INR&tn=Dinner%20%26%20tip',
  );
});

test('upiLink drops characters UPI apps can reject', () => {
  assert.match(upiLink({ vpa: 'a@b', name: 'Asha 🙂', paise: 100, note: 'x' }), /pn=Asha&/);
  assert.match(upiLink({ vpa: 'a@b', name: 'आशा', paise: 100, note: 'x' }), /pn=SplitSnap&/);
});

test('appLinks reuse the same query and skip GPay', () => {
  const links = appLinks('upi://pay?pa=a@b&am=1.00');
  assert.deepEqual(links.map((link) => link.href), ['phonepe://pay?pa=a@b&am=1.00', 'paytmmp://pay?pa=a@b&am=1.00']);
});
