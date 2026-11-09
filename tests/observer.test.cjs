const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ui = path.join(__dirname, '../ZoiObserver_XDX478/ui/HouseholdObserver');
const M = require(path.join(ui, 'goal-memory.js'));
const L = require(path.join(ui, 'life.js'));
const C = require(path.join(ui, 'choices.js'));
const P = require(path.join(ui, 'policy.js'));
const T = require(path.join(ui, 'travel.js'));
function load(name, globals = {}) {
 const context = vm.createContext({ObserverLife:L, ObserverPolicy:P, ObserverGoalMemory:M,
  ObserverChoices:C, setTimeout:fn => {fn(); return 0;}, ...globals});
 vm.runInContext(fs.readFileSync(path.join(ui, name), 'utf8'), context);
 return context;
}
const plan = () => ({name:'HandCraftGoal',instance:100,conditions:[]});

test('pending game commands and meaningful actions keep control of the Zoi', () => {
 assert.equal(L.relaxed({queue_count:1}), false);
 assert.equal(L.relaxed({queue_count:0,current:{interaction_bag_id:'Sleep_Bed01'}}), false);
 assert.equal(L.relaxed({queue_count:0,current:{interaction_bag_id:'Self_Idle_01'}}), true);
});
test('goal preparation, evidence and cooldowns survive JSON save/load', () => {
 const d = {}, p = plan();
 M.note(d,p,'preparing','손재주 준비','연습 후 성장 확인',100);
 M.failed(d,p,'Craft_Practice_HandCraft','20',100,'진행 없음');
 const restored = JSON.parse(JSON.stringify(d));
 assert.equal(M.record(restored,plan(),101).next,'다른 행동·대상 탐색 후 재시도');
 assert.equal(M.allowed(restored,plan(),'Craft_Practice_HandCraft','20',101),false);
 assert.equal(M.allowed(restored,plan(),'Craft_Practice_HandCraft','21',101),true);
 assert.equal(M.allowed(restored,plan(),'Craft_Practice_HandCraft','20',160),true);
});
test('repeated failures back off; rewinding the save resets future cooldowns', () => {
 const d={}, p=plan();
 for (let i=0;i<5;i++) M.failed(d,p,'a','b',100+i,'진행 없음');
 assert.equal(M.allowed(d,p,'a','b',463),false);
 assert.equal(M.allowed(d,p,'a','b',464),true);
 M.failed(d,p,'a','b',500,'진행 없음');
 assert.equal(M.allowed(d,p,'a','b',50),true);
});
test('training has a daily request budget and does not overwrite user pin fields', () => {
 const d={}, p={...plan(),bIsPinned:true};
 for(let i=0;i<3;i++) {assert.equal(M.practiceAllowed(d,p,100+i),true); M.started(d,p,100+i,'HandCraft');}
 assert.equal(M.practiceAllowed(d,p,104),false);
 assert.equal(M.practiceAllowed(d,p,1440),true);
 assert.equal(p.bIsPinned,true);
});
test('disappearing hopes are not reported as completed; finished history is bounded', () => {
 const d={};
 M.sync(d,[plan()],100);
 M.sync(d,[],101);
 assert.equal(d.goalMemory[M.key(plan())].phase,'ended');
 for(let i=0;i<30;i++) M.note(d,{name:'past',instance:i},'completed','완료','다음',i+200);
 M.sync(d,[],240);
 assert.equal(Object.keys(d.goalMemory).length,16);
});

