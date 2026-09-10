const BASE='http://127.0.0.1:5000';
const tok=async u=>(await (await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:'B@nd0077!'})})).json()).token;
const t=await tok('victoria@brucegillinghampollard.com');
// touch the route so ensureTables() has run
await fetch(`${BASE}/api/insights`,{headers:{Authorization:'Bearer '+t}});
