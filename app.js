'use strict';
/* Бланк игрока для настольной игры «Денежный поток» — неофициальный помощник (PWA).
   Бэкенд: Supabase (auth + таблицы games, game_players, profiles, professions). */
const CFG=window.CFG||{};
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=n=>Math.round(n).toLocaleString('ru-RU').replace(/ /g,' ');
let CUR='$';
const $$=n=>(n<0?'−':'')+CUR+fmt(Math.abs(n));
const EXP=[['taxes','Налоги'],['mort','Ипотека / арендная плата'],['edu','Кредит на образование'],['car','Кредит на автомобиль'],['cc','Кредитная карточка'],['small','Мелкие кредиты'],['other','Прочие расходы']];
const DEBT=[['mort','Ипотека'],['edu','Кредит на образование'],['car','Кредит на автомобиль'],['cc','Долг по кредитной карточке'],['small','Мелкие кредиты']];
const DISCLAIMER='Неофициальный помощник для настольной игры «Денежный поток» (CASHFLOW®). Не связан с правообладателями игры. Для личного некоммерческого использования.';

let sb=null,USER=null,SH=null,CURG=null,FIN=false,LOCK=false,POLL=null,REDRAW=()=>{},SORT='prog',INSTALL=null,PROFILE=null,REC=/type=recovery/.test(location.hash),HIST=[],RT=null;
const meta=()=>(USER&&USER.user_metadata)||{};
const fullName=()=>(PROFILE&&PROFILE.full_name)||meta().name||(USER&&USER.email||'').split('@')[0]||'Игрок';
const nickName=()=>(PROFILE?PROFILE.nick:meta().nick)||'';
const uname=()=>{const d=PROFILE?PROFILE.display:meta().display;const n=nickName();return(d==='nick'&&n)?n:fullName()};
const P=()=>SH;
function render(){REDRAW()}

/* ---------- модель и расчёты ---------- */
function newSheet(){return{name:'',auditor:'',prof:'',salary:0,interest:0,taxes:0,mort:0,edu:0,car:0,cc:0,small:0,other:0,kids:0,perKid:0,loan:0,
  cardSavings:0,savings:0,stocks:[],re:[],biz:[],debt:{mort:0,edu:0,car:0,cc:0,small:0},fast:null,log:[],
  started:false,turn:0,skip:0,charity:0,bankrupt:false,out:false,exitTurn:null,wonAt:null,real:false,cur:'$',
  stats:{doodads:0,doodadSum:0,loans:0,loanSum:0,charity:0,manual:0}}}
function normSheet(p){const d=newSheet();const s=Object.assign(d,p||{});s.stats=Object.assign(d.stats,(p&&p.stats)||{});s.debt=Object.assign(d.debt,(p&&p.debt)||{});['stocks','re','biz','log'].forEach(k=>{if(!Array.isArray(s[k]))s[k]=[]});return s}
function sum(a,k){return a.reduce((t,x)=>t+(+x[k]||0),0)}
function calc(p){
  const div=sum(p.stocks,'div'),re=sum(p.re,'income'),biz=sum(p.biz,'income');
  const ratPassive=(+p.interest||0)+div+re+biz;
  const kidsExp=(+p.kids||0)*(+p.perKid||0),loanPay=(+p.loan||0)/10;
  const exp=EXP.reduce((t,[k])=>t+(+p[k]||0),0)+kidsExp+loanPay;
  let passive,income,cf,goal=null,dreamCost=0;
  if(p.fast){const fb=sum(p.fast.biz,'income');passive=p.fast.start+fb;income=passive;cf=passive;goal=p.fast.start+50000;dreamCost=(+p.fast.dreamCost||0)*(1+(+p.fast.bumps||0))}
  else{passive=ratPassive;income=(+p.salary||0)+passive;cf=income-exp}
  const assets=(+p.savings||0)+(p.started?0:(+p.cardSavings||0))+p.stocks.reduce((t,s)=>t+s.qty*s.price,0)+sum(p.re,'cost')+sum(p.biz,'cost');
  const liab=DEBT.reduce((t,[k])=>t+(+p.debt[k]||0),0)+sum(p.re,'debt')+sum(p.biz,'debt')+(+p.loan||0);
  const won=!!(p.fast&&(passive>=goal||p.fast.dreamBought));
  const prog=goal?Math.min(100,passive/goal*100):(exp?Math.min(100,ratPassive/exp*100):0);
  return{div,re,biz,ratPassive,kidsExp,loanPay,exp,passive,income,cf,goal,dreamCost,assets,liab,won,prog,net:assets-liab}
}
function summ(p){const c=calc(p);return{stage:p.fast?'fast':'rat',won:c.won,passive:Math.round(c.passive),exp:Math.round(c.exp),cf:Math.round(c.cf),net:Math.round(c.net),assets:Math.round(c.assets),liab:Math.round(c.liab),prog:Math.round(c.prog),prof:p.prof||'',savings:Math.round(+p.savings||0),turn:p.turn||0,exitTurn:p.exitTurn,real:!!p.real,wonAt:p.wonAt||null}}

/* ---------- ввод ---------- */
function getRef(path){const a=path.split('.');let o=P();for(let i=0;i<a.length-1;i++)o=o[a[i]];return[o,a[a.length-1]]}
function setv(path,v,type){if(LOCK)return;const[o,k]=getRef(path);o[k]=type==='number'?(parseFloat(String(v).replace(',','.'))||0):v;save();queueRender()}
// Перерисовка с задержкой: иначе кнопка, на которую нажали сразу после правки поля, исчезает из-под пальца
function queueRender(){clearTimeout(RT);RT=setTimeout(()=>{const a=document.activeElement;if(a&&(a.tagName==='INPUT'||a.tagName==='SELECT')&&a.closest&&a.closest('#sheet'))return;render()},500)}
const CARD_KEYS=['salary','interest','taxes','mort','edu','car','cc','small','other','perKid','cardSavings'];
function snapCard(p){const c={};CARD_KEYS.forEach(k=>c[k]=+p[k]||0);c.debt={};DEBT.forEach(([k])=>c.debt[k]=+p.debt[k]||0);return c}
function logm(p,t){
  if(p.log.length===0&&!p.profSaved&&p.prof&&p.card&&+p.card.salary>0&&!p.real){p.profSaved=true;saveProfession(p.prof,p.card,true)}
  p.log.unshift(t);p.log=p.log.slice(0,60)}
function inp(path,val,type='number',cls='',ph=''){return`<input class="${cls}" type="${type==='number'?'number':'text'}" ${type==='number'?'inputmode="decimal" step="any"':''} value="${esc(val)}" placeholder="${ph}" onchange="setv('${path}',this.value,'${type}')">`}
function row(label,path,val){return`<div class="r"><span>${label}</span>${inp(path,val)}</div>`}
function out(label,val){return`<div class="r t"><span>${label}</span><b class="${val<0?'neg':''}">${$$(val)}</b></div>`}

/* ---------- модальное окно ---------- */
let MD=null;
function modal(title,fields,run,o={}){MD={fields,run};
  $('md').innerHTML=`<h3>${title}</h3>${o.note?`<div class="mu" style="margin-bottom:6px;white-space:pre-line">${o.note}</div>`:''}`+fields.map((f,i)=>`<label>${f.l}</label>`+(f.t==='area'?`<textarea id="mf${i}" rows="${f.rows||5}">${esc(f.v??'')}</textarea>`:f.t==='sel'?`<select id="mf${i}" class="fld">${f.o.map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>`:`<input id="mf${i}" type="${f.t==='text'?'text':'number'}" ${f.t==='text'?'':'inputmode="decimal" step="any"'} value="${esc(f.v??'')}">`)).join('')+`<div class="e" id="me"></div><div style="display:flex;gap:8px;margin-top:14px"><button class="p" onclick="mdOk()">${o.ok||'Готово'}</button>${o.nocancel?'':'<button onclick="mdClose()">Отмена</button>'}</div>`;
  $('ov').style.display='flex';const f=$('mf0');if(f&&f.tagName!=='SELECT')f.focus()}
function mdClose(){$('ov').style.display='none';MD=null}
async function mdOk(){
  const v={};MD.fields.forEach((f,i)=>{const x=$('mf'+i).value;v[f.k]=(f.t==='text'||f.t==='area'||f.t==='sel')?x.trim():(parseFloat(String(x).replace(',','.'))||0)});
  let err;try{err=await MD.run(v)}catch(e){err='Ошибка: '+(e.message||e)}
  if(err){$('me').textContent=err;return}mdClose();render()}
function confirmM(title,text,fn,sv){modal(title,[],async()=>{await fn();if(sv)save()},{note:text,ok:'Да'})}
function info(title,text){modal(title,[],()=>null,{note:text,ok:'Ок',nocancel:true})}
document.addEventListener('keydown',e=>{if($('ov').style.display==='flex'){if(e.key==='Enter'&&MD&&e.target.tagName!=='TEXTAREA')mdOk();if(e.key==='Escape')mdClose()}});

