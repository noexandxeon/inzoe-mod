'use strict';
// 0.6.4: fixes from the first in-game run with the game MCP connected (day 1003-1004, 5x speed).
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs'), vm = require('node:vm');
const ui = path.join(__dirname, '..', 'ZoiObserver_XDX478', 'ui', 'HouseholdObserver');
const G = require(path.join(ui, 'gathering.js'));
const CP = require(path.join(ui, 'career-path.js'));
const L = require(path.join(ui, 'life.js'));

function actions(execute, game = {}) {
  const ctx = vm.createContext({ObserverLife: L, ObserverPolicy: require(path.join(ui, 'policy.js')),
    ObserverGoalMemory: require(path.join(ui, 'goal-memory.js')), ObserverChoices: require(path.join(ui, 'choices.js')),
    ObserverRecovery: require(path.join(ui, 'recovery.js')), ObserverRelations: require(path.join(ui, 'relations.js')), ObserverCareerPath: CP,
    ObserverGameData: require(path.join(ui, 'game-data.js')), console});
  ctx.root = ctx; vm.runInContext('this.root=this;', ctx);
  vm.runInContext(fs.readFileSync(path.join(ui, 'life-actions.js'), 'utf8'), ctx);
  const calls = [], writes = [];
  const a = ctx.ObserverLifeActions.create({cli: async (n,args) => { calls.push(n); if(execute)return execute(n,args); throw Error(n); },
    write: async (n,args) => { calls.push(n); writes.push(args); },
    log: () => {}, state: {}, game: () => game, members: () => []});
  return {a, calls, writes};
}
const hungry = {stats: {Hunger: {pct: 5}, Toilet: {pct: 80}, Sleep: {pct: 80}, Cleanliness: {pct: 80}}};

test('a queued meal is waited for instead of queuing a second and third one', async () => {
  const {a, calls} = actions();
  const d = {needPending: {key: 'Hunger', bag: 'Eat_Fridge_Served_Soup', target: '8738', minute: 1000, at: Date.now() - 60000}, catLow: {Hunger: 900}};
  const snapshot = {stats: hungry, queue: {queue_count: 1, entries: null, current: {interaction_bag_id: 'Walk_To', state: 'Playing'}}, work: {}};
  assert.equal(await a.needs({entity_id: 1}, {}, d, snapshot, 1030, 't'), true);
  assert.deepEqual(calls, []);
  assert.equal(d.catLow.Hunger, 1030, 'the emergency donut clock restarts while the meal is on its way');
});

test('a meal that never showed up, or is 90 game minutes old, is requested again', async () => {
  const {a} = actions();
  const gone = {needPending: {key: 'Hunger', bag: 'Eat_Fridge_Served_Soup', target: '8738', minute: 1000, at: Date.now() - 60000}};
  const idle = {stats: hungry, queue: {queue_count: 0, entries: [], current: null}, work: {is_at_work: true}};
  assert.equal(await a.needs({entity_id: 1}, {}, gone, idle, 1030, 't'), false);
  assert.equal(gone.needPending, null);
  const old = {needPending: {key: 'Hunger', bag: 'Eat_Fridge_Served_Soup', target: '8738', minute: 1000, at: Date.now() - 60000}};
  const busy = {stats: hungry, queue: {queue_count: 2, entries: null, current: null}, work: {is_at_work: true}};
  assert.equal(await a.needs({entity_id: 1}, {}, old, busy, 1095, 't'), false);
  assert.equal(old.needPending, null);
});

