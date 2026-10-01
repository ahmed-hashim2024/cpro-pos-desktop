import { useRef, useState } from 'react';
import {
  FileSpreadsheet, Download, Paperclip, Upload, CheckCircle2, AlertTriangle, UtensilsCrossed, Layers, Wheat,
  Users, Store, Armchair, FilePlus2, FilePen, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { lang } from '@/lib/i18n';
import { toast } from '@/lib/store';
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
};

export default function Import() {
  const targets = useLoad(() => api.get('/import/targets', { lang }));
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
      <PageHeader title={T('استيراد البيانات')} icon={FileSpreadsheet} subtitle={T('أضف أو حدّث بياناتك دفعة واحدة من ملف Excel')} crumb={T('استيراد البيانات')} />
      <Tabs value={mode} onChange={switchMode} tabs={[['insert', T('إضافة بيانات جديدة'), FilePlus2], ['update', T('تحديث بيانات موجودة'), FilePen]]} />

      {targets.loading && !targets.data ? <Spinner /> : !list.length ? (
        <Empty icon={FileSpreadsheet} title={T('لا توجد صلاحية')}>{T('ليس لديك صلاحية لاستيراد أي نوع من البيانات')}</Empty>
      ) : (
        <div className="grid gap-5">
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
                <div className="flex flex-wrap items-start gap-6">
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
                  className="flex flex-wrap items-center gap-4 rounded-2xl border-2 border-dashed border-line bg-surface-2/50 p-5">
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
      <div className="flex items-center gap-3 rounded-card border border-success/30 bg-success-soft p-5 text-success">
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
