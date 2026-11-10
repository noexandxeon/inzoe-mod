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
const A = require(path.join(ui, 'agenda.js'));
const R = require(path.join(ui, 'recovery.js'));
const Rel = require(path.join(ui, 'relations.js'));
const Data = require(path.join(ui, 'game-data.js'));
function load(name, globals = {}) {
 const context = vm.createContext({ObserverLife:L, ObserverPolicy:P, ObserverGoalMemory:M, ObserverChoices:C,
  ObserverAgenda:A, ObserverRecovery:R, ObserverRelations:Rel, ObserverCareerPath:require(path.join(ui,'career-path.js')), ObserverGameData:Data, setTimeout:fn => {fn(); return 0;}, ...globals});
 vm.runInContext(fs.readFileSync(path.join(ui, name), 'utf8'), context);
 return context;
}

// ---------- 1. unified agenda ----------
test('a busy high-priority task cannot keep later work out: waiting raises the others', async () => {
 const d = {}, served = [];
 const tasks = [
  {key:'phone', label:'휴대폰', base:45, run:async()=>{served.push('phone');return true;}},
  {key:'hope', label:'소망', base:30, run:async()=>{served.push('hope');return true;}},
  {key:'social', label:'대화', base:20, run:async()=>{served.push('social');return true;}}
 ];
 for (let minute = 0; minute < 600; minute += 10) await A.run(d, tasks, minute);
 assert.ok(served.includes('hope'), 'hope was starved by the phone');
 assert.ok(served.includes('social'), 'social was starved by the phone');
 assert.ok(served.filter(k=>k==='phone').length > served.filter(k=>k==='social').length, 'priority still matters');
});
test('tasks that have nothing to do do not end the turn, and a near deadline jumps ahead', async () => {
 const d = {}, order = [];
 const tasks = [
  {key:'phone', base:45, run:async()=>{order.push('phone');return false;}},
  {key:'hope', base:20, deadline:130, run:async()=>{order.push('hope');return true;}},
  {key:'clean', base:30, run:async()=>{order.push('clean');return true;}}
 ];
 assert.equal(await A.run(d, tasks, 100), 'hope');
 assert.deepEqual(order, ['hope']);
 assert.equal(d.agenda.intent.key, 'hope');
});
test('while a goal action is running, only tasks allowed beside it are tried', async () => {
 const d = {}, order = [];
 const tasks = [
  {key:'clean', base:90, run:async()=>{order.push('clean');return true;}},
  {key:'phone', base:10, duringGoal:true, run:async()=>{order.push('phone');return false;}}
 ];
 assert.equal(await A.run(d, tasks, 0, {}, {skip:t=>!t.duringGoal}), null);
 assert.deepEqual(order, ['phone']);
 assert.equal(d.agenda.tasks.clean.preempted, 1);
});
test('long trips are pushed back late at night; starvation is reported for the window', async () => {
 const late = A.order({}, [{key:'trip',base:40,long:true,run(){}},{key:'clean',base:30,run(){}}], 0, {late:true});
 assert.equal(late[0].task.key, 'clean');
 const d = {};
 await A.run(d, [{key:'a',base:90,run:async()=>true},{key:'b',base:0,run:async()=>true}], 0, {}, {skip:t=>t.key==='b'});
 d.agenda.tasks.b.tried = null; d.agenda.tasks.b.since = 0;
 assert.deepEqual(A.starved(d, 400), ['b']);
 assert.deepEqual(JSON.parse(JSON.stringify(A.summary(d, 400))).starved, ['b']);
});
test('loading an earlier save resets agenda timestamps instead of treating them as future', async () => {
 const d = {};
 await A.run(d, [{key:'a',base:1,run:async()=>true}], 5000);
 await A.run(d, [{key:'a',base:1,run:async()=>false}], 100);
 assert.equal(d.agenda.tasks.a.tried, 100);
 assert.equal(d.agenda.tasks.a.served, null);
});

