/* Generates the PWA icons: brass coin + bitmap W on soot black.
   Supersampled 4x for smooth circles, no font/image libs needed beyond pngjs. */
const { PNG } = require('pngjs');
const fs = require('fs');

const SS = 4; // supersample factor

const BG   = [15, 15, 13];      // #0f0f0d
const BRASS = [232, 163, 61];   // #e8a33d
const RIM  = [184, 125, 36];    // #b87d24
const INK  = [23, 19, 10];      // dark engraving

function mix(a, b, t){
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

function makeIcon(size, { maskable }){
  const S = size * SS;
  const buf = new Uint8Array(S * S * 3);

  // coin geometry (in supersampled px)
  const cx = S / 2, cy = S / 2;
  const radius = (maskable ? 0.30 : 0.37) * S;   // maskable keeps art in the 80% safe zone
  const rimW = 0.045 * S;

  for(let y = 0; y < S; y++){
    for(let x = 0; x < S; x++){
      let col = BG;
      const d = Math.hypot(x - cx, y - cy);
      if(d <= radius){
        if(d >= radius - rimW){
          // rim ring, slight vertical gradient for depth
          const t = (y - (cy - radius)) / (2 * radius);
          col = mix(RIM, BRASS, 0.25 + 0.35 * t);
        }else{
          // coin face, soft top-left highlight
          const hl = 1 - Math.min(1, Math.hypot(x - (cx - radius * 0.4), y - (cy - radius * 0.45)) / (radius * 1.6));
          col = mix(BRASS, [255, 214, 150], hl * 0.45);
        }
      }
      const i = (y * S + x) * 3;
      buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2];
    }
  }

  // stamp the N as 3 vector strokes (mintmark style — one letter, like coins do)
  const polys = [
    [[-0.38, -0.55], [-0.38, 0.55]],   // left stem
    [[-0.38, -0.55], [ 0.38, 0.55]],   // diagonal
    [[ 0.38, -0.55], [ 0.38, 0.55]]    // right stem
  ].map(poly => poly.map(([ux, uy]) => [cx + ux * radius, cy + uy * radius]));
  const halfW = 0.13 * radius;

  function distToSeg(px, py, ax, ay, bx, by){
    const vx = bx - ax, vy = by - ay;
    const wx = px - ax, wy = py - ay;
    const len2 = vx * vx + vy * vy;
    let t = len2 > 0 ? (wx * vx + wy * vy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
  }

  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(S - 1, Math.ceil(cy + radius));
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(S - 1, Math.ceil(cx + radius));
  for(let y = y0; y <= y1; y++){
    for(let x = x0; x <= x1; x++){
      let d = Infinity;
      for(const poly of polys){
        for(let s = 0; s < poly.length - 1; s++){
          d = Math.min(d, distToSeg(x, y, poly[s][0], poly[s][1], poly[s+1][0], poly[s+1][1]));
          if(d <= halfW) break;
        }
        if(d <= halfW) break;
      }
      if(d <= halfW){
        const i = (y * S + x) * 3;
        buf[i] = INK[0]; buf[i + 1] = INK[1]; buf[i + 2] = INK[2];
      }
    }
  }

  // box downsample SS→1 with averaging
  const out = new PNG({ width: size, height: size });
  for(let y = 0; y < size; y++){
    for(let x = 0; x < size; x++){
      let r = 0, g = 0, b = 0;
      for(let sy = 0; sy < SS; sy++){
        for(let sx = 0; sx < SS; sx++){
          const i = (((y * SS + sy) * S) + (x * SS + sx)) * 3;
          r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      out.data[o] = Math.round(r / n);
      out.data[o + 1] = Math.round(g / n);
      out.data[o + 2] = Math.round(b / n);
      out.data[o + 3] = 255;
    }
  }
  return PNG.sync.write(out);
}

const dir = require('path').resolve(__dirname, '..') + '/';
fs.writeFileSync(dir + 'icon-192.png', makeIcon(192, { maskable: false }));
fs.writeFileSync(dir + 'icon-512.png', makeIcon(512, { maskable: false }));
fs.writeFileSync(dir + 'icon-maskable-512.png', makeIcon(512, { maskable: true }));
console.log('icons written');
