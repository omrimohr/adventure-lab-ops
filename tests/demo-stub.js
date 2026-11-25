// Browser-side stub for the demo build: answers every API fn of the Apps Script from in-memory demo data (no network).
// Dates are relative to the real current date at view time. Writes update the in-memory data.
(function(){
'use strict';
try{localStorage.setItem('adv_ops_pin','0000')}catch(e){}   // auto-login as admin "Omri" (no PIN screen)
const p2=n=>String(n).padStart(2,'0');
const ymd=d=>d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());
const addDays=(n)=>{const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()+n);return ymd(d)};
// Demo clock: starts at 12:20 on the real date and advances in real time, so the "Terminadas / En curso / Próximas" sections always show all three states.
const CLK0=Date.now(),hm=()=>{const t=12*60+20+Math.floor((Date.now()-CLK0)/60000);return p2(Math.floor(t/60)%24)+':'+p2(t%60)};
const wkStartOf=(s)=>{const d=new Date(s+'T12:00:00');d.setDate(d.getDate()-((d.getDay()-4+7)%7));return ymd(d)};
const mins=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
const tstr=m=>p2(Math.floor(m/60))+':'+p2(m%60);

// ---------- catalog ----------
const ITEMS=[
 {id:'cer',name:'Cerveza',icon:'🍺',unitIcon:'🥫',controlStock:true,group:'Bebidas',unit:'lata',units:'latas',pack:24,packName:'caja',price:17.5,min:96,field:'Cerveza',active:true},
 {id:'agu',name:'Agua',icon:'💧',unitIcon:'',controlStock:true,group:'Bebidas',unit:'botella',units:'botellas',pack:12,packName:'paquete',price:9,min:48,field:'Agua',active:true},
 {id:'ref',name:'Refresco',icon:'🥤',unitIcon:'🥫',controlStock:true,group:'Bebidas',unit:'lata',units:'latas',pack:24,packName:'caja',price:14,min:48,field:'Coca-Cola',active:true},
 {id:'vin',name:'Vino',icon:'🍷',unitIcon:'🍶',controlStock:true,group:'Bebidas',unit:'botella',units:'botellas',pack:6,packName:'caja',price:185,min:6,field:'Vino',active:true},
 {id:'gas',name:'Gasolina',icon:'⛽',unitIcon:'',controlStock:true,group:'Combustible',unit:'litro',units:'litros',pack:1,packName:'litro',price:24.8,min:80,field:'Gasolina',active:true},
 {id:'hie',name:'Hielo',icon:'🧊',unitIcon:'',controlStock:false,group:'Consumo directo',unit:'bolsa',units:'bolsas',pack:1,packName:'bolsa',price:45,min:0,field:'Hielo',active:true},
 {id:'fru',name:'Fruta',icon:'🍉',unitIcon:'',controlStock:false,group:'Consumo directo',unit:'persona',units:'personas',pack:1,packName:'persona',price:18,min:0,field:'Fruta',active:true},
 {id:'cde',name:'Desayuno Staff',icon:'🍳',unitIcon:'',controlStock:false,group:'Comida empleado',unit:'comida',units:'comidas',pack:1,packName:'comida',price:40,min:0,field:'',active:true},
 {id:'cda',name:'Almuerzo Staff',icon:'🍽️',unitIcon:'',controlStock:false,group:'Comida empleado',unit:'comida',units:'comidas',pack:1,packName:'comida',price:50,min:0,field:'',active:true}];
const TOURS=[
 {pk:'258806',name:'Bacalar Lagoon Boat Tour',tipo:'compartido',barco:'ponton'},
 {pk:'274513',name:'Shared Sailing Tour',tipo:'compartido',barco:'catamaran'},
 {pk:'244132',name:'Private Boat Tour',tipo:'privado',barco:'ponton'},
 {pk:'244134',name:'Sunrise Paddleboard Tour',tipo:'compartido',barco:'sup'},
 {pk:'258044',name:'Kayak Rental - The Yak Lakehouse',tipo:'renta',barco:'kayak'}];