// ---------- 2. failure classification ----------
test('failure reasons map to different strategies', () => {
 assert.equal(R.classify({reason:'다른 조이가 사용 중입니다'}), 'occupied');
 assert.equal(R.classify({reason:'요리 기술 레벨 3 필요'}), 'skill');
 assert.equal(R.classify({sleeping:true}), 'sleeping');
 assert.equal(R.classify({notStarted:true, sameTargetMisses:1}), 'unknown');
 assert.equal(R.classify({notStarted:true, sameTargetMisses:2}), 'unknown');
 assert.equal(R.classify({reason:'대상에 도달할 수 없음'}), 'path');
 assert.equal(R.classify({noTargets:true}), 'missing');
 assert.equal(R.classify({disabled:true}), 'condition');
 assert.notEqual(R.strategy('path').next, R.strategy('occupied').next);
 assert.equal(R.skillFor('Art_Easel_Drawing'), 'Art');
 assert.equal(R.disabledReason({enabled:false,interaction_bag_id:'X',display_name:'그림',disabled_reason:'미술 기술 부족'}), '미술 기술 부족');
 assert.equal(R.disabledReason({enabled:true,disabled_reason:'x'}), '');
});
test('queue receipts use the native actor, bag and target rather than the queue size', () => {
 const request={bag:'PaintMasterpiece',target:20};
 const entries=R.queueEntries([
  {ownerEntityId:{value:2},pickedEntityId:{value:20},interactionBagId:request.bag},
  {ownerEntityId:{value:1},pickedEntityId:{value:21},interactionBagId:request.bag},
  {ownerEntityId:{value:1},pickedEntityId:{value:20},interactionBagId:'Art_Easel_Drawing'}
 ],'1');
 assert.equal(entries.length,2);
 assert.equal(R.actionState({queue_count:2,entries},request),'unseen');
 assert.equal(R.actionState({queue_count:2,entries:null},request),'unknown');
 assert.equal(R.actionState({current:{interaction_bag_id:request.bag}},request),'unseen');
 assert.equal(R.actionState({current:{interaction_bag_id:request.bag,target_entity_id:20,state:'Waiting'}},request),'queued');
 assert.equal(R.actionState({current:{interaction_bag_id:request.bag,target_entity_id:20,state:'Playing'}},request),'playing');
});

// ---------- 3. goal preparation chain in the real life-actions code ----------
function lifeHarness(opts = {}) {
 const decision = {}, writes = [], logs = [];
 let art = 1, finished = false, easelEnabled = opts.easelEnabled || false;
 const member = {entity_id:1, household_id:10, first_name:'진', age_group:'Adult'};
 const character = {locatedSiteId:{value:30}, worldTransform:{translation:{x:0,y:0,z:0}}};
 const snapshot = {queue:{queue_count:0}, stats:{stats:opts.stats||{}}, work:{}, hope:{selected:[{hope_id:'PaintGoal'}]}};
 const objects = opts.objects || [{entity_id:20, table_id:'Easel01', world_location:{x:1,y:0,z:0}}];
 const cli = async (name, args) => {
  if (name === 'skill.get_all') return {skills:[{id:'Art', level:art}]};
  if (name === 'entity.reflect') {
   if (args.Component === 'Skill') return {skills:{}};
   if (args.Component === 'Hope') return {selectedHopes:[{hopeId:'PaintGoal', missionId:{value:100}}]};
   if (args.Component === 'Mission') return {missionMap:{'(Value=100)':{bIsFinished:finished,conditionStates:[{currentCount:0,goalCount:1,compareType:'GreaterOrEqual'}]}}};
   return {};
  }
  if (name === 'data.table_get' && args.Alias === 'Hope') return {missionId:'M1'};
  if (name === 'data.table_get' && args.Alias === 'Mission') return {conditions:[{conditionType:'InteractionBagCount', conditionId1:opts.bag||'PaintMasterpiece'}]};
  if (name === 'interaction.search') return {results:[{interaction_bag_id:opts.bag||'PaintMasterpiece'}]};
  if (name === 'world.get_loaded_sites') return {map_id:'Cahaya_Map', sites:opts.sites||[{entity_id:30, id:'Home'}]};
  if (name === 'build.get_site_info') return {site_id:'Home', site_type:'Residence'};
  if (name === 'build.scan_objects') return {total:objects.length, objects};
  if (name === 'interaction.list_available') {
   const list = [{enabled:easelEnabled, interaction_bag_id:'PaintMasterpiece', display_name:'걸작 그리기', disabled_reason:easelEnabled?undefined:'미술 기술이 부족합니다'}];
   list.push({enabled:true, interaction_bag_id:'Art_Easel_Drawing', display_name:'그림 연습'});
   return {interactions:list};
  }
  if (name === 'schedule.diagnose') return {has_schedule:true};
  if (name === 'interaction.get_queue') return {queue_count:0};
  throw Error('Unexpected CLI ' + name + ' ' + JSON.stringify(args));
 };
 const members = opts.members || [member];
 const snaps = opts.snapshots || {};
 const actions = load('life-actions.js').ObserverLifeActions.create({cli, write:async(...a)=>writes.push(a), log:s=>logs.push(s), state:{},
  game:()=>({map_id:'Cahaya_Map', possessed_entity_id:1}), members:()=>members, snapshot:id=>snaps[id], active:()=>true});
 return {decision, member, character, snapshot, writes, logs, actions,
  art:n=>art=n, enable:()=>easelEnabled=true, finish:()=>finished=true};
}
const time = {day:0, hour:10, minute:0};
test('a disabled goal action with a skill reason becomes practice, growth, then a retry of the original goal', async () => {
 const h = lifeHarness();
 // The same turn diagnoses the missing skill and queues a suitable practice.
 assert.equal(await h.actions.pursueHope(h.member, h.character, h.decision, h.snapshot, time, 600, 1), true);
 const memory = h.decision.goalPlans[0].memory;
 assert.equal(memory.prep.skill, 'Art');
 assert.equal(memory.flow.step, 'prepare');
 assert.equal(h.writes.length, 1);
 assert.equal(h.writes[0][1].interaction_bag_id, 'Art_Easel_Drawing');
 assert.equal(h.decision.goal.practice.skill, 'Art');
 // 3) Real growth is observed: the plan moves to retrying the original goal.
 h.snapshot.queue.current = {interaction_bag_id:'Art_Easel_Drawing', target_entity_id:20};
 h.art(2);
 await h.actions.reviewGoal(h.member, h.decision, h.snapshot, 640);
 h.snapshot.queue.current = null;
 await h.actions.reviewGoal(h.member, h.decision, h.snapshot, 660);
 assert.ok(memory.prep.grown);
 assert.equal(memory.flow.step, 'retry');
 // 4) With the skill in place the original action is available and requested.
 h.enable();
 assert.equal(await h.actions.pursueHope(h.member, h.character, h.decision, h.snapshot, time, 700, 1), true);
 assert.equal(h.writes[1][1].interaction_bag_id, 'PaintMasterpiece');
 assert.equal(h.decision.goalPlans[0].memory.flow.step, 'confirm');
 assert.match(M.flowText(memory), /필요: Art 기술 → 준비: Art 연습 → 재시도 → 완료 확인/);
});

