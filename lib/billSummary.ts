import { claimableUnits, splitBill, splitEqually, type Claim, type SplitResult } from './split.ts';
import type { Bill, ClaimRow, Member } from './types.ts';

export type BillSummary = {
  equal: boolean;
  itemsPaise: number;
  chargesPaise: number;
  claims: Record<string, Record<string, Claim>>;
  byItem: SplitResult;
  totals: Record<string, number>;
  unclaimedPaise: number;
  waitingFor: number;
  locked: boolean;
  isFinal: boolean;
  guests: Member[];
  confirmedPaise: number;
  owedPaise: number;
};

export type PersonLine = { label: string; paise: number };

export function summarizeBill(bill: Bill): BillSummary {
  const equal = bill.split_mode === 'equal';
  const itemsPaise = bill.items.reduce((sum, item) => sum + item.price_paise, 0);
  const chargesPaise = bill.total_paise - itemsPaise;

  const claims: BillSummary['claims'] = {};
  for (const claim of bill.claims) {
    (claims[claim.item_id] ??= {})[claim.user_id] = { units: claim.units, shared: claim.shared };
  }

  const byItem = splitBill({
    items: bill.items.map((item) => ({
      id: item.id,
      pricePaise: item.price_paise,
      units: claimableUnits(Number(item.quantity)),
    })),
    claims,
    chargesPaise,
  });

  // Seats nobody has taken yet still count, so the equal share doesn't jump as people arrive.
  const emptySeats = Array.from({ length: Math.max(bill.people_count - bill.members.length, 0) }, (_, i) => `seat-${i}`);
  const totals = equal
    ? splitEqually(bill.total_paise, [...bill.members.map((member) => member.user_id), ...emptySeats])
    : byItem.totals;
  const unclaimedPaise = equal ? 0 : byItem.unclaimedPaise;
  const waitingFor = emptySeats.length;
  const guests = bill.members.filter((member) => member.user_id !== bill.host_id);

  return {
    equal,
    itemsPaise,
    chargesPaise,
    claims,
    byItem,
    totals,
    unclaimedPaise,
    waitingFor,
    locked: bill.members.some((member) => !!member.paid_at),
    isFinal: waitingFor === 0 && unclaimedPaise === 0,
    guests,
    confirmedPaise: guests.reduce((sum, guest) => sum + (guest.confirmed_at ? totals[guest.user_id] ?? 0 : 0), 0),
    owedPaise: guests.reduce((sum, guest) => sum + (totals[guest.user_id] ?? 0), 0),
  };
}

export function personLines(bill: Bill, summary: BillSummary, id: string): PersonLine[] {
  if (summary.equal) return [{ label: `Equal share, 1 of ${bill.people_count}`, paise: summary.totals[id] ?? 0 }];

  return bill.items.flatMap((item) => {
    const paise = summary.byItem.itemShares[id]?.[item.id];
    const claim = summary.claims[item.id]?.[id];
    if (paise === undefined || !claim) return [];
    const count = claimableUnits(Number(item.quantity)) > 1 && claim.units > 0 ? `${claim.units} × ` : '';
    const shared = Object.keys(summary.claims[item.id]).length > 1 && (!count || claim.shared);
    return [{ label: `${count}${item.name}${shared ? ' (shared)' : ''}`, paise }];
  });
}

export const personCharges = (summary: BillSummary, id: string) =>
  summary.equal ? 0 : summary.byItem.chargeShares[id] ?? 0;

// The two functions below mirror set_claim and set_shared in the database, so the screen can
// update before the server answers.
export function withUnits(claims: ClaimRow[], itemId: string, userId: string, units: number): ClaimRow[] {
  const isTarget = (claim: ClaimRow) => claim.item_id === itemId && claim.user_id === userId;
  const existing = claims.find(isTarget);
  const others = claims.filter((claim) => !isTarget(claim));
  if (units > 0) return [...others, { item_id: itemId, user_id: userId, units, shared: existing?.shared ?? false }];
  return existing?.shared ? [...others, { ...existing, units: 0 }] : others;
}

export function withShared(claims: ClaimRow[], itemId: string, userId: string, shared: boolean): ClaimRow[] {
  const isTarget = (claim: ClaimRow) => claim.item_id === itemId && claim.user_id === userId;
  const existing = claims.find(isTarget);
  const others = claims.filter((claim) => !isTarget(claim));
  if (shared) return [...others, { item_id: itemId, user_id: userId, units: existing?.units ?? 0, shared: true }];
  return existing && existing.units > 0 ? [...others, { ...existing, shared: false }] : others;
}