/* ---------- профессии ---------- */
async function saveProfession(title,data,silent){
  const {error}=await sb.from('professions').insert({title:title.trim(),data});
  if(silent)return;
  if(error&&/duplicate|unique|23505/i.test(error.code+error.message))info('Профессия уже в списке','Профессия «'+esc(title)+'» уже есть в общем списке.');
  else if(error)info('Не удалось сохранить',esc(error.message));
  else info('Сохранено','Профессия «'+esc(title)+'» добавлена в общий список. Теперь её можно выбрать при заполнении бланка.');
}
const PRESETS=[
['Водитель грузовика',2500,460,400,0,80,60,50,570,140,750,38000,0,4000,2000,1000,880,1620],
['Менеджер',4600,910,700,60,120,90,50,1000,240,400,75000,12000,6000,3000,1000,1670,2930],
['Автомеханик',2000,360,300,0,60,60,50,450,110,670,31000,0,3000,2000,1000,720,1280],
['Дворник',1600,280,200,0,60,60,50,300,70,560,20000,0,4000,2000,1000,650,950],
['Пилот авиалиний',9500,2350,1330,0,300,660,50,2210,480,400,143000,0,15000,22000,1000,2600,6900],
['Инженер',4900,1050,700,60,140,120,50,1090,250,400,75000,12000,7000,4000,1000,1690,3210],
['Секретарь',2500,460,400,0,80,60,50,570,140,710,38000,0,4000,2000,1000,880,1620],
['Врач',13200,3420,1900,750,380,270,50,2880,640,400,202000,150000,19000,9000,1000,3550,9650],
['Офицер полиции',3000,580,400,0,100,60,50,690,160,520,46000,0,5000,2000,1000,1120,1880],
['Учитель',3300,630,500,60,100,90,50,760,180,400,50000,12000,5000,3000,1000,1110,2190],
['Адвокат',7500,1830,1100,390,220,180,50,1650,380,400,115000,78000,11000,6000,1000,2080,5420],
['Медсестра',3100,600,400,30,100,90,50,710,170,480,47000,6000,5000,3000,1000,1120,1980]
].map(a=>({id:'p:'+a[0],title:a[0],data:{salary:a[1],interest:0,taxes:a[2],mort:a[3],edu:a[4],car:a[5],cc:a[6],small:a[7],other:a[8],perKid:a[9],cardSavings:a[10],debt:{mort:a[11],edu:a[12],car:a[13],cc:a[14],small:a[15]}},preset:true,cf:a[16],exp:a[17]}));
async function pickProfession(){
  if(LOCK||SH.started||SH.log.length){info('Нельзя выбрать','Профессию можно выбрать только до получения стартовых денег.');return}
  const {data:db,error}=await sb.from('professions').select('*').order('title');
  if(error)return info('Ошибка',esc(error.message));
  const have=new Set((db||[]).map(r=>r.title.trim().toLowerCase()));
  const data=[...PRESETS.filter(r=>!have.has(r.title.toLowerCase())),...(db||[])];
  modal('Выбрать профессию',[{k:'id',l:'Профессия',t:'sel',o:data.map(r=>[r.id,`${r.title} — зарплата ${$$(r.data.salary||0)}`])}],v=>{
    const r=data.find(x=>x.id===v.id);if(!r)return'Выберите профессию';
    const d=r.data,p=P();p.prof=r.title;CARD_KEYS.forEach(k=>p[k]=+d[k]||0);if(d.savings&&!d.cardSavings)p.cardSavings=+d.savings;DEBT.forEach(([k])=>p.debt[k]=+(d.debt||{})[k]||0);p.profSaved=true;save()
  },{ok:'Применить',note:'Бланк заполнится данными карточки. Сверьте цифры с вашей карточкой «Профессия» и поправьте, если отличаются: данные внесены с карточек игры.'});
}
async function saveProfBtn(){const p=P();if(!p.prof||!(+p.salary>0))return info('Заполните карточку','Укажите профессию и зарплату.');p.profSaved=true;await saveProfession(p.prof,p.log.length&&p.card?p.card:snapCard(p),false)}

/* ---------- ходы игрока ---------- */
function startMoney(){const p=P(),c=calc(p);
  if(!p.prof||!(+p.salary>0))return info('Заполните карточку','Перенесите данные с карточки «Профессия» без изменений: профессия, зарплата, расходы, долги, сбережения.');
  confirmM('Стартовые деньги',`Банкир выдаёт: месячный денежный поток ${$$(c.cf)} + сбережения ${$$(p.cardSavings)} = ${$$(c.cf+p.cardSavings)}.\nПосле получения сбережения на карточке стираются.`,()=>{
    const tot=c.cf+(+p.cardSavings||0);logm(p,`Стартовые деньги: +${$$(tot)}`);p.savings+=tot;p.cardSavings=0;p.started=true},true)}
function payBank(p,amt,why,loanOk=true){
  if(p.savings<amt){
    if(!loanOk)return false;
    const need=Math.ceil((amt-p.savings)/1000)*1000;
    p.loan+=need;p.savings+=need;p.stats.loans++;p.stats.loanSum+=need;logm(p,`Кредит банка +${$$(need)} (чтобы оплатить: ${why}); платёж +${$$(need/10)}/мес`);
  }
  p.savings-=amt;return true;
}
function payday(){
  const p=P(),c=calc(p);if(LOCK)return;
  if(!p.fast&&c.cf<0&&p.savings<-c.cf){
    return confirmM('Банкротство',`Денежный поток отрицательный (${$$(c.cf)}), а наличных не хватает. По правилам вы банкрот:\n• продаёте Банку активы за ½ первого взноса и гасите долги, пока поток не станет положительным;\n• пропускаете 3 хода.\nОбъявить банкротство?`,()=>{p.bankrupt=true;p.skip=3;logm(p,'Банкротство! Пропуск 3 ходов')},true);
  }
  p.savings+=c.cf;logm(p,`${p.fast?'День денежного потока':'Расчётный чек'}: ${c.cf>=0?'+':''}${$$(c.cf)}`);save();render();
}
function nextTurn(){const p=P();if(LOCK)return;p.turn=(p.turn||0)+1;if(p.skip>0)p.skip--;if(p.charity>0&&!p.fast)p.charity--;save();render()}
function undo(){if(LOCK||HIST.length<2)return;HIST.pop();SH=JSON.parse(HIST[HIST.length-1]);dirty=true;SAVEST='pending';clearTimeout(st);st=setTimeout(flush,300);render()}
function adjust(){modal('Изменить наличные вручную',[{k:'a',l:'Сумма (плюс — получили, минус — заплатили)',v:''},{k:'c',l:'Комментарий (обязательно)',t:'text',v:''}],v=>{if(!v.a)return'Введите сумму';if(!v.c)return'Укажите причину — организатор увидит правку в журнале';const p=P();p.savings+=v.a;p.stats.manual++;logm(p,`✋ Ручная правка ${v.a>0?'+':''}${$$(v.a)}: ${v.c}`);save()},{note:'Используйте, если действие не покрыто кнопками. Все ручные правки видны организатору.'})}
function baby(){const p=P();if(LOCK||p.kids>=3)return;p.kids++;logm(p,`👶 Ребёнок (всего ${p.kids}); расходы +${$$(p.perKid)}/мес`);save();render()}
function doodad(){modal('Всякая всячина',[{k:'n',l:'На что потратились',t:'text',v:''},{k:'a',l:'Сумма, '+CUR,v:''}],v=>{
  if(v.a<=0)return'Введите сумму';const p=P();payBank(p,v.a,'Всякая всячина');p.stats.doodads++;p.stats.doodadSum+=v.a;logm(p,`🛍 Всякая всячина: ${v.n||'расход'} −${$$(v.a)}`);save()},{note:'Отказаться нельзя. Если не хватает наличных, будет автоматически взят кредит банка (кратно 1000).'})}
function charityRat(){const p=P(),c=calc(p);if(p.skip>0)return info('Недоступно','На время «Увольнения» привилегия благотворительности отменена.');
  const amt=c.income*0.1;confirmM('Благотворительность',`Пожертвовать 10% общего дохода: ${$$(amt)}. Взамен 3 следующих хода вы бросаете сразу две кости.`,()=>{
    if(p.savings<amt)throw new Error('Не хватает наличных на пожертвование');p.savings-=amt;p.charity=3;p.stats.charity+=amt;logm(p,`❤ Благотворительность −${$$(amt)} (3 хода с двумя кубиками)`)},true)}
function charityFast(){modal('Благотворительность (скоростная дорожка)',[{k:'a',l:'Сумма по карточке/правилам вашей игры, '+CUR,v:0}],v=>{const p=P();if(v.a>p.savings)return'Не хватает наличных';p.savings-=v.a;p.stats.charity+=v.a;p.fast.charity=true;logm(p,`❤ Благотворительность −${$$(v.a)}: до конца игры можно бросать 1, 2 или 3 кости`);save()},{note:'После пожертвования до конца игры можно бросать 1, 2 или 3 кости.'})}
function downsize(){const p=P(),c=calc(p);confirmM('Увольнение',`Заплатите Банку сумму общих расходов (${$$(c.exp)}) и пропустите 2 хода. Привилегия благотворительности отменяется.${p.savings<c.exp?'\nНаличных не хватает — будет взят кредит банка.':''}`,()=>{payBank(p,c.exp,'Увольнение');p.skip=2;p.charity=0;logm(p,`💼 Увольнение: −${$$(c.exp)}, пропуск 2 ходов`)},true)}
function buyStock(){modal('Купить акции / фонды / депозит',[{k:'n',l:'Название',t:'text',v:''},{k:'q',l:'Количество',v:1},{k:'pr',l:'Цена за единицу, '+CUR,v:''},{k:'d',l:'Дивиденд / доход в месяц (всего), '+CUR,v:0}],v=>{
  const p=P(),cost=v.q*v.pr;if(!v.n||v.q<=0||v.pr<=0)return'Заполните название, количество и цену';if(cost>p.savings)return`Не хватает денег: нужно ${$$(cost)}, на руках ${$$(p.savings)}. Купить можно только на наличные — при необходимости возьмите кредит банка.`;
  p.savings-=cost;p.stocks.push({n:v.n,qty:v.q,price:v.pr,div:v.d});logm(p,`Куплено: ${v.n} ${v.q} × ${$$(v.pr)}`);save()})}
const SELLNOTE='Активы продаются только когда это позволяет карточка «Возможность»/«Рынок» или при банкротстве. Продавать активы другим игрокам нельзя.';
function sellStock(i){const s=P().stocks[i];modal('Продать: '+esc(s.n),[{k:'q',l:'Сколько продать (макс. '+s.qty+')',v:s.qty},{k:'pr',l:'Цена продажи за единицу, '+CUR,v:s.price}],v=>{
  if(v.q<=0||v.q>s.qty)return'Неверное количество';const p=P();p.savings+=v.q*v.pr;
  if(s.div)s.div=s.div*(s.qty-v.q)/s.qty;s.qty-=v.q;logm(p,`Продано: ${s.n} ${v.q} × ${$$(v.pr)}`);if(s.qty<=0)p.stocks.splice(i,1);save()},{note:SELLNOTE})}