function mealAt(site,{fridge=true,hidden=false,carried=false,alternative=false}={}){
 const character={locatedSiteId:{value:site},inventoryEntityId:{value:12},worldTransform:{translation:{x:0,y:0,z:0}}};
 const mock=actions((name,args)=>{
  if(name==='entity.reflect'){
   if(args.Component==='RabbitHole')return {currentRabbitHoleId:hidden?'IT_Work':'None'};
   if(args.entity_id==='10')return {residanceSiteId:{value:30}};
   if(args.entity_id==='12')return {ownedEntityIds:carried?[{value:72}]:[]};
   if(args.entity_id==='72')return {carriableObjectType:'Food',locatedSiteId:{value:-1}};
   return character;
  }
  if(name==='world.get_loaded_sites')return {map_id:'Gangnam_Map',sites:[{entity_id:site,id:'Room'}]};
  if(name==='build.get_site_info')return {site_id:'Room'};
  if(name==='build.scan_objects')return {total:fridge?1:0,objects:fridge?[{entity_id:71,table_id:'Fridge04',world_location:{x:2,y:0,z:0}}]:[]};
  if(name==='interaction.get_queue')return {queue_count:0};
  if(name==='interaction.list_available')return {interactions:[{
   interaction_bag_id:args.target_entity_id==='72'?'Eat_Served_Meal':'Eat_Fridge_Served_Soup',enabled:true,display_name:'먹기'
  }].concat(alternative?[{interaction_bag_id:'Eat_Fridge_Served_Bibimbap',enabled:true,display_name:'비빔밥 먹기'}]:[])};
  throw Error(name);
 },{map_id:'Gangnam_Map',possessed_entity_id:1});
 return {...mock,character,member:{entity_id:1,household_id:10}};
}

test('the commute window permits an available meal at home before hunger turns urgent',async()=>{
 const h=mealAt(30), d={}, queue={queue_count:0};
 const stats={stats:{...hungry.stats,Hunger:{pct:47}}};
 const work={has_job:true,is_working_day:true,is_commute_time:true,is_working_time:false,home_site_id:30,work_site_id:40};
 assert.equal(await h.a.needs(h.member,h.character,d,{stats,work,queue},1000,'t'),true);
 assert.equal(h.writes[0].interaction_bag_id,'Eat_Fridge_Served_Soup');
 assert.equal(await h.a.needs(h.member,h.character,d,{stats,work,queue},1003,'t'),true);
 assert.equal(h.writes.length,1);
});

test('a critical workplace meal can use the actor inventory without leaving or interrupting work',async()=>{
 const work={is_at_work:true,work_site_id:40,home_site_id:30};
 const queue={queue_count:0};
 const h=mealAt(40,{fridge:false,carried:true});
 assert.equal(await h.a.needs(h.member,h.character,{}, {stats:hungry,work,queue},1000,'t'),true);
 assert.equal(h.writes[0].target_entity_id,'72');
 const hidden=mealAt(40,{hidden:true});
 assert.equal(await hidden.a.needs(hidden.member,hidden.character,{}, {stats:hungry,work,queue},1000,'t'),false);
 assert.equal(hidden.writes.length,0);
 const noFood=mealAt(40,{fridge:false});
 assert.equal(await noFood.a.needs(noFood.member,noFood.character,{}, {stats:hungry,work,queue},1000,'t'),false);
 assert.equal(noFood.writes.length,0);
 const working=mealAt(40);
 assert.equal(await working.a.needs(working.member,working.character,{},{
  stats:hungry,work,queue:{queue_count:0,current:{interaction_bag_id:'Work_Computer'}}
 },1000,'t'),false);
 assert.equal(working.writes.length,0);
});

test('a meal continuation is protected, and a meal with no measured gain gives way to a different meal',async()=>{
 const h=mealAt(40,{alternative:true}), work={is_at_work:true,work_site_id:40,home_site_id:30}, d={};
 const snap={stats:hungry,work,queue:{queue_count:0}};
 assert.equal(await h.a.needs(h.member,h.character,d,snap,1000,'t'),true);
 d.mealAttempt.at=Date.now()-60000;
 snap.queue.current={interaction_bag_id:'Next_Food_Start_Eat',state:'Playing'};
 assert.equal(await h.a.needs(h.member,h.character,d,snap,1070,'t'),true);
 assert.equal(h.writes.length,1);
 delete snap.queue.current;
 assert.equal(await h.a.needs(h.member,h.character,d,snap,1080,'t'),true);
 assert.deepEqual(h.writes.map(w=>w.interaction_bag_id),['Eat_Fridge_Served_Soup','Eat_Fridge_Served_Bibimbap']);
 snap.stats={stats:{...hungry.stats,Hunger:{pct:54}}};
 assert.equal(await h.a.needs(h.member,h.character,d,snap,1090,'t'),false);
 assert.equal(d.mealAttempt,null);
});