const BARCO={ponton:'Pontón',catamaran:'Catamarán',sup:'Tablas SUP',kayak:'Kayaks'};
const CREW_NAMES={cap:['Juan Pérez','Mauricio Canul','Rafael Tun'],mar:['Luis Martínez','Pedro Chan','Diego May'],guia:['Ignacio Arceo','Ana Rosado'],inst:['Carlos Pech']};
const ROLE_LABEL={cap:'Capitán',mar:'Marinero',guia:'Guía',inst:'Instructor líder'};
const PAY={cap:{ponton:450,catamaran:550},mar:{ponton:300,catamaran:350},guia:{ponton:250,sup:250,catamaran:250},inst:{sup:400}};
const NAMES=['Emma Johnson','Carlos Ramírez','Sophie Martin','Lucía Fernández','Daniel Kim','Hannah Müller','Mateo Rossi','Valeria Gómez','Tom Becker','Camila Torres','Andrés Soto','Julie Dubois','Ricardo Herrera','Olivia Brown','Marco Bianchi','Fernanda Ruiz'];

// ---------- departures ----------
const SCHED=[ // [dayOffset, time, itemIdx, resources, crew roles]
 [-1,'09:00',0,['Barracuda'],'cap,mar,guia'],[-1,'10:30',1,['Cormorán'],'cap,mar'],[-1,'14:00',2,['Ramona'],'cap,mar'],[-1,'16:00',0,['Barracuda'],'cap,mar,guia'],
 [0,'07:00',3,['SUP Yak'],'inst,guia'],[0,'08:30',4,['Kayaks Yak'],'guia'],[0,'09:00',0,['Barracuda'],'cap,mar,guia'],[0,'10:00',1,['Cormorán','La Flaca'],'cap,mar'],
 [0,'10:30',2,['Ramona'],'cap,mar'],[0,'11:30',0,['Barracuda','Ramona'],'cap,mar,mar,guia,inst'],[0,'13:00',1,[],'cap,mar'],[0,'14:00',2,['Ramona'],'cap,mar'],
 [0,'15:30',0,['Barracuda'],'cap,mar,guia'],[0,'15:00',4,['Kayaks Yak'],''],[0,'17:00',1,['Cormorán'],'cap,mar'],
 [1,'09:00',0,['Barracuda'],'cap,mar,guia'],[1,'10:00',1,['Cormorán'],'cap,mar'],[1,'11:00',2,['Ramona'],'cap,mar'],[1,'07:00',3,['SUP Yak'],'inst,guia']];
