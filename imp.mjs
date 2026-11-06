import { chromium } from 'playwright-core';
import ExcelJS from 'exceljs';
const S=process.argv[2], STAFF='http://127.0.0.1:8787';
const log=(...a)=>console.log(...a);
const j=await (await fetch(`${STAFF}/api/v1/setup`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({restaurant_name:'x',owner_name:'o',username:'owner',password:'owner1234',pin:'1111'})})).json();
const token=j.token; log('setup',!!token);
const h={Authorization:`Bearer ${token}`};
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const ctx=await b.newContext({viewport:{width:1366,height:900}});
await ctx.addInitScript((t)=>localStorage.setItem('cpro.token',t),token);
const p=await ctx.newPage(); p.on('pageerror',e=>log('ERR',String(e)));
p.on('response',async r=>{if(r.url().includes('/import/')&&r.request().method()==='POST')log('POST',r.status(),(await r.text()).slice(0,300))});
await p.goto(STAFF+'/#/import'); await p.waitForLoadState('networkidle');
for (const [ent,label,rows] of [['categories','الأقسام',[['بيتزا']]],['items','الأصناف',null]]) {
  const t=await (await fetch(`${STAFF}/api/v1/import/${ent}/template?mode=insert&lang=ar`,{headers:h})).arrayBuffer();
  const wb=new ExcelJS.Workbook(); await wb.xlsx.load(t);
  const ws=wb.worksheets[0];
  const heads=ws.getRow(1).values; log(ent,'headers',JSON.stringify(heads.map(x=>x?.richText?x.richText.map(r=>r.text).join(''):x)));
  const col=(needle)=>heads.findIndex(x=>JSON.stringify(x||'').includes(needle));
  if(ent==='categories'){ws.getCell(2,col('الاسم')>0?col('الاسم'):col('القسم')).value='بيتزا';}
  else { const r=ws.getRow(2); r.getCell(col('اسم الصنف')>0?col('اسم الصنف'):col('الاسم')).value='مارجريتا'; r.getCell(col('السعر')).value=180; r.getCell(col('القسم')).value='بيتزا'; r.commit(); }
  const buf=Buffer.from(await wb.xlsx.writeBuffer());
  await p.getByRole('button',{name:label,exact:true}).click();
  await p.locator('input[type=file]').setInputFiles({name:`${ent}.xlsx`,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:buf});
  await p.getByRole('button',{name:'رفع وإضافة'}).click();
  await p.waitForTimeout(1200);
  log('page says:',(await p.locator('main').innerText()).split('\n').slice(-6).join(' | '));
}
log('items', (await (await fetch(`${STAFF}/api/v1/items`,{headers:h})).json()).map(i=>i.name));
await b.close();