test('an employment leave goal without a supported schedule action never sends the actor to a public venue',async()=>{
 const h=lifeHarness({bag:'CareerCommon_UseVacation',
  sites:[{entity_id:30,id:'Home'},{entity_id:45,id:'Cahaya_Public_Park1'}],
  stats:{Hunger:{pct:80},Sleep:{pct:80},Toilet:{pct:80},Cleanliness:{pct:80}}});
 assert.equal(await h.actions.pursueHope(h.member,h.character,h.decision,h.snapshot,time,600,1),false);
 assert.equal(h.writes.length,0);
 assert.match(h.decision.goalPlans[0].status,/휴가·병가.*실행 경로 미확인/);
});

test('planning cannot consume a turn, while a dispatched command does even if its follow-up fails', async () => {
 const decision={}, ran=[];
 let receipts=0;
 const tasks=[
  {key:'wait',label:'대기',base:30,run:async()=>A.result('waiting','시설 확인',630)},
  {key:'plan',label:'판단',base:25,run:async()=>({ready:true})},
  {key:'command',label:'실행',base:20,run:async()=>{receipts++;throw Error('verification pending');}},
  {key:'later',label:'다른 행동',base:10,run:async()=>{ran.push('later');return true;}}
 ];
 assert.equal(await A.run(decision,tasks,600,{}, {receipt:()=>receipts}),'command');
 assert.deepEqual(ran,[]);
 assert.equal(decision.agenda.tasks.wait.status,'waiting');
 assert.equal(decision.agenda.tasks.plan.served_count,0);
 assert.equal(decision.agenda.intent.status,'requested');
 assert.equal(A.order(decision,tasks,620,{}).some(x=>x.task.key==='wait'),false);
});

