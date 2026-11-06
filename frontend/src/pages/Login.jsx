import { useEffect, useState } from 'react';
import { LangMenu } from '@/components/Layout';
import { Delete, KeyRound, UserRound, ShoppingCart, ChefHat, FlaskConical, ShieldCheck } from 'lucide-react';
import { api, deviceId } from '@/lib/api';
import { useApp, toastError } from '@/lib/store';
import { ConnectGoogle } from '@/components/License';
import { DomainField, slugify } from '@/components/Domain';
import { RestoreFirstRun } from '@/components/Restore';
import { roles } from '@/lib/format';
import { Button, Field, Input, Select, Spinner, cx } from '@/components/ui';
import { T } from '@/lib/i18n';

const DEVICE_NAME = 'cpro.deviceName';
const DEVICE_KIND = 'cpro.deviceKind';
const stored = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };

export default function Login() {
  const [status, setStatus] = useState(null);
  const load = () => api.get('/status').then(setStatus).catch(toastError);
  useEffect(() => { load(); }, []);
  if (!status) return <Spinner />;
  const returning = status.needs_setup && !status.needs_connect && status.account?.returning;
  return (
    <div className="flex h-dvh overflow-hidden bg-bg">
      <aside className="bg-brand relative hidden w-[42%] shrink-0 flex-col justify-between overflow-hidden p-12 text-white lg:flex">
        <div className="absolute -end-24 -top-24 size-80 rounded-full bg-white/10" aria-hidden />
        <div className="absolute -bottom-32 -start-20 size-96 rounded-full bg-white/10" aria-hidden />
        <div className="relative flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-white/20 text-2xl font-black">C</span>
          <div><div className="text-2xl font-black" dir="ltr">CPro</div><div className="text-sm text-white/80">{T('نظام المطاعم والكافيهات')}</div></div>
        </div>
        <div className="relative">
          <h1 className="text-4xl font-bold leading-snug">{T('كل مطعمك في شاشة واحدة')}</h1>
          <p className="mt-3 max-w-md text-lg text-white/85">{T('الكاشير، المطبخ، المخزون والتقارير — يعمل بدون إنترنت وبياناتك على جهازك.')}</p>
          <ul className="mt-8 grid gap-3 text-white/90">
            {[[ShoppingCart, T('بيع سريع بالطاولات والتيك أواي والتوصيل')], [ChefHat, T('شاشة مطبخ لحظية لكل محطة')], [FlaskConical, T('وصفات وجرد ومتابعة استهلاك الخامات')], [ShieldCheck, T('صلاحيات وموافقات المدير وسجل كامل')]].map(([Icon, t]) => (
              <li key={t} className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-xl bg-white/15"><Icon className="size-5" aria-hidden /></span>{t}</li>
            ))}
          </ul>
        </div>
        <div className="relative text-sm text-white/70">© CPro POS</div>
      </aside>
      <main className="relative min-w-0 flex-1 overflow-y-auto">
        <div className="absolute end-6 top-6"><LangMenu /></div>
        <div className="flex min-h-full items-center justify-center p-6">
        <div className="w-full max-w-2xl">
          <div className="mb-8">
            <h2 className="text-3xl font-bold">{returning ? T('أهلاً بيك تاني') : status.needs_connect || status.needs_setup ? T('مرحباً بك في CPro') : T('تسجيل الدخول')}</h2>
            <p className="mt-1 text-muted">
              {status.needs_connect ? T('سجّل دخولك بحساب Google علشان تبدأ. لو مالكش حساب هيتعمل لوحده.')
                : returning ? T('حسابك جاهز. كمّل على الجهاز ده من نسختك الاحتياطية، أو ابدأ من غير نسخة.')
                  : status.needs_setup ? T('خطوة أخيرة: جهّز حساب المالك على الجهاز ده') : T('اختر حسابك وأدخل الرقم السري')}
            </p>
          </div>
          {status.needs_connect
            ? <div className="max-w-md"><ConnectGoogle onDone={load} /></div>
            : status.needs_setup ? <Setup account={status.account} /> : <SignIn channel={status.channel} />}
        </div>
        </div>
      </main>
    </div>
  );
}

function Setup({ account }) {
  const [start, setStart] = useState(!account?.returning);
  if (!start) return <ReturningChoice account={account} onStart={() => setStart(true)} />;
  return <SetupForm account={account} onBack={account?.returning ? () => setStart(false) : null} />;
}

