import { formatRupees } from './bill';
import type { PersonLine } from './billSummary';
import { COLORS, LOGO_PATHS } from './brand';

type Receipt = {
  personName: string;
  hostName: string;
  hostVpa: string;
  lines: PersonLine[];
  chargesPaise: number;
  totalPaise: number;
  // Only a final bill carries a QR, so nobody pays a provisional amount.
  qr: HTMLCanvasElement | null;
};

const WIDTH = 720;
const MARGIN = 40;
const PAD = 44;
const TOOTH = 16;
const LINE = 38;
const QR_SIZE = 380;

function zigzag(ctx: CanvasRenderingContext2D, left: number, right: number, y: number, dir: 1 | -1) {
  const steps = Math.round((right - left) / (TOOTH * 2));
  for (let i = 0; i < steps; i++) {
    const from = dir === 1 ? left + i * TOOTH * 2 : right - i * TOOTH * 2;
    ctx.lineTo(from + dir * TOOTH, y - dir * TOOTH);
    ctx.lineTo(from + dir * TOOTH * 2, y);
  }
}

const clip = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

function dashes(ctx: CanvasRenderingContext2D, y: number, right: number) {
  ctx.save();
  ctx.setLineDash([9, 7]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLORS.ink;
  ctx.beginPath();
  ctx.moveTo(MARGIN + PAD, y);
  ctx.lineTo(right, y);
  ctx.stroke();
  ctx.restore();
}

export async function receiptImage(receipt: Receipt): Promise<Blob> {
  await document.fonts.ready;
  const styles = getComputedStyle(document.documentElement);
  const display = styles.getPropertyValue('--font-display');
  const mono = styles.getPropertyValue('--font-receipt');

  const rows = receipt.lines.length + (receipt.chargesPaise !== 0 ? 1 : 0);
  const height = 2 * MARGIN + 340 + rows * LINE + 110 + (receipt.qr ? QR_SIZE + 130 : 90);

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = COLORS.cloth;
  ctx.fillRect(0, 0, WIDTH, height);

  const left = MARGIN;
  const right = WIDTH - MARGIN;
  const textRight = right - PAD;
  const textLeft = left + PAD;
  const bottom = height - MARGIN;

  ctx.fillStyle = COLORS.paper;
  ctx.beginPath();
  ctx.moveTo(left, MARGIN + TOOTH);
  zigzag(ctx, left, right, MARGIN + TOOTH, 1);
  ctx.lineTo(right, bottom - TOOTH);
  zigzag(ctx, left, right, bottom - TOOTH, -1);
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.translate(WIDTH / 2 - 36, MARGIN + 44);
  ctx.scale(0.72, 0.72);
  ctx.fillStyle = COLORS.orange;
  for (const path of LOGO_PATHS) ctx.fill(new Path2D(path));
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.ink;
  ctx.font = `64px ${display}`;
  ctx.fillText('SPLITSNAP', WIDTH / 2, MARGIN + 190);
  ctx.font = `italic 500 24px ${mono}`;
  ctx.fillText(`${clip(receipt.personName, 24)}'s share`, WIDTH / 2, MARGIN + 234);

  let y = MARGIN + 270;
  dashes(ctx, y, textRight);
  y += 48;

  const row = (label: string, amount: string) => {
    ctx.textAlign = 'left';
    ctx.fillText(clip(label, 27), textLeft, y);
    ctx.textAlign = 'right';
    ctx.fillText(amount, textRight, y);
    y += LINE;
  };

  ctx.font = `500 24px ${mono}`;
  ctx.fillStyle = COLORS.ink;
  for (const line of receipt.lines) row(line.label, formatRupees(line.paise));
  if (receipt.chargesPaise !== 0) {
    row(receipt.chargesPaise > 0 ? 'Tax and charges' : 'Discount', formatRupees(Math.abs(receipt.chargesPaise)));
  }

  y -= 14;
  dashes(ctx, y, textRight);
  y += 56;
  ctx.font = `38px ${display}`;
  row('Total', formatRupees(receipt.totalPaise));

  ctx.textAlign = 'center';
  ctx.font = `500 22px ${mono}`;
  if (receipt.qr) {
    ctx.drawImage(receipt.qr, (WIDTH - QR_SIZE) / 2, y, QR_SIZE, QR_SIZE);
    y += QR_SIZE + 44;
    ctx.fillStyle = COLORS.faded;
    ctx.fillText(`Pay ${clip(receipt.hostName, 20)}`, WIDTH / 2, y);
    ctx.fillText(clip(receipt.hostVpa, 36), WIDTH / 2, y + 32);
  } else {
    ctx.fillStyle = COLORS.faded;
    ctx.fillText('Not final yet. Open the bill link to pay.', WIDTH / 2, y + 10);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not create bill image'))), 'image/png');
  });
}
