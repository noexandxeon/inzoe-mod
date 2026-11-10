'use strict';
// 0.6.1: why a Zoi is not being asked to do anything, read from every running wait.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ui = path.join(__dirname, '..', 'ZoiObserver_XDX478', 'ui', 'HouseholdObserver');
const Why = require(path.join(ui, 'why.js'));

test('the state of the Zoi comes before any wait', () => {
  const p = {nextTalk: 5000};
  assert.strictEqual(Why.explain(p, 1000, {enabled: false}), '자동 관리 꺼짐');
  assert.strictEqual(Why.explain(p, 1000, {sleeping: true}), '수면 중');
  assert.strictEqual(Why.explain(p, 1000, {work: {is_commute_time: true}}), '근무·출근 중');
  assert.match(Why.explain({outing: {name: '공원'}}, 1000, {}), /외출 중: 공원/);
  assert.match(Why.explain({goal: {name: 'Hope_X'}}, 1000, {}), /결과 확인 중: Hope_X/);
  assert.match(Why.explain({agenda: {intent: {label: '대화·관계', minute: 990}, tasks: {}}}, 1000, {}), /방금 요청: 대화·관계/);
  assert.match(Why.explain({}, 1000, {queueCount: 3}), /대기열의 행동 3개/);
});

test('waits from every place are gathered, soonest first, with the reason', () => {
  const p = {
    nextTalk: 1100, nextSide: 1300, nextMarket: 900,
    agenda: {tasks: {hope: {label: '소망 추구', retryAt: 1050, reason: '필요 기술 부족', eligible: true}, career: {label: '구직', retryAt: 1500, eligible: false}}},
    goalMemory: {a: {kind: 'hope', name: 'H1', phase: 'waiting', park: {until: 1200}}, b: {kind: 'ambition', name: 'A1', phase: 'waiting', block: {until: 1400, label: '필요한 물건·시설 없음'}}, c: {kind: 'hope', name: 'old', phase: 'ended', block: {until: 9999, label: 'x'}}},
    gather: {next: 1250, status: '가까운 지인 없음'},
  };
  const list = Why.waits(p, 1000);
  assert.deepStrictEqual(list.map(x => x.label), ['소망 추구', '대화', '소망 H1', '지인 초대', '개인 작업', '야망 A1']);
  assert.strictEqual(Why.explain(p, 1000, {}), '대기 6건 · 가장 먼저 풀림: 소망 추구 17:30 (필요 기술 부족)');
  assert.strictEqual(Why.report(p, 1000, {}).waits.length, 6);
});

test('nothing waiting is said plainly, and stale far-future timers are ignored', () => {
  assert.match(Why.explain({}, 1000, {}), /요청할 일 없음/);
  assert.match(Why.explain({}, 1000, {current: 'Use_TV_Watch'}), /자율 행동 중/);
  assert.strictEqual(Why.waits({nextTalk: 1000 + 10 * 1440}, 1000).length, 0);
});

test('every timer the code uses for an activity has a name here', () => {
  const src = ['app.js', 'life-actions.js', 'panels.js'].map(f => fs.readFileSync(path.join(ui, f), 'utf8')).join('\n');
  const used = new Set((src.match(/(?:p|decision)\.next[A-Z][A-Za-z]*/g) || []).map(x => x.split('.')[1]));
  // Bookkeeping timers that never hold an activity back.
  ['nextAutonomy', 'nextHope', 'nextAmbition', 'nextScoreRead'].forEach(k => used.delete(k));
  used.forEach(k => assert.ok(Why.TIMERS[k], k + ' has no label'));
});

test('it only reads: the Zoi record is not changed', () => {
  const p = {nextTalk: 1100, agenda: {tasks: {x: {retryAt: 1200}}}, goalMemory: {a: {kind: 'hope', name: 'H', phase: 'waiting', park: {until: 1300}}}};
  const before = JSON.stringify(p);
  Why.explain(p, 1000, {}); Why.report(p, 1000, {});
  assert.strictEqual(JSON.stringify(p), before);
});

test('the window and the report use it', () => {
  const app = fs.readFileSync(path.join(ui, 'app.js'), 'utf8');
  assert.match(app, /지금: '\+esc\(Why\.explain/);
  assert.match(app, /payload=\{why:why/);
});
