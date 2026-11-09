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
function load(name, globals = {}) {
 const context = vm.createContext({ObserverLife:L, ObserverPolicy:P, ObserverGoalMemory:M, ObserverChoices:C,
  ObserverAgenda:A, ObserverRecovery:R, ObserverRelations:Rel, setTimeout:fn => {fn(); return 0;}, ...globals});
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
 assert.equal(R.classify({notStarted:true, sameTargetMisses:2}), 'path');
 assert.equal(R.classify({noTargets:true}), 'missing');
 assert.equal(R.classify({disabled:true}), 'condition');
 assert.notEqual(R.strategy('path').next, R.strategy('occupied').next);
 assert.equal(R.skillFor('Art_Easel_Drawing'), 'Art');
 assert.equal(R.disabledReason({enabled:false,interaction_bag_id:'X',display_name:'그림',disabled_reason:'미술 기술 부족'}), '미술 기술 부족');
 assert.equal(R.disabledReason({enabled:true,disabled_reason:'x'}), '');
});
test('a target that twice accepted a request but never started is avoided, then retried later', () => {
 const store = {};
 assert.equal(R.miss(store, 20, 100), 1);
 assert.equal(R.reachable(store, 20, 120), true);
 assert.equal(R.miss(store, 20, 130), 2);
 assert.equal(R.reachable(store, 20, 200), false);
 assert.equal(R.reachable(store, 21, 200), true);
 assert.equal(R.reachable(store, 20, 371), true);
});

// ---------- 3. goal preparation chain in the real life-actions code ----------
function lifeHarness(opts = {}) {
 const decision = {}, writes = [], logs = [];
 let art = 1, finished = false, easelEnabled = opts.easelEnabled || false;
 const member = {entity_id:1, household_id:10, first_name:'진', age_group:'Adult'};
 const character = {locatedSiteId:{value:30}, worldTransform:{translation:{x:0,y:0,z:0}}};
 const snapshot = {queue:{queue_count:0}, stats:{stats:{}}, work:{}, hope:{selected:[{hope_id:'PaintGoal'}]}};
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
  if (name === 'data.table_get' && args.Alias === 'Mission') return {conditions:[{conditionType:'InteractionBagCount', conditionId1:'PaintMasterpiece'}]};
  if (name === 'interaction.search') return {results:[{interaction_bag_id:'PaintMasterpiece'}]};
  if (name === 'world.get_loaded_sites') return {map_id:'Cahaya_Map', sites:[{entity_id:30, id:'Home'}]};
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
 // 1) Original action is disabled for lack of skill: the goal records a preparation step, no action yet.
 assert.equal(await h.actions.pursueHope(h.member, h.character, h.decision, h.snapshot, time, 600, 1), false);
 const memory = h.decision.goalPlans[0].memory;
 assert.equal(memory.prep.skill, 'Art');
 assert.equal(memory.block.kind, 'skill');
 assert.equal(memory.flow.step, 'prepare');
 assert.equal(h.writes.length, 0);
 // 2) Next turn practises the inferred skill instead of retrying the disabled action.
 assert.equal(await h.actions.pursueHope(h.member, h.character, h.decision, h.snapshot, time, 620, 1), true);
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
test('a request that never starts twice marks the target unreachable and records a path block', async () => {
 const h = lifeHarness({easelEnabled:true});
 for (const minute of [600, 700]) {
  assert.equal(await h.actions.pursueHope(h.member, h.character, h.decision, h.snapshot, time, minute, 1), true);
  h.decision.goal.sentAt = 0;
  await h.actions.reviewGoal(h.member, h.decision, h.snapshot, minute + 40);
  h.decision.goalRetry = {};
  h.decision.goalPlans[0].memory.failures = {};
 }
 assert.equal(h.decision.goalPlans[0].memory.block.kind, 'path');
 assert.equal(R.reachable(h.decision.unreachable, 20, 800), false);
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

function appHarness(execute) {
 const elements = new Map(), intervals = new Map(), saved = {};
 const element = () => ({style:{}, addEventListener(){}, appendChild(){}, setAttribute(){}, scrollHeight:0, textContent:'', innerHTML:''});
 let deliver;
 const context = vm.createContext({console:{log(){}, error(){}}, engine:{},
  document:{body:element(), getElementById:id => {if (!elements.has(id)) elements.set(id, element()); return elements.get(id);},
   createElement:element, addEventListener(){}},
  inzoi:{cli:{execute:(name, args) => {
   if (name === 'uimod.cfg_save') {saved[args.key] = args.value; return {success:true};}
   if (name === 'uimod.cfg_load') return saved[args.key] ? {value:saved[args.key]} : {value:null};
   return execute(name, args);
  }}, view:{}, saveState:{register(){}, onLoad:fn => deliver = fn}},
  setInterval:(fn, ms) => intervals.set(ms, fn), setTimeout:() => 0, clearTimeout(){}, addEventListener(){}, Date});
 context.window = context;
 for (const name of ['window','policy','protocol','life','goal-memory','agenda','recovery','relations','choices','life-actions','panels','travel','app'])
  vm.runInContext(fs.readFileSync(path.join(ui, name + '.js'), 'utf8'), context, {filename:name + '.js'});
 return {context, intervals, saved, elements, load:value => deliver(JSON.stringify(value))};
}
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