test('an eligible missing fridge proceeds from household planning to verified placement without replacing an existing object',async()=>{
 const member={entity_id:1,household_id:10,age_group:'Adult',first_name:'진'};
 const snapshot={queue:{queue_count:0},stats:{stats:{}},trait:{}};
 const character={locatedSiteId:{value:30},worldTransform:{translation:{x:0,y:0,z:0}}};
 const existing=[{entity_id:20,table_id:'Bed02'},{entity_id:21,table_id:'Toilet04'},{entity_id:22,table_id:'Mop01'}];
 const floor={floors:[{floor_level:0,rooms:[{center:{x:500,y:500,z:0}}]}]};
 const decision={}, writes=[];
 let building=false, placed=false;
 const cli=async(name,args)=>{
  if(name==='world.get_loaded_sites')return {map_id:'Cahaya_Map',sites:[{entity_id:30,id:'Home'}]};
  if(name==='build.get_site_info')return {site_id:'Home',site_type:'Residence',counts:{rooms:3},coord_space:{min:{x:0,y:0},max:{x:1000,y:1000}}};
  if(name==='entity.reflect'&&args.Component==='Currency')return {currencyMap:{mew:5500}};
  if(name==='entity.reflect')return {residanceSiteId:{value:30}};
  if(name==='data.table_get'&&args.Row==='Fridge02')return {price:2600,objectCategory:'Fridge',objectTags:['Fridge']};
  if(name==='build.scan_floors')return floor;
  if(name==='build.scan_walls')return {walls:[],total:0};
  if(name==='build.get_mode_state')return building?{phase:'ready',site_id:'Home',editable:true}:{phase:'none'};
  if(name==='build.scan_objects'){
   const objects=placed?existing.concat({entity_id:23,table_id:'Fridge02'}):existing;
   return {objects,total:objects.length};
  }
  if(name==='building.place_object'){writes.push(args.object_table_id);placed=true;return {committed:true,entity_id:23,price:2600};}
  if(name==='build.exit_mode'){building=false;return {};}
  throw Error('Unexpected CLI '+name);
 };
 const life=load('life-actions.js').ObserverLifeActions.create({cli,write:async name=>{
  assert.equal(name,'build.enter_mode');building=true;return {accepted:true};
 },log(){},state:{},game:()=>({map_id:'Cahaya_Map',possessed_entity_id:1}),members:()=>[member],snapshot:()=>snapshot,active:()=>true});
 const plan={cash:5500,reserve:2000};
 await life.householdPlan(member,character,decision,plan,600);
 assert.equal(decision.housePlan.missing[0].item,'Fridge02');
 assert.equal((await life.furnish(member,character,decision,plan,snapshot,[],600,1)).status,'verified');
 assert.deepEqual(writes,['Fridge02']);
 assert.equal(decision.housePlan.missing.length,0);
 assert.equal(await life.furnish(member,character,decision,plan,snapshot,[],610,1),false);
});
test('an object another household member is using is skipped in favour of a free one', async () => {
 const objects = [20,21].map(id => ({entity_id:id, table_id:'Easel01', world_location:{x:id,y:0,z:0}}));
 const h = lifeHarness({objects, easelEnabled:true, members:[{entity_id:1},{entity_id:2,first_name:'하'}],
  snapshots:{'2':{queue:{current:{interaction_bag_id:'Art_Easel_Drawing', target_entity_id:20}}}}});
 assert.equal(await h.actions.pursueHope(h.member, h.character, h.decision, h.snapshot, time, 600, 1), true);
 assert.equal(h.writes[0][1].target_entity_id, '21');
});
test('when the only object is in use, the goal waits with an occupied reason instead of retrying it', async () => {
 const h = lifeHarness({easelEnabled:true, members:[{entity_id:1},{entity_id:2,first_name:'하'}],
  snapshots:{'2':{queue:{current:{interaction_bag_id:'Art_Easel_Drawing', target_entity_id:20}}}}});
 assert.equal(await h.actions.pursueHope(h.member, h.character, h.decision, h.snapshot, time, 600, 1), false);
 assert.equal(h.decision.goalPlans[0].memory.block.kind, 'occupied');
 assert.equal(h.writes.length, 0);
});
test('exact pending work is retained while an unrelated queue releases the goal and retries on another object', async () => {
 const h = lifeHarness({easelEnabled:true,objects:[
  {entity_id:20,table_id:'Easel01',world_location:{x:1,y:0,z:0}},
  {entity_id:21,table_id:'Easel01',world_location:{x:2,y:0,z:0}}
 ]});
 assert.equal(await h.actions.pursueHope(h.member, h.character, h.decision, h.snapshot, time, 600, 1),true);
 h.decision.goal.sentAt=0;
 h.snapshot.queue={queue_count:1,entries:[{bag:'PaintMasterpiece',target:'20'}]};
 await h.actions.reviewGoal(h.member,h.decision,h.snapshot,640);
 assert.equal(h.decision.goal.target,'20');
 assert.equal(await h.actions.pursueHope(h.member,h.character,h.decision,h.snapshot,time,640,1),false);
 h.snapshot.queue.entries=[{bag:'Self_Idle_01',target:'1'}];
 await h.actions.reviewGoal(h.member,h.decision,h.snapshot,641);
 assert.equal(h.decision.goal,null);
 assert.equal(h.decision.goalPlans[0].memory.block.kind,'unknown');
 assert.equal(M.allowed(h.decision,h.decision.goalPlans[0],'Art_Easel_Drawing','20',641),true);
 assert.equal(await h.actions.pursueHope(h.member,h.character,h.decision,h.snapshot,time,641,1),true);
 assert.deepEqual(h.writes.map(write=>write[1].target_entity_id),['20','21']);
});