function lifeHarness() {
 const decision={}, writes=[], logs=[];
 let level=1, experience, finished=false;
 const member={entity_id:1,household_id:10,first_name:'진',age_group:'Adult'};
 const character={locatedSiteId:{value:30},worldTransform:{translation:{x:0,y:0,z:0}}};
 const snapshot={queue:{queue_count:0},stats:{stats:{}},work:{},hope:{selected:[{hope_id:'HandCraftGoal'}]}};
 const cli=async(name,args) => {
  if(name==='skill.get_all') return {skills:[{id:'HandCraft',level}]};
  if(name==='entity.reflect') {
   if(args.Component==='Skill'&&experience!==undefined)return {skills:{handCraft:{iD:'HandCraft',level,experience}}};
   if(args.Component==='Hope') return {selectedHopes:[{hopeId:'HandCraftGoal',missionId:{value:100}}]};
   if(args.Component==='Mission') return {missionMap:{'(Value=100)':{bIsFinished:finished,conditionStates:[{currentCount:level,goalCount:3,compareType:'GreaterOrEqual'}]}}};
  }
  if(name==='data.table_get'&&args.Alias==='Hope') return {missionId:'M1'};
  if(name==='data.table_get'&&args.Alias==='Mission') return {conditions:[{conditionType:'SkillLevel',conditionId1:'HandCraft'}]};
  if(name==='world.get_loaded_sites') return {map_id:'Cahaya_Map',sites:[{entity_id:30,id:'Home'}]};
  if(name==='build.get_site_info') return {site_id:'Home'};
  if(name==='build.scan_objects') return {total:2,objects:[20,21].map(id=>({entity_id:id,table_id:'Workbench01',world_location:{x:id,y:0,z:0}}))};
  if(name==='interaction.list_available') return {interactions:[{enabled:true,interaction_bag_id:'Craft_Practice_HandCraft',display_name:'손재주 연습'}]};
  throw Error('Unexpected CLI '+name+' '+JSON.stringify(args));
 };
 const context=load('life-actions.js');
 const actions=context.ObserverLifeActions.create({cli,write:async(...args)=>writes.push(args),log:s=>logs.push(s),state:{},
  game:()=>({map_id:'Cahaya_Map',possessed_entity_id:1}),active:()=>true});
 return {decision,member,character,snapshot,writes,logs,actions,level:n=>level=n,xp:n=>experience=n,finish:()=>finished=true};
}
test('a skill hope trains through available actions, measures growth, then checks original completion',async() => {
 const h=lifeHarness(), time={day:0,hour:10};
 assert.equal(await h.actions.pursueHope(h.member,h.character,h.decision,h.snapshot,time,600,1),true);
 assert.equal(h.writes[0][0],'interaction.execute');
 assert.equal(h.decision.goal.practice.level,1);
 h.snapshot.queue.current={interaction_bag_id:'Craft_Practice_HandCraft',target_entity_id:20};
 h.level(2);
 await h.actions.reviewGoal(h.member,h.decision,h.snapshot,620);
 assert.ok(h.decision.goal, 'growth must not interrupt an ongoing action');
 assert.equal(h.decision.goalPlans[0].memory.evidence,'HandCraft Lv.1 → 2');
 assert.notEqual(h.decision.goalPlans[0].memory.phase,'completed');
 h.snapshot.queue.current=null;
 await h.actions.reviewGoal(h.member,h.decision,h.snapshot,650);
 assert.equal(h.decision.goal,null);
 h.finish();
 assert.equal(await h.actions.pursueHope(h.member,h.character,h.decision,h.snapshot,time,680,1),false);
 assert.equal(h.decision.goalPlans[0].memory.phase,'completed');
 assert.equal(h.writes.length,1);
});
test('practice without a level-up stays in preparation, does not assume failure, and can try another object', async() => {
 const h=lifeHarness(), time={day:0,hour:10};
 await h.actions.pursueHope(h.member,h.character,h.decision,h.snapshot,time,600,1);
 h.snapshot.queue.current={interaction_bag_id:'Craft_Practice_HandCraft',target_entity_id:20};
 await h.actions.reviewGoal(h.member,h.decision,h.snapshot,610);
 h.snapshot.queue.current=null;
 await h.actions.reviewGoal(h.member,h.decision,h.snapshot,640);
 assert.equal(h.decision.goalPlans[0].memory.phase,'preparing');
 assert.equal(Object.keys(h.decision.goalPlans[0].memory.failures).length,0);
 await h.actions.pursueHope(h.member,h.character,h.decision,h.snapshot,time,650,1);
 assert.equal(h.writes.length,2);
 assert.equal(h.writes[1][1].target_entity_id,'21');
 assert.ok(!h.logs.some(line=>line.includes('성장 확인')));
});
test('a queued game action prevents new hope training requests',async() => {
 const h=lifeHarness(); h.snapshot.queue.queue_count=1;
 assert.equal(await h.actions.pursueHope(h.member,h.character,h.decision,h.snapshot,{day:0,hour:10},600,1),false);
 assert.equal(h.writes.length,0);
});
test('a real experience change at the same level is evidence without marking the hope complete',async()=>{
 const h=lifeHarness();
 h.xp(82.78);
 await h.actions.pursueHope(h.member,h.character,h.decision,h.snapshot,{day:0,hour:10},600,1);
 h.snapshot.queue.current={interaction_bag_id:'Craft_Practice_HandCraft',target_entity_id:20};
 h.xp(93.28);
 await h.actions.reviewGoal(h.member,h.decision,h.snapshot,620);
 assert.equal(h.decision.goalPlans[0].memory.evidence,'HandCraft 경험치 +10.50');
 assert.equal(h.decision.goalPlans[0].memory.phase,'preparing');
});
test('a prior same-price debit or an unrelated purchase cannot verify a payment',()=>{
 const record=(amount,transactionReason='ExpenseTax',actor=1)=>({amount,transactionReason,participantId:{value:actor}});
 const wallet=records=>({currencyHistoryMap:{mew:{dailyTransactionMap:{'0003.11.01-00.00.00':{records}}}}});
 const before=[record(-70)], checkpoint=L.ledgerCheckpoint(wallet(before));
 assert.equal(L.matchingDebit(wallet(before),checkpoint,1,70,'ExpenseTax'),null);
 assert.equal(L.matchingDebit(wallet([...before,record(-70,'ExpenseBuy')]),checkpoint,1,70,'ExpenseTax'),null);
 assert.equal(L.matchingDebit(wallet([...before,record(-70,'ExpenseTax',2)]),checkpoint,1,70,'ExpenseTax'),null);
 assert.deepEqual(L.matchingDebit(wallet([...before,record(-70)]),checkpoint,1,70,'ExpenseTax'),
  {day:'0003.11.01-00.00.00',amount:-70,reason:'ExpenseTax'});
 assert.equal(L.matchingDebit(wallet([...before,record(-70),record(-70)]),checkpoint,1,70,'ExpenseTax'),null);
});

