import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Delete, KeyRound, UserRound, ShoppingCart, ChefHat, FlaskConical, ShieldCheck } from 'lucide-react';
import { api, deviceId } from '@/lib/api';
import { useApp, toastError } from '@/lib/store';
import { roles } from '@/lib/format';
import { Button, Field, Input, Select, Spinner, cx } from '@/components/ui';

const DEVICE_NAME = 'cpro.deviceName';
const DEVICE_KIND = 'cpro.deviceKind';
const stored = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };

export default function Login() {
  const [status, setStatus] = useState(null);
  useEffect(() => { api.get('/status').then(setStatus).catch(toastError); }, []);
  if (!status) return <Spinner />;
  return (
    <div className="flex min-h-full bg-bg">
      <aside className="bg-brand relative hidden w-[42%] flex-col justify-between overflow-hidden p-12 text-white lg:flex">
        <div className="absolute -left-24 -top-24 size-80 rounded-full bg-white/10" aria-hidden />
        <div className="absolute -bottom-32 -right-20 size-96 rounded-full bg-white/10" aria-hidden />
        <div className="relative flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-white/20 text-2xl font-black">C</span>
          <div><div className="text-2xl font-black" dir="ltr">CPro</div><div className="text-sm text-white/80">نظام المطاعم والكافيهات</div></div>
        </div>
        <div className="relative">
          <h1 className="text-4xl font-bold leading-snug">كل مطعمك في شاشة واحدة</h1>
          <p className="mt-3 max-w-md text-lg text-white/85">الكاشير، المطبخ، المخزون والتقارير — يعمل بدون إنترنت وبياناتك على جهازك.</p>
          <ul className="mt-8 grid gap-3 text-white/90">
            {[[ShoppingCart, 'بيع سريع بالطاولات والتيك أواي والتوصيل'], [ChefHat, 'شاشة مطبخ لحظية لكل محطة'], [FlaskConical, 'وصفات وجرد ومتابعة استهلاك الخامات'], [ShieldCheck, 'صلاحيات وموافقات المدير وسجل كامل']].map(([Icon, t]) => (
              <li key={t} className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-xl bg-white/15"><Icon className="size-5" aria-hidden /></span>{t}</li>
            ))}
          </ul>
        </div>
        <div className="relative text-sm text-white/70">© CPro POS</div>
      </aside>
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-2xl">
          <div className="mb-8">
            <h2 className="text-3xl font-bold">{status.needs_setup ? 'مرحباً بك في CPro' : 'تسجيل الدخول'}</h2>
            <p className="mt-1 text-muted">{status.needs_setup ? 'أنشئ حساب المالك لبدء استخدام النظام' : 'اختر حسابك وأدخل الرقم السري'}</p>
          </div>
          {status.needs_setup ? <Setup /> : <SignIn channel={status.channel} />}
        </div>
      </main>
    </div>
  );
}

function Setup() {
  const signedIn = useApp((s) => s.signedIn);
  const navigate = useNavigate();
  const [f, setF] = useState({ restaurant_name: '', owner_name: '', username: '', password: '', pin: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await signedIn(await api.post('/setup', f));
      navigate('/settings');
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="grid max-w-md gap-4 rounded-card border border-line bg-surface p-6 shadow-card">
      <h3 className="text-lg font-bold">إعداد النظام لأول مرة</h3>
      <Field label="اسم المطعم"><Input required value={f.restaurant_name} onChange={set('restaurant_name')} /></Field>
      <Field label="اسم المالك"><Input required value={f.owner_name} onChange={set('owner_name')} /></Field>
      <Field label="اسم المستخدم"><Input required value={f.username} onChange={set('username')} /></Field>
      <Field label="كلمة المرور" hint="8 أحرف على الأقل وتحتوي على حرف ورقم">
        <Input required type="password" value={f.password} onChange={set('password')} />
      </Field>
      <Field label="الرقم السري للدخول السريع وموافقات المدير" hint="من 4 إلى 6 أرقام">
        <Input inputMode="numeric" maxLength={6} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} />
      </Field>
      <Button busy={busy} size="lg">ابدأ</Button>
    </form>
  );
}

function SignIn({ channel }) {
  const signedIn = useApp((s) => s.signedIn);
  const navigate = useNavigate();
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
      await signedIn(s);
      navigate(device.kind === 'kds' && lan ? '/kitchen' : '/');
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
            <Field label="اسم الجهاز"><Input value={device.name} placeholder="تابلت الصالة" onChange={(e) => setDevice({ ...device, name: e.target.value })} /></Field>
            <Field label="نوع الجهاز">
              <Select value={device.kind} onChange={(e) => setDevice({ ...device, kind: e.target.value })}>
                <option value="waiter">ويتر</option><option value="kds">شاشة مطبخ</option>
                <option value="terminal">كاشير</option><option value="display">شاشة عميل</option>
              </Select>
            </Field>
          </div>
        )}
        <div className="mb-3 flex gap-2">
          <Button variant={mode === 'pin' ? 'primary' : 'secondary'} size="sm" onClick={() => setMode('pin')} disabled={!users.length}><KeyRound className="size-4" />رقم سري</Button>
          <Button variant={mode === 'password' ? 'primary' : 'secondary'} size="sm" onClick={() => setMode('password')}><UserRound className="size-4" />اسم مستخدم</Button>
        </div>
        {mode === 'pin' ? (
          <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto">
            {users.map((u) => (
              <button key={u.id} onClick={() => { setPicked(u); setPin(''); }}
                className={cx('flex items-center gap-3 rounded-2xl border-2 p-3 text-right transition', picked?.id === u.id ? 'border-primary bg-primary-soft' : 'border-line bg-surface hover:border-primary/50')}>
                <span className="bg-brand flex size-10 shrink-0 items-center justify-center rounded-full font-bold text-white">{u.name.trim()[0]}</span>
                <span><span className="block font-bold">{u.name}</span><span className="block text-sm text-muted">{roles[u.role]}</span></span>
              </button>
            ))}
          </div>
        ) : (
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); login(cred); }}>
            <Field label="اسم المستخدم"><Input autoFocus value={cred.username} onChange={(e) => setCred({ ...cred, username: e.target.value })} /></Field>
            <Field label="كلمة المرور"><Input type="password" value={cred.password} onChange={(e) => setCred({ ...cred, password: e.target.value })} /></Field>
            <Button busy={busy} size="lg">دخول</Button>
          </form>
        )}
      </div>
      {mode === 'pin' && (
        <div className={cx('rounded-card border border-line bg-surface p-5 shadow-card', !picked && 'pointer-events-none opacity-50')}>
          <div className="mb-3 text-center font-bold">{picked ? picked.name : 'اختر المستخدم'}</div>
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
            <Button className="h-14" busy={busy} disabled={pin.length < 4} onClick={() => login({ user_id: picked.id, pin })}>دخول</Button>
          </div>
        </div>
      )}
    </div>
  );
}
