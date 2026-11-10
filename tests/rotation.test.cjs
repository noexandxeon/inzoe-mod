'use strict';
// 0.5.8: every family member is managed even when not selected.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ui = path.join(__dirname, '..', 'ZoiObserver_XDX478', 'ui', 'HouseholdObserver');
const Rot = require(path.join(ui, 'rotation.js'));
const CP = require(path.join(ui, 'career-path.js'));

const members = [{entity_id: 1}, {entity_id: 2}, {entity_id: 3}];
function fresh() { return {people: {'1': {}, '2': {}, '3': {}}}; }

test('what makes an unselected Zoi wait for the selection', () => {
  assert.strictEqual(Rot.wants({selected: true, urgent: true}), null);
  assert.strictEqual(Rot.wants({away: true, urgent: true}), null);
  assert.strictEqual(Rot.wants({dependent: true, autonomyOff: true}), null);
  assert.strictEqual(Rot.wants({autonomyOff: true}), '자율 행동 켜기');
  assert.strictEqual(Rot.wants({urgent: true, replies: true}), '긴급 욕구 해결');
  assert.strictEqual(Rot.wants({blind: true}), '주변 물건 확인');
  assert.strictEqual(Rot.wants({}), null);
});

test('the selection moves to whoever has waited longest, urgent needs first, and not too often', () => {
  const state = fresh();
  assert.strictEqual(Rot.choose(state, members, 1, 1000, false), null, 'nobody waiting');
  Rot.note(state.people['2'], '휴대폰 답장', 900);
  Rot.note(state.people['3'], '주변 물건 확인', 950);
  assert.strictEqual(Rot.choose(state, members, 1, 1000, false), '2');
  Rot.note(state.people['3'], '긴급 욕구 해결', 960);
  assert.strictEqual(Rot.choose(state, members, 1, 1000, false), '3');
  assert.strictEqual(state.people['3'].wants.since, 950, 'the wait is counted from the first note');
  assert.strictEqual(Rot.choose(state, members, 1, 1000, true), null, 'not during a trip or popup');
  Rot.moved(state, 1000);
  assert.strictEqual(Rot.choose(state, members, 3, 1000 + Rot.DWELL - 1, false), null, 'stays a while');
  assert.strictEqual(Rot.choose(state, members, 3, 1000 + Rot.DWELL, false), '2');
});

test('switched off, or failing twice, it stops; an earlier save starts it again', () => {
  const state = fresh();
  Rot.note(state.people['2'], '휴대폰 답장', 900);
  Rot.book(state).on = false;
  assert.strictEqual(Rot.choose(state, members, 1, 1000, false), null);
  Rot.book(state).on = true;
  assert.strictEqual(Rot.failed(state, 1000), false);
  assert.strictEqual(Rot.choose(state, members, 1, 1100, false), null);
  assert.strictEqual(Rot.choose(state, members, 1, 1130, false), '2');
  assert.strictEqual(Rot.failed(state, 1130), true);
  assert.strictEqual(Rot.choose(state, members, 1, 2000, false), null, 'rests a game day');
  assert.strictEqual(Rot.choose(state, members, 1, 1130 + 1440, false), '2');
  Rot.failed(state, 5000); Rot.failed(state, 5000);
  assert.strictEqual(Rot.choose(state, members, 1, 950, false), '2', 'time went back');
});

test('the running mod uses the selection command the phone replies already use, and checks the result', () => {
  const app = fs.readFileSync(path.join(ui, 'app.js'), 'utf8');
  const body = app.slice(app.indexOf('async function rotateSelection'), app.indexOf('async function inspect'));
  assert.match(body, /write\('character\.possess',\{character_id:pick\}/);
  assert.match(body, /possessed_entity_id\)!==pick\)throw/);
  assert.match(body, /panels\.borrowing\(\)/);
});

test('review fixes: a rewound game forgets a future retirement; no computer in reach does not block founding', async () => {
  const base = {id: 3, age: 'Elderly', traits: ['Faithful'], skills: [], ambition: null, employed: false, daysInJob: 0, cash: 50000, reserve: 2000, short: false, business: null};
  const book = {};
  CP.plan(book, Object.assign({day: 30}, base));
  assert.strictEqual(book.retired, true);
  CP.plan(book, Object.assign({}, base, {day: 10, age: 'Adult'}));
  assert.strictEqual(book.retired, false);
  assert.strictEqual(book.step, 'seek_job');

  const logs = [];
  let computers = [];
  const v = CP.create({log: m => logs.push(m), cli: async () => ({results: []}), computers: async () => computers, objects: async () => [], act: async () => null, move: async () => false});
  const p = {careerPath: {step: 'start_business', why: '창업'}};
  assert.strictEqual(await v.start({entity_id: 1}, {}, p, 1000, 1), false);
  assert.ok(!p.careerPath.foundingBlocked, 'away from any computer: try again later');
  computers = [{entity_id: 9}];
  assert.strictEqual(await v.start({entity_id: 1}, {}, p, 1100, 1), false);
  assert.strictEqual(p.careerPath.foundingBlocked, true, 'a computer was there and offered nothing');
});