test('a stale goal is released during sleep and can use the same valid object after waking', async () => {
 const h=lifeHarness({easelEnabled:true});
 assert.equal(await h.actions.pursueHope(h.member,h.character,h.decision,h.snapshot,time,600,1),true);
 h.decision.goal.sentAt=0;
 h.snapshot.queue={queue_count:0,current:{interaction_bag_id:'Sleep_Bed',target_entity_id:31,state:'Playing'}};
 await h.actions.reviewGoal(h.member,h.decision,h.snapshot,640);
 assert.equal(h.decision.goal,null);
 assert.equal(h.decision.goalPlans[0].memory.next,'기상 후 다시 시도');
 assert.equal(await h.actions.pursueHope(h.member,h.character,h.decision,h.snapshot,time,640,1),false);
 h.snapshot.queue={queue_count:0};
 assert.equal(await h.actions.pursueHope(h.member,h.character,h.decision,h.snapshot,time,660,1),true);
 assert.deepEqual(h.writes.map(write=>write[1].target_entity_id),['20','20']);
});

// ---------- 4. relationship goals reach relationship actions ----------
test('a new-relationship goal greets a stranger but not someone already known', async () => {
 const h = lifeHarness();
 const plan = {name:'MakeNewFriend', instance:5, conditions:[{conditionType:'NewRelationshipCount', conditionId1:'Friend'}]};
 h.decision.goalPlans = [plan];
 const offered = [{enabled:true, interaction_bag_id:'Co_Talk_Hello', display_name:'인사하기'}];
 const stranger = await h.actions.goalConversation(h.decision, offered, {entity_id:9}, 600, null, {stats:{}});
 assert.equal(stranger.action.interaction_bag_id, 'Co_Talk_Hello');
 const known = await h.actions.goalConversation(h.decision, offered, {entity_id:9}, 600, null, {stats:{Friendship:{value:40}}});
 assert.equal(known, null);
});
test('marriage and lover goals are routed to courtship instead of being dropped', async () => {
 const h = lifeHarness();
 const plan = {name:'GetMarried', instance:6, conditions:[{conditionType:'Marriage', conditionId1:'None'}]};
 const result = await h.actions.goalConversation(h.decision, [], {entity_id:9, age_group:'Adult'}, 600, {plan}, {stats:{}});
 assert.equal(result.romance, true);
 const lover = {name:'StartRomance', instance:7, conditions:[{conditionType:'RelationshipCount', conditionId1:'Youth_Lover'}]};
 assert.equal((await h.actions.goalConversation(h.decision, [], {entity_id:9, age_group:'Adult'}, 600, {plan:lover}, {})).romance, true);
});

// ---------- 5. contact memory ----------
test('contact memory separates not-executed, improved and rejected attempts, with different next meetings', () => {
 const life = {};
 Rel.attempted(life, 1, 9, {name:'민'}, {stats:{Friendship:{value:10}}}, 'Co_Talk', 'talk', 100);
 let c = Rel.settle(life, 1, 9, {stats:{Friendship:{value:10}}}, 200, {notStarted:true});
 assert.equal(c.outcome, 'not_executed');
 assert.equal(c.next.at, 260);
 Rel.attempted(life, 1, 9, null, {stats:{Friendship:{value:10}}}, 'Co_Talk', 'talk', 300);
 c = Rel.settle(life, 1, 9, {stats:{Friendship:{value:14}}}, 400, {});
 assert.equal(c.outcome, 'improved');
 assert.deepEqual(Rel.reunion(life, 1, 600), ['9']);
 Rel.attempted(life, 1, 9, null, {stats:{}}, 'Co_Love_Confession_01_ToNPC', 'confess', 700);
 c = Rel.settle(life, 1, 9, {stats:{}}, 900, {formalExpired:true});
 assert.equal(c.outcome, 'rejected');
 assert.equal(Rel.ready(life, 1, 9, 900 + 1440), false);
 assert.deepEqual(Rel.reunion(life, 1, 900 + 3000), []);
 assert.equal(JSON.parse(JSON.stringify(life)).contacts['1']['9'].name, '민');
});