const RPK={Barracuda:309946,Ramona:309950,'Cormorán':309951,'La Flaca':309952,'SUP Yak':309960,'Kayaks Yak':309961};
const LONGNAME='Private Healing Boat Tour (La Ramona) · Atardecer con cena';
const FHB='https://fareharbor.com/thegaiaexperience/dashboard/?overlay=/contacts/';
const PRICE={0:650,1:1200,2:4200,3:850,4:450};
let seed=7;const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647};
const pick=(a)=>a[Math.floor(rnd()*a.length)];
let bkId=393004100; // realistic 9-digit FareHarbor-style numbers (demo only)
function makeDeps(){
  const T=addDays(0),now=mins(hm());
  return SCHED.map((s,i)=>{
    const [off,time,ti,res,crewS]=s,tour=TOURS[ti],date=addDays(off),end=tstr(mins(time)+(ti===4?240:ti===3?120:180)),endKey=date+' '+end;
    const nb=ti===2?1:ti===4?2:1+Math.floor(rnd()*3);
    const bookings=[];
    for(let k=0;k<nb;k++){
      const pax=ti===2?4+Math.floor(rnd()*4):ti===4?2+Math.floor(rnd()*3):2+Math.floor(rnd()*4);
      const gross=ti===2?PRICE[2]:pax*PRICE[ti];
      const exact=off<0||(off===0&&k===0&&i%3===0);
      const affiliate=rnd()<.25;
      const net=Math.round(gross*(affiliate?.78:.93));
      const kids=pax>3&&ti!==2&&rnd()<.5;
      bookings.push({id:'#'+(++bkId),url:(i===6&&k===0)?'':FHB+(364756000+bkId)+'/bookings/'+(10000+bkId)+'-demo/',name:pick(NAMES),pax:pax,types:ti===2?'1× Private Group':kids?(pax-1)+'× Adult, 1× Child':pax+'× Adult',gross:gross,net:net,est:!exact,alert:''});
    }
    const crew=crewS.split(',').filter(Boolean).map((r,j)=>{
      const nm=CREW_NAMES[r][(i+j)%CREW_NAMES[r].length];const base=(PAY[r]||{})[tour.barco]||250;
      return {n:nm,r:ROLE_LABEL[r],pay:{base:base,hx:0,tot:base},alert:''};
    });
    // round 5: crew notes (boat) + external captain with amount + Costos adicionales (parsed / unparsed)
    if(res.length>1)crew.forEach((c,j)=>{c.nt='Barco: '+res[j%res.length]});
    let ca={items:[],total:0,unparsed:false,rest:[],raw:''};
    if(i===0){crew.push({n:'Capitan Externo',r:'Capitán',nt:'San Ángel – Juan Pérez',ext:true,note:'San Ángel – Juan Pérez',monto:2500,pay:{base:0,hx:0,tot:0},alert:''});
      ca={items:[{label:'Barco externo San Ángel – Juan Pérez',amount:2500,ext:true},{label:'gasolina extra',amount:300,ext:false}],total:2800,unparsed:false,rest:[],raw:'Barco externo San Ángel – Juan Pérez: $2,500 · gasolina extra $300'}}
    if(i===3)ca={items:[{label:'hielo extra',amount:90,ext:false}],total:90,unparsed:true,rest:['lo paga la oficina'],raw:'hielo extra $90 · lo paga la oficina'};
    if(i===6)crew.push({n:'Capitan Externo',r:'Capitán',nt:'',ext:true,note:'',monto:null,pay:{base:0,hx:0,tot:0},alert:'Falta nota: ¿a quién se debe? | Falta monto en Costos adicionales'});
    if(off===0&&time==='13:00')crew.push({n:'Beto (externo)',r:'',ext:true,note:'Pagar a Carmelita',pay:{base:0,hx:0,tot:0},alert:''});
    if(off===0&&time==='14:00')crew.push({n:'Ana Rosado',r:'',pay:{base:0,hx:0,tot:0},alert:''});
    const carries=ti!==4;                   // bitácora applies to every item except rentals (round 4 rule)
    const started=(date<T)||(date===T&&mins(time)<=now),ended=(date<T)||(date===T&&mins(end)<now);
    let bit='No aplica';
    if(carries){
      if(ended)bit=(i%4===1)?'Sin bitácora':(i%4===2)?'Falta regreso':'Completa';
      else if(started)bit='Falta regreso';
      else bit='Sin bitácora';
    }
    const idaDone=/^(Completa|Falta regreso)$/.test(bit),regDone=/^(Completa|Falta salida)$/.test(bit);
    const pax=bookings.reduce((a,b)=>a+b.pax,0);
    const out=idaDone?{cer:Math.round(pax*2.5),agu:pax*2,ref:pax,gas:ti===1?55:40,hie:2}:null;
    const back=regDone?{cer:Math.round(pax*0.9),agu:pax,ref:Math.round(pax*0.3)}:null;
    let costs=null;
    if(idaDone&&regDone){const b=out.cer*17.5-back.cer*17.5+(out.agu-back.agu)*9+(out.ref-back.ref)*14,g=out.gas*24.8,h=90,ev=crew.reduce((a,c)=>a+c.pay.tot,0);
      const f=pax*18,tot=b+g+h+f+ev+ca.total;const gr=bookings.reduce((a,x)=>a+x.net,0);costs={b:b,g:g,h:h,f:f,des:0,ev:ev,ca:ca.total,tot:tot,pct:gr?tot/gr*100:null}}
    const resObjs=res.map(n=>({pk:String(RPK[n]),name:n,n:ti===2?pax:ti>=3?pax:Math.min(pax,10)}));
    // second resource gets the overflow
    if(resObjs.length>1){resObjs[1].n=Math.max(1,Math.floor(pax/3));resObjs[0].n=pax-resObjs[1].n}
    return {id:String(9000+i),itemPk:tour.pk,date:date,time:time,end:endKey,item:(off===0&&time==='14:00')?LONGNAME:tour.name,label:'',boat:BARCO[tour.barco]||'',barco:tour.barco,tipo:tour.tipo,
      crew:crew,bookings:bookings,out:out,back:back,extras:idaDone&&i%3===0?'Jugo y botanas':'',ca:ca,hx:0,rev:(off<0&&i%2===0)?{by:'Jesús',at:'16:20',day:date,hm:'16:20'}:null,
      bit:bit,alerts:'',netSource:bookings.some(b=>b.est)?'estimado':'',costs:costs,paxTxt:String(pax),
      salidaPk:'',regresoPk:'',salidaId:idaDone?'#'+(393010200+i):'',regresoId:regDone?'#'+(393010300+i):'',salidaUrl:idaDone?FHB+(364800000+i)+'/bookings/ops-ida-'+i+'/':'',regresoUrl:regDone?FHB+(364900000+i)+'/bookings/ops-reg-'+i+'/':'',
      gross:bookings.reduce((a,b)=>a+b.gross,0),res:resObjs};
  });
}