// An owner who has used CPro before, on a computer with nothing on it yet.
function ReturningChoice({ account, onStart }) {
  return (
    <div className="grid max-w-md gap-3">
      <RestoreFirstRun />
      <div className="grid gap-2 rounded-card border border-line bg-surface p-4 shadow-card">
        <div>
          <h3 className="font-bold">{T('معندكش نسخة احتياطية؟')}</h3>
          <p className="text-sm text-muted">{account.restaurant ? T('هتبدأ ببيانات مطعمك من حسابك، والأصناف والمبيعات فاضية.') : T('هتبدأ من غير بيانات، والدومين من حسابك.')}</p>
        </div>
        <Button variant="secondary" onClick={onStart}>{T('ابدأ من غير نسخة')}</Button>
      </div>
    </div>
  );
}

function SetupForm({ account, onBack }) {
  const signedIn = useApp((s) => s.signedIn);
  const known = !!account?.restaurant; // the account already has the restaurant's data
  const [f, setF] = useState({ restaurant_name: account?.restaurant || '', owner_name: account?.owner_name || account?.name || '', username: account?.username || '', password: '', pin: '' });
  const [busy, setBusy] = useState(false);
  const wantsDomain = !!account?.emenu && !account.has_domain;
  const [domain, setDomain] = useState({ value: '', touched: false, status: 'idle' });
  const subdomain = domain.touched ? domain.value : slugify(f.restaurant_name);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      sessionStorage.setItem('cpro.next', '/settings');
      await signedIn(await api.post('/setup', f));
      if (wantsDomain && domain.status === 'free') await api.post('/platform/domain', { subdomain });
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="grid max-w-md gap-4 rounded-card border border-line bg-surface p-6 shadow-card">
      <h3 className="text-lg font-bold">{onBack ? T('كلمة مرور للجهاز ده') : T('إعداد النظام لأول مرة')}</h3>
      {known ? (
        <dl className="grid gap-2 rounded-xl bg-surface-2 p-3 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-muted">{T('المطعم')}</dt><dd className="font-bold">{f.restaurant_name}</dd></div>
          {f.username && <div className="flex justify-between gap-3"><dt className="text-muted">{T('اسم المستخدم')}</dt><dd className="font-bold" dir="ltr">{f.username}</dd></div>}
          {account?.domain && <div className="flex justify-between gap-3"><dt className="text-muted">{T('المنيو')}</dt><dd className="num font-bold" dir="ltr">{account.domain}</dd></div>}
        </dl>
      ) : (
        <Field label={T('اسم المطعم')}><Input required value={f.restaurant_name} onChange={set('restaurant_name')} /></Field>
      )}
      {!known && account?.domain && (
        <div className="rounded-xl bg-surface-2 p-3 text-sm">
          <div className="text-muted">{T('دومين المنيو من حسابك')}</div>
          <div className="num font-bold" dir="ltr">{account.domain}</div>
        </div>
      )}
      {wantsDomain && (
        <DomainField value={subdomain} onChange={(value) => setDomain({ ...domain, value, touched: true })}
          onStatus={(status) => setDomain((d) => ({ ...d, status }))} />
      )}
      {!(known && account?.username) && (
        <>
          <Field label={T('اسم المالك')}><Input required value={f.owner_name} onChange={set('owner_name')} /></Field>
          <Field label={T('اسم المستخدم')}><Input required value={f.username} onChange={set('username')} /></Field>
        </>
      )}
      <Field label={T('كلمة المرور')} hint={T('8 أحرف على الأقل وتحتوي على حرف ورقم')}>
        <Input required type="password" value={f.password} onChange={set('password')} />
      </Field>
      <Field label={T('الرقم السري للدخول السريع وموافقات المدير')} hint={T('من 4 إلى 6 أرقام')}>
        <Input inputMode="numeric" maxLength={6} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} />
      </Field>
      <Button busy={busy} size="lg" disabled={wantsDomain && !['free', 'error'].includes(domain.status)}>{T('ابدأ')}</Button>
      {onBack && <Button type="button" variant="ghost" onClick={onBack}>{T('رجوع')}</Button>}
    </form>
  );
}

