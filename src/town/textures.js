import * as THREE from 'three';
import { rng } from './data.js';

const PPU = 14;

function finish(canvas, repeat = false) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  return t;
}

export function facadeTexture(wU, hU, o = {}) {
  const {
    style = 'office',
    wall = '#f2f5f8',
    glass = '#9fcbe2',
    floors = Math.max(1, Math.round(hU / 3)),
    door = false,
    accent = null,
    seed = 7,
  } = o;

  const c = document.createElement('canvas');
  c.width = Math.max(16, Math.round(wU * PPU));
  c.height = Math.max(16, Math.round(hU * PPU));
  const x = c.getContext('2d');
  const W = c.width;
  const H = c.height;
  const r = rng(seed + Math.round(wU * 13 + hU * 7));

  x.fillStyle = wall;
  x.fillRect(0, 0, W, H);
  x.globalAlpha = 0.05;
  for (let i = 0; i < 60; i++) {
    x.fillStyle = i % 2 ? '#000' : '#fff';
    x.fillRect(r() * W, r() * H, 2 + r() * 8, 2 + r() * 5);
  }
  x.globalAlpha = 1;

  const base = PPU * 0.7;
  x.fillStyle = 'rgba(20,30,40,0.16)';
  x.fillRect(0, H - base, W, base);
  x.fillStyle = 'rgba(20,30,40,0.12)';
  x.fillRect(0, 0, W, PPU * 0.3);
  if (accent) {
    x.fillStyle = accent;
    x.fillRect(0, PPU * 0.3, W, PPU * 0.28);
  }

  const top = PPU * 0.45;
  const bottom = H - base;
  const fh = (bottom - top) / floors;

  const win = (wx, wy, ww, wh) => {
    const g = x.createLinearGradient(0, wy, 0, wy + wh);
    g.addColorStop(0, '#e8f6fd');
    g.addColorStop(0.5, glass);
    g.addColorStop(1, '#6ea6c4');
    x.fillStyle = g;
    x.fillRect(wx, wy, ww, wh);
    if (r() < 0.15) {
      x.fillStyle = 'rgba(255,240,190,0.75)';
      x.fillRect(wx, wy, ww, wh);
    }
    x.strokeStyle = 'rgba(255,255,255,0.75)';
    x.lineWidth = Math.max(1, PPU * 0.08);
    x.strokeRect(wx, wy, ww, wh);
  };

  if (style === 'glass') {
    x.fillStyle = glass;
    x.fillRect(0, top, W, bottom - top);
    const g = x.createLinearGradient(0, top, W, bottom);
    g.addColorStop(0, 'rgba(255,255,255,0.4)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(25,55,85,0.3)');
    x.fillStyle = g;
    x.fillRect(0, top, W, bottom - top);
    x.strokeStyle = 'rgba(240,248,252,0.85)';
    x.lineWidth = Math.max(1, PPU * 0.1);
    for (let f = 0; f <= floors; f++) {
      const y = top + fh * f;
      x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke();
    }
    for (let u = 2; u < wU; u += 2) {
      const px = (u / wU) * W;
      x.beginPath(); x.moveTo(px, top); x.lineTo(px, bottom); x.stroke();
    }
    x.globalAlpha = 0.14;
    x.fillStyle = '#fff';
    for (let i = 0; i < 3; i++) {
      const sx = r() * W;
      x.save();
      x.translate(sx, 0);
      x.rotate(-0.5);
      x.fillRect(0, -H, PPU * (1 + r() * 2), H * 3);
      x.restore();
    }
    x.globalAlpha = 1;
  } else if (style === 'ribbon') {
    for (let f = 0; f < floors; f++) {
      const wy = top + fh * f + fh * 0.28;
      const wh = fh * 0.46;
      const g = x.createLinearGradient(0, wy, 0, wy + wh);
      g.addColorStop(0, '#e8f6fd');
      g.addColorStop(1, '#7fb2cd');
      x.fillStyle = g;
      x.fillRect(PPU * 0.5, wy, W - PPU, wh);
      x.strokeStyle = 'rgba(255,255,255,0.8)';
      x.lineWidth = Math.max(1, PPU * 0.08);
      x.strokeRect(PPU * 0.5, wy, W - PPU, wh);
      x.strokeStyle = 'rgba(255,255,255,0.45)';
      for (let u = 1.5; u < wU - 0.5; u += 1.5) {
        const px = (u / wU) * W;
        x.beginPath(); x.moveTo(px, wy); x.lineTo(px, wy + wh); x.stroke();
      }
    }
  } else if (style === 'industrial') {
    x.globalAlpha = 0.08;
    for (let u = 0; u < wU; u += 0.6) {
      x.fillStyle = Math.round(u / 0.6) % 2 ? '#000' : '#fff';
      x.fillRect((u / wU) * W, 0, (0.3 / wU) * W, H);
    }
    x.globalAlpha = 1;
    for (let u = 1; u + 1.4 < wU; u += 3) {
      win((u / wU) * W, top + fh * 0.3, 1.4 * PPU, Math.min(fh * 0.5, 1.4 * PPU));
    }
    if (door) {
      const dw = 3.4 * PPU;
      const dh = Math.min(H - base - top, 3.6 * PPU);
      x.fillStyle = '#5b656e';
      x.fillRect(W / 2 - dw / 2, H - base - dh, dw, dh);
      x.strokeStyle = 'rgba(0,0,0,0.25)';
      x.lineWidth = 2;
      for (let yy = H - base - dh + 6; yy < H - base; yy += 8) {
        x.beginPath(); x.moveTo(W / 2 - dw / 2, yy); x.lineTo(W / 2 + dw / 2, yy); x.stroke();
      }
      x.fillStyle = '#e8b13c';
      x.fillRect(W / 2 - dw / 2, H - base - PPU * 0.3, dw, PPU * 0.3);
    }
  } else {
    for (let f = 0; f < floors; f++) {
      const wh = Math.min(fh * 0.52, 1.6 * PPU);
      const wy = top + fh * f + fh * 0.24;
      for (let u = 1.1; u + 1.3 < wU; u += 2.4) {
        win((u / wU) * W, wy, 1.3 * PPU, wh);
      }
    }
  }

  if (door && style !== 'industrial') {
    const dw = 2.4 * PPU;
    const dh = Math.min(2.3 * PPU, H - base - top);
    x.fillStyle = '#274b63';
    x.fillRect(W / 2 - dw / 2, H - base - dh, dw, dh);
    x.fillStyle = 'rgba(255,255,255,0.55)';
    x.fillRect(W / 2 - 1, H - base - dh, 2, dh);
    x.fillStyle = accent || '#2f8fe6';
    x.fillRect(W / 2 - dw * 0.75, H - base - dh - PPU * 0.35, dw * 1.5, PPU * 0.35);
  }

  return finish(c);
}

