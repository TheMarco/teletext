/**
 * Image preprocessing for bitmap import.
 * Per 07_BITMAP_IMPORT_PIPELINE.md Stage 3.
 */

/**
 * Sharpen a grayscale image using unsharp mask.
 */
export function sharpen(gray: Uint8Array, width: number, height: number, amount: number = 1.0): Uint8Array {
  const result = new Uint8Array(gray.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const center = gray[i] * 5;
      const top = y > 0 ? gray[(y - 1) * width + x] : gray[i];
      const bottom = y < height - 1 ? gray[(y + 1) * width + x] : gray[i];
      const left = x > 0 ? gray[y * width + x - 1] : gray[i];
      const right = x < width - 1 ? gray[y * width + x + 1] : gray[i];
      const laplacian = center - top - bottom - left - right;
      const sharpened = gray[i] + laplacian * amount;
      result[i] = Math.max(0, Math.min(255, Math.round(sharpened)));
    }
  }
  return result;
}

/**
 * Posterize a grayscale image to n levels.
 */
export function posterize(gray: Uint8Array, levels: number = 4): Uint8Array {
  const result = new Uint8Array(gray.length);
  const step = 255 / (levels - 1);
  for (let i = 0; i < gray.length; i++) {
    const level = Math.round(gray[i] / step);
    result[i] = Math.round(level * step);
  }
  return result;
}

/**
 * Edge-emphasis using Sobel operator.
 */
export function edgeEmphasis(gray: Uint8Array, width: number, height: number, mix: number = 0.5): Uint8Array {
  const edges = new Uint8Array(gray.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const tl = gray[(y - 1) * width + x - 1];
      const t  = gray[(y - 1) * width + x];
      const tr = gray[(y - 1) * width + x + 1];
      const l  = gray[y * width + x - 1];
      const r  = gray[y * width + x + 1];
      const bl = gray[(y + 1) * width + x - 1];
      const b  = gray[(y + 1) * width + x];
      const br = gray[(y + 1) * width + x + 1];

      const gx = -tl + tr - 2 * l + 2 * r - bl + br;
      const gy = -tl - 2 * t - tr + bl + 2 * b + br;
      edges[y * width + x] = Math.min(255, Math.round(Math.sqrt(gx * gx + gy * gy)));
    }
  }

  // Mix edges with original
  const result = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    result[i] = Math.max(0, Math.min(255, Math.round(gray[i] * (1 - mix) + edges[i] * mix)));
  }
  return result;
}

/**
 * Resize grayscale image using nearest-neighbor sampling.
 */
export function resizeNearest(
  gray: Uint8Array,
  srcW: number, srcH: number,
  dstW: number, dstH: number,
): Uint8Array {
  const result = new Uint8Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const sx = Math.floor(x * srcW / dstW);
      const sy = Math.floor(y * srcH / dstH);
      result[y * dstW + x] = gray[sy * srcW + sx];
    }
  }
  return result;
}

/**
 * Crop and fit an image to a target region.
 * Returns resized grayscale data sized to fill the target cell grid.
 *
 * @param targetCols - number of character columns
 * @param targetRows - number of character rows
 * @returns resized image at (targetCols*2) × (targetRows*3) pixels
 */
export function fitToRegion(
  gray: Uint8Array,
  srcW: number, srcH: number,
  targetCols: number, targetRows: number,
  mode: 'contain' | 'cover' | 'stretch' = 'contain',
): { data: Uint8Array; width: number; height: number } {
  const dstW = targetCols * 2;
  const dstH = targetRows * 3;

  if (mode === 'stretch') {
    return { data: resizeNearest(gray, srcW, srcH, dstW, dstH), width: dstW, height: dstH };
  }

  const scaleX = dstW / srcW;
  const scaleY = dstH / srcH;
  const scale = mode === 'contain' ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
  const scaledW = Math.round(srcW * scale);
  const scaledH = Math.round(srcH * scale);
  const scaled = resizeNearest(gray, srcW, srcH, scaledW, scaledH);

  // Center in target
  const result = new Uint8Array(dstW * dstH);
  const offsetX = Math.floor((dstW - scaledW) / 2);
  const offsetY = Math.floor((dstH - scaledH) / 2);

  for (let y = 0; y < scaledH && (y + offsetY) < dstH; y++) {
    for (let x = 0; x < scaledW && (x + offsetX) < dstW; x++) {
      const dy = y + offsetY;
      const dx = x + offsetX;
      if (dy >= 0 && dx >= 0) {
        result[dy * dstW + dx] = scaled[y * scaledW + x];
      }
    }
  }

  return { data: result, width: dstW, height: dstH };
}