function SignIn({ channel }) {
  const signedIn = useApp((s) => s.signedIn);
  const [users, setUsers] = useState([]);
  const [picked, setPicked] = useState(null);
  const [pin, setPin] = useState('');
  const [mode, setMode] = useState('pin');
  const [cred, setCred] = useState({ username: '', password: '' });
  const [device, setDevice] = useState({ name: stored(DEVICE_NAME, ''), kind: stored(DEVICE_KIND, 'waiter') });
  const [busy, setBusy] = useState(false);
  const lan = channel !== 'app';

  useEffect(() => {
    api.get('/auth/users').then((u) => { setUsers(u); if (!u.length) setMode('password'); }).catch(toastError);
  }, []);

  const login = async (body) => {
    setBusy(true);
    try {
      if (lan) {
        try { localStorage.setItem(DEVICE_NAME, device.name); localStorage.setItem(DEVICE_KIND, device.kind); } catch { /* ignore */ }
      }
      const s = await api.post('/auth/login', { ...body, device_id: deviceId(), device_name: device.name, device_kind: device.kind });
      if (lan && device.kind === 'kds') sessionStorage.setItem('cpro.next', '/kitchen');
      await signedIn(s);
    } catch (e) {
      toastError(e);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const press = (d) => {
    const next = (pin + d).slice(0, 6);
    setPin(next);
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        {lan && (
          <div className="mb-4 grid grid-cols-2 gap-2 rounded-card border border-line bg-surface p-3">
            <Field label={T('اسم الجهاز')}><Input value={device.name} placeholder={T('تابلت الصالة')} onChange={(e) => setDevice({ ...device, name: e.target.value })} /></Field>
            <Field label={T('نوع الجهاز')}>
              <Select value={device.kind} onChange={(e) => setDevice({ ...device, kind: e.target.value })}>
                <option value="waiter">{T('ويتر')}</option><option value="kds">{T('شاشة مطبخ')}</option>
                <option value="terminal">{T('كاشير')}</option><option value="display">{T('شاشة عميل')}</option>
              </Select>
            </Field>
          </div>
        )}
        <div className="mb-3 flex gap-2">
          <Button variant={mode === 'pin' ? 'primary' : 'secondary'} size="sm" onClick={() => setMode('pin')} disabled={!users.length}><KeyRound className="size-4" />{T('رقم سري')}</Button>
          <Button variant={mode === 'password' ? 'primary' : 'secondary'} size="sm" onClick={() => setMode('password')}><UserRound className="size-4" />{T('اسم مستخدم')}</Button>
        </div>
        {mode === 'pin' ? (
          <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto">
            {users.map((u) => (
              <button key={u.id} onClick={() => { setPicked(u); setPin(''); }}
                className={cx('flex items-center gap-3 rounded-2xl border-2 p-3 text-start transition', picked?.id === u.id ? 'border-primary bg-primary-soft' : 'border-line bg-surface hover:border-primary/50')}>
                <span className="bg-brand flex size-10 shrink-0 items-center justify-center rounded-full font-bold text-white">{u.name.trim()[0]}</span>
                <span><span className="block font-bold">{u.name}</span><span className="block text-sm text-muted">{roles[u.role]}</span></span>
              </button>
            ))}
          </div>
        ) : (
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); login(cred); }}>
            <Field label={T('اسم المستخدم')}><Input autoFocus value={cred.username} onChange={(e) => setCred({ ...cred, username: e.target.value })} /></Field>
            <Field label={T('كلمة المرور')}><Input type="password" value={cred.password} onChange={(e) => setCred({ ...cred, password: e.target.value })} /></Field>
            <Button busy={busy} size="lg">{T('دخول')}</Button>
          </form>
        )}
      </div>
      {mode === 'pin' && (
        <div className={cx('rounded-card border border-line bg-surface p-5 shadow-card', !picked && 'pointer-events-none opacity-50')}>
          <div className="mb-3 text-center font-bold">{picked ? picked.name : T('اختر المستخدم')}</div>
          <div className="mb-4 flex justify-center gap-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span key={i} className={cx('size-4 rounded-full', i < pin.length ? 'bg-primary' : 'bg-line')} />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2" dir="ltr">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button key={d} onClick={() => press(d)} className="num h-14 rounded-xl bg-surface-2 text-2xl font-bold transition hover:bg-primary-soft hover:text-primary-ink">{d}</button>
            ))}
            <button onClick={() => setPin(pin.slice(0, -1))} className="flex h-14 items-center justify-center rounded-xl bg-surface-2 transition hover:bg-danger-soft hover:text-danger"><Delete /></button>
            <button onClick={() => press('0')} className="num h-14 rounded-xl bg-surface-2 text-2xl font-bold transition hover:bg-primary-soft hover:text-primary-ink">0</button>
            <Button className="h-14" busy={busy} disabled={pin.length < 4} onClick={() => login({ user_id: picked.id, pin })}>{T('دخول')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