export function roofTexture(wU, dU, color = '#c9d1d8') {
  const c = document.createElement('canvas');
  c.width = Math.max(16, Math.round(wU * 6));
  c.height = Math.max(16, Math.round(dU * 6));
  const x = c.getContext('2d');
  const r = rng(Math.round(wU * 5 + dU * 11));
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  x.globalAlpha = 0.08;
  for (let i = 0; i < 120; i++) {
    x.fillStyle = i % 2 ? '#000' : '#fff';
    x.fillRect(r() * c.width, r() * c.height, 1 + r() * 3, 1 + r() * 3);
  }
  x.globalAlpha = 1;
  x.fillStyle = 'rgba(0,0,0,0.12)';
  x.fillRect(0, 0, c.width, 3);
  x.fillRect(0, 0, 3, c.height);
  x.fillRect(c.width - 3, 0, 3, c.height);
  x.fillRect(0, c.height - 3, c.width, 3);
  return finish(c);
}

export function signTexture(text, bg = '#12365f', fg = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = bg;
  x.beginPath();
  x.roundRect(2, 2, 252, 60, 12);
  x.fill();
  x.fillStyle = fg;
  x.font = '700 30px system-ui, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 128, 34);
  return finish(c);
}

export function stripeTexture(a = '#f2a03d', b = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 16;
  const x = c.getContext('2d');
  x.fillStyle = a;
  x.fillRect(0, 0, 32, 16);
  x.fillStyle = b;
  x.fillRect(32, 0, 32, 16);
  return finish(c, true);
}

export function helipadTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#59626b';
  x.fillRect(0, 0, 128, 128);
  x.strokeStyle = '#f4f7fa';
  x.lineWidth = 6;
  x.beginPath();
  x.arc(64, 64, 52, 0, Math.PI * 2);
  x.stroke();
  x.font = '700 64px system-ui, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillStyle = '#f4f7fa';
  x.fillText('H', 64, 68);
  return finish(c);
}

export function ribTexture(color = '#f5f7fa', gap = '#d8dee4') {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const x = c.getContext('2d');
  x.fillStyle = color;
  x.fillRect(0, 0, 32, 32);
  x.fillStyle = gap;
  x.fillRect(0, 0, 6, 32);
  return finish(c, true);
}
