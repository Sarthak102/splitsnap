export type ParsedItem = { name: string; quantity: number; pricePaise: number };
export type ParsedBill = { items: ParsedItem[]; totalPaise: number };

export const MAX_PAISE = 10_000_000;

const VPA = /^[A-Za-z0-9._-]{1,64}@[A-Za-z0-9.-]{1,64}$/;
export const isValidVpa = (vpa: string) => VPA.test(vpa.trim());

export const toPaise = (rupees: number) => Math.round(rupees * 100);

// Returns null unless the text is a plain amount with at most two decimals.
export function parseRupees(text: string): number | null {
  const value = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const paise = toPaise(Number(value));
  return paise <= MAX_PAISE ? paise : null;
}

export const formatRupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const isAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && toPaise(value) <= MAX_PAISE;

// The model's output is untrusted: returns null if it isn't a usable bill.
export function normalizeBill(raw: unknown): ParsedBill | null {
  let data = raw;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof data !== 'object' || data === null) return null;

  const { isBill, items, total } = data as { isBill?: unknown; items?: unknown; total?: unknown };
  if (isBill === false || !Array.isArray(items)) return null;

  const parsed: ParsedItem[] = [];
  for (const item of items.slice(0, 100)) {
    const { name, quantity, lineTotal } = (item ?? {}) as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim() || !isAmount(lineTotal)) continue;
    parsed.push({
      name: name.trim().slice(0, 120),
      quantity: typeof quantity === 'number' && quantity > 0 ? quantity : 1,
      pricePaise: toPaise(lineTotal),
    });
  }
  // A faded total shouldn't lose a good scan: start from the item sum and let the host correct it.
  const itemsPaise = parsed.reduce((sum, item) => sum + item.pricePaise, 0);
  const totalPaise = isAmount(total) && total > 0 ? toPaise(total) : itemsPaise;
  return itemsPaise > 0 && totalPaise > 0 ? { items: parsed, totalPaise } : null;
}
