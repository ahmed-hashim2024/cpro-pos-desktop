import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShoppingCart, Wallet, Boxes, BarChart3, UtensilsCrossed, Smartphone, ShieldCheck, Search, BookOpen, Route, ChevronDown, ExternalLink, SearchX,
} from 'lucide-react';
import { useApp } from '@/lib/store';
import { navLeaves, allowed } from '@/components/Layout';
import { Card, cx } from '@/components/ui';
import { T, lang } from '@/lib/i18n';
import { sections, guides, terms } from './helpContent';

const icons = { ShoppingCart, Wallet, Boxes, BarChart3, UtensilsCrossed, Smartphone, ShieldCheck };
const pick = (o) => o[lang] || o.ar;
// Arabic letters vary in ways a search shouldn't care about (أ/إ/آ/ا, ة/ه, ى/ي, diacritics).
const fold = (s) => s.toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

// How the system works and what each business term means. Open to every
// user; the «open the screen» links show only for screens they may open.
export default function Help() {
  const can = useApp((s) => s.can);
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [section, setSection] = useState('');
  const [open, setOpen] = useState(() => new Set(['day']));
  const reachable = useMemo(() => {
    const ok = new Set();
    navLeaves.forEach((n) => { if (allowed(can, n.perm)) ok.add(n.to.split('?')[0]); });
    return ok;
  }, [can]);
  const canOpen = (to) => to && reachable.has(to.split('?')[0]);

  const needle = fold(q.trim());
  const shownGuides = guides.filter((g) => !needle || fold(`${pick(g).t} ${pick(g).steps.join(' ')}`).includes(needle));
  const shownTerms = terms.filter((x) => (!section || x.s === section) && (!needle || fold(pick(x).join(' ')).includes(needle)));
  const toggle = (id) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const goTo = (to) => navigate(to);

  return (
    <div className="grid gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={T('ابحث عن مصطلح أو شرح…')} aria-label={T('ابحث عن مصطلح أو شرح…')}
          className="h-11 w-full rounded-xl border border-line bg-surface ps-11 pe-3 outline-none focus:border-primary focus:ring-4 focus:ring-primary/15" />
      </div>

      {shownGuides.length > 0 && !section && (
        <Card title={T('كيف يعمل النظام')} icon={Route}>
          <div className="grid gap-2">
            {shownGuides.map((g) => {
              const c = pick(g);
              const isOpen = open.has(g.id) || !!needle;
              return (
                <div key={g.id} className="rounded-xl border border-line">
                  <button type="button" onClick={() => toggle(g.id)} aria-expanded={isOpen}
                    className="flex w-full items-center gap-3 px-4 py-3 text-start font-bold hover:bg-surface-2">
                    <span className="flex-1">{c.t}</span>
                    <ChevronDown className={cx('size-4 text-muted transition', isOpen && 'rotate-180')} aria-hidden />
                  </button>
                  {isOpen && (
                    <div className="border-t border-line px-4 py-3">
                      <ol className="grid gap-2.5">
                        {c.steps.map((st, i) => (
                          <li key={i} className="flex gap-3 text-sm leading-relaxed">
                            <span className="num flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary">{i + 1}</span>
                            <span>{st}</span>
                          </li>
                        ))}
                      </ol>
                      {canOpen(g.to) && (
                        <button type="button" onClick={() => goTo(g.to)} className="mt-3 flex items-center gap-1.5 text-sm font-bold text-primary hover:underline">
                          <ExternalLink className="size-4" aria-hidden />{T('فتح الشاشة')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card title={T('مسرد المصطلحات')} icon={BookOpen}>
        <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label={T('مسرد المصطلحات')}>
          {[{ id: '', ar: 'الكل', en: 'All', fr: 'Tout' }, ...sections].map((s) => {
            const Icon = icons[s.icon];
            return (
              <button key={s.id} type="button" role="tab" aria-selected={section === s.id} onClick={() => setSection(s.id)}
                className={cx('flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition',
                  section === s.id ? 'border-primary bg-primary-soft text-primary' : 'border-line hover:bg-surface-2')}>
                {Icon && <Icon className="size-4" aria-hidden />}{pick(s)}
              </button>
            );
          })}
        </div>
        {!shownTerms.length ? (
          <div className="flex flex-col items-center gap-2 py-10 text-muted"><SearchX className="size-8" aria-hidden /><p>{T('لا نتائج للبحث')}</p></div>
        ) : (
          <dl className="grid gap-3 md:grid-cols-2">
            {shownTerms.map((x) => {
              const [term, def] = pick(x);
              const sec = sections.find((s) => s.id === x.s);
              return (
                <div key={x.ar[0]} className="rounded-xl border border-line bg-surface p-4">
                  <dt className="flex items-start justify-between gap-2">
                    <span className="font-bold">{term}</span>
                    {!section && sec && <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">{pick(sec)}</span>}
                  </dt>
                  <dd className="mt-1.5 text-sm leading-relaxed text-muted">{def}</dd>
                  {canOpen(x.to) && (
                    <button type="button" onClick={() => goTo(x.to)} className="mt-2 flex items-center gap-1.5 text-xs font-bold text-primary hover:underline">
                      <ExternalLink className="size-3.5" aria-hidden />{T('فتح الشاشة')}
                    </button>
                  )}
                </div>
              );
            })}
          </dl>
        )}
      </Card>
    </div>
  );
}
