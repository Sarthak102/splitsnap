import { formatRupees } from '@/lib/bill';
import { claimableUnits, type Claim } from '@/lib/split';
import type { Item } from '@/lib/types';

type Props = {
  item: Item;
  itemClaims: Record<string, Claim>;
  actor: string;
  equal: boolean;
  locked: boolean;
  memberName: (id: string) => string;
  onUnits: (item: Item, units: number) => void;
  onShared: (item: Item, shared: boolean) => void;
};

export default function ItemRow({ item, itemClaims, actor, equal, locked, memberName, onUnits, onShared }: Props) {
  const units = claimableUnits(Number(item.quantity));
  const mine = itemClaims[actor];
  const heading = (
    <span className="line-main">
      <span>{Number(item.quantity)} × {item.name}</span>
      <span>{formatRupees(item.price_paise)}</span>
    </span>
  );

  if (equal) return <li className="line">{heading}</li>;

  if (units === 1) {
    return (
      <li>
        <button type="button" className={`line ${mine ? 'mine' : ''}`} aria-pressed={!!mine} disabled={locked}
          onClick={() => (mine?.shared ? onShared(item, false) : onUnits(item, mine ? 0 : 1))}>
          {heading}
          <span className="line-who">{Object.keys(itemClaims).map(memberName).join(', ') || 'Tap if you had this'}</span>
        </button>
      </li>
    );
  }

  const count = mine?.units ?? 0;
  const entries = Object.entries(itemClaims);
  const counted = entries.reduce((sum, [, claim]) => sum + claim.units, 0);
  const left = units - counted;
  const counts = entries
    .filter(([, claim]) => claim.units > 0)
    .map(([id, claim]) => `${memberName(id)} ${claim.units}`)
    .join(', ');
  const sharers = entries.filter(([, claim]) => claim.shared).map(([id]) => memberName(id));
  const rest = left === 0 ? 'All claimed' : sharers.length > 0 ? `${sharers.join(', ')} sharing ${left}` : `${left} left`;

  return (
    <li className={`line ${mine ? 'mine' : ''}`}>
      {heading}
      <div className="line-foot">
        <span className="line-who">{[counts, rest].filter(Boolean).join('. ')}</span>
        <div className="stepper" role="group" aria-label={`How many ${item.name} you had`}>
          <button type="button" aria-label={`One less ${item.name}`} disabled={locked || count === 0}
            onClick={() => onUnits(item, count - 1)}>−</button>
          <output key={count}>{count}</output>
          <button type="button" aria-label={`One more ${item.name}`} disabled={locked || left === 0}
            onClick={() => onUnits(item, count + 1)}>+</button>
        </div>
      </div>
      <button type="button" className="share-toggle" aria-pressed={!!mine?.shared}
        disabled={locked || (left === 0 && !mine?.shared)}
        onClick={() => onShared(item, !mine?.shared)}>
        {mine?.shared ? 'Sharing the rest' : 'Shared? Split the rest'}
      </button>
    </li>
  );
}