// ---------- 6. save / travel recovery ----------
const household = {household_id:11, members:[{entity_id:1}]};
const game = {phase:'in_game', loading:false, map_id:'Cahaya_Map'};
test('returning from a trip resumes a Start that the loaded city save does not contain', () => {
 const mirror = {v:1, at:1000, enabled:true, scope:'current', household:'11',
  awayTravel:{household:'11', awayHousehold:'31', origin:'Cahaya_Map', destination:'Gangnam_Map'}};
 const plan = R.resumeDecision({enabled:false}, mirror, household, game, 2000);
 assert.equal(plan.enable, true);
 assert.equal(plan.returning, true);
 assert.equal(plan.reason, '여행 귀환');
 assert.equal(R.resumeDecision({enabled:false}, {...mirror, stoppedByUser:true}, household, game, 2000), null);
 assert.equal(R.resumeDecision({enabled:false}, {...mirror, enabled:false}, household, game, 2000), null);
 assert.equal(R.resumeDecision({enabled:false}, {...mirror, household:'99', awayTravel:null}, household, game, 2000), null);
 assert.equal(R.resumeDecision({enabled:false}, mirror, household, game, 1000 + 7*3600*1000), null);
 assert.equal(R.resumeDecision({enabled:true}, mirror, household, game, 2000).enable, false);
});
test('payments and replies handled after the last save are merged back, never removed', () => {
 const state = {people:{'1':{payments:{a:{phase:'ledger-matched'}}}}};
 const mirror = R.mirrorOf({enabled:true, people:{'1':{payments:{a:{phase:'x'}, b:{phase:'unconfirmed'}}, replyRequests:{r:{phase:'outgoing'}}, goal:{}}}}, 5, false);
 assert.equal(mirror.people['1'].goal, undefined);
 assert.equal(R.mergeProcessed(state, mirror), 2);
 assert.equal(state.people['1'].payments.a.phase, 'ledger-matched');
 assert.equal(state.people['1'].payments.b.phase, 'unconfirmed');
 assert.equal(state.people['1'].replyRequests.r.phase, 'outgoing');
});

