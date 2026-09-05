const BASE='http://localhost:5000';
const login = await (await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'victoria@brucegillinghampollard.com',password:'B@nd0077!'})})).json();
const T=login.token;
const post = async (body,label) => {
  const r = await fetch(BASE+'/api/lease-events',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+T},body:JSON.stringify(body)});
  console.log(label, r.status, (await r.text()).slice(0,600));
};
const d = new Date(Date.now()+60*864e5).toISOString().slice(0,10);
await post({ tenant:'QA-PROBE t1', eventType:'Rent Review', status:'Monitoring', sourceEvidence:'Manual', eventDate:d }, 'A minimal:');
await post({ tenant:'QA-PROBE t2', eventType:'Rent Review', status:'Monitoring', sourceEvidence:'Manual', eventDate:d, address:'Bluewater', landlord:'Landsec', unitRef:'U124', currentRent:'£125,000', estimatedErv:'£150,000' }, 'B UI-shaped:');
await post({ eventType:'Rent Review', status:'Monitoring', sourceEvidence:'Manual', eventDate:d, notes:'x' }, 'C no tenant:');
const list = await (await fetch(BASE+'/api/lease-events',{headers:{Authorization:'Bearer '+T}})).json();
console.log('rows now', list.length, JSON.stringify(list.map(x=>({id:x.id,tenant:x.tenant}))));
for (const row of list) {
  const r = await fetch(BASE+'/api/lease-events/'+row.id,{method:'DELETE',headers:{Authorization:'Bearer '+T}});
  console.log('cleanup delete', row.tenant, r.status);
}