function splitStock(i){const s=P().stocks[i];modal('Дробление акций: '+esc(s.n),[{k:'k',l:'Операция',t:'sel',o:[['2','Сплит: количество ×2, цена ÷2'],['0.5','Обратный сплит: количество ÷2, цена ×2']]}],v=>{
  const k=parseFloat(v.k),p=P();s.qty=+(s.qty*k).toFixed(2);s.price=+(s.price/k).toFixed(2);logm(p,`Дробление акций ${s.n}: ${k===2?'×2':'÷2'}`);save()},{note:'Количество и цена пересчитаются. Если по акциям были дивиденды, проверьте поле «Див./мес» по карточке.'})}
function buyAsset(kind){const t=kind==='re'?'недвижимость':'бизнес';modal('Купить '+t,[{k:'n',l:'Название',t:'text',v:''},{k:'cost',l:'Цена, '+CUR,v:''},{k:'down',l:'Первый взнос, '+CUR,v:''},{k:'income',l:'Денежный поток в месяц, '+CUR,v:0}],v=>{
  const p=P();if(!v.n||v.cost<=0)return'Заполните название и цену';if(v.down>v.cost)return'Взнос больше цены';if(v.down>p.savings)return`Не хватает денег: взнос ${$$(v.down)}, на руках ${$$(p.savings)}. Возьмите кредит банка.`;
  p.savings-=v.down;p[kind].push({n:v.n,cost:v.cost,down:v.down,debt:v.cost-v.down,income:v.income});logm(p,`Куплено (${t}): ${v.n}, взнос ${$$(v.down)}, поток ${$$(v.income)}/мес`);save()},{note:'Ипотека = цена − первый взнос. Платежи по ипотеке уже учтены в денежном потоке: дополнительно ничего вычитать не нужно. Покупать в складчину нельзя.'})}
function sellAsset(kind,i){const a=P()[kind][i];modal('Продать: '+esc(a.n),[{k:'pr',l:'Цена продажи, '+CUR,v:a.cost}],v=>{const p=P();const res=v.pr-a.debt;p.savings+=res;logm(p,`Продано: ${a.n} за ${$$(v.pr)}, ипотека ${$$(a.debt)}, результат ${res>=0?'+':''}${$$(res)}`);p[kind].splice(i,1);save()},{note:SELLNOTE+'\nФинансовый результат = цена продажи − ипотека.'})}
function delItem(path,i){confirmM('Убрать строку?','Строка удаляется без движения денег (исправление ошибки).',()=>{const a=path.split('.');let o=P();a.forEach(k=>o=o[k]);o.splice(i,1)},true)}
function takeLoan(){modal('Кредит банка',[{k:'a',l:'Сумма (кратно 1000), '+CUR,v:1000}],v=>{if(v.a<=0||v.a%1000)return'Сумма должна быть кратна 1000';const p=P();p.loan+=v.a;p.savings+=v.a;p.stats.loans++;p.stats.loanSum+=v.a;logm(p,`Кредит банка +${$$(v.a)} (платёж +${$$(v.a/10)}/мес)`);save()},{note:'Ставка 10% в месяц: платёж $100 на каждую $1000. Проценты платятся до полного погашения кредита.'})}
function repayLoan(){const p=P();modal('Погасить кредит банка',[{k:'a',l:`Сумма (кратно 1000, долг ${$$(p.loan)}), ${CUR}`,v:Math.min(1000,p.loan)}],v=>{if(v.a<=0||v.a%1000||v.a>p.loan)return'Сумма кратна 1000 и не больше долга';if(v.a>p.savings)return'Не хватает денег';p.loan-=v.a;p.savings-=v.a;logm(p,`Погашено кредита банка ${$$(v.a)}; платёж −${$$(v.a/10)}/мес`);save()})}
function payDebt(k,name){const p=P(),d=p.debt[k];if(!d)return;confirmM('Погасить: '+name,`Долги, кроме банковских, погашаются сразу и полностью: ${$$(d)}. Платёж по этой статье (${$$(p[k])}/мес) обнулится.${p.savings<d?'\nНе хватает наличных.':''}`,()=>{
  if(p.savings<d)throw new Error('Не хватает наличных');p.savings-=d;p.debt[k]=0;p[k]=0;logm(p,`Погашено полностью: ${name} ${$$(d)}`)},true)}
function sellToBank(){const p=P();const opts=[];
  p.stocks.forEach((s,i)=>opts.push(['s'+i,`${s.n} (акции) → ${$$(s.qty*s.price/2)}`]));
  p.re.forEach((a,i)=>opts.push(['r'+i,`${a.n} (недвижимость) → ${$$(a.down/2)}`]));
  p.biz.forEach((a,i)=>opts.push(['b'+i,`${a.n} (бизнес) → ${$$(a.down/2)}`]));
  if(!opts.length)return info('Нет активов','Продавать нечего. Если поток всё ещё отрицательный, сократите долги вдвое.');
  modal('Продать актив Банку',[{k:'a',l:'Актив (получите ½ первого взноса)',t:'sel',o:opts}],v=>{
    const t=v.a[0],i=+v.a.slice(1);let get=0,nm='';
    if(t==='s'){const s=p.stocks[i];get=s.qty*s.price/2;nm=s.n;p.stocks.splice(i,1)}
    else{const k=t==='r'?'re':'biz';const a=p[k][i];get=a.down/2;nm=a.n;p[k].splice(i,1)}
    p.savings+=get;logm(p,`Банкротство: продано банку ${nm} за ${$$(get)} (½ взноса). Ипотека по объекту исчезает вместе с ним`);save()},{note:'Полученные деньги используйте для погашения долгов (кнопки «Погасить»), пока месячный денежный поток не станет положительным.'})}
function halveDebts(){const p=P();confirmM('Сократить долги вдвое','Если после продажи всех активов поток всё ещё отрицательный: кредиты на машину, долги по карточкам и мелкие долги, а также их платежи сокращаются вдвое. Ипотека и кредит на образование не меняются.',()=>{
  ['car','cc','small'].forEach(k=>{p.debt[k]=p.debt[k]/2;p[k]=p[k]/2});logm(p,'Банкротство: долги (авто, карточки, мелкие) и платежи сокращены вдвое')},true)}
function endBankrupt(){const p=P(),c=calc(p);if(c.cf<0)return info('Поток ещё отрицательный',`Месячный денежный поток ${$$(c.cf)}. Продавайте активы Банку и гасите долги. Если после этого поток остаётся отрицательным, вы выбываете из игры.`);p.bankrupt=false;logm(p,'Банкротство завершено: поток положительный');save();render()}
function dropOut(){confirmM('Выбыть из игры?','Если после всех мер месячный денежный поток отрицательный, вы выбываете. Бланк станет только для чтения.',async()=>{const p=P();p.out=true;logm(p,'Выбыл из игры (банкротство)');FIN=true;SAVEST='pending';await persist();SAVEST='ok'})}
function exitRace(){const p=P(),c=calc(p);const old=Math.round(c.ratPassive/1000)*1000;
  confirmM('Выход на скоростную дорожку',`Пассивный доход ${$$(c.ratPassive)} → округляем до ${$$(old)}, ×100 = ${$$(old*100)} — новый доход в День денежного потока.\nВы сразу получаете эту сумму от Банка. Цель: купить Мечту или прибавить к начальному доходу ${$$(50000)}. Кредиты на скоростной дорожке брать нельзя.`,()=>{
    p.fast={old,start:old*100,biz:[],dreamName:'',dreamCost:0,bumps:0,dreamBought:false,charity:false};p.exitTurn=p.turn||0;p.savings+=old*100;p.charity=0;logm(p,`🚀 Вышел на скоростную дорожку (ход ${p.turn||0}). Начальный доход ${$$(old*100)} получен`)},true)}
function buyFast(){modal('Купить предприятие (скоростная дорожка)',[{k:'n',l:'Название',t:'text',v:''},{k:'cost',l:'Первый взнос (цена), '+CUR,v:''},{k:'income',l:'Денежный поток в месяц, '+CUR,v:''}],v=>{const p=P();if(!v.n||v.cost<=0)return'Заполните название и цену';if(v.cost>p.savings)return`Не хватает денег: нужно ${$$(v.cost)}, на руках ${$$(p.savings)}`;p.savings-=v.cost;p.fast.biz.push({n:v.n,cost:v.cost,income:v.income});logm(p,`Предприятие: ${v.n}, взнос ${$$(v.cost)}, +${$$(v.income)}/мес`);save()})}
function setDream(){const f=P().fast;modal('Ваша Мечта',[{k:'n',l:'Название мечты',t:'text',v:f.dreamName||''},{k:'c',l:'Цена, '+CUR,v:f.dreamCost||''}],v=>{if(!v.n||v.c<=0)return'Укажите название и цену';f.dreamName=v.n;f.dreamCost=v.c;logm(P(),`Мечта: ${v.n}, ${$$(v.c)}`);save()})}
function bumpDream(){const f=P().fast;if(!f.dreamCost)return info('Сначала укажите Мечту','Нажмите «Выбрать Мечту».');confirmM('Жетон соперника на вашей Мечте','Другой игрок заплатил за вашу Мечту: её цена для вас растёт на 100% от первоначальной.',()=>{f.bumps=(f.bumps||0)+1;logm(P(),`Цена Мечты выросла: ${$$(f.dreamCost*(1+f.bumps))}`)},true)}
function buyDream(){const p=P(),f=p.fast,c=calc(p);if(!f.dreamCost)return info('Сначала укажите Мечту','Нажмите «Выбрать Мечту».');
  confirmM('Купить Мечту',`Цена: ${$$(c.dreamCost)}. На руках: ${$$(p.savings)}.${p.savings<c.dreamCost?'\nНе хватает денег.':'\nКто первым купит Мечту, тот побеждает.'}`,()=>{
    if(p.savings<c.dreamCost)throw new Error('Не хватает денег');p.savings-=c.dreamCost;f.dreamBought=true;logm(p,`🏆 Куплена Мечта «${f.dreamName}» за ${$$(c.dreamCost)}`)},true)}
function fastEvent(kind){const p=P();const cfg={tax:['Налоговая проверка','Вы платите 1/2 наличных.',()=>Math.floor(p.savings/2),'Налоговая проверка'],div:['Развод','Вы теряете все наличные.',()=>p.savings,'Развод'],law:['Судебный иск','Вы теряете 1/2 наличных.',()=>Math.floor(p.savings/2),'Судебный иск']}[kind];
  confirmM(cfg[0],cfg[1]+` Сейчас на руках ${$$(p.savings)}.`,()=>{const a=cfg[2]();p.savings-=a;logm(p,`${cfg[3]}: −${$$(a)}`)},true)}
