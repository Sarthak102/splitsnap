import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatRupees, isValidVpa, normalizeBill, parseRupees } from './bill.ts';

test('parseRupees accepts plain amounts only', () => {
  assert.equal(parseRupees('1'), 100);
  assert.equal(parseRupees(' 12.34 '), 1234);
  assert.equal(parseRupees('1.1'), 110);
  assert.equal(parseRupees('19.99'), 1999);
  for (const bad of ['', 'abc', '1.234', '-5', '1,000', '100001']) assert.equal(parseRupees(bad), null);
});

test('formatRupees uses Indian grouping', () => {
  assert.equal(formatRupees(12345678), '₹1,23,456.78');
});

test('isValidVpa', () => {
  assert.equal(isValidVpa('asha.rao@okaxis'), true);
  for (const bad of ['asha', 'a@b@c', 'a b@okaxis', '@okaxis']) assert.equal(isValidVpa(bad), false);
});

test('normalizeBill converts a model response', () => {
  const parsed = normalizeBill('{"isBill":true,"items":[{"name":" Tea ","quantity":2,"lineTotal":40.5}],"total":42.53}');
  assert.deepEqual(parsed, { items: [{ name: 'Tea', quantity: 2, pricePaise: 4050 }], totalPaise: 4253 });
});

test('normalizeBill drops bad lines and defaults quantity', () => {
  const parsed = normalizeBill({
    items: [{ name: 'Tea', lineTotal: 10 }, { name: '', lineTotal: 5 }, { name: 'Bad', lineTotal: -1 }, null],
    total: 10,
  });
  assert.deepEqual(parsed?.items, [{ name: 'Tea', quantity: 1, pricePaise: 1000 }]);
});

test('normalizeBill falls back to the item sum when the total is unreadable', () => {
  for (const total of [0, undefined, Infinity]) {
    assert.equal(normalizeBill({ items: [{ name: 'a', lineTotal: 12.5 }], total })?.totalPaise, 1250);
  }
});

test('normalizeBill rejects unusable responses', () => {
  for (const bad of ['not json', null, 5, { items: [], total: 10 }, { isBill: false, items: [{ name: 'a', lineTotal: 1 }], total: 1 },
    { items: 'x', total: 1 }, { items: [{ name: 'a', lineTotal: 0 }], total: 5 }]) {
    assert.equal(normalizeBill(bad), null);
  }
});