const text=s=>({role:'text',text:s});
test('payment amounts accept inline or separate values, reject dates, ambiguity and malformed amounts',() => {
 assert.equal(C.paymentAmount([text('납부 금액: 1,200미유')]),1200);
 assert.equal(C.paymentAmount([text('청구 금액'),text('₥70')]),70);
 assert.equal(C.paymentAmount([text('납부 금액: 70'),text('이자 금액: 20')]),null);
 for (const value of ['2026-11-09','0','-70','70원, 가입비 200','7,0'])
  assert.equal(C.paymentAmount([text('Amount due: '+value)]),null);
});
test('a payment label cannot hide a new-loan action or two ambiguous payment options',() => {
 const options=[{ref:'a',text:'납부하기'}], words={a:'납부하기'};
 const action={kind:'positive',keys:['a'],scripts:['PayUtility','NewLoan']};
 assert.equal(C.responseButton(options,words,[action],{financial:true}),null);
 assert.equal(C.responseButton(options,words,[{...action,scripts:['PayUtility']}],{financial:true}).payment,true);
 const b={kind:'normal',keys:['b'],scripts:['PayInterest']};
 assert.equal(C.responseButton([...options,{ref:'b',text:'이자 납부'}],{...words,b:'이자 납부'},[{...action,scripts:['PayUtility']},b],{financial:true}),null);
});
test('native tax and mortgage templates select only the identified total or interest',()=>{
 const pay={ref:'pay',text:'납부하기'}, principal={ref:'principal',text:'원금 일시상환 (당회 이자 포함)'};
 const interest={ref:'interest',text:'이자만 납부'};
 const words={pay:pay.text,principal:principal.text,interest:interest.text};
 const tax=C.responseButton([pay],words,[{kind:'positive',keys:['pay'],scripts:['Accept_Payment_Tax']}],{financial:true});
 assert.equal(tax.ledgerReason,'ExpenseTax');
 assert.equal(C.paymentAmount([text('청구 내역 총 청구 금액 : 518 뮤 재산세 : 300 뮤 전기세 : 150 뮤')],tax.paymentKind),518);
 const paid=C.responseButton([principal,interest],words,[
  {kind:'positive',keys:['principal'],scripts:['LoanPayment_All_Mortgage']},
  {kind:'normal',keys:['interest'],scripts:['LoanPayment_Interest_Mortgage']}],{financial:true});
 assert.equal(paid.button,interest);
 assert.equal(C.paymentAmount([text('1. 원금 일시상환 (당회 이자 포함) → 총 납부액은 1,400뮤입니다.'),
  text('2. 이자만 납부'),text('→ 총 납부액은 70뮤입니다.')],paid.paymentKind),70);
 assert.equal(C.paymentAmount([text('1. 원금 일시상환 (당회 이자 포함) → 총 납부액은 1,400뮤입니다.')],paid.paymentKind),null);
});
test('destination arrival is distinct from a fresh native check-in tag',()=>{
 const tag={value:'Stay_CheckIn',expire:'0003.11.01-22.09.09'};
 const trip={destination:'Gangnam_Map',checkInBefore:['old']};
 const character={locatedCityName:'Gangnam_Map',locatedSiteId:{value:53549},entityTags:[tag]};
 assert.equal(T.checkInEvidence({...character,locatedCityName:'Cahaya_Map'},trip),null);
 assert.equal(T.checkInEvidence(character,{...trip,checkInBefore:[tag.expire]}),null);
 assert.equal(T.checkInEvidence(character,{...trip,checkInBefore:null}),null);
 assert.deepEqual(T.checkInEvidence(character,trip),{tag:tag.value,expiry:tag.expire,site:53549});
});
test('the six native travel notices gate the single departure button',()=>{
 const path='Travel/BW_WBP_Confirm/BW_DynamicEntryBox_CheckBox';
 const notices=[
  '여행에 함께 오지 않은 가족은 조작할 수 없습니다.',
  '가족 구성원이 아닌 조이와는 그룹 기능을 이용해 함께 다닐 수 있습니다.',
  '진행 중이거나, 예정된 이벤트는 즉시 취소됩니다.',
  '미션은 유지되지만 조건에 따라 달성이 불가할 수 있습니다.',
  '여행 기간 동안 직장은 무급 휴가로, 학교는 인정 결석으로 처리됩니다.',
  '다른 도시에서는 기존 도시에 있는 가족의 정보가 즉시 갱신되지 않을 수 있음을 확인했습니다.'
 ];
 const trip={destination:'Gangnam_Map',room:'102호 도미토리',party:1,roomParty:1,price:70};
 const toggles=notices.map((label,i)=>({role:'toggle',text:label,ref:path+'/row'+i+'/BW_CheckBox',state:['off']}));
 const ready={role:'button',text:'여행 떠나기',ref:'Travel/BW_WBP_Button_Ready'};
 const button={...ready,ref:ready.ref+'/BW_Button'};
 const review={nodes:[...['내 여행 정보','여행 도시','도원','숙소',trip.room,'여행 기간','1박','여행 인원','총 여행 비용','70'].map(text),
  ...toggles,ready,button]};
 assert.equal(T.bookingReview(review,trip).pending,toggles[0]);
 assert.equal(T.bookingReview(review,trip).confirm,false);
 toggles.forEach(t=>t.state=['on']);
 assert.equal(T.bookingReview(review,trip).confirm,button);
 assert.equal(T.bookingReview(review,{...trip,price:71}),null);
 toggles[0].text='다른 안내';
 assert.equal(T.bookingReview(review,trip),null);
});

