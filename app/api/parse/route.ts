import { createClient } from '@supabase/supabase-js';
import { normalizeBill } from '@/lib/bill';

export const maxDuration = 120;

const MAX_IMAGE_BYTES = 4_000_000;
const MODEL = '@cf/qwen/qwen3.8-27b';
const MODEL_TIMEOUT_MS = 110_000;

const PROMPT = `Read this restaurant bill photo. Return only values printed on it, in rupees.
items: each ordered item, with quantity and the line total printed for that line (not the unit price).
charges: every tax or fee line such as CGST, SGST, VAT, service charge, round off (negative if it reduces the bill). Do not include the subtotal.
discount: total discount as a positive number, 0 if none.
total: the final amount payable.
isBill: false if the photo is not a bill.`;

const SCHEMA = {
  type: 'object',
  required: ['isBill', 'items', 'charges', 'discount', 'total'],
  properties: {
    isBill: { type: 'boolean' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'quantity', 'lineTotal'],
        properties: { name: { type: 'string' }, quantity: { type: 'number' }, lineTotal: { type: 'number' } },
      },
    },
    charges: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'amount'],
        properties: { name: { type: 'string' }, amount: { type: 'number' } },
      },
    },
    discount: { type: 'number' },
    total: { type: 'number' },
  },
};

const fail = (status: number, error: string) => Response.json({ error }, { status });

const LIMIT_MESSAGES: Record<string, string> = {
  user_limit: "You've scanned a few bills recently. Try again in a while, or add the items by hand.",
  daily_limit: 'Bill scanning has reached its limit for today. Add the items by hand instead.',
};

export async function POST(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token) return fail(401, 'Please refresh the page and try again.');

  const image = new Uint8Array(await request.arrayBuffer());
  if (image.length === 0 || image.length > MAX_IMAGE_BYTES) return fail(413, 'That photo is too large. Try another one.');
  // The browser re-encodes photos to JPEG, so anything else didn't come from our page.
  if (image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff) return fail(415, "That file isn't a photo we can read.");

  const database = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: slot, error: slotError } = await database.rpc('take_parse_slot');
  if (slotError) {
    console.error('take_parse_slot failed', slotError);
    return fail(slotError.code === 'PGRST301' ? 401 : 503, "We couldn't scan the bill. Add the items by hand instead.");
  }
  if (slot !== 'ok') return fail(429, LIMIT_MESSAGES[slot] ?? LIMIT_MESSAGES.daily_limit);

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${MODEL}`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_AI_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from(image).toString('base64')}` } },
            ],
          }],
          max_tokens: 8000,
          temperature: 0,
          chat_template_kwargs: { enable_thinking: false },
          response_format: { type: 'json_schema', json_schema: { name: 'bill', schema: SCHEMA } },
        }),
      },
    );
    const body = await response.json();
    if (!response.ok) {
      console.error('Bill model request failed', response.status, body.errors);
      return fail(502, "We couldn't scan the bill. Add the items by hand instead.");
    }

    const bill = normalizeBill(body.result?.response ?? body.result?.choices?.[0]?.message?.content);
    if (!bill) return fail(422, "We couldn't read a bill in that photo. Try a clearer one, or add the items by hand.");
    return Response.json(bill);
  } catch (error) {
    console.error('Bill model request failed', error);
    return fail(504, 'Scanning took too long. Try again, or add the items by hand.');
  }
}