// round 6: check-in / no-show + booking detail (note, pago, canal, campos, teléfono). Deterministic by index (no rnd → the rest of the demo is unchanged).
function decorate(deps){
  const T=addDays(0),now=mins(hm());
  deps.forEach((d,i)=>{
    const started=d.date<T||(d.date===T&&mins(d.time)<=now);let dn=0,dt=0,dns=0;
    d.bookings.forEach((b,k)=>{
      const det=[];String(b.types).split(', ').forEach(t=>{const m=/^(\d+)× (.*)$/.exec(t);for(let j=0;j<+m[1];j++)det.push({t:m[2],s:'pending'})});
      const mode=!started?'none':(i%4===1&&k===0)?'part':(i%4===2&&k===0)?'noshow':'all';
      det.forEach((x,j)=>{x.s=mode==='all'?'in':mode==='part'?(j===0?'pending':'in'):mode==='noshow'?(j===0?'noshow':'in'):'pending'});
      const c={in:det.filter(x=>x.s==='in').length,n:det.length,ns:det.filter(x=>x.s==='noshow').length,det:det};
      b.ci=c;dn+=c.in;dt+=c.n;dns+=c.ns;
      b.pk=String(393004100+i*10+k);b.paid=(i%5===0&&k===0)?Math.round(b.gross/2):b.gross;
      b.note=(k===0&&i%3===0)?'Cumpleaños de la abuela. Llegan en 2 carros, pedir estacionamiento. Sin gluten en la fruta.':'';
      b.aff=(i%6===2&&k===0)?'Hotel Magic Bacalar':'';b.src=b.aff?'':(i%2?'Sitio web':'Mostrador');b.by=b.aff?'Hotel Magic Bacalar':'Omri';
      b.created=addDays(-3-(i%4))+' 1'+(k+1)+':2'+(i%6);
      b.tel=(i%7===3)?'':'+52 983 '+(100+i*13)+' '+(2000+i*37+k);
      b.campos=(k===0&&i%2===0)?'Hotel: Magic Bacalar | Alergias: nueces | Talla chaleco: M ×2':'';
    });
    d.ci=dt?{in:dn,n:dt,ns:dns}:null;if(dns)d.alerts='No show: '+dns;
  });
  return deps;
}
// ---------- state ----------
const D={};
function init(){
  const T=addDays(0);
  D.deps=decorate(makeDeps());
  // round 7: one departure per day whose bookings are ALL cancelled (no active bookings) and with a warning: it must not count in the day summary
  [-1,0].forEach((off,n)=>{const b=D.deps[0];D.deps.push(Object.assign({},b,{id:String(9090+n),date:addDays(off),time:'18:'+(n?'30':'00'),end:addDays(off)+' 21:00',bookings:[],gross:0,res:[],crew:[{n:'Pedro Chan',r:'',pay:{base:0,hx:0,tot:0},alert:''}],out:null,back:null,costs:null,ca:{items:[],total:0,unparsed:false,rest:[],raw:''},extras:'',rev:null,bit:'Sin bitácora',ci:null,alerts:'',netSource:'',salidaId:'',regresoId:'',salidaUrl:'',regresoUrl:''}))});
  D.items=ITEMS.map(x=>Object.assign({},x));
  const buys=[
   {id:'c1',d:addDays(-6),sup:'Depósito Bacalar',lines:[{i:'cer',q:240,p:17.5},{i:'ref',q:120,p:14}],ticket:'',note:'',annulled:false,hasta:'',history:[{d:addDays(-6),a:'Registrada · Omri',r:''}]},
   {id:'c2',d:addDays(-3),sup:'Gasolinera Chetumal',lines:[{i:'gas',q:200,p:24.8}],ticket:'',note:'',annulled:false,hasta:'',history:[{d:addDays(-3),a:'Registrada · Jesús',r:''}]},
   {id:'c3',d:addDays(-2),sup:'Súper del Lago',lines:[{i:'agu',q:144,p:9},{i:'vin',q:12,p:185}],ticket:'',note:'Para el fin de semana',annulled:false,hasta:'',history:[{d:addDays(-2),a:'Registrada · Edder',r:''}]}];
  D.purchases=buys;
  D.moves=[];
  buys.forEach(c=>c.lines.forEach(l=>D.moves.push({d:c.d,i:l.i,q:l.q,c:l.p,t:'Compra',ref:c.sup,cid:c.id,noStock:!D.items.find(x=>x.id===l.i).controlStock})));
  D.moves.push({d:addDays(-1),i:'cer',q:-70,c:17.5,t:'Bitácora',ref:'09:00 Bacalar Lagoon Boat Tour',dep:'9000'});
  D.moves.push({d:addDays(-1),i:'agu',q:-30,c:9,t:'Bitácora',ref:'09:00 Bacalar Lagoon Boat Tour',dep:'9000'});
  D.moves.push({d:addDays(-1),i:'gas',q:-45,c:24.8,t:'Bitácora',ref:'10:30 Shared Sailing Tour',dep:'9001'});
  D.moves.push({d:addDays(-1),i:'cer',q:-6,c:17.5,t:'Ajuste · Merma',ref:'Se rompieron al descargar',aj:true,mot:'Merma',nota:'Se rompieron al descargar',por:'Jesús',k:'seed-aj-1'});
  D.moves.sort((a,b)=>a.d<b.d?-1:a.d>b.d?1:0);
  D.priceLog={cer:[{d:addDays(-30),p:16.5,cid:'x'},{d:addDays(-6),p:17.5,cid:'c1'}],gas:[{d:addDays(-3),p:24.8,cid:'c2'}]};
  D.rates=[
   {id:2,l:'Capitán · pontón',amt:450,u:'salida',note:'',pending:false},{id:3,l:'Capitán · catamarán',amt:550,u:'salida',note:'',pending:false},
   {id:4,l:'Marinero · pontón',amt:300,u:'salida',note:'',pending:false},{id:5,l:'Guía',amt:250,u:'salida',note:'',pending:false},
   {id:6,l:'Instructor líder',amt:400,u:'salida',note:'',pending:false},{id:7,l:'Hora extra (capitán y marinero)',amt:100,u:'hora',note:'',pending:false},
   {id:8,l:'Día festivo',amt:'',u:'salida',note:'Por definir',pending:true}];
  D.paid={};D.weekly=[];
  D.externos=[{d:T,time:'13:00',item:'Shared Sailing Tour',pk:'9010',r:'Marinero',n:'Beto (externo)',note:'Pagar a Carmelita',alert:'',monto:null},
    {d:addDays(-1),time:'09:00',item:'Bacalar Lagoon Boat Tour',pk:'9000',r:'Capitan',n:'Capitan Externo',note:'San Ángel – Juan Pérez',alert:'',monto:2500},
    {d:T,time:'09:00',item:'Bacalar Lagoon Boat Tour',pk:'9006',r:'Capitan',n:'Capitan Externo',note:'',alert:'Falta nota: ¿a quién se debe? | Falta monto en Costos adicionales',monto:null}];
  D.control=[];
  for(let k=0;k<12;k++){const d=addDays(-k),n=D.deps.filter(x=>x.date===d).length||(k%7===0?0:4);
    D.control.push({d:d,dia:'',sal:n,res:n*3,ex:k>1?n*2100:0,est:k<=1?n*2300:0,estado:k===0?'⏳ Hoy':k===1?'⚠️ Falta reporte de Comercial':'✅ Exacto'})}
  D.tours=TOURS.concat([{pk:'337347',name:'Pontón Privado [HBTS]',tipo:'privado',barco:'ponton'},{pk:'696746',name:'Private Healing Boat Tour (La Ramona)',tipo:'privado',barco:'catamaran'}]);
  D.comidas=[{d:addDays(-1),n:'Luis Martínez',tipo:'desayuno',q:1,nota:'',por:'Jesús'},{d:addDays(-1),n:'Juan Pérez',tipo:'almuerzo',q:1,nota:'',por:'Jesús'}];
  const nowS=T+' '+hm();
  D.fh={ultimo:nowS,hoy:23,dups:3,errores:0,eventos:[
    {at:nowS,t:'Reserva',s:'Bacalar Lagoon Boat Tour · '+T+' 09:00'},{at:T+' 08:12',t:'Reserva cancelada',s:'Private Boat Tour · '+T+' 14:00'},
    {at:T+' 07:48',t:'Reserva',s:'Shared Sailing Tour · '+addDays(1)+' 10:00'}]};
  const ms=Date.now();
  D.pend=[
   {kind:'tipo',clave:'4242',name:'Student',pk:'4242',en:'258806 · Bacalar Lagoon Boat Tour',ejemplo:'',actual:{uso:'pax'},opciones:['pax','no cuenta','ops salida','ops regreso'],visto:addDays(-3)+' 11:20',ms:ms-3*86400000},
   {kind:'campo',clave:'8888',name:'Pet name',pk:'8888',en:'244132 · Private Boat Tour',ejemplo:'Rex',actual:{uso:'ignorar',prod:''},opciones:[],visto:addDays(-1)+' 09:05',ms:ms-86400000},
   {kind:'item',clave:'999001',name:'Sunset Cruise',pk:'999001',en:'',ejemplo:'',actual:{tipo:'compartido',barco:'',bitacora:'no',fields:[]},opciones:{tipos:[],barcos:[],campos:[]},visto:T+' 07:10',ms:ms-3600000}];
  D.salud=[{nivel:'warn',tipo:'bitacora',texto:'Falta bitácora: '+addDays(-1)+' 14:00 Private Boat Tour',rol:'todos'},
           {nivel:'warn',tipo:'reporte',texto:'Falta reporte de Comercial del '+addDays(-1),rol:'admin'},
           {nivel:'warn',tipo:'config',texto:'1 cosa por configurar desde hace más de 2 días',rol:'admin'}];
  D.perms={admin:{compras:true,revisar:true,pagar:true,inventario:true,ajuste:true,editar:true,comida:true,config:true},
           op:{compras:true,revisar:true,pagar:false,inventario:false,ajuste:false,editar:false,comida:true,config:false}};
  D.calls=0;D.staleOnce=true;D.config={semana_inicio:'jueves',semana_pago:'jueves'};
}
init();