function setCur(v){SH.cur=v;CUR=v;save();render()}

/* ---------- отчёт для разбора ---------- */
function reportText(p){
  const c=calc(p),L=[];
  L.push(`Отчёт игрока: ${p.name||'—'}${p.prof?' ('+p.prof+')':''}`);
  L.push(`Этап: ${p.fast?'скоростная дорожка':'крысиные бега'}${c.won?' — ПОБЕДА':''}${p.out?' — выбыл (банкротство)':''}; ходов: ${p.turn||0}${p.exitTurn!=null?`; вышел на ходу ${p.exitTurn}`:''}`);
  L.push(`Доход ${$$(c.income)}, расход ${$$(c.exp)}, денежный поток ${$$(c.cf)}`);
  L.push(`Пассивный доход ${$$(c.passive)}${p.fast?`, цель ${$$(c.goal)}`:`, покрытие расходов ${c.exp?Math.round(c.ratPassive/c.exp*100):0}%`}`);
  L.push(`Наличные ${$$(p.savings)}; активы ${$$(c.assets)}; пассивы ${$$(c.liab)}; чистая стоимость ${$$(c.net)}`);
  const A=[...p.stocks.map(s=>`${s.n} ${s.qty}×${$$(s.price)}`),...p.re.map(a=>`${a.n} (взнос ${$$(a.down)}, поток ${$$(a.income)})`),...p.biz.map(a=>`${a.n} (взнос ${$$(a.down)}, поток ${$$(a.income)})`),...((p.fast&&p.fast.biz)||[]).map(a=>`${a.n} (скоростная: взнос ${$$(a.cost)}, поток ${$$(a.income)})`)];
  L.push('Активы: '+(A.join('; ')||'нет'));
  L.push(`Всякая всячина: ${p.stats.doodads} раз на ${$$(p.stats.doodadSum)}; кредитов банка: ${p.stats.loans} на ${$$(p.stats.loanSum)} (долг сейчас ${$$(p.loan)}); благотворительность: ${$$(p.stats.charity)}; ручных правок: ${p.stats.manual}`);
  const idle=c.assets?Math.round(p.savings/c.assets*100):0;
  L.push(`Доля «мёртвых» наличных в активах: ${idle}%`);
  L.push('Журнал (от старых к новым):');
  [...p.log].reverse().forEach(t=>L.push('- '+t));
  return L.join('\n');
}
function showReport(p){const t=reportText(p||SH);modal('Отчёт для разбора',[{k:'t',l:'Скопируйте и отправьте наставнику или ИИ-ассистенту для обратной связи',t:'area',v:t,rows:12}],()=>{try{navigator.clipboard.writeText(t)}catch(e){}return null},{ok:'Скопировать и закрыть'})}
function showPolicy(){modal('Согласие на обработку персональных данных',[],()=>null,{ok:'Закрыть',nocancel:true,note:`ШАБЛОН: перед запуском согласуйте текст с юристом (закон РК «О персональных данных и их защите», требования к хранению и трансграничной передаче).

Оператор: [наименование / ФИО, контакт].
Какие данные: имя и фамилия, никнейм, email, номер телефона WhatsApp, данные ваших игр (бланки, результаты).
Зачем: регистрация и вход, проведение игр, ваша статистика, показ данных организатору вашей игры (имя, никнейм, бланк); при отдельной галочке — новости о проекте C4%.
Где хранятся: сервис Supabase (облачная база данных).
Срок: пока действует аккаунт; вы можете изменить данные в разделе «Профиль» или попросить удалить аккаунт по контакту оператора.
Согласие на новости отдельное и необязательное; его можно снять в «Профиле».`})}

/* ---------- бланк ---------- */
function listTable(head,rows){return`<table><tr>${head.map(h=>`<th>${h}</th>`).join('')}<th></th></tr>${rows}</table>`}
const roi=a=>a.down>0?Math.round(a.income*12/a.down*100)+'%':'—';
function assetTable(p,kind){if(!p[kind].length)return'<div class="mu">нет</div>';
  return listTable(['Название','Взнос','Цена','Долг','Поток/мес','ROI'],p[kind].map((a,i)=>`<tr><td>${inp(kind+'.'+i+'.n',a.n,'text','w')}</td><td style="width:62px">${inp(kind+'.'+i+'.down',a.down,'number','w')}</td><td style="width:70px">${inp(kind+'.'+i+'.cost',a.cost,'number','w')}</td><td style="width:70px">${inp(kind+'.'+i+'.debt',a.debt,'number','w')}</td><td style="width:70px">${inp(kind+'.'+i+'.income',a.income,'number','w')}</td><td class="mu">${roi(a)}</td><td style="white-space:nowrap"><button class="s" onclick="sellAsset('${kind}',${i})">Продать</button> <button class="x" onclick="delItem('${kind}',${i})">✕</button></td></tr>`).join(''))}
