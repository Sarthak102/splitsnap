import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allocate, claimableUnits, splitBill, splitEqually } from './split.ts';

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

test('allocate always adds up to the total', () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocate(1, [1, 1]), [1, 0]);
  assert.equal(sum(allocate(-100, [1, 1, 1])), -100);
});

test('allocate rejects zero total weight', () => {
  assert.throws(() => allocate(100, [0, 0]));
});

const item = (id: string, pricePaise: number, units = 1) => ({ id, pricePaise, units });
const count = (units: number) => ({ units, shared: false });
const tap = count(1);
const share = (units = 0) => ({ units, shared: true });

test('a shared item splits equally and charges follow each share', () => {
  const { totals, unclaimedPaise } = splitBill({
    items: [item('pizza', 30000), item('coke', 10000)],
    claims: { pizza: { asha: tap, ravi: tap }, coke: { ravi: tap } },
    chargesPaise: 4000,
  });
  assert.deepEqual(totals, { asha: 16500, ravi: 27500 });
  assert.equal(unclaimedPaise, 0);
});

test('shares add up to the bill exactly when prices do not divide evenly', () => {
  const { totals, unclaimedPaise } = splitBill({
    items: [item('thali', 10001)],
    claims: { thali: { a: tap, b: tap, c: tap } },
    chargesPaise: 1801,
  });
  assert.equal(unclaimedPaise, 0);
  assert.equal(sum(Object.values(totals)), 11802);
});

test('rotis are charged by how many each person ate', () => {
  const { totals, unclaimedPaise } = splitBill({
    items: [item('roti', 5000, 5)],
    claims: { roti: { asha: count(2), ravi: count(3) } },
    chargesPaise: 0,
  });
  assert.deepEqual(totals, { asha: 2000, ravi: 3000 });
  assert.equal(unclaimedPaise, 0);
});

test('rotis nobody has claimed yet stay unclaimed', () => {
  const { totals, unclaimedPaise } = splitBill({
    items: [item('roti', 5000, 5)],
    claims: { roti: { asha: count(2) } },
    chargesPaise: 500,
  });
  assert.deepEqual(totals, { asha: 2200 });
  assert.equal(unclaimedPaise, 3300);
});

test('unclaimed items hold back their share of the charges', () => {
  const { totals, unclaimedPaise } = splitBill({
    items: [item('a', 10000), item('b', 10000)],
    claims: { a: { asha: tap } },
    chargesPaise: 2000,
  });
  assert.deepEqual(totals, { asha: 11000 });
  assert.equal(unclaimedPaise, 11000);
});

test('a discount reduces shares and still adds up', () => {
  const { totals } = splitBill({
    items: [item('a', 10000)],
    claims: { a: { asha: tap, ravi: tap } },
    chargesPaise: -1001,
  });
  assert.equal(sum(Object.values(totals)), 8999);
});

test('three friends share two plates', () => {
  const { totals, unclaimedPaise } = splitBill({
    items: [item('biryani', 60000, 2)],
    claims: { biryani: { a: share(), b: share(), c: share() } },
    chargesPaise: 0,
  });
  assert.deepEqual(totals, { a: 20000, b: 20000, c: 20000 });
  assert.equal(unclaimedPaise, 0);
});

test('sharers split only what nobody counted', () => {
  const { totals, unclaimedPaise } = splitBill({
    items: [item('roti', 6000, 6)],
    claims: { roti: { a: count(2), b: share(), c: share() } },
    chargesPaise: 0,
  });
  assert.deepEqual(totals, { a: 2000, b: 2000, c: 2000 });
  assert.equal(unclaimedPaise, 0);
});

test('a person can count portions and share the rest', () => {
  const { totals } = splitBill({
    items: [item('roti', 4000, 4)],
    claims: { roti: { a: share(2), b: share() } },
    chargesPaise: 0,
  });
  assert.deepEqual(totals, { a: 3000, b: 1000 });
});

test('sharers owe nothing when every portion is counted', () => {
  const { totals, unclaimedPaise } = splitBill({
    items: [item('roti', 2000, 2)],
    claims: { roti: { a: count(2), b: share() } },
    chargesPaise: 0,
  });
  assert.deepEqual(totals, { a: 2000, b: 0 });
  assert.equal(unclaimedPaise, 0);
});

test('shared plates still add up exactly with charges', () => {
  const { totals, unclaimedPaise } = splitBill({
    items: [item('plate', 10001, 2), item('tea', 3333)],
    claims: { plate: { a: share(), b: share(), c: share() }, tea: { c: tap } },
    chargesPaise: 777,
  });
  assert.equal(unclaimedPaise, 0);
  assert.equal(sum(Object.values(totals)), 14111);
});

test('itemShares and chargeShares add up to each total', () => {
  const { totals, itemShares, chargeShares } = splitBill({
    items: [item('roti', 6001, 6), item('dal', 10000), item('rice', 3333)],
    claims: { roti: { a: count(2), b: share(), c: share() }, dal: { a: tap, b: tap }, rice: { c: tap } },
    chargesPaise: 1999,
  });
  for (const id of ['a', 'b', 'c']) {
    assert.equal(sum(Object.values(itemShares[id])) + chargeShares[id], totals[id]);
  }
  assert.equal(itemShares.a.roti, 2000);
  assert.equal(sum(Object.values(totals)), 21333);
});

test('invalid prices are rejected', () => {
  assert.throws(() => splitBill({ items: [item('a', 10.5)], claims: {}, chargesPaise: 0 }));
  assert.throws(() => splitBill({ items: [item('a', -1)], claims: {}, chargesPaise: 0 }));
});

test('splitEqually adds up exactly', () => {
  assert.deepEqual(splitEqually(10000, ['c', 'a', 'b']), { a: 3334, b: 3333, c: 3333 });
});

test('only whole quantities above 1 are claimed by count', () => {
  assert.deepEqual([5, 2, 1, 0.5, 1.5].map(claimableUnits), [5, 2, 1, 1, 1]);
});
