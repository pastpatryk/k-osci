// Side-effect wrappers: haptics + confetti. Degrade silently where unsupported.

import confetti from 'https://esm.sh/canvas-confetti@1.9.3';

function reducedMotion() {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function hidden() {
  return typeof document !== 'undefined' && document.hidden;
}

export function vibrate(pattern) {
  if (hidden()) return;
  try {
    navigator.vibrate?.(pattern);
  } catch (_) { /* iOS Safari and others just don't */ }
}

export const haptics = {
  roll() { vibrate([15, 30, 15]); },
  bank() { vibrate(50); },
  yahtzee() { vibrate([30, 40, 30, 40, 60]); },
  win() { vibrate([60, 50, 60, 50, 120]); },
};

const SAKURA_PALETTE = [
  '#b288d4', '#d9a6e8', '#f5cddb', '#e8b4d0', '#ffffff', '#8b5a9f',
];

export function burstConfetti(origin = { x: 0.5, y: 0.5 }) {
  if (hidden() || reducedMotion()) return;
  confetti({
    particleCount: 60,
    spread: 70,
    startVelocity: 30,
    origin,
    colors: SAKURA_PALETTE,
    zIndex: 9999,
  });
}

export function stormConfetti() {
  if (hidden() || reducedMotion()) return;
  const duration = 2500;
  const end = Date.now() + duration;
  const frame = () => {
    confetti({
      particleCount: 3,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.8 },
      colors: SAKURA_PALETTE,
      zIndex: 9999,
    });
    confetti({
      particleCount: 3,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.8 },
      colors: SAKURA_PALETTE,
      zIndex: 9999,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  };
  frame();
}