function sheet(p,ro){
  const c=calc(p),real=!!p.real;
  let h=`<div class="top">${inp('prof',p.prof,'text','','Профессия')}${inp('name',p.name,'text','','Ваше имя')}${inp('auditor',p.auditor,'text','','Аудитор (игрок справа)')}</div>`;
  if(!ro){
    if(real){
      h+=`<div class="banner in">Режим «реальный кэш-флоу»: внесите свои настоящие доходы, расходы, активы и долги. Так по правилам игры проверяют, смогли бы вы вырваться из крысиных бегов в реальной жизни.</div>
      <div class="acts"><select onchange="setCur(this.value)">${['₸','$','₽','€'].map(x=>`<option ${p.cur===x?'selected':''}>${x}</option>`).join('')}</select><button onclick="adjust()">± Наличные</button><button onclick="undo()" ${HIST.length>1?'':'disabled'}>↶ Отменить</button><button onclick="showReport()">📋 Отчёт</button></div>`;
    }else if(!p.started){
      h+=`<div class="banner in">Шаг 1. Перенесите карточку «Профессия» на бланк без изменений (до первого хода профессию можно выбрать из списка). Шаг 2. Получите у банкира стартовые деньги: месячный денежный поток + сбережения.<br>Начинаете игру без банковских кредитов и без детей.</div>
      <div class="acts"><button onclick="pickProfession()">📋 Выбрать профессию из списка</button><button onclick="saveProfBtn()">💾 Сохранить профессию в список</button><button class="g" onclick="startMoney()">🏦 Получить стартовые деньги (${$$(c.cf+(+p.cardSavings||0))})</button></div>`;
    }else if(!p.out){
      h+=`<div class="acts"><button class="g" onclick="payday()">💵 ${p.fast?'День денежного потока':'Расчётный чек'} (${$$(c.cf)})</button><button onclick="nextTurn()">🎲 Следующий ход (№${(p.turn||0)+1})</button><button onclick="undo()" ${HIST.length>1?'':'disabled'}>↶ Отменить</button><button onclick="adjust()">± Наличные</button><button onclick="showReport()">📋 Отчёт</button></div>`;
      if(!p.fast)h+=`<div class="acts"><button onclick="buyStock()">Акции/фонды</button><button onclick="buyAsset('re')">Недвижимость</button><button onclick="buyAsset('biz')">Бизнес</button><button onclick="doodad()">🛍 Всякая всячина</button><button onclick="charityRat()">❤ Благотворительность</button><button onclick="baby()" ${p.kids>=3?'disabled':''}>👶 Ребёнок (${p.kids}/3)</button><button onclick="downsize()">💼 Увольнение</button><button onclick="takeLoan()">Взять кредит</button><button onclick="repayLoan()" ${p.loan?'':'disabled'}>Погасить кредит</button></div>`;
      else h+=`<div class="acts"><button onclick="buyFast()">Купить предприятие</button><button onclick="setDream()">⭐ Выбрать Мечту</button><button class="p" onclick="buyDream()">🏆 Купить Мечту</button><button onclick="bumpDream()">+100% к Мечте (жетон соперника)</button><button onclick="charityFast()">❤ Благотворительность</button><button onclick="fastEvent('tax')">Налоговая проверка</button><button onclick="fastEvent('div')">Развод</button><button onclick="fastEvent('law')">Судебный иск</button></div>`;
    }
  }
  if(!real){
    if(p.out)h+=`<div class="banner no">Вы выбыли из игры (банкротство).</div>`;
    if(p.bankrupt&&!p.out)h+=`<div class="banner no">Банкротство. Продайте Банку активы за ½ первого взноса и погасите долги, пока месячный денежный поток не станет положительным; затем пропустите ходы.${ro?'':'<div class="acts" style="margin:8px 0 0"><button onclick="sellToBank()">Продать актив Банку</button><button onclick="halveDebts()">Сократить долги вдвое</button><button onclick="endBankrupt()">Завершить банкротство</button><button class="x" onclick="dropOut()">Выбыть из игры</button></div>'}</div>`;
    if(p.skip>0)h+=`<div class="banner no">⏭ Пропустите ходов: ${p.skip}</div>`;
    if(p.charity>0&&!p.fast)h+=`<div class="banner in">❤ Благотворительность: ещё ${p.charity} ход(а) бросайте две кости</div>`;
    if(p.fast&&p.fast.charity)h+=`<div class="banner in">❤ Благотворительность: можно бросать 1, 2 или 3 кости</div>`;
    if(p.started&&!p.fast&&!p.out&&!p.bankrupt&&(c.exp>0||c.ratPassive>0)){
      const ok=c.ratPassive>c.exp&&c.exp>0;
      h+=`<div class="banner ${ok?'ok':'no'}">${ok?'✅ Пассивный доход превысил расходы — в начале хода можно выйти на скоростную дорожку!':`Крысиные бега: пассивный доход ${$$(c.ratPassive)} из ${$$(c.exp)} расходов (не хватает ${$$(Math.max(0,c.exp-c.ratPassive))})`}</div>${ok&&!ro?'<div class="acts"><button class="p" onclick="exitRace()">🚀 Выйти на скоростную дорожку</button></div>':''}`;
    }
    if(p.fast){
      h+=`<div class="banner ${c.won?'ok':'no'}">${c.won?'🏆 Победа! Цель достигнута.':`Скоростная дорожка. Цель: Мечта (${p.fast.dreamCost?$$(c.dreamCost):'не выбрана'}) или доход в День денежного потока ${$$(c.goal)} (ещё ${$$(c.goal-c.passive)}).`}</div>`;
    }
  }
  if(!p.fast){
    h+=`<div class="cols"><div>
    <div class="sec"><h2>Доходы</h2><div class="b">${row('Зарплата','salary',p.salary)}${row('Проценты','interest',p.interest)}
      <div class="r"><span>Дивиденды (из акций)</span><b>${$$(c.div)}</b></div><div class="r"><span>Недвижимость</span><b>${$$(c.re)}</b></div><div class="r"><span>Бизнес и предприятия</span><b>${$$(c.biz)}</b></div></div></div>
    <div class="sec"><h2>Расходы</h2><div class="b">${EXP.map(([k,l])=>row(l,k,p[k])).join('')}
      <div class="r"><span>Детей (не более 3)</span><b>${p.kids}</b></div>${row('Расходы на одного ребёнка','perKid',p.perKid)}
      <div class="r"><span>Расходы на детей</span><b>${$$(c.kidsExp)}</b></div><div class="r"><span>Оплата кредита банка (10%)</span><b>${$$(c.loanPay)}</b></div></div></div>
    </div><div>
    <div class="sec"><h2>Итоги</h2><div class="b">
      <div class="r"><span>Пассивный доход (проценты + дивиденды + аренда + бизнес)</span><b class="big pos">${$$(c.ratPassive)}</b></div>
      <div class="r"><span>Общий доход</span><b>${$$(c.income)}</b></div>
      <div class="r"><span>Общий расход</span><b>${$$(c.exp)}</b></div>
      ${out('Месячный денежный поток',c.cf)}
      ${!p.started&&!real?row('Сбережения по карточке (выдаются при старте)','cardSavings',p.cardSavings):''}
      <div class="r"><span>Деньги на руках (наличные)</span>${inp('savings',p.savings)}</div></div></div>
    `;
  }else{
    const f=p.fast;
    h+=`<div class="cols"><div>
    <div class="sec"><h2>Скоростная дорожка — финансовый отчёт</h2><div class="b">
      <div class="r"><span>Старый пассивный доход (округл. до тысяч)</span><b>${$$(f.old)}</b></div>
      <div class="r"><span>Начальный доход в День денежного потока (× 100)</span><b>${$$(f.start)}</b></div>
      ${f.biz.length?listTable(['Предприятие','Поток / мес'],f.biz.map((b,i)=>`<tr><td>${inp('fast.biz.'+i+'.n',b.n,'text','w')}</td><td style="width:110px">${inp('fast.biz.'+i+'.income',b.income,'number','w')}</td><td style="width:34px"><button class="x" onclick="delItem('fast.biz',${i})">✕</button></td></tr>`).join('')):'<div class="mu">Предприятий пока нет</div>'}
      ${out('Доход в День денежного потока',c.passive)}
      <div class="r"><span>Нужно для победы (начальный + ${$$(50000)})</span><b>${$$(c.goal)}</b></div>
      <div class="r"><span>Мечта: ${esc(f.dreamName||'не выбрана')}${f.bumps?` (жетонов соперников: ${f.bumps})`:''}</span><b>${f.dreamCost?$$(c.dreamCost):'—'}${f.dreamBought?' ✔':''}</b></div>
      <div class="r"><span>Деньги на руках</span>${inp('savings',p.savings)}</div></div></div>
    </div><div>`;
  }
  h+=`<div class="sec"><h2>Журнал</h2><div class="b log">${p.log.length?p.log.map(t=>`<div>${esc(t)}</div>`).join(''):'Пока пусто'}</div></div></div></div>`;
  if(!p.fast){
    h+=`<div class="sec"><h2>Балансовый отчёт</h2><div class="b"><div class="cols"><div>
      <b>Активы</b>
      <div class="r"><span>Сбережения / наличные</span><b>${$$(p.savings)}</b></div>
      <div class="mu" style="margin-top:6px">Акции / фонды / депозиты</div>
      ${p.stocks.length?listTable(['Название','Кол-во','Цена','Див./мес'],p.stocks.map((s,i)=>`<tr><td>${inp('stocks.'+i+'.n',s.n,'text','w')}</td><td style="width:62px">${inp('stocks.'+i+'.qty',s.qty,'number','w')}</td><td style="width:70px">${inp('stocks.'+i+'.price',s.price,'number','w')}</td><td style="width:70px">${inp('stocks.'+i+'.div',s.div,'number','w')}</td><td style="white-space:nowrap"><button class="s" onclick="sellStock(${i})">Продать</button> <button class="s" onclick="splitStock(${i})">Сплит</button> <button class="x" onclick="delItem('stocks',${i})">✕</button></td></tr>`).join('')):'<div class="mu">нет</div>'}
      <div class="mu" style="margin-top:8px">Недвижимость</div>
      ${assetTable(p,'re')}
      <div class="mu" style="margin-top:8px">Бизнес</div>
      ${assetTable(p,'biz')}
      <div class="r t"><span>Всего активов</span><b>${$$(c.assets)}</b></div>
    </div><div>
      <b>Пассивы</b>
      ${DEBT.map(([k,l])=>`<div class="r"><span>${l}</span>${inp('debt.'+k,p.debt[k])}<button class="s" onclick="payDebt('${k}','${l}')" ${p.debt[k]?'':'disabled'}>Погасить</button></div>`).join('')}
      <div class="r"><span>Ипотека недвижимости</span><b>${$$(sum(p.re,'debt'))}</b></div>
      <div class="r"><span>Пассивы (бизнес)</span><b>${$$(sum(p.biz,'debt'))}</b></div>
      <div class="r"><span>Кредит банка</span><b>${$$(p.loan)}</b></div>
      <div class="r t"><span>Всего пассивов</span><b>${$$(c.liab)}</b></div>
      ${out('Чистая стоимость (активы − пассивы)',c.net)}
    </div></div></div></div>`;
  }
  return h;
}
function roHtml(p){const t=SH,tc=CUR;SH=p;CUR=p.cur||'$';try{return sheet(p,true)}finally{SH=t;CUR=tc}}
function lockInputs(el){if(el)el.querySelectorAll('input,select,button').forEach(e=>e.disabled=true)}

/* ---------- сохранение бланка ---------- */
let st=null,dirty=false,inflight=false,SAVEST='ok';
function pushHist(){const s=JSON.stringify(SH);if(HIST[HIST.length-1]!==s){HIST.push(s);if(HIST.length>40)HIST.shift()}}
function save(){
  if(LOCK||!CURG)return;
  if(!SH.log.length)SH.card=snapCard(SH);
  const c=calc(SH);
  if(c.won&&!SH.wonAt){SH.wonAt=Date.now();SH.log.unshift('🏆 Победа!')}
  pushHist();dirty=true;SAVEST='pending';stat();clearTimeout(st);st=setTimeout(flush,700);
}
async function flush(){
  if(!dirty||!CURG)return;
  if(inflight){st=setTimeout(flush,400);return}
  inflight=true;dirty=false;
  const {error}=await persist();
  inflight=false;
  SAVEST=error?'err':(dirty?'pending':'ok');stat();
  if(error)dirty=true;
}
async function persist(){
  return sb.from('game_players').upsert({game_id:CURG.id,user_id:USER.id,name:SH.name||uname(),full_name:fullName(),nick:nickName(),sheet:SH,summary:summ(SH),finished:FIN,updated_at:new Date().toISOString()},{onConflict:'game_id,user_id'});
}
function stat(){const e=$('sv');if(!e)return;const m={ok:['ok','Сохранено ✓'],pending:['','Сохранение…'],err:['no','Нет связи — повторю при следующем действии']}[SAVEST];e.className='pill '+m[0];e.textContent=m[1]}
window.addEventListener('visibilitychange',()=>{if(document.hidden&&dirty)flush()});
window.addEventListener('online',()=>{if(dirty)flush()});

/* ---------- каркас ---------- */
function view(html){clearInterval(POLL);$('app').innerHTML=`<div class="wrap">${html}</div>`}
function topbar(back,title,extra=''){return`<div class="hdr">${back?`<button onclick="location.hash='${back}'">←</button>`:''}<h1>${title}</h1><span class="sp"></span>${extra}</div>`}
function fail(e){view(`<div class="banner no">Ошибка: ${esc(e&&e.message||e)}</div><button onclick="route()">Повторить</button>`)}
const foot=()=>`<p class="mu" style="margin-top:24px">${DISCLAIMER}</p>`;
const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent),isStandalone=(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||navigator.standalone;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();INSTALL=e;const b=$('inst');if(b)b.style.display=''});
async function doInstall(){if(!INSTALL)return;INSTALL.prompt();try{await INSTALL.userChoice}catch(e){}INSTALL=null;const b=$('inst');if(b)b.style.display='none'}

/* ---------- вход, регистрация, профиль ---------- */
let AUTHMODE='in';
const PHONE_HINT='+7 7XX XXX XX XX';
function normPhone(v){const digits=String(v||'').replace(/\D/g,'');if(digits.length<10||digits.length>15)return null;return '+'+(digits.length===11&&digits[0]==='8'?'7'+digits.slice(1):digits)}
function profFields(p){return`
  <input class="fld" id="fn" placeholder="Имя и Фамилия" autocomplete="name" value="${esc(p.name||'')}">
  <input class="fld" id="fk" placeholder="Никнейм (необязательно)" autocomplete="nickname" value="${esc(p.nick||'')}">
  <div class="mu" style="margin-top:6px">Как показывать вас другим игрокам и в итогах:</div>
  <label class="r"><input type="radio" name="fd" value="name" ${p.display!=='nick'?'checked':''}><span>Имя и фамилия</span></label>
  <label class="r"><input type="radio" name="fd" value="nick" ${p.display==='nick'?'checked':''}><span>Никнейм</span></label>
  <div class="mu">Организатор игры всегда видит и имя, и никнейм.</div>
  <input class="fld" id="fp" type="tel" placeholder="Телефон WhatsApp (${PHONE_HINT})" autocomplete="tel" value="${esc(p.phone||'')}">
  <label class="r" style="align-items:flex-start;margin-top:6px"><input type="checkbox" id="fpd" ${p.pd?'checked':''}><span>Согласен на <a href="#" onclick="showPolicy();return false">обработку персональных данных</a> (обязательно)</span></label>
  <label class="r" style="align-items:flex-start"><input type="checkbox" id="fnw" ${p.news?'checked':''}><span>Хочу получать информацию и новости о проекте C4%</span></label>`}
