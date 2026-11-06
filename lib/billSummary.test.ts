import assert from 'node:assert/strict';
import { test } from 'node:test';
import { personLines, summarizeBill, withShared, withUnits } from './billSummary.ts';
import type { Bill, ClaimRow, Member } from './types.ts';

const member = (user_id: string, fields: Partial<Member> = {}): Member => ({
  user_id, name: user_id, offline: false, paid_method: null, paid_at: null, confirmed_at: null, ...fields,
});

const bill = (fields: Partial<Bill> = {}): Bill => ({
  id: 'b',
  host_id: 'host',
  host_name: 'Host',
  host_vpa: 'h@okaxis',
  total_paise: 13000,
  split_mode: 'items',
  people_count: 2,
  items: [
    { id: 'roti', name: 'Roti', quantity: 4, price_paise: 4000 },
    { id: 'dal', name: 'Dal', quantity: 1, price_paise: 8000 },
  ],
  members: [member('host'), member('asha')],
  claims: [],
  ...fields,
});

const claim = (item_id: string, user_id: string, units = 1, shared = false): ClaimRow => ({ item_id, user_id, units, shared });

test('a bill is final once everyone joined and everything is claimed', () => {
  const claims = [claim('roti', 'host', 2), claim('roti', 'asha', 2), claim('dal', 'asha')];
  const summary = summarizeBill(bill({ claims }));
  assert.equal(summary.isFinal, true);
  assert.equal(summary.chargesPaise, 1000);
  assert.equal(summary.totals.asha + summary.totals.host, 13000);
});

test('a bill is not final while seats are empty', () => {
  const claims = [claim('roti', 'host', 4), claim('dal', 'asha')];
  const summary = summarizeBill(bill({ claims, people_count: 3 }));
  assert.equal(summary.waitingFor, 1);
  assert.equal(summary.isFinal, false);
});

test('equal shares count empty seats, so they stay put as people arrive', () => {
  const summary = summarizeBill(bill({ split_mode: 'equal', people_count: 3, total_paise: 9000 }));
  assert.equal(summary.totals.host, 3000);
  assert.equal(summary.totals.asha, 3000);
});

test('payments lock the bill and count towards collected', () => {
  const paid = member('asha', { paid_at: 'now', confirmed_at: 'now' });
  const summary = summarizeBill(bill({ split_mode: 'equal', members: [member('host'), paid] }));
  assert.equal(summary.locked, true);
  assert.equal(summary.confirmedPaise, summary.owedPaise);
});

test('personLines labels counts and shared items', () => {
  const data = bill({ claims: [claim('roti', 'asha', 2), claim('dal', 'asha'), claim('dal', 'host')] });
  const summary = summarizeBill(data);
  assert.deepEqual(personLines(data, summary, 'asha').map((line) => line.label), ['2 × Roti', 'Dal (shared)']);
});

test('withUnits adds, changes and removes a claim', () => {
  const one = withUnits([], 'roti', 'asha', 1);
  assert.deepEqual(one, [claim('roti', 'asha', 1)]);
  assert.deepEqual(withUnits(one, 'roti', 'asha', 3), [claim('roti', 'asha', 3)]);
  assert.deepEqual(withUnits(one, 'roti', 'asha', 0), []);
});

test('withUnits keeps a sharer when their count reaches zero', () => {
  assert.deepEqual(withUnits([claim('roti', 'asha', 2, true)], 'roti', 'asha', 0), [claim('roti', 'asha', 0, true)]);
});

test('withShared toggles without losing a count', () => {
  assert.deepEqual(withShared([], 'roti', 'asha', true), [claim('roti', 'asha', 0, true)]);
  assert.deepEqual(withShared([claim('roti', 'asha', 2)], 'roti', 'asha', true), [claim('roti', 'asha', 2, true)]);
  assert.deepEqual(withShared([claim('roti', 'asha', 2, true)], 'roti', 'asha', false), [claim('roti', 'asha', 2)]);
  assert.deepEqual(withShared([claim('roti', 'asha', 0, true)], 'roti', 'asha', false), []);
});

test('claims for other people and items are left alone', () => {
  const other = claim('dal', 'host');
  assert.deepEqual(withUnits([other], 'roti', 'asha', 0), [other]);
  assert.deepEqual(withShared([other], 'roti', 'asha', false), [other]);
});
