export type Item = {
  id: string;
  pricePaise: number;
  // How many portions can be claimed. 1 means whoever taps it shares it equally.
  units: number;
};

// units are portions counted to this member. shared means they also share whatever nobody counted.
export type Claim = { units: number; shared: boolean };

export type SplitInput = {
  items: Item[];
  claims: Record<string, Record<string, Claim>>;
  // Tax and service charge, minus any discount. Negative when the discount is larger.
  chargesPaise: number;
};

export type SplitResult = {
  // What each member owes, charges included
  totals: Record<string, number>;
  // Left over until every item is claimed, charges included
  unclaimedPaise: number;
  // memberId -> itemId -> paise before charges
  itemShares: Record<string, Record<string, number>>;
  // memberId -> their part of the tax, charges or discount
  chargeShares: Record<string, number>;
};

// 5 rotis are claimed by count; a plate of 0.5 kg or a single pizza is shared by tapping.
export const claimableUnits = (quantity: number) => (Number.isInteger(quantity) && quantity > 1 ? quantity : 1);

// Splits total by weight using the largest-remainder method, so the parts always add up to total.
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error('allocate needs a positive total weight');

  const parts = weights.map((weight) => Math.floor((total * weight) / sum));
  const remainders = weights.map((weight, i) => ({ i, remainder: total * weight - parts[i] * sum }));
  const leftover = total - parts.reduce((a, b) => a + b, 0);

  remainders.sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (let n = 0; n < leftover; n++) parts[remainders[n].i] += 1;
  return parts;
}

const add = (totals: Record<string, number>, id: string, paise: number) => {
  totals[id] = (totals[id] ?? 0) + paise;
};

export function splitBill({ items, claims, chargesPaise }: SplitInput): SplitResult {
  const subtotals: Record<string, number> = {};
  const itemShares: Record<string, Record<string, number>> = {};
  let unclaimed = 0;

  for (const item of items) {
    if (!Number.isSafeInteger(item.pricePaise) || item.pricePaise < 0) {
      throw new Error(`Invalid price for item ${item.id}`);
    }
    // Sorted so the same claims always give the same split.
    const members = Object.keys(claims[item.id] ?? {}).sort();
    if (members.length === 0) {
      unclaimed += item.pricePaise;
      continue;
    }
    const itemClaims = members.map((id) => claims[item.id][id]);
    const owe = (id: string, paise: number) => {
      add(subtotals, id, paise);
      add(itemShares[id] ??= {}, item.id, paise);
    };
    const sharers = members.filter((_, i) => itemClaims[i].shared);

    if (item.units === 1) {
      allocate(item.pricePaise, members.map(() => 1)).forEach((share, i) => owe(members[i], share));
      continue;
    }

    const counted = itemClaims.reduce((sum, claim) => sum + claim.units, 0);
    const rest = Math.max(item.units - counted, 0);
    const shares = allocate(item.pricePaise, [...itemClaims.map((claim) => claim.units), rest]);
    members.forEach((id, i) => owe(id, shares[i]));

    const restPaise = shares[members.length];
    if (sharers.length === 0) unclaimed += restPaise;
    else allocate(restPaise, sharers.map(() => 1)).forEach((share, i) => owe(sharers[i], share));
  }

  const members = Object.keys(subtotals).sort();
  // Unclaimed items keep their share of the charges, so a guest's total stays stable as others claim.
  const charges = allocate(chargesPaise, [...members.map((id) => subtotals[id]), unclaimed]);
  const totals = Object.fromEntries(members.map((id, i) => [id, subtotals[id] + charges[i]]));
  const chargeShares = Object.fromEntries(members.map((id, i) => [id, charges[i]]));

  return { totals, unclaimedPaise: unclaimed + charges[members.length], itemShares, chargeShares };
}

export function splitEqually(totalPaise: number, memberIds: string[]): Record<string, number> {
  const members = [...memberIds].sort();
  const shares = allocate(totalPaise, members.map(() => 1));
  return Object.fromEntries(members.map((id, i) => [id, shares[i]]));
}
