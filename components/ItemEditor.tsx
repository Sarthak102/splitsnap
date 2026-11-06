'use client';

import { formatRupees, parseRupees } from '@/lib/bill';

export type Line = { key: number; id?: string; name: string; quantity: string; rupees: string };

let nextKey = 0;
export const newLine = (fields?: Partial<Line>): Line => ({ name: '', quantity: '1', rupees: '', ...fields, key: nextKey++ });

export const linePrices = (lines: Line[]) => lines.map((line) => parseRupees(line.rupees));

// Returns what's wrong with the lines, or null if they can be saved.
export function lineError(lines: Line[], totalPaise: number | null): string | null {
  const prices = linePrices(lines);
  if (lines.length === 0 || lines.some((line) => !line.name.trim())) return 'Every item needs a name.';
  if (prices.some((price) => price === null)) return 'Check the item prices. Use amounts like 120 or 120.50.';
  if (lines.some((line) => !(Number(line.quantity) > 0 && Number(line.quantity) <= 9999))) return 'Item quantities must be between 0 and 9999.';
  if (!totalPaise) return 'Enter the bill total.';
  if (prices.every((price) => !price)) return 'At least one item needs a price.';
  return null;
}

export const linesForSave = (lines: Line[]) => lines.map((line) => ({
  id: line.id,
  name: line.name,
  quantity: Number(line.quantity),
  pricePaise: parseRupees(line.rupees),
}));

type Props = {
  lines: Line[];
  total: string;
  onLines: (lines: Line[]) => void;
  onTotal: (total: string) => void;
};

export default function ItemEditor({ lines, total, onLines, onTotal }: Props) {
  const update = (key: number, change: Partial<Line>) =>
    onLines(lines.map((line) => (line.key === key ? { ...line, ...change } : line)));

  const itemsPaise = linePrices(lines).reduce<number>((sum, price) => sum + (price ?? 0), 0);
  const totalPaise = parseRupees(total);
  const extraPaise = totalPaise === null ? 0 : totalPaise - itemsPaise;
  const looksWrong = itemsPaise > 0 && totalPaise !== null && Math.abs(extraPaise) > itemsPaise * 0.3;

  return (
    <div className="editor">
      <div className="edit-row edit-head"><span>Item</span><span>Qty</span><span>Price ₹</span><span /></div>
      {lines.map((line) => (
        <div className="edit-row" key={line.key}>
          <input aria-label="Item name" value={line.name} maxLength={120}
            onChange={(e) => update(line.key, { name: e.target.value })} />
          <input aria-label="Quantity" inputMode="decimal" value={line.quantity}
            onChange={(e) => update(line.key, { quantity: e.target.value })} />
          <input aria-label="Line price in rupees" inputMode="decimal" value={line.rupees}
            onChange={(e) => update(line.key, { rupees: e.target.value })} />
          <button type="button" className="remove" aria-label={`Remove ${line.name || 'item'}`} disabled={lines.length === 1}
            onClick={() => onLines(lines.filter((other) => other.key !== line.key))}>×</button>
        </div>
      ))}
      <button type="button" className="quiet" onClick={() => onLines([...lines, newLine()])}>Add another item</button>
      <p className="note">Price is the full line. For 5 rotis, enter quantity 5 and the price for all 5, so friends can each claim how many they ate.</p>

      <label>Bill total (₹)
        <input inputMode="decimal" value={total} onChange={(e) => onTotal(e.target.value)} />
      </label>
      {totalPaise !== null && extraPaise !== 0 && (
        <p className={`note ${looksWrong ? 'warn' : ''}`}>
          {looksWrong && 'Check the items and total: they look far apart. '}
          Items add up to {formatRupees(itemsPaise)}, so {formatRupees(Math.abs(extraPaise))} will be
          {extraPaise > 0 ? ' shared as tax and charges.' : ' taken off as a discount.'}
        </p>
      )}
    </div>
  );
}
