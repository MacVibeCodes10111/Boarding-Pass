// ============================================================================
// PRESET LOGOS (v2.67)
//   Original logo designs drawn in code (no outside artwork, so no copyright
//   to worry about), in the player's two colours, as 512×512 pictures ready to
//   add to a livery like an uploaded logo.
// ============================================================================
import { LOGO_PX, MAX_LOGO_CHARS } from '../../game/livery';

type Draw = (g: CanvasRenderingContext2D, a: string, b: string, initial: string) => void;
const S = LOGO_PX;
const c = S / 2;

const circle = (g: CanvasRenderingContext2D, r: number, fill: string, x = c, y = c) => {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
};

export const PRESET_LOGOS: { id: string; label: string; draw: Draw }[] = [
  {
    id: 'globe',
    label: 'Globe',
    draw: (g, a, b) => {
      circle(g, 58, a);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 5;
      g.beginPath();
      g.arc(c, c, 50, 0, Math.PI * 2);
      g.stroke();
      for (const rx of [18, 36]) {
        g.beginPath();
        g.ellipse(c, c, rx, 50, 0, 0, Math.PI * 2);
        g.stroke();
      }
      for (const y of [-25, 0, 25]) {
        const w = Math.sqrt(50 * 50 - y * y);
        g.beginPath();
        g.moveTo(c - w, c + y);
        g.lineTo(c + w, c + y);
        g.stroke();
      }
      g.strokeStyle = b;
      g.lineWidth = 8;
      g.beginPath();
      g.arc(c, c, 60, Math.PI * 1.1, Math.PI * 1.75);
      g.stroke();
    },
  },
  {
    id: 'wings',
    label: 'Wings',
    draw: (g, a, b) => {
      g.fillStyle = a;
      for (const sx of [-1, 1]) {
        g.save();
        g.translate(c, c + 6);
        g.scale(sx, 1);
        for (let k = 0; k < 3; k++) {
          g.beginPath();
          g.moveTo(10, -6 + k * 12);
          g.bezierCurveTo(30, -26 + k * 10, 50, -30 + k * 8, 62 - k * 8, -34 + k * 10);
          g.bezierCurveTo(52 - k * 8, -16 + k * 10, 34, -4 + k * 12, 10, 4 + k * 12);
          g.closePath();
          g.fill();
        }
        g.restore();
      }
      circle(g, 15, b, c, c + 4);
    },
  },
  {
    id: 'star',
    label: 'Star',
    draw: (g, a, b) => {
      circle(g, 58, a);
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const t = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 19 : 46;
        g.lineTo(c + Math.cos(t) * r, c + 3 + Math.sin(t) * r);
      }
      g.closePath();
      g.fillStyle = b;
      g.fill();
    },
  },
  {
    id: 'swoosh',
    label: 'Swoosh',
    draw: (g, a, b) => {
      circle(g, 58, a);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(14, 84);
      g.bezierCurveTo(44, 70, 78, 46, 116, 22);
      g.bezierCurveTo(90, 54, 58, 82, 18, 96);
      g.closePath();
      g.fill();
      circle(g, 11, b, 86, 86);
    },
  },
  {
    id: 'compass',
    label: 'Compass',
    draw: (g, a, b) => {
      const pt = (ang: number, r: number, w: number, col: string) => {
        g.save();
        g.translate(c, c);
        g.rotate(ang);
        g.beginPath();
        g.moveTo(0, -r);
        g.lineTo(w, 0);
        g.lineTo(0, w * 0.6);
        g.lineTo(-w, 0);
        g.closePath();
        g.fillStyle = col;
        g.fill();
        g.restore();
      };
      for (let i = 0; i < 4; i++) pt(Math.PI / 4 + (i * Math.PI) / 2, 40, 8, b);
      for (let i = 0; i < 4; i++) pt((i * Math.PI) / 2, 60, 13, a);
      circle(g, 8, '#ffffff');
    },
  },
  {
    id: 'bird',
    label: 'Bird',
    draw: (g, a, b) => {
      circle(g, 58, '#ffffff');
      g.lineWidth = 7;
      g.strokeStyle = b;
      g.beginPath();
      g.arc(c, c, 54, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = a;
      g.beginPath();
      g.moveTo(20, 62);
      g.quadraticCurveTo(44, 34, 64, 60);
      g.quadraticCurveTo(84, 34, 108, 62);
      g.quadraticCurveTo(86, 48, 64, 74);
      g.quadraticCurveTo(42, 48, 20, 62);
      g.fill();
    },
  },
  {
    id: 'sun',
    label: 'Sun',
    draw: (g, a, b) => {
      g.fillStyle = a;
      for (let i = 0; i < 12; i++) {
        g.save();
        g.translate(c, c);
        g.rotate((i * Math.PI) / 6);
        g.beginPath();
        g.moveTo(-7, -36);
        g.lineTo(0, -62);
        g.lineTo(7, -36);
        g.closePath();
        g.fill();
        g.restore();
      }
      circle(g, 32, b);
    },
  },
  {
    id: 'peak',
    label: 'Peaks',
    draw: (g, a, b) => {
      circle(g, 58, '#ffffff');
      circle(g, 13, b, 88, 40);
      g.fillStyle = a;
      g.beginPath();
      g.moveTo(10, 100);
      g.lineTo(50, 38);
      g.lineTo(72, 72);
      g.lineTo(86, 54);
      g.lineTo(120, 100);
      g.closePath();
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(42, 50);
      g.lineTo(50, 38);
      g.lineTo(58, 50);
      g.lineTo(50, 46);
      g.closePath();
      g.fill();
    },
  },
  {
    id: 'waves',
    label: 'Waves',
    draw: (g, a, b) => {
      g.lineCap = 'round';
      [a, b, a].forEach((col, i) => {
        g.strokeStyle = col;
        g.lineWidth = 12;
        g.beginPath();
        for (let x = 12; x <= 116; x += 2) {
          const y = 40 + i * 26 + Math.sin((x / 104) * Math.PI * 2 + i) * 9;
          if (x === 12) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      });
    },
  },
  {
    id: 'monogram',
    label: 'Initial',
    draw: (g, a, b, initial) => {
      g.fillStyle = a;
      g.beginPath();
      g.roundRect(8, 8, 112, 112, 26);
      g.fill();
      g.fillStyle = '#ffffff';
      g.font = '800 82px Barlow, "Segoe UI", system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      const m = g.measureText(initial);
      g.fillText(initial, c, c + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2 - 4);
      g.fillStyle = b;
      g.fillRect(30, 100, 68, 8);
    },
  },
  {
    id: 'plane',
    label: 'Paper plane',
    draw: (g, a, b) => {
      g.strokeStyle = b;
      g.lineWidth = 6;
      g.setLineDash([10, 9]);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(14, 112);
      g.quadraticCurveTo(30, 70, 62, 72);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = a;
      g.beginPath();
      g.moveTo(118, 14);
      g.lineTo(36, 52);
      g.lineTo(64, 64);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(118, 14);
      g.lineTo(64, 64);
      g.lineTo(80, 96);
      g.closePath();
      g.fill();
    },
  },
  {
    id: 'chevrons',
    label: 'Chevrons',
    draw: (g, a, b) => {
      [b, a, a].forEach((col, i) => {
        g.fillStyle = col;
        g.beginPath();
        const x = 22 + i * 28;
        g.moveTo(x, 18);
        g.lineTo(x + 26, 18);
        g.lineTo(x + 62, 64);
        g.lineTo(x + 26, 110);
        g.lineTo(x, 110);
        g.lineTo(x + 36, 64);
        g.closePath();
        g.fill();
      });
    },
  },
];

/** A preset drawn as a logo data URL: small for the buttons, big (sharp on an aircraft) for the one picked. */
export function presetLogo(id: string, a: string, b: string, airlineName: string, big = false): string | null {
  const p = PRESET_LOGOS.find((x) => x.id === id);
  if (!p) return null;
  // Drawn at 4× (sharp on a big logo), or at the drawing size if that's ever too big to keep
  for (const k of big ? [4, 2, 1] : [1]) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = S * k;
    const g = cv.getContext('2d')!;
    g.scale(k, k);
    p.draw(g, a, b, (airlineName.trim()[0] || 'A').toUpperCase());
    const webp = cv.toDataURL('image/webp', 0.9);
    const url = webp.startsWith('data:image/webp') ? webp : cv.toDataURL('image/png');
    if (url.length <= MAX_LOGO_CHARS) return url;
  }
  return null;
}