test('names the game uses for other things are not invitations or parties', () => {
  ['Object_Closet01_OutfitCategory_Party|파티복으로 갈아입기', 'Self_OutfitCategory_Party|파티복으로 갈아입기', 'Use_Mannequin_SetCategory_Party|파티복',
    'SetTable_BirthDay_Party|모임 상 차리기', 'Event_ComeHere_Party|참석자 모으기', 'Event_MoveToPartyMain|주인공 찾아 가기',
    'Co_RandomEvent_ClubDanceParty_Act1|인사하기', 'Co_GroupContext_SurpriseParty_Act3|생일 선물 주기', 'Co_PoolParty_Reserve_Talk_PM|풀 파티 신청하기 (오후 3시)',
    'Co_InviteRainWalk|같이 비 맞자고 제안하기'].forEach(row => {
    const [id, name] = row.split('|');
    assert.equal(G.kindOf({interaction_bag_id: id, display_name: name}), null, id);
  });
  assert.equal(G.kindOf({interaction_bag_id: 'Co_Friendship_InviteHome', display_name: '집으로 초대하기'}), 'invite');
});

test('retirement gifts and shop purchases are not leaving a job or founding a business', () => {
  const m = (p, id, name) => CP.matches(p, {interaction_bag_id: id, display_name: name});
  assert.equal(m(CP.LEAVE, 'Co_Event_Business_Retirement_01', '은퇴 선물 주기'), false);
  assert.equal(m(CP.LEAVE, 'Co_Event_Business_Retirement_02', '은퇴 축하하기'), false);
  assert.equal(m(CP.LEAVE, 'Self_SmartPhone_HouseholdBiz_Quit', '퇴사하기'), true);
  assert.equal(m(CP.FOUND, 'Buy_SurfShop_01', '서핑 용품 구입하기'), false);
  assert.equal(m(CP.FOUND, 'Buy_ShopStall02_ThemePark', '기념품 구매하기'), false);
  assert.equal(m(CP.FOUND, 'Open_StoreBooth', '영업 시작하기'), false);
  assert.equal(m(CP.FOUND, 'Computer_Use_U_BusinessPlanWriting', '창업을 위한 사업 계획서 작성하기'), true);
  assert.equal(m(CP.OPEN, 'Open_CafeBooth', '영업 시작하기'), true);
});

const M = require(path.join(ui, 'goal-memory.js'));
const S = require(path.join(ui, 'scoreboard.js'));

test('a disappearance needs observed execution, and an interrupted attempt no longer supports completion', () => {
  const d = {}, plan = {kind: 'hope', instance: 148, name: 'Trait_CleanFreak_Laundry', expire_ticks: 2000 * 600000000};
  M.record(d, plan, 1000);
  M.flow(d, plan, 'confirm', {}, 1000);
  assert.equal(M.gone(d.goalMemory[M.key(plan)], 1050, 1).phase, 'ended', 'a request alone is not execution');
  M.observed(d,{...plan,at:1000},1030);
  assert.equal(M.gone(d.goalMemory[M.key(plan)], 1050, 1).phase, 'completed');
  assert.equal(M.gone(d.goalMemory[M.key(plan)], 1050, 2).phase, 'ended', 'two hopes leaving together is the game clearing the list');
  assert.equal(M.gone(d.goalMemory[M.key(plan)], 2001, 1).reason, '기한 만료 후 목록에서 종료');
  M.resume(d,plan,{bag:'Laundry',target:11},1050,'욕구 해결');
  assert.equal(M.gone(d.goalMemory[M.key(plan)], 1060, 1).phase, 'ended');
  const idle = {kind: 'hope', instance: 9, name: 'Hope_Never_Tried'};
  M.record(d, idle, 1000);
  assert.equal(M.gone(d.goalMemory[M.key(idle)], 1050, 1).phase, 'ended', 'no request, no completion');
});