function phoneHarness(isPayment=true) {
 let screen='hud',sent=0;
 const decision={}, logs=[];
 let history=[{messageId:isPayment?'UtilityBill':'Greeting',timestamp:'2026.11.09-10.00.00',bIsRead:true,bNeedResponse:true,
  customResponse:{dtId:isPayment?'Bill':'Greeting'}}];
 const mobile=()=>({messageList:{mobileMessageListMap:{'(Value=2)':{mobileMessageList:history}}}});
 const button=(ref,t)=>({role:'button',ref,text:t,state:'enabled'});
 const cli=async(name,args) => {
  if(name==='entity.reflect'&&args.Component==='MobileMessage') return mobile();
  if(name==='entity.reflect'&&args.Component==='Currency') return {currencyMap:{mew:3000}};
  if(name==='entity.get_character_info') return {display_name:'고지서'};
  if(name==='data.table_get') return {positiveAnswerButtonStrId:'pay',positiveAnswerScriptIds:isPayment?['PayUtility']:[],messageData:{}};
  if(name==='l10n.get') return {pay:isPayment?'납부하기':'확인'};
  if(name==='environment.get_time') return {day:0,hour:10,minute:0};
  if(name==='game.get_state') return {possessed_entity_id:1,blocking:{}};
  if(name==='ui.list_windows') return {windows:[{ui_type:'Hud'}],blocking:{}};
  if(name==='ui.get_tree') {
   if(args.Window==='Hud') return {nodes:[button('/WBP_PlayerInfo/BW_Button_SmartPhone','phone')]};
   if(screen==='hud') return {};
   const list={role:'list',ref:'/WBP_Mobile_Message/TileView_list',children:[{role:'entry',text:'고지서',children:[button('/thread/BW_Button','고지서')]}]};
   const detail=[text('고지서'),text('청구 금액'),text('70미유'),button('/WBP_Mobile_Message_Popup/BW_Choice_Slot1/Button',isPayment?'납부하기':'확인')];
   return {window:'Phone',nodes:screen==='thread'?detail.concat(button('/WBP_Mobile_Message_Popup/BW_Button_Close','close')):
    [list,button('/WBP_Mobile_AppIcon_Message/BW_Button','messages'),button('/WBP_Common_CloseButton/BW_Button','close')]};
  }
  throw Error('Unexpected CLI '+name+' '+JSON.stringify(args));
 };
 const write=async(name,args)=>{
  const ref=args.ref;
  if(ref.includes('SmartPhone')) screen='phone';
  else if(ref==='/thread/BW_Button') screen='thread';
  else if(ref.includes('Choice_Slot')) sent++;
  else if(ref.includes('Message_Popup/BW_Button_Close')) screen='phone';
  else if(ref.includes('Common_CloseButton')) screen='hud';
 };
 const actions=load('panels.js').ObserverPanels.create({cli,write,log:s=>logs.push(s),state:{},
  game:()=>({possessed_entity_id:1}),background:()=>true,active:()=>true});
 const member={entity_id:1,household_id:10,first_name:'진'};
 const snapshot={queue:{queue_count:0},work:{},stats:{stats:{}}};
 return {decision,logs,actions,member,snapshot,count:()=>sent,deliver:()=>history=history.concat({
  bIsSend:true,messageId:'Outgoing',timestamp:'2026.11.09-10.01.00'})};
}
test('an ordinary reply requested before a save is reconciled later without a second send',async()=>{
 const h=phoneHarness(false);
 await h.actions.phone(h.member,h.decision,h.snapshot,600,1);
 assert.equal(h.count(),1);
 const saved=JSON.parse(JSON.stringify(h.decision));
 await h.actions.phone(h.member,saved,h.snapshot,650,1);
 assert.equal(h.count(),1);
 h.deliver();
 await h.actions.phone(h.member,saved,h.snapshot,700,1);
 assert.equal(h.count(),1);
 assert.equal(Object.values(saved.replyRequests)[0].phase,'outgoing');
 assert.equal(saved.pendingReplies,0);
});
test('an ambiguous payment result never clicks again, including after saved decision restoration',async() => {
 const h=phoneHarness();
 await h.actions.phone(h.member,h.decision,h.snapshot,600,1);
 assert.equal(h.count(),1);
 assert.equal(Object.values(h.decision.payments)[0].phase,'unconfirmed');
 const saved=JSON.parse(JSON.stringify(h.decision));
 h.actions.reset();
 await h.actions.phone(h.member,saved,h.snapshot,750,1);
 assert.equal(h.count(),1);
 assert.ok(h.logs.some(s=>s.includes('중복 요청 보류')));
});