// ---------- API ----------
const API={
 login:()=>({ok:true,nombre:'Omri',rol:'admin',perms:D.perms}),
 getData:(pin,from,to)=>{
   const today=addDays(0);D.calls++;
   const stale=D.staleOnce;D.staleOnce=false;
   return JSON.parse(JSON.stringify({ok:true,user:{nombre:'Omri',rol:'admin'},perms:D.perms,today:today,now:hm(),desde:from||addDays(-21),hasta:to||addDays(7),
     items:D.items,purchases:D.purchases,moves:D.moves,priceLog:D.priceLog,deps:D.deps,rates:D.rates,paid:D.paid,weekly:D.weekly,externos:D.externos,control:D.control,
     tours:D.tours,comidas:D.comidas,fh:D.fh,pend:D.pend,salud:D.salud,fhOk:true,config:D.config,stale:stale,rebuildPending:false}));
 },
 refreshFin:()=>({ran:true}),
 addCompra:(pin,p)=>{const dup=D.purchases.find(x=>p.cid&&x.cid===p.cid);if(dup)return {ok:true,id:dup.id,dup:true};
   const id='c'+(D.purchases.length+1)+Date.now()%1000;
   D.purchases.push({cid:p.cid||'',id:id,d:p.d,sup:p.sup,lines:p.lines,ticket:p.ticket||'',note:p.note||'',annulled:false,hasta:p.hasta||'',history:[{d:addDays(0),a:'Registrada · Omri',r:''}]});
   p.lines.forEach(l=>{const it=D.items.find(x=>x.id===l.i);if(it)it.price=l.p;D.moves.push({d:p.d,i:l.i,q:l.q,c:l.p,t:'Compra',ref:p.sup,cid:id,noStock:!it.controlStock})});return {ok:true,id:id}},
 anularCompra:(pin,id,reason)=>{const c=D.purchases.find(x=>x.id===id);if(c){c.annulled=true;c.history.push({d:addDays(0),a:'Anulada',r:reason||''});
   c.lines.forEach(l=>D.moves.push({d:addDays(0),i:l.i,q:-l.q,c:l.p,t:'Compra anulada',ref:reason||'',cid:id}))}return {ok:true}},
 editCompra:(pin,id,p,reason)=>{const c=D.purchases.find(x=>x.id===id);if(c){Object.assign(c,{d:p.d,sup:p.sup,note:p.note,hasta:p.hasta,lines:p.lines});c.history.push({d:addDays(0),a:'Editada',r:reason||''})}return {ok:true}},
 addAjuste:(pin,p)=>{if(p.cid&&D.moves.some(m=>m.k===p.cid))return {ok:true,dup:true};D.moves.push({d:p.d,i:p.i,q:p.q,c:0,t:'Ajuste · '+p.motivo,ref:p.nota||p.motivo,aj:true,mot:p.motivo,nota:p.nota||'',por:'Omri',k:p.cid||''});return {ok:true}},
 stockReport:(pin,desde,hasta)=>{
   if(hasta<desde){const t=desde;desde=hasta;hasta=t}
   const rows=D.items.filter(i=>i.controlStock).map(i=>{const o={i:i.id,name:i.name,icon:i.icon,group:i.group,unit:i.unit,units:i.units,price:i.price,ini:0,com:0,con:0,aj:0,comV:0,conV:0};
     D.moves.filter(m=>m.i===i.id&&!m.noStock).forEach(m=>{if(m.d<desde)o.ini+=m.q;else if(m.d<=hasta){if(m.t==='Bitácora'){o.con-=m.q;o.conV-=m.q*m.c}else if(/^Compra/.test(m.t)){o.com+=m.q;o.comV+=m.q*m.c}else o.aj+=m.q}});
     o.fin=o.ini+o.com-o.con+o.aj;o.delta=o.fin-o.ini;o.val=Math.round(o.fin*i.price*100)/100;return o});
   const sum=k=>Math.round(rows.reduce((a,r)=>a+r[k],0)*100)/100;
   return {ok:true,desde:desde,hasta:hasta,rows:rows,totals:{consumo:sum('conV'),compras:sum('comV'),valor:sum('val')}}},
 addConteo:(pin,p)=>{Object.keys(p.counts||{}).forEach(i=>{const cur=D.moves.filter(m=>m.i===i&&!m.noStock).reduce((a,m)=>a+m.q,0),df=Number(p.counts[i])-cur;if(df)D.moves.push({d:p.d,i:i,q:df,c:0,t:'Inventario completo',ref:p.nota||''})});return {ok:true}},
 addComida:(pin,p)=>{D.comidas.unshift({d:p.d,n:p.nombre,tipo:p.tipo,q:p.cantidad,nota:p.nota||'',por:'Omri'});return {ok:true}},
 markPaid:(pin,ws,name)=>{D.paid[ws+'|'+name]=addDays(0);return {ok:true}},
 markRev:(pin,id,cid)=>{const d=D.deps.find(x=>x.id===id);if(d)d.rev={by:'Omri',at:hm(),day:addDays(0),hm:hm()};return {ok:true}},
 saveProducto:(pin,p)=>{const i=D.items.findIndex(x=>x.id===p.id);const it=Object.assign({units:p.unit+'s',unitIcon:''},p);
   if(i>=0)D.items[i]=Object.assign(D.items[i],it);else{it.id=(p.name||'prd').toLowerCase().slice(0,3)+D.items.length;D.items.push(it)}return {ok:true}},
 saveTarifa:(pin,row,v)=>{const r=D.rates.find(x=>x.id===row);if(r){r.amt=v.amt;r.pending=false}return {ok:true}},
 savePerm:(pin,rol,perm,val)=>{D.perms[rol][perm]=!!val;return {ok:true}},
 saveTourBarco:(pin,pk,b)=>{const t=D.tours.find(x=>x.pk===String(pk));if(t)t.barco=b;return {ok:true}},
 setConfig:(pin,k,v)=>{const okv=k==='semana_inicio'?(v==='jueves'||v==='lunes'):k==='semana_pago'?['lunes','martes','miercoles','jueves','viernes','sabado','domingo'].includes(v):false;if(!okv)throw new Error('Ajuste inválido');D.config[k]=v;return {ok:true,config:D.config}},
 setMapeo:(pin,kind,clave)=>{D.pend=D.pend.filter(x=>!(x.kind===kind&&x.clave===clave));return {ok:true,rebuildPending:false}}
};
const WRITES={addCompra:1,addAjuste:1,addConteo:1,markRev:1,markPaid:1,setMapeo:1};
window.fetch=function(url,opts){
  let delay=350,fail='';try{delay=Number(localStorage.getItem('demo_delay'))||350;fail=localStorage.getItem('demo_fail')||''}catch(e){}   // demo_delay (ms) / demo_fail ('net' | 'final') para ver "guardando…" y el error
  return new Promise((res,rej)=>setTimeout(()=>{
    let body;try{body=JSON.parse(opts.body)}catch(e){body={}}
    let out;
    if(fail&&WRITES[body.fn]){if(fail==='net'){rej(new TypeError('Failed to fetch'));return}out={ok:false,error:'Producto desconocido'};res({ok:true,status:200,json:()=>Promise.resolve(out)});return}
    try{const f=API[body.fn];if(!f)throw new Error('Función desconocida');out={ok:true,result:f.apply(null,body.args||[])}}
    catch(e){out={ok:false,error:String(e.message||e)}}
    res({ok:true,status:200,json:()=>Promise.resolve(out)});
  },delay));
};
// small unobtrusive label
document.addEventListener('DOMContentLoaded',()=>{
  const l=document.createElement('div');l.textContent='Demo';
  l.style.cssText='position:fixed;bottom:calc(60px + env(safe-area-inset-bottom,0px));left:8px;font:600 10px/1 -apple-system,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#8a8a90;background:rgba(127,127,135,.16);padding:3px 8px;border-radius:99px;z-index:80;pointer-events:none';
  document.body.appendChild(l);
});
})();
