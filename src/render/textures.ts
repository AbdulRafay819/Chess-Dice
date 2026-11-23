import * as THREE from 'three';

/** Deterministic little PRNG so textures are stable between reloads. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Procedural wood grain: a base tone, long thin wavy fibres and a few knots.
 * Used for the board squares, the frame and the back of the board.
 */
export function woodTexture(options: {
  base: string;
  fibre: string;
  seed?: number;
  size?: number;
  repeat?: number;
}): THREE.Texture {
  const size = options.size ?? 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const random = rng(options.seed ?? 7);

  ctx.fillStyle = options.base;
  ctx.fillRect(0, 0, size, size);

  // Broad tonal bands.
  for (let band = 0; band < 24; band++) {
    const x = random() * size;
    const width = size * (0.02 + random() * 0.09);
    const gradient = ctx.createLinearGradient(x, 0, x + width, 0);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.5, `rgba(0,0,0,${0.03 + random() * 0.05})`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, 0, width, size);
  }

  // Fibres.
  for (let i = 0; i < 320; i++) {
    const x = random() * size;
    const amplitude = 2 + random() * 9;
    const frequency = 0.004 + random() * 0.02;
    ctx.strokeStyle = options.fibre;
    ctx.globalAlpha = 0.05 + random() * 0.16;
    ctx.lineWidth = 0.4 + random() * 2.1;
    ctx.beginPath();
    for (let y = -4; y <= size + 4; y += 5) {
      const xx = x + Math.sin(y * frequency + i * 1.7) * amplitude;
      if (y <= 0) ctx.moveTo(xx, y);
      else ctx.lineTo(xx, y);
    }
    ctx.stroke();
  }

  // Knots.
  for (let k = 0; k < 5; k++) {
    const cx = random() * size;
    const cy = random() * size;
    for (let ring = 0; ring < 9; ring++) {
      ctx.globalAlpha = 0.05 + random() * 0.05;
      ctx.strokeStyle = options.fibre;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 4 + ring * 4.5, 2 + ring * 2.6, random() * 0.6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const repeat = options.repeat ?? 1;
  texture.repeat.set(repeat, repeat);
  return texture;
}

/** Soft radial sprite used for glows and dust puffs. */
export function radialSprite(color = '#ffffff'): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.35, color);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