function readProf(){
  const name=$('fn').value.trim(),nick=$('fk').value.trim(),display=(document.querySelector('input[name=fd]:checked')||{}).value||'name';
  const phone=normPhone($('fp').value),news=$('fnw').checked,pd=$('fpd').checked;
  if(name.split(/\s+/).filter(Boolean).length<2)return{err:'Введите имя и фамилию'};
  if(display==='nick'&&!nick)return{err:'Вы выбрали показ никнейма — введите никнейм'};
  if(!phone)return{err:'Введите номер WhatsApp в международном формате, например '+PHONE_HINT};
  if(!pd)return{err:'Необходимо согласие на обработку персональных данных'};
  return{name,nick,display,phone,news,pd};
}
function authScreen(){
  view(`<div class="auth"><h1 style="text-align:center;margin-bottom:6px">Финансовое мышление С4%</h1><p class="mu" style="text-align:center">бланк игрока для игры «Денежный поток» · статистика ваших игр</p>
  <div class="tabs" style="justify-content:center"><button class="${AUTHMODE==='in'?'on':''}" onclick="AUTHMODE='in';authScreen()">Вход</button><button class="${AUTHMODE==='up'?'on':''}" onclick="AUTHMODE='up';authScreen()">Регистрация</button></div>
  ${AUTHMODE==='up'?profFields({}):''}
  <input class="fld" id="ae" type="email" placeholder="Email" autocomplete="email">
  <input class="fld" id="ap" type="password" placeholder="Пароль (не меньше 6 символов)" autocomplete="${AUTHMODE==='up'?'new-password':'current-password'}">
  <button class="p fld" id="ab" onclick="doAuth()">${AUTHMODE==='in'?'Войти':'Зарегистрироваться'}</button>
  ${AUTHMODE==='in'?'<div style="text-align:center;margin-top:8px"><button class="lnk" onclick="forgot()">Забыли пароль?</button></div>':''}
  <div class="err" id="ae2"></div>${foot()}</div>`);
  ['ae','ap'].forEach(i=>{const e=$(i);if(e)e.addEventListener('keydown',ev=>{if(ev.key==='Enter')doAuth()})});
}
async function doAuth(){
  const email=$('ae').value.trim(),password=$('ap').value;
  const er=$('ae2');er.textContent='';er.style.color='';
  if(!email||password.length<6){er.textContent='Введите email и пароль (не меньше 6 символов)';return}
  let pf=null;
  if(AUTHMODE==='up'){pf=readProf();if(pf.err){er.textContent=pf.err;return}}
  $('ab').disabled=true;
  try{
    if(AUTHMODE==='up'){
      const {data,error}=await sb.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname,data:{name:pf.name,nick:pf.nick,display:pf.display,phone:pf.phone,news:pf.news,pd:true}}});
      if(error)throw error;
      if(!data.session){er.style.color='var(--in)';er.textContent='Письмо отправлено. Подтвердите email по ссылке из письма и войдите.';$('ab').disabled=false;return}
    }else{
      const {error}=await sb.auth.signInWithPassword({email,password});
      if(error)throw error;
    }
  }catch(e){
    const m=String(e.message||e);
    er.textContent=/Invalid login/i.test(m)?'Неверный email или пароль':/already registered/i.test(m)?'Этот email уже зарегистрирован — войдите':/Email not confirmed/i.test(m)?'Подтвердите email по ссылке из письма':m;
    $('ab').disabled=false;
  }
}
async function logout(){PROFILE=null;await sb.auth.signOut()}
function forgot(){modal('Восстановление пароля',[{k:'e',l:'Email, указанный при регистрации',t:'text',v:($('ae')&&$('ae').value)||''}],async v=>{
  if(!/^\S+@\S+\.\S+$/.test(v.e))return'Введите корректный email';
  const {error}=await sb.auth.resetPasswordForEmail(v.e,{redirectTo:location.origin+location.pathname});
  if(error)return error.message;
  setTimeout(()=>info('Письмо отправлено','Откройте письмо и перейдите по ссылке, чтобы задать новый пароль. Проверьте папку «Спам».'),50);return null},{ok:'Отправить ссылку'})}
function recoveryScreen(){
  view(`<div class="auth"><h1 style="text-align:center">Новый пароль</h1><input class="fld" id="np" type="password" placeholder="Новый пароль (не меньше 6 символов)" autocomplete="new-password"><button class="p fld" onclick="setNewPass()">Сохранить пароль</button><div class="err" id="ae2"></div></div>`);
}
async function setNewPass(){
  const p=$('np').value;if(p.length<6){$('ae2').textContent='Не меньше 6 символов';return}
  const {error}=await sb.auth.updateUser({password:p});
  if(error){$('ae2').textContent=error.message;return}
  REC=false;history.replaceState(null,'',location.pathname);location.hash='#/';route();
}
async function ensureProfile(){
  if(PROFILE&&PROFILE.id===USER.id)return;
  const {data,error}=await sb.from('profiles').select('*').eq('id',USER.id).maybeSingle();
  if(error)throw error;
  if(data){PROFILE=data;return}
  const m=meta(),now=new Date().toISOString();
  const row={id:USER.id,full_name:m.name||(USER.email||'').split('@')[0],nick:m.nick||'',display:(m.display==='nick'&&m.nick)?'nick':'name',phone:m.phone||'',news:!!m.news,news_at:m.news?now:null,pd_consent_at:m.pd?now:null};
  const r=await sb.from('profiles').upsert(row).select().single();
  if(r.error)throw r.error;PROFILE=r.data;
}
async function profileScreen(){
  await ensureProfile();
  const p=PROFILE;
  REDRAW=()=>{};
  view(`${topbar('#/','Профиль')}<div class="auth" style="margin-top:0">${profFields({name:p.full_name,nick:p.nick,display:p.display,phone:p.phone,news:p.news,pd:!!p.pd_consent_at})}
  <div class="mu" style="margin-top:6px">Email: ${esc(USER.email||'')}</div>
  <button class="p fld" style="margin-top:10px" onclick="saveProfile()">Сохранить</button><div class="err" id="ae2"></div></div>`);
}
async function saveProfile(){
  const er=$('ae2');er.style.color='';er.textContent='';
  const pf=readProf();if(pf.err){er.textContent=pf.err;return}
  const row={full_name:pf.name,nick:pf.nick,display:pf.display,phone:pf.phone,news:pf.news};
  if(pf.news!==!!PROFILE.news)row.news_at=pf.news?new Date().toISOString():null;
  if(!PROFILE.pd_consent_at)row.pd_consent_at=new Date().toISOString();
  const {data,error}=await sb.from('profiles').update(row).eq('id',USER.id).select().single();
  if(error){er.textContent=error.message;return}
  PROFILE=data;er.style.color='var(--in)';er.textContent='Сохранено ✓';
}

/* ---------- главная и статистика ---------- */
function codeGen(){const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let s='';for(let i=0;i<5;i++)s+=A[Math.floor(Math.random()*A.length)];return s}
async function createGame(title){
  for(let i=0;i<6;i++){
    const {data,error}=await sb.from('games').insert({code:codeGen(),title}).select().single();
    if(!error)return data;
    if(!/duplicate|unique/i.test(error.message))throw error;
  }
  throw new Error('Не удалось создать код игры, попробуйте ещё раз');
}
function newGameModal(){modal('Организовать игру',[{k:'t',l:'Название (например, «Пятничный стол»)',t:'text',v:''}],async v=>{
  const g=await createGame(v.t||'Игра '+new Date().toLocaleDateString('ru-RU'));location.hash='#/host/'+g.id;return null},{ok:'Создать',note:'Вы станете организатором: увидите бланки всех, кто войдёт по коду.'})}
function soloModal(){modal('Личная игра',[{k:'t',l:'Название',t:'text',v:'Личная игра'}],async v=>{
  const g=await createGame(v.t||'Личная игра');location.hash='#/game/'+g.id;return null},{ok:'Начать',note:'Игра только для вас: результат попадёт в вашу статистику.'})}
async function realGame(){try{const g=await createGame('💼 Мой реальный кэш-флоу');location.hash='#/game/'+g.id}catch(e){fail(e)}}
function joinModal(){modal('Присоединиться к игре',[{k:'c',l:'Код игры (5 символов)',t:'text',v:''}],async v=>{
  const code=v.c.toUpperCase().replace(/\s/g,'');if(!code)return'Введите код';
  const {data,error}=await sb.rpc('find_game',{p_code:code});
  if(error)return error.message;
  const g=data&&data[0];if(!g)return'Открытая игра с таким кодом не найдена';
  const sheet=newSheet();sheet.name=uname();
  const ins=await sb.from('game_players').insert({game_id:g.id,user_id:USER.id,name:uname(),full_name:fullName(),nick:nickName(),sheet,summary:summ(sheet),finished:false});
  if(ins.error&&!/duplicate|unique/i.test(ins.error.message))return ins.error.message;
  location.hash='#/game/'+g.id;return null},{ok:'Войти в игру'})}