function appHarness(execute, beforeSave) {
 const elements = new Map(), intervals = new Map(), saved = {};
 const element = () => ({style:{}, addEventListener(){}, appendChild(){}, setAttribute(){}, scrollHeight:0, textContent:'', innerHTML:''});
 let deliver, trigger, shows=0;
 const context = vm.createContext({console:{log(){}, error(){}}, engine:{}, innerWidth:1920, innerHeight:1080,
  document:{body:element(), getElementById:id => {if (!elements.has(id)) elements.set(id, element()); return elements.get(id);},
   createElement:element, addEventListener(){}},
  inzoi:{cli:{execute:(name, args) => {
   if (name === 'uimod.cfg_save') {if (beforeSave) beforeSave(args); saved[args.key] = args.value; return {success:true};}
   if (name === 'uimod.cfg_load') return saved[args.key] ? {value:saved[args.key]} : {value:null};
   return execute(name, args);
  }}, view:{show(){shows++;}}, trigger:{onActivated:fn=>trigger=fn}, saveState:{register(){}, onLoad:fn => deliver = fn}},
  setInterval:(fn, ms) => intervals.set(ms, fn), setTimeout:() => 0, clearTimeout(){}, addEventListener(){}, Date});
 context.window = context;
 for (const name of ['window','policy','protocol','life','child-care','game-data','goal-memory','scoreboard','agenda','recovery','career-path','persona','why','family','rotation','fieldcheck','relations','gathering','choices','life-actions','panels','travel','app'])
  vm.runInContext(fs.readFileSync(path.join(ui, name + '.js'), 'utf8'), context, {filename:name + '.js'});
 return {context, intervals, saved, elements, load:value => deliver(JSON.stringify(value)), trigger:event=>trigger(event), shows:()=>shows};
}
test('the game loop saves one 15-day archive, retries a failed write and preserves the usual reports', async () => {
 let day=0, now=1000000, writes=[], failed=false;
 const h=appHarness(name=>{
  if(name==='game.get_state')return {phase:'in_game',map_id:'Cahaya_Map',possessed_entity_id:1,blocking:{}};
  if(name==='environment.get_time')return {day,hour:0,minute:0};
  if(name==='environment.get_simulation')return {is_paused:true};
  if(name==='household.get_members')return {household_id:11,members:[{entity_id:1,first_name:'가',household_id:11}]};
  return {};
 },args=>{
  if(!args.key.startsWith('observer-15d-'))return;
  writes.push(args.key);
  assert.match(args.section,/\/saved$/);
  if(!failed){failed=true;throw Error('temporary save failure');}
 });
 h.context.Date=class extends Date {static now(){return now;}};
 h.load({schema:1,enabled:true,household:11,people:{}});
 const cycle=h.intervals.get(10000), S=h.context.ObserverScoreboard, state=h.context.wf.state;
 const observe=(d)=>S.observe(state,d*1440+12,1,{stats:{}},now);
 await cycle();
 observe(0);
 for(day=1;day<=15;day++){
  if(day!==4)observe(day);
  S.event(state,{minute:day*1440+20,zoi:1,kind:'blocked',reason:'skill'});
 }
 day=15;
 await cycle();
 assert.equal(writes.length,0);
 day=16;
 now+=60000;
 await cycle();
 assert.equal(writes.length,1);
 assert.equal(h.saved[writes[0]],undefined);
 await cycle();
 assert.equal(writes.length,1);
 now+=60001;
 await cycle();
 assert.deepEqual(writes,[writes[0],writes[0]]);
 const report=JSON.parse(h.saved[writes[0]]);
 assert.equal(report.period.fromDay,1);
 assert.equal(report.period.toDayExclusive,16);
 assert.deepEqual(report.period.daysWithoutObservations,[4]);
 assert.equal(report.period.people[0].observedDays,14);
 assert.equal(report.period.people[0].blockers[0].records,15);
 assert.equal(Object.keys(report.score.days).length,15);
 assert.ok(h.saved['observer-auto']);
 await cycle();
 assert.equal(writes.length,2);
});
test('the quick observer sees a different household member start and finish a goal without issuing a command', async () => {
 const calls=[], start=Date.now(), adult={entity_id:1,first_name:'가',household_id:11,age_group:'Adult'};
 const second={...adult,entity_id:2,first_name:'나'};
 let now=start, minute=25, current=null, completed=false;
 const h=appHarness((name,args)=>{
  calls.push(name);
  if(name==='game.get_state')return {phase:'in_game',map_id:'Cahaya_Map',possessed_entity_id:1,blocking:{}};
  if(name==='environment.get_time')return {day:0,hour:10,minute};
  if(name==='environment.get_simulation')return {is_paused:true};
  if(name==='household.get_members')return {household_id:11,members:[adult,second]};
  if(name==='interaction.get_queue'&&args.entity_id==='2')return {queue_count:current?0:1,current};
  if(name==='entity.reflect'&&args.Component==='Interaction')return {interactionQueue:[
   {ownerEntityId:{value:2},pickedEntityId:{value:20},interactionBagId:'PaintMasterpiece'}
  ]};
  if(name==='entity.reflect'&&args.Component==='Mission')return {missionMap:{'(Value=100)':{bIsFinished:completed,conditionStates:[{currentCount:completed?1:0,goalCount:1}]}}};
  return {};
 });
 h.context.Date=class extends Date {static now(){return now;}};
 h.load({schema:1,enabled:true,household:11,people:{'2':{
  goal:{name:'PaintGoal',kind:'hope',instance:100,bag:'PaintMasterpiece',target:'20',at:600,sentAt:start-26000,progress:'0/1'},
  lastAction:{bag:'PaintMasterpiece',target:'20',at:start-26000,minute:600,status:'requested'}
 }}});
 await h.intervals.get(10000)();
 const decision=h.context.wf.state.people['2'];
 await h.intervals.get(1500)();
 assert.equal(decision.lastAction.status,'queued');
 now+=3100;minute+=2;current={interaction_bag_id:'PaintMasterpiece',state:'Playing',target_entity_id:20};
 await h.intervals.get(1500)();
 assert.equal(decision.lastAction.status,'started');
 now+=3100;minute+=2;current={interaction_bag_id:'Sleep_Bed',state:'Playing',target_entity_id:31};completed=true;
 await h.intervals.get(1500)();
 assert.equal(decision.lastAction.status,'ended');
 assert.equal(decision.goal,null);
 assert.equal(decision.goalMemory['hope:100:PaintGoal'].phase,'completed');
 assert.equal(calls.includes('interaction.execute'),false);
});
test('the observer itself resumes after a travel return loads a save without Start', async () => {
 let map = 'Cahaya_Map';
 const h = appHarness((name, args) => {
  if (name === 'game.get_state') return {phase:'in_game', map_id:map, possessed_entity_id:1, blocking:{}};
  if (name === 'environment.get_time') return {day:3, hour:10, minute:0};
  if (name === 'household.get_members') return {household_id:11, name:'진', members:[{entity_id:1, first_name:'가', household_id:11}]};
  if (name === 'cli.help') return {id:args.command, access:'Public'};
  if (name === 'environment.get_simulation') return {is_paused:true};
  return {};
 });
 h.saved['observer-resume'] = JSON.stringify({v:1, at:Date.now(), enabled:true, scope:'current', household:'11', background:true,
  awayTravel:{household:'11', awayHousehold:'31', actor:'1', origin:'Cahaya_Map', destination:'Gangnam_Map', room:'102호'},
  people:{'1':{payments:{bill:{phase:'unconfirmed'}}}}});
 h.load({schema:1, enabled:false, people:{'1':{}}, household:11});
 await h.intervals.get(10000)();
 const state = h.context.wf.state;
 assert.equal(state.enabled, true);
 assert.equal(state.awayTravel, null);
 assert.equal(state.lastReturn.from, 'Gangnam_Map');
 assert.ok(state.people['1'].payments.bill);
 const log = h.elements.get('log').textContent;
 assert.match(log, /자동 관리 재개 · 여행 귀환/);
 assert.match(log, /여행 귀환 확인/);
 assert.equal(JSON.parse(h.saved['observer-resume']).enabled, true);
});
test('Stop is remembered: a later reload does not restart management', async () => {
 const h = appHarness((name, args) => {
  if (name === 'game.get_state') return {phase:'in_game', map_id:'Cahaya_Map', possessed_entity_id:1, blocking:{}};
  if (name === 'environment.get_time') return {day:3, hour:10, minute:0};
  if (name === 'household.get_members') return {household_id:11, members:[{entity_id:1, first_name:'가', household_id:11}]};
  if (name === 'cli.help') return {id:args.command, access:'Public'};
  if (name === 'environment.get_simulation') return {is_paused:true};
  return {};
 });
 h.load({schema:1, enabled:true, people:{}, household:11});
 h.elements.get('stop').onclick();
 h.load({schema:1, enabled:false, people:{}, household:11});
 await h.intervals.get(10000)();
 assert.equal(h.context.wf.state.enabled, false);
});
test('a few failing calls during a city transition pause and retry instead of switching off', async () => {
 let fail = true, now = 1e12;
 const RealDate = Date;
 const h = appHarness((name, args) => {
  if (name === 'game.get_state') return {phase:'in_game', map_id:'Cahaya_Map', possessed_entity_id:1, blocking:{}};
  if (name === 'environment.get_time') return {day:3, hour:10, minute:0};
  if (name === 'household.get_members') { if (fail) throw Error('loading'); return {household_id:11, members:[]}; }
  if (name === 'cli.help') return {id:args.command, access:'Public'};
  if (name === 'environment.get_simulation') return {is_paused:true};
  return {};
 });
 h.context.Date = class extends RealDate { static now() { return now; } };
 h.load({schema:1, enabled:true, people:{}, household:11});
 for (let i = 0; i < 5; i++) { await h.intervals.get(10000)(); now += 400000; }
 assert.equal(h.context.wf.state.enabled, true);
 fail = false;
 await h.intervals.get(10000)();
 assert.equal(h.context.wf.state.enabled, true);
});

