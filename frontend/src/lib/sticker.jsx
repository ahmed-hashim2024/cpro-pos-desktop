import { useEffect, useRef } from 'react';

// The savings sticker on a family offer («وفّر 20%»), shared by the guest
// menu and the owner's editor so both look the same.
//
// x and y place its centre on the picture (% from the left and top: the
// same spot whatever the language). size is % of normal. The picture must
// be a size container (`containerType: inline-size`), so the sticker scales
// with the card: the editor's small preview matches the phone.

export const STICKER_MOTIONS = ['pulse', 'bounce', 'wiggle', 'shine', 'none'];
export const STICKER_DEFAULT = { x: 14, y: 20, size: 100, motion: 'pulse' };

// Keyframes for the Web Animations API (no stylesheet needed in either app).
const MOTIONS = {
  pulse: {
    frames: [{ transform: 'scale(1)' }, { transform: 'scale(1.14)', offset: 0.5 }, { transform: 'scale(1)' }],
    timing: { duration: 1600, iterations: Infinity, easing: 'ease-in-out' },
  },
  bounce: {
    frames: [
      { transform: 'translateY(0)', easing: 'cubic-bezier(.3,0,.5,1)' },
      { transform: 'translateY(-28%)', offset: 0.18, easing: 'cubic-bezier(.5,0,.7,1)' },
      { transform: 'translateY(0)', offset: 0.36 },
      { transform: 'translateY(-10%)', offset: 0.48 },
      { transform: 'translateY(0)', offset: 0.6 },
      { transform: 'translateY(0)' },
    ],
    timing: { duration: 1800, iterations: Infinity },
  },
  wiggle: {
    frames: [
      { transform: 'rotate(0)' }, { transform: 'rotate(-9deg)', offset: 0.08 }, { transform: 'rotate(8deg)', offset: 0.16 },
      { transform: 'rotate(-6deg)', offset: 0.24 }, { transform: 'rotate(4deg)', offset: 0.32 }, { transform: 'rotate(0)', offset: 0.4 },
      { transform: 'rotate(0)' },
    ],
    timing: { duration: 2200, iterations: Infinity, easing: 'ease-in-out' },
  },
};
const SHINE = {
  frames: [{ transform: 'translateX(-130%) skewX(-20deg)' }, { transform: 'translateX(230%) skewX(-20deg)', offset: 0.45 }, { transform: 'translateX(230%) skewX(-20deg)' }],
  timing: { duration: 2600, iterations: Infinity, easing: 'ease-in-out' },
};

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function OfferSticker({ text, x = STICKER_DEFAULT.x, y = STICKER_DEFAULT.y, size = STICKER_DEFAULT.size, motion = STICKER_DEFAULT.motion,
  className = '', style, ...rest }) {
  const body = useRef(null);
  const gloss = useRef(null);

  useEffect(() => {
    if (reducedMotion() || !body.current?.animate) return undefined;
    const runs = [];
    if (MOTIONS[motion]) runs.push(body.current.animate(MOTIONS[motion].frames, MOTIONS[motion].timing));
    if (motion === 'shine' && gloss.current) runs.push(gloss.current.animate(SHINE.frames, SHINE.timing));
    return () => runs.forEach((a) => a.cancel());
  }, [motion]);

  if (!text) return null;
  return (
    // The outer box places the centre; the inner one moves, so a bounce or a
    // wiggle never shifts where the owner put it.
    <span {...rest} className={`absolute z-10 max-w-[60%] ${className}`}
      style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)', fontSize: `${(3.1 * size) / 100}cqw`, ...style }}>
      <span ref={body} className="relative block overflow-hidden truncate whitespace-nowrap rounded-full px-[0.95em] py-[0.5em] font-bold leading-none shadow-lg ring-1 ring-black/5"
        style={{ background: 'var(--sticker-bg)', color: 'var(--sticker-fg)' }}>
        {text}
        {motion === 'shine' && (
          <span ref={gloss} aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1/2"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.65), transparent)', transform: 'translateX(-130%)' }} />
        )}
      </span>
    </span>
  );
}
