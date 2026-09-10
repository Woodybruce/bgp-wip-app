// r574 step4: Mark downloads the tenancy schedule Excel from the board he is
// looking at, and checks it against the board and the dashboard tiles.
import { chromium } from '../node_modules/playwright/index.mjs';
import fs from 'fs';
const BASE='http://localhost:5000';
const PID='cccccccc-0000-0000-0000-000000000001';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
try{
 const ctx=await b.newContext({viewport:{width:1440,height:900},locale:'en-GB'});
 const lr=await ctx.request.post(`${BASE}/api/auth/login`,{data:{username:'mark.warne@landsec.com',password:'B@nd0077!'}});
 const user=await lr.json(); const H={Authorization:`Bearer ${user.token}`};
 // board payload
 const br=await ctx.request.get(`${BASE}/api/tenancy-schedule/property/${PID}`,{headers:H});
 const bj=await br.json();
 const units=bj.units||bj.rows||bj;
 console.log('BOARD status',br.status(),'keys',Object.keys(bj).slice(0,12).join(','));
 console.log('BOARD rows:',Array.isArray(units)?units.length:'n/a');
 if(Array.isArray(units)){
   const sum=(f)=>units.reduce((s,u)=>s+(Number(u[f])||0),0);
   console.log('  board sums: passing_rent_pa',sum('passing_rent_pa'),'erv_pa',sum('erv_pa'),'nia',sum('nia_sqft'),'gia',sum('gia_sqft'));
   const st={}; for(const u of units) st[u.status||'(null)']=(st[u.status||'(null)']||0)+1;
   console.log('  board statuses:',JSON.stringify(st));
   console.log('  synthetic?',units.filter(u=>u.__synthetic||u.source==='letting_tracker'||u.id===null).length);
 }
 // the document
 const xr=await ctx.request.get(`${BASE}/api/tenancy-schedule/property/${PID}/export-excel`,{headers:H});
 console.log('EXPORT status',xr.status(),xr.headers()['content-type']);
 const buf=Buffer.from(await xr.body());
 fs.writeFileSync('/tmp/r574-tenancy.xlsx',buf);
 const ExcelJS=(await import('exceljs')).default;
 const wb=new ExcelJS.Workbook(); await wb.xlsx.load(buf);
 const ws=wb.worksheets[0];
 console.log('SHEET',ws.name,'rowCount',ws.rowCount);
 console.log('R1',ws.getRow(1).getCell(1).value);
 console.log('R2',ws.getRow(2).getCell(1).value);
 const hdr=ws.getRow(4).values.slice(1).map(v=>String(v));
 console.log('HDRS',hdr.length,hdr.join(' | ').slice(0,600));
 // last row = totals
 const last=ws.getRow(ws.rowCount).values.slice(1);
 const tot={}; hdr.forEach((h,i)=>{ if(last[i]!==''&&last[i]!=null) tot[h]=last[i]; });
 console.log('TOTAL ROW:',JSON.stringify(tot));
 // count data rows (numbered col 1)
 let data=0, groupBands=0;
 for(let i=5;i<=ws.rowCount;i++){const c=ws.getRow(i).getCell(1).value; if(typeof c==='number')data++; else if(c&&String(c).trim()&&ws.getRow(i).getCell(2).value==null)groupBands++;}
 console.log('EXPORT data rows',data,'group bands',groupBands);
}finally{await b.close();}