function spark(vals){
  if(vals.length<2)return'<div class="mu">График появится после двух игр</div>';
  const W=300,H=60,mx=Math.max(...vals),mn=Math.min(...vals),rg=(mx-mn)||1;
  const pts=vals.map((v,i)=>`${(i/(vals.length-1)*(W-8)+4).toFixed(1)},${(H-6-(v-mn)/rg*(H-12)).toFixed(1)}`).join(' ');
  return`<svg viewBox="0 0 ${W} ${H}" width="100%" height="60"><polyline points="${pts}" fill="none" stroke="var(--ac)" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
}
async function home(){
  const [a,b]=await Promise.all([
    sb.from('game_players').select('id,game_id,name,summary,finished,updated_at,games(id,title,code,status,created_at,host)').eq('user_id',USER.id).order('updated_at',{ascending:false}),
    sb.from('games').select('*').eq('host',USER.id).order('created_at',{ascending:false})]);
  if(a.error)throw a.error;if(b.error)throw b.error;
  const all=a.data||[],hosted=b.data||[];
  const S=r=>r.summary||{};
  const real=all.filter(r=>S(r).real),rows=all.filter(r=>!S(r).real);
  const done=rows.filter(r=>r.finished||(r.games&&r.games.status==='finished'));
  const wins=rows.filter(r=>S(r).won).length,exitsR=rows.filter(r=>S(r).stage==='fast');
  const best=f=>rows.length?Math.max(...rows.map(r=>+S(r)[f]||0)):0;
  const avgCf=rows.length?rows.reduce((t,r)=>t+(+S(r).cf||0),0)/rows.length:0;
  const turnsToExit=exitsR.filter(r=>S(r).exitTurn!=null).map(r=>+S(r).exitTurn);
  const avgExit=turnsToExit.length?Math.round(turnsToExit.reduce((t,x)=>t+x,0)/turnsToExit.length):null;
  const chron=[...rows].sort((x,y)=>new Date(x.updated_at)-new Date(y.updated_at)).map(r=>+S(r).net||0);
  REDRAW=()=>{};CUR='$';
  view(`${topbar('',`Привет, ${esc(uname())}!`,`<button class="s" id="inst" style="display:${INSTALL?'':'none'}" onclick="doInstall()">📲 Установить</button><button class="s" onclick="location.hash='#/profile'">⚙ Профиль</button><button class="s" onclick="logout()">Выйти</button>`)}
  ${isIOS&&!isStandalone&&!localStorage.getItem('cf101ios')?`<div class="banner in">Чтобы добавить на экран «Домой»: нажмите «Поделиться» в Safari → «На экран „Домой“». <button class="lnk" onclick="localStorage.setItem('cf101ios','1');home().catch(fail)">Понятно</button></div>`:''}
  <div class="acts"><button class="p" onclick="joinModal()">🔑 Присоединиться по коду</button><button onclick="newGameModal()">➕ Организовать игру</button><button onclick="soloModal()">🎯 Личная игра</button><button onclick="realGame()">💼 Мой реальный кэш-флоу</button></div>
  <h2 class="pg">Моя статистика</h2>
  <div class="stats"><div class="st"><div class="l">Игр сыграно</div><div class="v">${rows.length}</div></div>
   <div class="st"><div class="l">Завершено</div><div class="v">${done.length}</div></div>
   <div class="st"><div class="l">Вышел на скоростную дорожку</div><div class="v">${exitsR.length}</div></div>
   <div class="st"><div class="l">Ходов до выхода (в среднем)</div><div class="v">${avgExit==null?'—':avgExit}</div></div>
   <div class="st"><div class="l">Побед 🏆</div><div class="v">${wins}</div></div>
   <div class="st"><div class="l">Лучший пассивный доход</div><div class="v">${$$(best('passive'))}</div></div>
   <div class="st"><div class="l">Лучшая чистая стоимость</div><div class="v">${$$(best('net'))}</div></div>
   <div class="st"><div class="l">Средний денежный поток</div><div class="v">${$$(avgCf)}</div></div></div>
  <div class="sec"><h2>Чистая стоимость по играм</h2><div class="b">${spark(chron)}</div></div>
  <h2 class="pg">Мои игры</h2>
  <div class="sec">${all.length?all.map(r=>`<div class="gl" onclick="location.hash='#/game/${r.game_id}'"><div><b>${esc(r.games?r.games.title:'Игра')}</b> <span class="mu">${r.games?esc(r.games.code):''} · ${new Date(r.updated_at).toLocaleDateString('ru-RU')}</span><div class="mu">${S(r).real?'Реальные данные':(S(r).stage==='fast'?'Скоростная дорожка':'Крысиные бега')}${S(r).prof?' · '+esc(S(r).prof):''} · пассивный ${fmt(S(r).passive||0)} · поток ${fmt(S(r).cf||0)}</div></div><div>${S(r).won?'🏆':(r.finished?'✔':'▶')}</div></div>`).join(''):'<div class="b mu">Пока нет игр. Присоединитесь по коду или начните личную игру.</div>'}</div>
  ${hosted.length?`<h2 class="pg">Игры, которые я организую</h2><div class="sec">${hosted.map(g=>`<div class="gl" onclick="location.hash='#/host/${g.id}'"><div><b>${esc(g.title||'Игра')}</b> <span class="mu">код ${esc(g.code)} · ${new Date(g.created_at).toLocaleDateString('ru-RU')}</span></div><div class="mu">${g.status==='open'?'идёт':'завершена'}</div></div>`).join('')}</div>`:''}${foot()}`);
}

/* ---------- экран игрока ---------- */
async function playerGame(gid){
  const {data:g,error}=await sb.from('games').select('*').eq('id',gid).maybeSingle();
  if(error)throw error;if(!g){view(topbar('#/','Игра не найдена'));return}
  CURG=g;
  const {data:row,error:e2}=await sb.from('game_players').select('*').eq('game_id',gid).eq('user_id',USER.id).maybeSingle();
  if(e2)throw e2;
  if(row){SH=normSheet(row.sheet);SH.name=SH.name||row.name;FIN=!!row.finished}
  else{
    if(g.status==='finished'){view(topbar('#/','Игра завершена')+'<div class="banner no">Организатор уже завершил эту игру.</div>');return}
    SH=newSheet();SH.name=uname();FIN=false;
    if(String(g.title).startsWith('💼')){SH.real=true;SH.started=true;SH.cur='₸'}
    const {error:e3}=await persist();if(e3)throw e3;
  }
  HIST=[JSON.stringify(SH)];dirty=false;SAVEST='ok';
  renderGame();
}
function renderGame(){
  REDRAW=renderGame;CUR=SH.cur||'$';
  LOCK=CURG.status==='finished'||FIN||SH.out;
  const note=CURG.status==='finished'?'Игра завершена организатором — бланк только для чтения.':FIN?'Вы завершили свою игру. Бланк только для чтения.':'';
  view(`${topbar('#/',esc(CURG.title||'Игра'),`<span class="pill">код ${esc(CURG.code)}</span><span class="pill">ход ${SH.turn||0}</span><span class="pill" id="sv"></span>`)}
  ${note?`<div class="banner in">${note}${FIN&&!SH.out&&CURG.status!=='finished'?' <button class="lnk" onclick="resumeGame()">Продолжить игру</button>':''} <button class="lnk" onclick="showReport()">📋 Отчёт для разбора</button></div>`:''}
  <div id="sheet">${sheet(SH,LOCK)}</div>
  ${LOCK?'':`<div class="acts" style="margin-top:12px"><button class="p" onclick="finishGame()">🏁 Завершить мою игру</button></div>`}${foot()}`);
  if(LOCK)lockInputs($('sheet'));
  stat();
}
function finishGame(){confirmM('Завершить игру?','Результат попадёт в вашу статистику. Позже можно продолжить, если организатор не закрыл игру.',async()=>{FIN=true;dirty=false;const {error}=await persist();if(error)throw error;SAVEST='ok'})}
async function resumeGame(){FIN=false;dirty=false;const {error}=await persist();if(error)return fail(error);renderGame()}

/* ---------- экран организатора ---------- */
async function loadHost(gid){
  const [g,p]=await Promise.all([sb.from('games').select('*').eq('id',gid).maybeSingle(),sb.from('game_players').select('*').eq('game_id',gid)]);
  if(g.error)throw g.error;if(p.error)throw p.error;
  return{g:g.data,rows:p.data||[]};
}
function lineup(rows){return rows.map(r=>{const p=normSheet(r.sheet);p.name=p.name||r.name;return{r,p,c:calc(p)}})}
function stageTxt(x){return x.c.won?'🏆 Победитель':x.p.out?'Выбыл':x.p.fast?'Скоростная дорожка':'Крысиные бега'}
function ranked(L){const grp=x=>x.c.won?0:x.p.fast?1:2;return [...L].sort((a,b)=>grp(a)-grp(b)||(grp(a)===0?(a.p.wonAt||0)-(b.p.wonAt||0):grp(a)===2?(b.c.prog-a.c.prog||b.c.passive-a.c.passive):b.c.passive-a.c.passive)||b.c.net-a.c.net)}
async function hostView(gid,sub,uid){
  const draw=async()=>{
    const {g,rows}=await loadHost(gid);
    if(!g){view(topbar('#/','Игра не найдена'));return}
    if(g.host!==USER.id){view(topbar('#/','Нет доступа')+'<div class="banner no">Вы не организатор этой игры.</div>');return}
    CURG=null;CUR='$';
    const L=lineup(rows).filter(x=>!x.p.real);
    const first=L.filter(x=>x.c.won).sort((a,b)=>(a.p.wonAt||0)-(b.p.wonAt||0))[0];
    const tabs=`<div class="tabs"><button class="${!sub?'on':''}" onclick="location.hash='#/host/${gid}'">📊 Стол</button><button class="${sub==='res'?'on':''}" onclick="location.hash='#/host/${gid}/res'">🏁 Итоги игры</button>${sub==='p'?'<button class="on">👁 Бланк игрока</button>':''}</div>`;
    const head=topbar('#/',esc(g.title||'Игра'),`<span class="pill ${g.status==='open'?'ok':''}">${g.status==='open'?'идёт':'завершена'}</span>`)+
      `<div class="sec"><div class="b" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><div><div class="mu">Код для игроков</div><div class="code">${esc(g.code)}</div></div><div class="mu" style="flex:1;min-width:200px">Игроки заходят в приложение → «Присоединиться по коду». Бланки появляются здесь автоматически.</div>
      <div class="acts" style="margin:0"><button onclick="location.hash='#/game/${gid}'">🎮 Играть самому</button><button onclick="setStatus('${gid}','${g.status==='open'?'finished':'open'}')">${g.status==='open'?'Завершить игру':'Открыть снова'}</button></div></div></div>`+
      (first&&g.status==='open'?`<div class="banner ok">🏆 ${esc(first.p.name)} победил первым. По правилам, когда кто-то купил Мечту или достиг цели по доходу, игра заканчивается. <button class="lnk" onclick="setStatus('${gid}','finished')">Завершить игру</button></div>`:'');
    let body='';
    if(sub==='p'){
      const x=lineup(rows).find(y=>y.r.user_id===uid);
      body=!x?'<div class="mu">Игрок не найден.</div>':`<div class="acts"><button onclick="location.hash='#/host/${gid}'">← К столу</button><button onclick="showReport(window.__rp)">📋 Отчёт для разбора</button><button class="x" onclick="kick('${gid}','${x.r.id}')">Убрать игрока</button></div><div class="mu" style="margin-bottom:8px">Только чтение. Игрок: <b>${esc(x.p.name)}</b> · имя: ${esc(x.r.full_name||'—')}${x.r.nick?' · ник: @'+esc(x.r.nick):''}</div><div id="sheet">${roHtml(x.p)}</div>`;
      window.__rp=x?x.p:null;
    }else if(sub==='res')body=resultsHtml(L);
    else body=tableHtml(L,gid);
    view(head+tabs+body+foot());
    if(sub==='p')lockInputs($('sheet'));
    POLL=setInterval(()=>{if($('ov').style.display!=='flex')draw().catch(()=>{})},8000);
  };
  REDRAW=()=>{};
  await draw();
}
function tableHtml(L,gid){
  const key={prog:x=>-x.c.prog,cf:x=>-x.c.cf,net:x=>-x.c.net,name:x=>(x.p.name||'').toLowerCase()}[SORT];
  const S=[...L].sort((a,b)=>{const x=key(a),y=key(b);return x<y?-1:x>y?1:0});
  const n=L.length,inFast=L.filter(x=>x.p.fast).length,won=L.filter(x=>x.c.won).length;
  const avg=n?L.reduce((t,x)=>t+x.c.cf,0)/n:0;
  const lead=[...L].sort((a,b)=>b.c.net-a.c.net)[0],near=L.filter(x=>!x.p.fast&&!x.p.out).sort((a,b)=>b.c.prog-a.c.prog)[0];
  return`<div class="stats"><div class="st"><div class="l">Игроков</div><div class="v">${n}</div></div>
  <div class="st"><div class="l">На скоростной дорожке</div><div class="v">${inFast}${won?` · 🏆 ${won}`:''}</div></div>
  <div class="st"><div class="l">Средний поток</div><div class="v">${$$(avg)}</div></div>
  <div class="st"><div class="l">Лидер по чистой стоимости</div><div class="v">${lead?esc(lead.p.name)+' · '+$$(lead.c.net):'—'}</div></div>
  <div class="st"><div class="l">Ближе всех к выходу</div><div class="v">${near?esc(near.p.name)+' · '+Math.round(near.c.prog)+'%':'—'}</div></div></div>
  <div class="acts"><label class="mu" style="align-self:center">Сортировка <select onchange="SORT=this.value;route()">${[['prog','по прогрессу'],['cf','по потоку'],['net','по чистой стоимости'],['name','по имени']].map(([k,l])=>`<option value="${k}" ${SORT===k?'selected':''}>${l}</option>`).join('')}</select></label></div>`+
  (!n?'<div class="sec"><div class="b mu">Пока никто не вошёл. Дайте игрокам код игры.</div></div>':
  `<div class="sec"><div class="b scroll"><table class="tb"><tr><th>Игрок</th><th>Профессия</th><th>Этап</th><th>Ход</th><th>Прогресс</th><th>Пассивный</th><th>Расходы</th><th>Поток</th><th>Наличные</th><th>Чистая ст-ть</th><th>✋</th><th>Обновлено</th></tr>`+
  S.map(({p,c,r})=>`<tr class="cl" onclick="location.hash='#/host/${gid}/p/${r.user_id}'"><td><b>${esc(p.name)}</b> ${c.won?'🏆':''}${r.finished?' <span class="mu">завершил</span>':''}<div class="mu">${esc(r.full_name||'')}${r.nick?' · @'+esc(r.nick):''}</div></td><td>${esc(p.prof)}</td><td>${stageTxt({c,p})}${p.skip>0?` <span class="mu">пропуск ${p.skip}</span>`:''}</td><td>${p.turn||0}</td><td><div class="bar"><i style="width:${c.prog}%"></i></div></td><td>${$$(c.passive)}</td><td>${p.fast?'—':$$(c.exp)}</td><td class="${c.cf<0?'neg':''}">${$$(c.cf)}</td><td>${$$(p.savings)}</td><td class="${c.net<0?'neg':''}">${$$(c.net)}</td><td>${p.stats.manual||''}</td><td class="mu">${new Date(r.updated_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</td></tr>`).join('')+`</table></div></div><div class="mu">Нажмите на строку, чтобы открыть полный бланк. «✋» — число ручных правок наличных (смотрите их причины в журнале). Таблица обновляется сама.</div>`);
}
function resultsHtml(L){
  if(!L.length)return'<div class="sec"><div class="b mu">Пока нет данных для итогов.</div></div>';
  const R=ranked(L),medal=['🥇','🥈','🥉'];
  const best=f=>[...L].sort((a,b)=>f(b)-f(a))[0];
  const aw=[['💰 Лучший денежный поток',best(x=>x.c.cf),x=>$$(x.c.cf)+'/мес'],['📈 Самый большой пассивный доход',best(x=>x.c.passive),x=>$$(x.c.passive)+'/мес'],['🏦 Больше всех активов',best(x=>x.c.assets),x=>$$(x.c.assets)],['💎 Чистая стоимость',best(x=>x.c.net),x=>$$(x.c.net)]];
  window.__txt=`Итоги игры\n`+R.map((x,i)=>`${i+1}. ${x.p.name}${x.p.prof?' ('+x.p.prof+')':''} — ${stageTxt(x)}, пассивный доход ${$$(x.c.passive)}, поток ${$$(x.c.cf)}, чистая стоимость ${$$(x.c.net)}`).join('\n');
  return`<div class="acts"><button onclick="copyRes()">📋 Скопировать итоги текстом</button><span class="mu" id="cpm" style="align-self:center"></span></div>
  <div class="podium">${R.slice(0,3).map((x,i)=>`<div class="pd p${i}"><div class="md">${medal[i]}</div><div class="nm">${esc(x.p.name)}</div><div class="mu">${esc(x.p.prof)}</div><div class="mu">${stageTxt(x)}</div><div class="pv">${$$(x.c.passive)}</div><div class="mu">пассивный доход / мес</div></div>`).join('')}</div>
  <div class="stats">${aw.map(([t,x,f])=>`<div class="st"><div class="l">${t}</div><div class="v">${esc(x.p.name)}</div><div class="mu">${f(x)}</div></div>`).join('')}</div>
  <div class="sec"><h2>Итоговая таблица</h2><div class="b scroll"><table class="tb"><tr><th>#</th><th>Игрок</th><th>Профессия</th><th>Этап</th><th>Ход</th><th>Пассивный доход</th><th>Цель / расходы</th><th>Прогресс</th><th>Поток</th><th>Чистая ст-ть</th></tr>`+
  R.map((x,i)=>`<tr><td>${i<3?medal[i]:i+1}</td><td><b>${esc(x.p.name)}</b></td><td>${esc(x.p.prof)}</td><td>${stageTxt(x)}</td><td>${x.p.turn||0}</td><td>${$$(x.c.passive)}</td><td>${x.c.goal?$$(x.c.goal):$$(x.c.exp)}</td><td><div class="bar"><i style="width:${x.c.prog}%"></i></div></td><td class="${x.c.cf<0?'neg':''}">${$$(x.c.cf)}</td><td class="${x.c.net<0?'neg':''}">${$$(x.c.net)}</td></tr>`).join('')+`</table></div></div>
  <div class="mu">Победитель — кто первым купил Мечту или достиг цели по доходу. Далее: скоростная дорожка по доходу, затем крысиные бега по доле покрытия расходов пассивным доходом. На итогах показаны имена так, как выбрали игроки.</div>`;
}
function copyRes(){const m=$('cpm');try{navigator.clipboard.writeText(window.__txt||'').then(()=>{m.textContent='Скопировано'},()=>{m.textContent='Не удалось скопировать'})}catch(e){m.textContent='Не удалось скопировать'}}
async function setStatus(gid,status){const {error}=await sb.from('games').update({status}).eq('id',gid);if(error)return fail(error);route()}
function kick(gid,id){confirmM('Убрать игрока?','Бланк игрока будет удалён из этой игры.',async()=>{const {error}=await sb.from('game_players').delete().eq('id',id);if(error)throw error;location.hash='#/host/'+gid})}

/* ---------- маршрутизация ---------- */
async function route(){
  clearTimeout(st);clearTimeout(RT);if(dirty&&CURG){try{await flush()}catch(e){}}
  CURG=null;LOCK=false;dirty=false;CUR='$';
  if(!sb)return;
  if(!USER)return authScreen();
  if(REC)return recoveryScreen();
  const h=location.hash.replace(/^#\/?/,'').split('/');
  try{
    await ensureProfile();
    if(h[0]==='profile')await profileScreen();
    else if(h[0]==='game'&&h[1])await playerGame(h[1]);
    else if(h[0]==='host'&&h[1])await hostView(h[1],h[2]||'',h[3]);
    else await home();
  }catch(e){fail(e)}
}
async function boot(){
  if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
  if(!CFG.SUPABASE_URL||!CFG.SUPABASE_ANON_KEY||!window.supabase){
    view(`<div class="banner no">Приложение не настроено</div><p>Откройте <b>config.js</b> и впишите SUPABASE_URL и SUPABASE_ANON_KEY (см. README).</p>`);return;
  }
  sb=window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_ANON_KEY);
  const {data}=await sb.auth.getSession();USER=data.session?data.session.user:null;
  sb.auth.onAuthStateChange((ev,s)=>{const u=s?s.user:null;if(ev==='PASSWORD_RECOVERY')REC=true;if((u&&u.id)!==(USER&&USER.id)||ev==='PASSWORD_RECOVERY'){USER=u;if(!u){PROFILE=null;location.hash=''}route()}});
  window.addEventListener('hashchange',route);
  route();
}
boot();