function travelHarness() {
 const state={people:{'1':{vacation:{trips:[]}}},travel:{stage:'submitted',submitted:Date.now()-130000,
  actor:'1',actorName:'진 가',household:'10',day:0,origin:'Cahaya_Map',destination:'Gangnam_Map',room:'102호',party:2,
  price:70,balanceBefore:3000,companions:[{id:'2',name:'진 나'}]}};
 let map='Cahaya_Map', readsFail=false;
 const writes=[];
 const cli=async(name,args)=>{
  if(name==='household.get_members') return {household_id:11,members:[{entity_id:1,last_name:'진',first_name:'가'},{entity_id:2,last_name:'진',first_name:'나'}]};
  if(name==='entity.reflect') {
   if(readsFail) throw Error('unavailable');
   return args.Component==='Currency'?{currencyMap:{mew:2930}}:{locatedCityName:'Cahaya_Map'};
  }
  throw Error('Unexpected CLI '+name);
 };
 const game=()=>({map_id:map,possessed_entity_id:1});
 const travel=T.create({state,cli,write:async(...args)=>writes.push(args),log:()=>{},game,active:()=>true},L,P);
 return {state,travel,game,writes,arrive:()=>map='Gangnam_Map',fail:()=>readsFail=true};
}
test('a travel timeout preserves its reservation and resumes household observation without another booking',async()=>{
 const h=travelHarness();
 assert.equal(await h.travel.advance(h.game(),{day:0},1),false);
 assert.equal(h.state.travel.stage,'unconfirmed');
 assert.equal(await h.travel.advance(h.game(),{day:1},1),false);
 assert.equal(h.writes.length,0);
 assert.equal(await h.travel.start({entity_id:1,household_id:10},{},{},{day:1},1),false);
});
test('delayed arrival records balance evidence and checks companions independently, not check-in completion',async()=>{
 const h=travelHarness();
 await h.travel.advance(h.game(),{day:0},1);
 h.arrive();
 assert.equal(await h.travel.advance(h.game(),{day:1},1),false);
 assert.equal(h.state.travel,null);
 assert.equal(h.state.awayTravel.paymentEvidence,'matching-balance-change');
 assert.equal(h.state.awayTravel.companions[0].present,false);
 assert.equal(h.state.awayTravel.checkIn,'unconfirmed');
 assert.equal(h.state.people['1'].vacation.trips.length,1);
});
test('arrival can resume life when payment or companion queries are unavailable',async()=>{
 const h=travelHarness(); h.arrive();h.fail();
 assert.equal(await h.travel.advance(h.game(),{day:1},1),false);
 assert.equal(h.state.awayTravel.paymentEvidence,'unconfirmed');
 assert.equal(h.state.awayTravel.companions[0].present,null);
});

