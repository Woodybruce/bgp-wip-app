const BASE='http://localhost:5000';
const r = await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'})});
const u = await r.json();
const H = { Authorization: 'Bearer '+u.token };
const cos = await (await fetch(BASE+'/api/crm/companies',{headers:H})).json();
const list = Array.isArray(cos)?cos:(cos.companies||[]);
console.log('companies:', list.length);
for (const c of list) {
  console.log(JSON.stringify({name:c.name, companyType:c.companyType, isPortfolioAccount:c.isPortfolioAccount, keys_portfolio: Object.keys(c).filter(k=>/portfolio|client/i.test(k))}));
}
