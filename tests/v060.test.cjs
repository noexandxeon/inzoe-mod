'use strict';
// 0.6.0: picking goals back up, the chain and stalls, household metrics, family coordination.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ui = path.join(__dirname, '..', 'ZoiObserver_XDX478', 'ui', 'HouseholdObserver');
const M = require(path.join(ui, 'goal-memory.js'));
const L = require(path.join(ui, 'life.js'));
const S = require(path.join(ui, 'scoreboard.js'));
const Family = require(path.join(ui, 'family.js'));

const hope = {name: 'Hope_Paint', kind: 'hope', instance: 11};
const ambition = {name: 'Mission_A1', kind: 'ambition', instance: 22};
const goal = {bag: 'Easel_Paint', target: 500};

test('(1) cut short by work, a need or a trip is told apart from a failure', () => {
  assert.strictEqual(M.interruption({work: {is_commute_time: true}}), '출근·근무');
  assert.strictEqual(M.interruption({work: {}, current: {interaction_bag_id: 'Eat_Fridge01_Served'}}), '욕구 해결');
  assert.strictEqual(M.interruption({work: {}, current: {interaction_bag_id: 'Object_Toilet01_Use'}}), '욕구 해결');
  assert.strictEqual(M.interruption({current: {interaction_bag_id: 'MoveTo_Site'}, travel: /^MoveTo_/}), '이동');
  assert.strictEqual(M.interruption({urgent: true}), '욕구 해결');
  assert.strictEqual(M.interruption({work: {}, current: {interaction_bag_id: 'Use_TV_Watch'}}), null);
  assert.strictEqual(M.interruption({}), null);
});

test('(1) a cut-short action carries no penalty and is picked up at most three times a day', () => {
  const d = {};
  for (let i = 0; i < 3; i++) assert.strictEqual(M.resume(d, hope, goal, 1000 + i * 30, '욕구 해결'), true);
  assert.strictEqual(M.allowed(d, hope, goal.bag, goal.target, 1100), true, 'no failure was recorded');
  assert.match(hope.memory.reason, /중단됨\(욕구 해결\)/);
  assert.strictEqual(M.resume(d, hope, goal, 1100, '욕구 해결'), false, 'then it is an ordinary miss');
  assert.strictEqual(M.resume(d, hope, {bag: 'Other', target: 1}, 1110, '이동'), true, 'another action starts its own count');
  assert.strictEqual(M.resume(d, hope, goal, 1000 + 1440, '출근·근무'), true, 'a new day too');
});

test('(1) the running code asks before it marks a failure', () => {
  const src = fs.readFileSync(path.join(ui, 'life-actions.js'), 'utf8');
  const cut = src.indexOf('M.interruption('), fail = src.indexOf('M.failed(decision,plan,goal.bag');
  assert.ok(cut > 0 && cut < fail);
});

test('(2) the chain lists what the goal needs, in order, with where it stands', () => {
  const d = {};
  M.prepare(d, hope, {kind: 'skill', skill: 'Art', need: 'Art Lv.3', label: '이젤 연습'}, 100);
  assert.deepStrictEqual(M.chain(hope.memory).map(s => s.label + ':' + s.state),
    ['필요: Art Lv.3:done', '준비: 이젤 연습:now', '원래 목표 재시도:todo', '완료 확인:todo']);
  M.prepared(d, hope, 200, 'Art Lv.2 → 3');
  assert.strictEqual(M.chain(hope.memory)[2].state, 'now');
});

test('(2) a hope stuck in preparation steps aside for four game hours; evidence of progress resets the clock', () => {
  const d = {};
  M.prepare(d, hope, {kind: 'skill', skill: 'Art', need: 'Art Lv.3'}, 100);
  M.failed(d, hope, 'Easel_Paint', 500, 150, 'x');
  assert.strictEqual(M.stalled(d, hope, 400), null, 'not yet');
  assert.strictEqual(M.stalled(d, hope, 100 + 360), 'park');
  assert.ok(M.parked(hope.memory, 500));
  assert.strictEqual(M.allowed(d, hope, 'Easel_Paint', 500, 500), true, 'old dead ends are forgotten');
  assert.ok(!M.parked(hope.memory, 100 + 360 + 240));
  assert.strictEqual(M.stalled(d, hope, 100 + 360 + 240), null, 'the clock started again');
  const d2 = {}, h2 = {name: 'H2', kind: 'hope', instance: 12};
  M.prepare(d2, h2, {kind: 'skill', skill: 'Art'}, 100);
  M.prepared(d2, h2, 300, 'grown');
  assert.strictEqual(M.stalled(d2, h2, 2000), null, 'a goal that is retrying is not stalled');
});

test('(2) a hope close to expiry steps aside sooner; an ambition never steps aside, it starts its search over', () => {
  const d = {}, soon = {name: 'H3', kind: 'hope', instance: 13, expire_ticks: 700 * 600000000};
  M.prepare(d, soon, {kind: 'skill', skill: 'Art'}, 100);
  assert.strictEqual(M.stalled(d, soon, 100 + 200), 'park');
  const a = {};
  M.prepare(a, ambition, {kind: 'skill', skill: 'Logic', need: 'Logic Lv.5'}, 100);
  assert.strictEqual(M.stalled(a, ambition, 100 + 1440), null);
  assert.strictEqual(M.stalled(a, ambition, 100 + 2 * 1440), 'reroute');
  assert.ok(!M.parked(ambition.memory, 100 + 2 * 1440));
  assert.strictEqual(ambition.memory.prep, null);
  assert.strictEqual(ambition.memory.flow.step, 'need');
});

