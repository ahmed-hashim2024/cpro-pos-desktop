import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2 } from 'lucide-react';
import { toastError } from '@/lib/store';
import { T } from '@/lib/i18n';
import { cropImage, openImage, prepareImage } from '@/lib/image';
import { Button, Modal, cx } from '@/components/ui';

// wide: items. slider and family: offer banners, framed exactly as the guest
// page shows them. square: logo and app icon. round: category icons.
const ASPECT = { wide: 4 / 3, slider: 12 / 7, family: 5 / 2, square: 1, round: 1 };
const MAX_ZOOM = 4;

// Picks a picture, lets the owner frame it, then prepares it for upload
// (under 1 MB, high quality). `prepare` replaces that last step.
export function ImagePick({ onPick, label = T('صورة'), size = 'md', maxSide = 1600, shape = 'wide', prepare, hint }) {
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState(null); // {file, img}

  const close = () => {
    if (source) URL.revokeObjectURL(source.img.src);
    setSource(null);
  };
  const choose = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try { setSource({ file, img: await openImage(file) }); } catch (err) { toastError(err); } finally { setBusy(false); }
  };
  const done = async (box) => {
    setBusy(true);
    try {
      const out = await cropImage(source.img, box, { maxSide, type: source.file.type });
      onPick(await (prepare ? prepare(out) : prepareImage(out, { maxSide })));
      close();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <label className={cx('inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface font-semibold transition hover:bg-surface-2',
        size === 'sm' ? 'h-8 px-2.5 text-sm' : 'h-9 px-3', busy && 'pointer-events-none opacity-60')}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}{label}
        {hint && <span className="text-xs font-normal text-muted" dir="auto">{hint}</span>}
        <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={choose} />
      </label>
      {source && <CropDialog key={source.img.src} img={source.img} shape={shape} busy={busy} onCancel={close} onDone={done} />}
    </>
  );
}

function CropDialog({ img, shape, busy, onCancel, onDone }) {
  const frame = useRef(null);
  const W = Math.min(ASPECT[shape] > 1 ? 480 : 360, window.innerWidth - 96);
  const H = Math.round(W / ASPECT[shape]);
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const base = Math.max(W / iw, H / ih); // zoom 1: the picture just covers the frame

  const clamp = (p, z) => {
    const s = base * z;
    return { x: Math.min(0, Math.max(W - iw * s, p.x)), y: Math.min(0, Math.max(H - ih * s, p.y)) };
  };
  const [view, setView] = useState(() => ({ z: 1, ...clamp({ x: (W - iw * base) / 2, y: (H - ih * base) / 2 }, 1) }));
  const drag = useRef(null);

  // Zoom around a point of the frame, keeping that part of the picture under it.
  const zoomTo = (z, cx0 = W / 2, cy0 = H / 2) => setView((v) => {
    const next = Math.min(MAX_ZOOM, Math.max(1, z));
    const k = next / v.z;
    return { z: next, ...clamp({ x: cx0 - (cx0 - v.x) * k, y: cy0 - (cy0 - v.y) * k }, next) };
  });
  const move = (dx, dy) => setView((v) => ({ z: v.z, ...clamp({ x: v.x + dx, y: v.y + dy }, v.z) }));

  // The wheel needs a non-passive listener to stop the dialog scrolling.
  useEffect(() => {
    const el = frame.current;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView((v) => {
        const next = Math.min(MAX_ZOOM, Math.max(1, v.z * (e.deltaY < 0 ? 1.1 : 0.9)));
        const k = next / v.z;
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        return { z: next, ...clamp({ x: px - (px - v.x) * k, y: py - (py - v.y) * k }, next) };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape cancels the crop only, not the dialog underneath.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const arrows = { ArrowLeft: [12, 0], ArrowRight: [-12, 0], ArrowUp: [0, 12], ArrowDown: [0, -12] };
  const s = base * view.z;
  const confirm = () => onDone({ x: -view.x / s, y: -view.y / s, w: W / s, h: H / s });

  return (
    <Modal open onClose={onCancel} title={T('ظبط الصورة')} subtitle={T('اسحب الصورة وكبّرها لحد ما يظهر الجزء اللي عايزه')}
      footer={<><Button variant="secondary" onClick={onCancel}>{T('إلغاء')}</Button><Button busy={busy} onClick={confirm}>{T('استخدام الصورة')}</Button></>}>
      <div className="grid justify-items-center gap-3">
        <div ref={frame} dir="ltr" tabIndex={0} role="application" aria-label={T('ظبط الصورة')}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY }; }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            move(e.clientX - drag.current.x, e.clientY - drag.current.y);
            drag.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
          onKeyDown={(e) => { if (arrows[e.key]) { e.preventDefault(); move(...arrows[e.key]); } }}
          className="relative cursor-move touch-none select-none overflow-hidden rounded-2xl bg-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
          style={{ width: W, height: H }}>
          <img src={img.src} alt="" draggable={false} className="pointer-events-none absolute max-w-none"
            style={{ left: view.x, top: view.y, width: iw * s, height: ih * s }} />
          {shape === 'round' && <span className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgba(0,0,0,.5)]" aria-hidden />}
          {shape === 'wide' && (
            <span className="pointer-events-none absolute inset-y-0 start-1/2 -translate-x-1/2 border-x-2 border-dashed border-white/80" style={{ width: H }} aria-hidden />
          )}
        </div>
        {shape === 'wide' && <p className="text-center text-xs text-muted">{T('الجزء اللي بين الخطين هو اللي بيظهر في الكروت المربعة')}</p>}
        <label className="flex w-full max-w-sm items-center gap-3 text-sm font-semibold">
          {T('تكبير')}
          <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={view.z} onChange={(e) => zoomTo(Number(e.target.value))} className="flex-1 accent-[var(--primary)]" />
        </label>
      </div>
    </Modal>
  );
}
