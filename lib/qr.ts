import qrcode from 'qrcode-generator';
import { COLORS, LOGO_PATHS } from './brand';

const MODULE = 12;
const QUIET_MODULES = 4;

function drawFinder(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = COLORS.ink;
  ctx.beginPath();
  ctx.roundRect(x * MODULE, y * MODULE, 7 * MODULE, 7 * MODULE, 2 * MODULE);
  ctx.roundRect((x + 1) * MODULE, (y + 1) * MODULE, 5 * MODULE, 5 * MODULE, 1.2 * MODULE);
  ctx.fill('evenodd');
  ctx.beginPath();
  ctx.roundRect((x + 2) * MODULE, (y + 2) * MODULE, 3 * MODULE, 3 * MODULE, MODULE);
  ctx.fill();
}

export function qrCanvas(link: string): HTMLCanvasElement {
  // ponytail: level H is what lets the logo sit over the code; it makes the QR denser, so keep notes short.
  const qr = qrcode(0, 'H');
  qr.addData(link);
  qr.make();

  const count = qr.getModuleCount();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = (count + QUIET_MODULES * 2) * MODULE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(QUIET_MODULES * MODULE, QUIET_MODULES * MODULE);

  const inFinder = (row: number, col: number) =>
    (row < 7 && col < 7) || (row < 7 && col >= count - 7) || (row >= count - 7 && col < 7);
  // Odd width keeps the logo centred on the module grid.
  const logoSize = Math.floor(count * 0.11) * 2 + 1;
  const logoStart = (count - logoSize) / 2;
  const inLogo = (row: number, col: number) =>
    row >= logoStart && row < logoStart + logoSize && col >= logoStart && col < logoStart + logoSize;

  ctx.fillStyle = COLORS.ink;
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!qr.isDark(row, col) || inFinder(row, col) || inLogo(row, col)) continue;
      ctx.beginPath();
      ctx.roundRect(col * MODULE, row * MODULE, MODULE, MODULE, MODULE * 0.28);
      ctx.fill();
    }
  }

  drawFinder(ctx, 0, 0);
  drawFinder(ctx, count - 7, 0);
  drawFinder(ctx, 0, count - 7);

  const inset = logoSize * MODULE * 0.14;
  const scale = (logoSize * MODULE - inset * 2) / 100;
  ctx.translate(logoStart * MODULE + inset, logoStart * MODULE + inset);
  ctx.scale(scale, scale);
  ctx.fillStyle = COLORS.orange;
  for (const path of LOGO_PATHS) ctx.fill(new Path2D(path));

  return canvas;
}
