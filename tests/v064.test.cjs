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

function actions() {
  const ctx = vm.createContext({ObserverLife: L, ObserverPolicy: require(path.join(ui, 'policy.js')),
    ObserverGoalMemory: require(path.join(ui, 'goal-memory.js')), ObserverChoices: require(path.join(ui, 'choices.js')),
    ObserverRecovery: require(path.join(ui, 'recovery.js')), ObserverRelations: require(path.join(ui, 'relations.js')), ObserverCareerPath: CP,
    ObserverGameData: require(path.join(ui, 'game-data.js')), console});
  ctx.root = ctx; vm.runInContext('this.root=this;', ctx);
  vm.runInContext(fs.readFileSync(path.join(ui, 'life-actions.js'), 'utf8'), ctx);
  const calls = [];
  const a = ctx.ObserverLifeActions.create({cli: async n => { calls.push(n); throw Error(n); }, write: async n => { calls.push(n); },
    log: () => {}, state: {}, game: () => ({}), members: () => []});
  return {a, calls};
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

test('a hope that leaves right after its requested action counts as completed', () => {
  const d = {}, plan = {kind: 'hope', instance: 148, name: 'Trait_CleanFreak_Laundry', expire_ticks: 2000 * 600000000};
  M.record(d, plan, 1000);
  M.flow(d, plan, 'confirm', {}, 1000);
  assert.equal(M.gone(d.goalMemory[M.key(plan)], 1050, 1).phase, 'completed');
  assert.equal(M.gone(d.goalMemory[M.key(plan)], 1050, 2).phase, 'ended', 'two hopes leaving together is the game clearing the list');
  assert.equal(M.gone(d.goalMemory[M.key(plan)], 2001, 1).reason, '기한 만료 후 목록에서 종료');
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
  [a, b].forEach(p => { M.record(d, p, 1000); M.flow(d, p, 'confirm', {}, 1000); });
  const first = d.goalMemory[M.key(a)], verdict = M.gone(first, 1050, 2);
  first.phase = verdict.phase; first.reason = verdict.reason; first.leftAt = 1050;
  M.sync(d, [], 1050);
  assert.equal(d.goalMemory[M.key(a)].phase, 'ended');
  assert.equal(d.goalMemory[M.key(b)].phase, 'ended');
});