test('an infant with a misleading employment flag or an existing job never enters the career planner', async () => {
 for (const hasCareer of [false,true]) {
  const calls=[];
  const child={entity_id:1, first_name:'아기', household_id:11, age_group:'Infant', employable:true, has_career:hasCareer};
  const h=appHarness(name=>{
   calls.push(name);
   if (name==='game.get_state') return {phase:'in_game',map_id:'Cahaya_Map',possessed_entity_id:1,blocking:{}};
   if (name==='environment.get_time') return {day:3,hour:8,minute:15};
   if (name==='environment.get_simulation') return {is_paused:false};
   if (name==='household.get_members') return {household_id:11,name:'가구',members:[child]};
   if (name==='entity.reflect') return {locatedCityName:'Cahaya_Map',householdEntityId:{value:11}};
   if (name==='stat.get_all') return {stats:{Hunger:{pct:100}},stat_names:{Hunger:'배고픔'}};
   if (name==='interaction.get_queue') return {queue_count:0,is_empty:true};
   return {};
  });
  h.load({schema:1,enabled:true,people:{},household:11});
  await h.intervals.get(10000)();
  assert.ok(h.context.wf.state.people['1'].childCare);
  assert.equal(calls.some(name=>/^(?:career\.|hope\.)/.test(name)),false);
  assert.equal(calls.includes('interaction.execute'),false);
 }
});

test('collapsing the overlay keeps the running observer and restores its controls', async () => {
 let cycles=0;
 const h=appHarness(name=>{
  if (name==='game.get_state') {cycles++;return {phase:'in_game',map_id:'Cahaya_Map',possessed_entity_id:1,blocking:{}};}
  if (name==='environment.get_time') return {day:3,hour:8,minute:15};
  if (name==='environment.get_simulation') return {is_paused:true};
  if (name==='household.get_members') return {household_id:11,members:[]};
  return {};
 });
 h.load({schema:1,enabled:true,people:{},household:11});
 h.elements.get('app-root')._applyMinimize(true);
 await h.intervals.get(10000)();
 assert.equal(h.context.wf.state.enabled,true);
 assert.equal(cycles,1);
 assert.equal(h.elements.get('content').style.display,'none');
 h.elements.get('app-root')._applyMinimize(false);
 assert.equal(h.elements.get('content').style.display,'');
 assert.equal(h.elements.get('minimize-btn').textContent,'숨기기');
});

test('the recovery shortcut restores and relocates the existing overlay without restarting management', () => {
 const h=appHarness(()=>({}));
 h.load({schema:1,enabled:true,people:{},household:11});
 const root=h.elements.get('app-root');
 root._applyMinimize(true);
 root.style.left='2890px';
 h.trigger({type:'keybind',key:'O'});
 assert.equal(h.shows(),1);
 assert.equal(root._minimized,false);
 assert.equal(root.style.left,'40px');
 assert.equal(root.style.top,'60px');
 assert.equal(h.context.wf.state.enabled,true);
});