test('the scoreboard counts that completion once and leaves cleared lists unverified', () => {
  const state = {}, acted = name => name !== 'Hope_B';
  S.hopes(state, 1000, 1, [{name: 'Hope_A', instance: 7, expire: 3000}], {}, acted);
  assert.deepEqual(S.hopes(state, 1050, 1, [], {}, acted), [{name: 'Hope_A', outcome: 'acted'}]);
  assert.deepEqual(S.hopes(state, 1060, 1, [], {}, acted), []);
  S.hopes(state, 1100, 1, [{name: 'Hope_B', instance: 8, expire: 3000}], {}, acted);
  assert.deepEqual(S.hopes(state, 1150, 1, [], {}, acted), [{name: 'Hope_B', outcome: 'unverified'}]);
  S.hopes(state, 1200, 1, [{name: 'Hope_C', instance: 9, expire: 3000}, {name: 'Hope_D', instance: 10, expire: 3000}], {}, acted);
  assert.deepEqual(S.hopes(state, 1250, 1, [], {}, acted).map(x => x.outcome), ['unverified', 'unverified']);
});

test('an early meal request is remembered when hunger turns urgent', async () => {
  const {a, calls} = actions();
  const d = {needPending: {key: 'Hunger', bag: 'Eat_Fridge_Served_Soup', target: '8', minute: 1000, at: Date.now()}};
  const calm = {stats: {Hunger: {pct: 28}, Toilet: {pct: 80}, Sleep: {pct: 80}, Cleanliness: {pct: 80}}};
  assert.equal(await a.needs({entity_id: 1}, {}, d, {stats: calm, queue: {queue_count: 1, entries: null}, work: {}}, 1010, 't'), false);
  assert.ok(d.needPending, 'kept while the need is not yet urgent');
  assert.equal(await a.needs({entity_id: 1}, {}, d, {stats: hungry, queue: {queue_count: 1, entries: null}, work: {}}, 1020, 't'), true);
  assert.deepEqual(calls, []);
});

test('before a sleep that is not an emergency, hunger and toilet are handled first', () => {
  const s = (h, t, sl, c) => ({Hunger: {pct: h}, Toilet: {pct: t}, Sleep: {pct: sl}, Cleanliness: {pct: c}});
  assert.equal(L.bedtimeNeed(s(40, 80, 20, 80)).key, 'Hunger');
  assert.equal(L.bedtimeNeed(s(40, 80, 20, 80)).bedtime, true);
  assert.equal(L.bedtimeNeed(s(50, 20, 20, 80)).key, 'Toilet');
  assert.equal(L.bedtimeNeed(s(80, 80, 20, 80)).key, 'Sleep');
  assert.equal(L.bedtimeNeed(s(40, 40, 6, 80)).key, 'Sleep', 'about to pass out: bed first');
  assert.equal(L.bedtimeNeed(s(80, 80, 80, 80)), null);
  assert.equal(L.bedtimeNeed(s(10, 80, 20, 80)).key, 'Hunger');
});

test('two hopes leaving together stay unverified even when the goal review settles one first', () => {
  const d = {}, a = {kind: 'hope', instance: 1, name: 'Hope_A', expire_ticks: 5000 * 600000000}, b = {kind: 'hope', instance: 2, name: 'Hope_B', expire_ticks: 5000 * 600000000};
  [a, b].forEach(p => { M.record(d, p, 1000); M.flow(d, p, 'confirm', {}, 1000); M.observed(d,{...p,at:1000},1020); });
  const first = d.goalMemory[M.key(a)], verdict = M.gone(first, 1050, 2);
  first.phase = verdict.phase; first.reason = verdict.reason; first.leftAt = 1050;
  M.sync(d, [], 1050);
  assert.equal(d.goalMemory[M.key(a)].phase, 'ended');
  assert.equal(d.goalMemory[M.key(b)].phase, 'ended');
});

test('0.6.14: the pending-action look follows game speed and repeated venue misses back off', () => {
  const app = fs.readFileSync(path.join(ui, 'app.js'), 'utf8'), la = fs.readFileSync(path.join(ui, 'life-actions.js'), 'utf8');
  assert.match(app, /var gap=gameSpeed>=4\?1200:gameSpeed>=2\?2000:3000;/);
  assert.match(la, /Math\.min\(24,3\*Math\.pow\(2,/);
});
