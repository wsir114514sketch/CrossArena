/** Draw an image inside a box preserving its aspect ratio (no stretching), centered. */
export function drawImageFit(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width: number; height: number },
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const s = Math.min(w / iw, h / ih);
  const dw = Math.round(iw * s);
  const dh = Math.round(ih * s);
  ctx.drawImage(img, x + Math.floor((w - dw) / 2), y + Math.floor((h - dh) / 2), dw, dh);
}
