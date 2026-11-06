import { useRef, useState } from 'react';
import {
  FileSpreadsheet, Download, Paperclip, Upload, CheckCircle2, AlertTriangle, UtensilsCrossed, Layers, Wheat,
  Users, Store, Armchair, FilePlus2, FilePen, X, FileDown, Loader2, Truck,
} from 'lucide-react';
import { api } from '@/lib/api';
import { lang } from '@/lib/i18n';
import { toast, toastError, useApp } from '@/lib/store';
import { useTab } from '@/lib/useTab';
import { exportCSV } from '@/lib/csv';
import { Button, Card, Empty, PageHeader, Spinner, Table, Td, Tabs, cx, useAction, useLoad } from '@/components/ui';
import { T } from '@/lib/i18n';

const icons = { items: UtensilsCrossed, categories: Layers, ingredients: Wheat, customers: Users, suppliers: Store, tables: Armchair };

// Messages for the issue codes returned by the server.
const issueText = {
  missing_column: T('عمود إلزامي غير موجود في الملف'),
  required: T('حقل إلزامي فارغ'),
  invalid_number: T('رقم غير صحيح'),
  invalid_integer: T('يجب أن يكون رقماً صحيحاً'),
  invalid_bool: T('القيمة يجب أن تكون نعم أو لا'),
  invalid_choice: T('قيمة غير مسموح بها'),
  unknown_reference: T('غير موجود في النظام'),
  duplicate_in_file: T('مكرر في نفس الملف (الصف)'),
  already_exists: T('موجود بالفعل — استخدم تبويب التحديث'),
  not_found: T('غير موجود — استخدم تبويب الإضافة'),
  too_long: T('النص أطول من المسموح'),
  invalid_json: T('صيغة البيانات في الخلية غير صحيحة'),
  db_rule: T('قاعدة البيانات رفضت القيمة دي'),
};

