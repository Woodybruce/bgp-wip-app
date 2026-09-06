const BASE='http://127.0.0.1:5000';
async function tok(u){const r=await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:u,password:'B@nd0077!'})});return (await r.json()).token;}
const PROP='cccccccc-0000-0000-0000-000000000001';
const t=await tok('mark.warne@landsec.com');
const arr=await (await fetch(`${BASE}/api/tenancy-schedule/property/${PROP}`,{headers:{authorization:'Bearer '+t}})).json();
const f=k=>arr.filter(u=>u[k]!=null&&u[k]!=='').length;
for(const k of ['break_date','lease_expiry','passing_rent_pa','erv_pa','service_charge','next_review_date','break_notice','term_years','unexpired_term_break','landlord_break_date','arrears_balance','credit_rating','deposit_held'])
  console.log(k, f(k));
const now=new Date();
const in6=new Date(now.getTime()+182*864e5);
const exp6=arr.filter(u=>u.lease_expiry&&new Date(u.lease_expiry)>=now&&new Date(u.lease_expiry)<=in6);
console.log('expiring within 6m:', exp6.length, exp6.map(u=>`${u.unit_number}|${u.tenant_name}|${u.lease_expiry}`).join('\n  '));
const brk=arr.filter(u=>u.break_date).sort((a,b)=>new Date(a.break_date)-new Date(b.break_date));
console.log('with break_date:', brk.length);
for(const u of brk.slice(0,15)) console.log('  BREAK', u.unit_number,'|',u.tenant_name,'|',u.break_date,'| notice',u.break_notice,'| expiry',u.lease_expiry,'| rent',u.passing_rent_pa,'| status',u.status);
const in5y=new Date(now.getTime()+5*365*864e5);
console.log('expiring within 5yrs:', arr.filter(u=>u.lease_expiry&&new Date(u.lease_expiry)>=now&&new Date(u.lease_expiry)<=in5y).length);
console.log('sum passing_rent_pa:', arr.reduce((s,u)=>s+(Number(u.passing_rent_pa)||0),0));
console.log('sum service_charge:', arr.reduce((s,u)=>s+(Number(u.service_charge)||0),0));