test('(3) household record: popups, who closed them, how long they blocked, manual steps, duplicate payments', () => {
  const state = {};
  S.house(state, 1440 * 3 + 10, 'popup', {auto: true, seconds: 4});
  S.house(state, 1440 * 3 + 20, 'popup', {auto: false, seconds: 200});
  S.house(state, 1440 * 3 + 30, 'selection');
  S.house(state, 1440 * 3 + 40, 'stop');
  S.house(state, 1440 * 3 + 50, 'duplicate');
  const u = S.unattended(state, 3, 7);
  assert.deepStrictEqual([u.days, u.interventions, u.duplicates, u.popups, u.popupAuto, u.stalls, u.longest, u.pass], [1, 3, 1, 2, 1, 1, 200, false]);
  assert.match(S.houseLine(state, 3), /무인 운영 1\/7일 · 개입 3 · 팝업 자동 1\/2 \(최장 200초\) · 중복 결제 1/);
  assert.strictEqual(S.report(state).days['3'].house.duplicates, 1);
  assert.strictEqual(S.house(state, NaN, 'stop'), false);
});

test('(3) seven clean days meet the unattended criterion; six do not', () => {
  const state = {};
  for (let d = 1; d <= 7; d++) { S.event(state, {minute: d * 1440 + 5, zoi: 1, kind: 'request'}); S.house(state, d * 1440 + 5, 'popup', {auto: true, seconds: 3}); }
  assert.strictEqual(S.unattended(state, 7, 7).pass, true);
  assert.strictEqual(S.unattended(state, 6, 7).pass, false);
  S.house(state, 7 * 1440 + 9, 'selection');
  assert.strictEqual(S.unattended(state, 7, 7).pass, false);
});

test('(3) a payment recorded twice is counted, one payment is not', () => {
  const rec = {transactionReason: 'ExpenseBuy', amount: -300, participantId: {value: 1}};
  const wallet = n => ({currencyMap: {mew: 1}, currencyHistoryMap: {mew: {dailyTransactionMap: {'0001': {records: Array(n).fill(rec)}}}}});
  const checkpoint = L.ledgerCheckpoint(wallet(0));
  assert.strictEqual(L.debitCount(wallet(1), checkpoint, 1, 300, 'ExpenseBuy'), 1);
  assert.strictEqual(L.debitCount(wallet(2), checkpoint, 1, 300, 'ExpenseBuy'), 2);
  assert.strictEqual(L.matchingDebit(wallet(2), checkpoint, 1, 300, 'ExpenseBuy'), null);
  assert.strictEqual(L.debitCount(wallet(2), checkpoint, 2, 300, 'ExpenseBuy'), 0);
});

test('(4) two family members are not sent to the same object; the claim runs out by itself', () => {
  let t = 0;
  const c = Family.create(() => t);
  assert.strictEqual(c.claim(500, 1), true);
  assert.strictEqual(c.free(500, 2), false);
  assert.strictEqual(c.free(500, 1), true);
  assert.strictEqual(c.claim(500, 2), false);
  assert.strictEqual(c.claim(2, 2), true, 'a Zoi itself is never claimed');
  assert.strictEqual(c.holder(2), null);
  t = Family.TTL;
  assert.strictEqual(c.claim(500, 2), true);
  c.release(2);
  assert.strictEqual(c.free(500, 1), true);
});

test('(4) the running code skips an object another member holds and claims what it uses', () => {
  const src = fs.readFileSync(path.join(ui, 'life-actions.js'), 'utf8');
  assert.match(src, /!api\.claims\.free\(target,id\)\)continue/);
  assert.match(src, /api\.claims\.claim\(target,id\)/);
});

test('(4) whoever is behind on hopes today gets the next turn; someone done waits for the others', () => {
  assert.strictEqual(Family.fairness({'1': 1, '2': 5, '3': 3}, 1, 5), 15);
  assert.strictEqual(Family.fairness({'1': 3, '2': 4}, 1, 5), 5);
  assert.strictEqual(Family.fairness({'1': 6, '2': 2}, 1, 5), -6);
  assert.strictEqual(Family.fairness({'1': 6, '2': 7}, 2, 5), 0);
  assert.strictEqual(Family.fairness({'1': 0}, 1, 5), 0, 'a single adult has nobody to be fair to');
});

test('(4) one host per household at a time', () => {
  const members = [{entity_id: 1, household_id: 7}, {entity_id: 2, household_id: 7}, {entity_id: 3, household_id: 8}];
  const people = {'1': {}, '2': {gather: {pending: {bag: 'x'}}}, '3': {gather: {hosting: {}}}};
  assert.strictEqual(Family.hostBusy(people, members, members[0]), true);
  assert.strictEqual(Family.hostBusy(people, members, members[1]), false, 'the host itself is not blocked by its own guests');
  people['2'].gather = {};
  assert.strictEqual(Family.hostBusy(people, members, members[0]), false, 'another household does not count');
});