export default function Import() {
  const targets = useLoad(() => api.get('/import/targets', { lang }));
  const owner = useApp((s) => s.me?.role === 'owner');
  const [mode, setMode] = useTab('insert');
  const [entity, setEntity] = useState(null);
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, run] = useAction();
  const input = useRef(null);

  const list = targets.data || [];
  const target = list.find((t) => t.key === entity);
  const fields = target?.fields.filter((f) => !(mode === 'update' && f.insert_only)) || [];
  const isRequired = (f) => f.required || (mode === 'update' && f.key === target.match);

  const reset = () => { setFile(null); setResult(null); if (input.current) input.current.value = ''; };
  const pick = (k) => { setEntity(k); reset(); };
  const switchMode = (m) => { setMode(m); reset(); };

  const template = () => run(async () => {
    await api.download(`/import/${entity}/template`, `cpro-${entity}-${mode}.xlsx`, { mode, lang });
  });
  const upload = () => run(async () => {
    const r = await api.upload(`/import/${entity}`, file, { mode, lang });
    setResult(r);
    if (!r.issues.length) toast(mode === 'insert' ? T('تمت إضافة {0} سجل', [r.inserted]) : T('تم تحديث {0} سجل', [r.updated]));
  });

  return (
    <div>
      <PageHeader title={T('استيراد وتصدير البيانات')} icon={FileSpreadsheet} subtitle={T('أضف أو حدّث أو نزّل بياناتك دفعة واحدة في ملف Excel')} crumb={T('استيراد وتصدير البيانات')} />
      <Tabs value={mode} onChange={switchMode} tabs={[['insert', T('إضافة بيانات جديدة'), FilePlus2], ['update', T('تحديث بيانات موجودة'), FilePen], ['export', T('تصدير البيانات'), FileDown], ...(owner ? [['transfer', T('نقل البيانات'), Truck]] : [])]} />

      {mode === 'transfer' && owner ? <Transfer /> : targets.loading && !targets.data ? <Spinner /> : !list.length ? (
        <Empty icon={FileSpreadsheet} title={T('لا توجد صلاحية')}>{T('ليس لديك صلاحية لاستيراد أي نوع من البيانات')}</Empty>
      ) : mode === 'export' ? <Export list={list} /> : (
        <div className="grid gap-4">
          <Step n={1} title={T('اختر نوع البيانات')}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {list.map((t) => {
                const Icon = icons[t.key] || FileSpreadsheet;
                return (
                  <button key={t.key} onClick={() => pick(t.key)} aria-pressed={entity === t.key}
                    className={cx('flex flex-col items-center gap-2 rounded-2xl border-2 p-4 font-semibold transition',
                      entity === t.key ? 'border-primary bg-primary-soft text-primary-ink' : 'border-line bg-surface hover:border-primary/40')}>
                    <span className={cx('flex size-11 items-center justify-center rounded-xl', entity === t.key ? 'bg-brand text-white' : 'bg-surface-2 text-primary')}>
                      <Icon className="size-5" aria-hidden />
                    </span>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </Step>

          {target && (
            <>
              <Step n={2} title={T('نزّل القالب واملأه')}>
                <div className="flex flex-wrap items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="mb-3 text-sm text-muted">
                      {mode === 'insert'
                        ? T('القالب فارغ ويحتوي على كل الأعمدة. الحقول المعلّمة بـ * إلزامية.')
                        : T('القالب يحتوي على بياناتك الحالية — عدّل ما تريد ثم ارفعه. الخلية الفارغة تعني عدم التغيير.')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {fields.map((f) => (
                        <span key={f.key} title={f.help} className="rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-sm">
                          {f.label}{isRequired(f) && <span className="font-bold text-danger"> *</span>}
                        </span>
                      ))}
                    </div>
                    {mode === 'update' && <p className="mt-3 text-sm text-muted">{T('يتم التعرف على السجل من عمود «')}{fields.find((f) => f.key === target.match)?.label}».</p>}
                  </div>
                  <Button icon={Download} variant="soft" size="lg" busy={busy && !file} onClick={template}>{T('تنزيل قالب Excel')}</Button>
                </div>
              </Step>

              <Step n={3} title={T('أرفق الملف بعد ملئه')}>
                <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
                  onChange={(e) => { setFile(e.target.files[0] || null); setResult(null); }} />
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { setFile(f); setResult(null); } }}
                  className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-dashed border-line bg-surface-2/50 p-4">
                  <span className="flex size-12 items-center justify-center rounded-xl bg-primary-soft text-primary"><Paperclip className="size-6" aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    {file ? (
                      <div className="flex items-center gap-2 font-semibold">
                        <FileSpreadsheet className="size-5 text-success" aria-hidden /><span className="truncate">{file.name}</span>
                        <button onClick={reset} aria-label={T('إزالة الملف')} className="rounded p-1 text-muted hover:text-danger"><X className="size-4" /></button>
                      </div>
                    ) : (
                      <>
                        <div className="font-semibold">{T('اسحب الملف هنا أو اضغط «إرفاق ملف»')}</div>
                        <div className="text-sm text-muted">{T('ملف Excel ‎.xlsx — حتى 10,000 صف')}</div>
                      </>
                    )}
                  </div>
                  <Button variant="secondary" icon={Paperclip} onClick={() => input.current?.click()}>{T('إرفاق ملف')}</Button>
                  <Button icon={Upload} disabled={!file} busy={busy && !!file} onClick={upload}>{mode === 'insert' ? T('رفع وإضافة') : T('رفع وتحديث')}</Button>
                </div>
              </Step>

              {result && <Result result={result} mode={mode} entity={entity} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Downloads the current records as Excel, one type or everything.
function Export({ list }) {
  const [busy, setBusy] = useState('');
  const download = async (key) => {
    setBusy(key);
    try {
      const saved = await api.download(`/import/${key}/export`, `cpro-${key}.xlsx`, { lang });
      if (saved) toast(T('تم تصدير البيانات'));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy('');
    }
  };
  return (
    <Card title={T('تصدير البيانات')} icon={FileDown}
      actions={<Button icon={Download} busy={busy === 'all'} disabled={!!busy} onClick={() => download('all')}>{T('تصدير كل البيانات')}</Button>}>
      <p className="mb-4 text-sm text-muted">{T('نزّل بياناتك الحالية في ملف Excel. تقدر تعدّل الملف وترفعه من تبويب «تحديث بيانات موجودة». ملف «كل البيانات» فيه ورقة لكل نوع، ولرفع التعديلات استخدم ملف كل نوع لوحده.')}</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {list.map((t) => {
          const Icon = icons[t.key] || FileSpreadsheet;
          return (
            <button key={t.key} disabled={!!busy} onClick={() => download(t.key)} aria-busy={busy === t.key}
              className="flex flex-col items-center gap-2 rounded-2xl border-2 border-line bg-surface p-4 font-semibold transition hover:border-primary/40 disabled:opacity-60">
              <span className="flex size-11 items-center justify-center rounded-xl bg-surface-2 text-primary">
                {busy === t.key ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Icon className="size-5" aria-hidden />}
              </span>
              {t.label}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// Moving the restaurant to another computer, for the owner.
function Transfer() {
  const summary = useLoad(() => api.get('/transfer', { lang }));
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const input = useRef(null);
  const d = summary.data;

  const act = async (key, fn) => {
    setBusy(key);
    try { await fn(); } catch (e) { toastError(e); } finally { setBusy(''); }
  };
  const download = () => act('down', async () => {
    if (await api.download('/transfer/export', 'cpro-transfer.zip')) toast(T('تم تجهيز ملف النقل'));
  });
  const upload = (file) => act('up', async () => {
    const r = await api.upload('/transfer/import', file);
    setResult(r);
    if (!r.issues.length) {
      toast(T('تم نقل البيانات'));
      summary.reload(true);
    }
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={T('من الجهاز القديم')} icon={Download}>
        <p className="mb-3 text-sm text-muted">{T('نزّل ملف واحد فيه بيانات المطعم وصور المنيو، وانقله للجهاز الجديد.')}</p>
        {d && (
          <ul className="mb-3 divide-y divide-line rounded-xl bg-surface-2 px-3 text-sm">
            {d.groups.map((g) => <li key={g.label} className="flex justify-between py-2"><span>{g.label}</span><span className="num text-muted">{g.rows}</span></li>)}
            <li className="flex justify-between py-2"><span>{T('الصور')}</span><span className="num text-muted">{d.images}</span></li>
          </ul>
        )}
        {d?.open_shifts > 0 && <p className="mb-3 rounded-xl bg-warning-soft p-2.5 text-sm text-warning">{T('فيه وردية مفتوحة. اقفلها الأول علشان حساباتها تتنقل كاملة.')}</p>}
        <Button icon={Download} busy={busy === 'down'} disabled={!!busy} onClick={download}>{T('تنزيل ملف النقل')}</Button>
      </Card>

      <Card title={T('على الجهاز الجديد')} icon={Upload}>
        <ol className="mb-3 grid list-decimal gap-1.5 ps-5 text-sm text-muted">
          <li>{T('احذف الجهاز القديم من حسابك على المنصة لو عدد الأجهزة في باقتك جهاز واحد.')}</li>
          <li>{T('افتح البرنامج على الجهاز الجديد، ودوس Continue with Google، وجهّز حساب المالك.')}</li>
          <li>{T('ارفع ملف النقل من هنا.')}</li>
        </ol>
        <input ref={input} type="file" accept=".zip,.xlsx" className="hidden"
          onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) upload(f); }} />
        <Button icon={Upload} busy={busy === 'up'} disabled={!!busy} onClick={() => input.current?.click()}>{T('رفع ملف النقل')}</Button>
        <p className="mt-3 text-xs text-muted">{T('بتتاخد نسخة احتياطية قبل الرفع، ولو فيه خطأ في صف واحد مش بيتحفظ أي حاجة. رفع نفس الملف مرتين مش بيكرر البيانات.')}</p>
      </Card>

      <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted lg:col-span-2">{T('المستخدمين والأجهزة والترخيص مش بيتنقلوا. الطلبات والورديات القديمة بتتسجل باسم المالك اللي عمل النقل، فتقارير الكاشير القديمة هتظهر باسمه.')}</p>

      {result && <div className="lg:col-span-2"><TransferResult result={result} /></div>}
    </div>
  );
}

function TransferResult({ result }) {
  if (!result.issues.length) {
    return (
      <div className="flex items-center gap-3 rounded-card border border-success/30 bg-success-soft p-4 text-success">
        <CheckCircle2 className="size-7 shrink-0" aria-hidden />
        <div>
          <div className="text-lg font-bold">{T('تمت إضافة {0} وتعديل {1} صف، ونقل {2} صورة', [result.inserted, result.updated, result.images])}</div>
          <div className="text-sm" dir="auto">{T('نسخة احتياطية قبل الرفع')}: {result.backup}</div>
        </div>
      </div>
    );
  }
  return (
    <Card title={<span className="flex items-center gap-2 text-danger"><AlertTriangle className="size-5" />{T('لم يتم حفظ أي بيانات — يوجد')} {result.issues.length} {T('خطأ')}</span>}>
      <Table head={[T('الصف'), T('العمود'), T('المشكلة'), T('القيمة')]}>
        {result.issues.map((i, k) => (
          <tr key={k} className="bg-danger-soft/30">
            <Td className="num font-bold">{i.row}</Td>
            <Td className="font-semibold" dir="ltr">{i.column}</Td>
            <Td className="text-danger">{issueText[i.code] || i.code}</Td>
            <Td className="text-muted">{i.value}</Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function Step({ n, title, children }) {
  return (
    <Card>
      <div className="mb-4 flex items-center gap-3">
        <span className="bg-brand num flex size-8 items-center justify-center rounded-full text-sm font-bold text-white">{n}</span>
        <h2 className="text-lg font-bold">{title}</h2>
      </div>
      {children}
    </Card>
  );
}

function Result({ result, mode, entity }) {
  if (!result.issues.length) {
    return (
      <div className="flex items-center gap-3 rounded-card border border-success/30 bg-success-soft p-4 text-success">
        <CheckCircle2 className="size-7" aria-hidden />
        <div>
          <div className="text-lg font-bold">{mode === 'insert' ? T('تمت إضافة {0} سجل بنجاح', [result.inserted]) : T('تم تحديث {0} سجل بنجاح', [result.updated])}</div>
          <div className="text-sm">{T('تمت مراجعة')} {result.rows} {T('صف بدون أخطاء')}</div>
        </div>
      </div>
    );
  }
  const rows = result.issues;
  return (
    <Card
      title={<span className="flex items-center gap-2 text-danger"><AlertTriangle className="size-5" />{T('لم يتم حفظ أي بيانات — يوجد')} {rows.length} {T('خطأ')}</span>}
      actions={<Button size="sm" variant="secondary" icon={Download}
        onClick={() => exportCSV(`import-errors-${entity}`, [T('الصف'), T('العمود'), T('المشكلة'), T('القيمة')], rows.map((i) => [i.row, i.column, issueText[i.code] || i.code, i.value]))}>{T('تصدير الأخطاء')}</Button>}>
      <p className="mb-3 text-sm text-muted">{T('صحّح الأخطاء التالية في الملف ثم أرفقه وارفعه مرة أخرى.')}</p>
      <Table head={[T('الصف'), T('العمود'), T('المشكلة'), T('القيمة')]}>
        {rows.map((i, k) => (
          <tr key={k} className="bg-danger-soft/30">
            <Td className="num font-bold">{i.row}</Td>
            <Td className="font-semibold">{i.column}</Td>
            <Td className="text-danger">{issueText[i.code] || i.code}</Td>
            <Td className="text-muted">{i.value}</Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}