function appHarness(execute=()=>({})) {
 const elements=new Map(), intervals=new Map();
 const element=()=>({style:{},addEventListener(){},appendChild(){},setAttribute(){},scrollHeight:0});
 let deliver,collect;
 const context=vm.createContext({console:{log(){},error(){}},engine:{},
  document:{body:element(),getElementById:id=>{
   if(!elements.has(id)) elements.set(id,element());
   return elements.get(id);
  },createElement:element,addEventListener(){}},
  inzoi:{cli:{execute},view:{},saveState:{register:fn=>collect=fn,onLoad:fn=>deliver=fn}},
  setInterval:(fn,ms)=>intervals.set(ms,fn),setTimeout:()=>0,clearTimeout(){},addEventListener(){}});
 context.window=context;
 for(const name of ['window','policy','protocol','life','goal-memory','choices','life-actions','panels','travel','app'])
  vm.runInContext(fs.readFileSync(path.join(ui,name+'.js'),'utf8'),context,{filename:name+'.js'});
 return {context,intervals,load:value=>deliver(JSON.stringify(value)),collect:()=>collect()};
}
test('loading another save replaces old keys while preserving the shared state reference',()=>{
 const h=appHarness(), shared=h.context.wf.state;
 shared.travel={stage:'submitted'}; shared.awayTravel={destination:'Gangnam_Map'};
 shared.people.old={goal:{name:'old'}};
 h.load({schema:1,enabled:false,people:{new:{goalMemory:{}}}});
 assert.equal(h.context.wf.state,shared);
 assert.equal(h.collect(),shared);
 assert.equal(shared.travel,undefined);
 assert.equal(shared.awayTravel,undefined);
 assert.equal(shared.people.old,undefined);
 assert.ok(shared.people.new);
 h.load([]);
 assert.ok(shared.people.new,'invalid save payload must not erase valid state');
});
test('household cycles and popup watchers cannot overlap their game calls',async()=>{
 const game={phase:'in_game',map_id:'Cahaya_Map',possessed_entity_id:1,blocking:{}};
 let calls=0, releaseTime,releaseGame,holdGame=false;
 const h=appHarness((name,args)=>{
  if(name==='game.get_state') {calls++;return holdGame?new Promise(r=>releaseGame=r):game;}
  if(name==='environment.get_time') return new Promise(r=>releaseTime=r);
  if(name==='household.get_members') return {household_id:10,members:[]};
  if(name==='cli.help') return {id:args.command,access:'Public'};
  if(name==='environment.get_simulation') return {is_paused:true};
  return {};
 });
 h.load({schema:1,enabled:true,people:{},household:10});
 const running=h.intervals.get(10000)();
 await new Promise(setImmediate);
 assert.ok(releaseTime);
 await h.intervals.get(1500)();
 assert.equal(calls,1,'watcher must wait for the household cycle');
 releaseTime({day:0,hour:10,minute:0});
 await running;
 holdGame=true;
 const watching=h.intervals.get(1500)();
 await new Promise(setImmediate);
 assert.ok(releaseGame);
 await h.intervals.get(10000)();
 assert.equal(calls,2,'cycle must wait for the watcher');
 releaseGame(game);
 await watching;
});
