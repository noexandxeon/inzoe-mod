// Scoreboard: dated facts per Zoi and game day. Completion needs the game's mission record and counts once.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ui = path.join(__dirname, '../ZoiObserver_XDX478/ui/HouseholdObserver');
const S = require(path.join(ui, 'scoreboard.js'));
const Rel = require(path.join(ui, 'relations.js'));
const day = 3, at = (hour, minute = 0) => day * 1440 + hour * 60 + minute;
const finished = {bIsFinished: true}, open = {bIsFinished: false};

test('a hope is counted when the mission record says finished, once, also after the save is loaded again', () => {
 let state = {};
 S.hopes(state, at(9), 1, [{name: 'Hope_A', instance: 7, expire: at(20)}], {'(Value=7)': open});
 assert.equal(S.summary(state, day, 1).completed, 0);
 assert.equal(S.summary(state, day, 1).offered, 1);
 // Still listed, mission finished: counted now.
 const settled = S.hopes(state, at(10), 1, [{name: 'Hope_A', instance: 7}], {'(Value=7)': finished});
 assert.deepEqual(settled, [{name: 'Hope_A', outcome: 'completed'}]);
 assert.equal(S.summary(state, day, 1).completed, 1);
 // Seen again, and again after a save round trip: never a second count.
 S.hopes(state, at(11), 1, [{name: 'Hope_A', instance: 7}], {'(Value=7)': finished});
 state = JSON.parse(JSON.stringify(state));
 assert.deepEqual(S.hopes(state, at(12), 1, [{name: 'Hope_A', instance: 7}], {'(Value=7)': finished}), []);
 assert.equal(S.summary(state, day, 1).completed, 1);
 assert.equal(S.event(state, {minute: at(12), zoi: 1, kind: 'hope_completed', key: '7', name: 'Hope_A'}), false);
});

test('a hope that leaves the list is completed only with a finished record; otherwise it is reported as unverified or expired', () => {
 const state = {};
 const list = [{name: 'Done', instance: 1, expire: at(20)}, {name: 'Vanished', instance: 2, expire: at(20)}, {name: 'Late', instance: 3, expire: at(10)}];
 S.hopes(state, at(9), 1, list, {});
 // The mission record could not be read: nothing is concluded.
 assert.deepEqual(S.hopes(state, at(11), 1, [], null), []);
 assert.equal(S.summary(state, day, 1).gone, 0);
 const settled = S.hopes(state, at(11, 10), 1, [], {'(Value=1)': finished, '(Value=2)': open});
 assert.deepEqual(settled.map(x => x.outcome).sort(), ['completed', 'expired', 'unverified']);
 const r = S.summary(state, day, 1);
 assert.equal(r.completed, 1);
 assert.equal(r.gone, 1);
 assert.equal(r.expired, 1);
 assert.match(S.line(state, day, 1), /오늘 소망 1\/5/);
 assert.match(S.line(state, day, 1), /확인 못 한 종료 1개/);
});

test('each Zoi has its own count; one Zoi finishing does not count for another', () => {
 const state = {};
 S.hopes(state, at(9), 1, [{name: 'Talk', instance: 11}], {});
 S.hopes(state, at(9), 2, [{name: 'Talk', instance: 21}], {});
 S.hopes(state, at(10), 1, [], {'(Value=11)': finished});
 assert.equal(S.summary(state, day, 1).completed, 1);
 assert.equal(S.summary(state, day, 2).completed, 0);
});

test('the mission record is asked for only when the list changed', () => {
 const state = {};
 assert.equal(S.hopesChanged(state, 1, ['A', 'B']), true);
 S.hopes(state, at(9), 1, [{name: 'A', instance: 1}, {name: 'B', instance: 2}], {});
 assert.equal(S.hopesChanged(state, 1, ['B', 'A']), false);
 assert.equal(S.hopesChanged(state, 1, ['A']), true);
 assert.equal(S.hopesChanged(state, 1, ['A', 'B', 'C']), true);
});

test('observations add up work, sleep, free and danger time, lowest needs and the real gap between looks', () => {
 const state = {}, need = (h, t = 90) => ({Hunger: {pct: h}, Toilet: {pct: t}, Sleep: {pct: 80}, Cleanliness: {pct: 80}});
 S.observe(state, at(8), 1, {stats: need(60)}, 1000);
 S.observe(state, at(8, 20), 1, {stats: need(50), working: true}, 41000);
 S.observe(state, at(8, 40), 1, {stats: need(20), sleeping: true}, 53000);
 // A long silence (the game was paused or the Zoi was away) is capped, not counted as lived time.
 S.observe(state, at(12), 1, {stats: need(70)}, 54000);
 const r = S.summary(state, day, 1);
 assert.deepEqual(r.minutes, {work: 20, sleep: 20, free: 30, danger: 20});
 assert.equal(r.low.Hunger, 20);
 assert.deepEqual(r.watchSeconds, {average: 17.7, max: 40});
 assert.equal(r.partial, true);
});

test('a missed day names its main reasons, and a met day names none', () => {
 const state = {};
 S.observe(state, at(0), 1, {stats: {}}, 0);
 S.observe(state, at(23), 1, {stats: {}}, 1);
 S.hopes(state, at(9), 1, [{name: 'A', instance: 1}, {name: 'B', instance: 2}], {});
 S.event(state, {minute: at(9), zoi: 1, kind: 'blocked', key: '1:skill', reason: 'skill'});
 S.event(state, {minute: at(9), zoi: 1, kind: 'blocked', key: '1:skill', reason: 'skill'});
 S.event(state, {minute: at(9), zoi: 1, kind: 'failed', key: '2:a:1'});
 let r = S.summary(state, day, 1);
 assert.equal(r.met, false);
 assert.equal(r.partial, false);
 assert.deepEqual(r.shortfall.map(x => x.kind), ['offered', 'skill', 'failed']);
 assert.equal(r.shortfall[0].detail, '새로 받은 소망 2개');
 for (let i = 10; i < 15; i++) S.hopes(state, at(10), 1, [{name: 'H' + i, instance: i}], {['(Value=' + i + ')']: finished});
 r = S.summary(state, day, 1);
 assert.equal(r.met, true);
 assert.deepEqual(r.shortfall, []);
 assert.match(S.line(state, day, 1), /오늘 소망 5\/5 달성/);
});

test('old days are dropped and the report lists every retained day', () => {
 const state = {};
 for (let d = 0; d < 20; d++) S.event(state, {minute: d * 1440 + 600, zoi: 1, kind: 'request', key: 'r' + d});
 const report = S.report(state);
 assert.deepEqual(Object.keys(report.days).map(Number).sort((a, b) => a - b), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
 assert.equal(report.days['4'].events.length, 0);
 assert.equal(report.days['19'].events.length, 1);
 assert.equal(report.days['19'].people[0].requests, 1);
});

test('a conversation never seen running still counts when the relationship measurably changed', () => {
 const life = {}, rel = (f, r = 0) => ({stats: {Friendship: {value: f}, Romance: {value: r}}});
 Rel.attempted(life, 1, 2, null, rel(10), 'Talk_Friendly', 'talk', 600);
 const improved = Rel.settle(life, 1, 2, rel(14), 640, {notStarted: true});
 assert.equal(improved.outcome, 'improved');
 assert.equal(improved.history[0].delta, 4);
 // No measurable change and never seen running: still treated as not executed.
 Rel.attempted(life, 1, 2, null, rel(14), 'Talk_Friendly', 'talk', 700);
 assert.equal(Rel.settle(life, 1, 2, rel(14), 740, {notStarted: true}).outcome, 'not_executed');
 Rel.attempted(life, 1, 2, null, rel(14), 'Talk_Friendly', 'talk', 800);
 assert.equal(Rel.settle(life, 1, 2, rel(10), 840, {notStarted: true}).outcome, 'worse');
});

test('facts replayed from goal memory are counted once however many there are, and again only when they grow', () => {
 const state = {}, p = {goalMemory: {}};
 for (let g = 0; g < 30; g++) {
  const failures = {};
  for (let f = 0; f < 20; f++) failures['bag' + f] = {count: 1, until: 0};
  p.goalMemory['hope:' + g] = {name: 'Hope' + g, kind: 'hope', instance: g, phase: 'waiting', block: {kind: 'missing'}, failures};
 }
 p.goalMemory['ambition:900'] = {name: 'Amb', kind: 'ambition', instance: 900, phase: 'completed', failures: {}};
 p.goal = {name: 'Hope0', instance: 0, bag: 'x', sentAt: 5};
 p.outing = {goalVisit: 'Hope0', site: 40, start: 600, name: '카페'};
 // 600 failure facts, far more than any bounded key table: looked at on two different days.
 S.memory(state, at(9), 1, p);
 S.memory(state, at(9, 10), 1, p);
 S.memory(state, (day + 1) * 1440 + 600, 1, JSON.parse(JSON.stringify(p)));
 const first = S.summary(state, day, 1);
 assert.equal(first.failed, 600);
 assert.equal(first.requests, 1);
 assert.equal(first.outings, 1);
 assert.equal(first.ambition, 1);
 assert.equal(S.summary(state, day + 1, 1), null);
 // A real new failure and an outing that found its action are counted when they happen.
 p.goalMemory['hope:3'].failures.bag0.count = 3;
 p.outing.found = true;
 S.memory(state, at(11), 1, p);
 assert.equal(S.summary(state, day, 1).failed, 602);
 assert.equal(S.summary(state, day, 1).outingFound, 1);
});

test('a finished hope that stays listed is not counted again after hundreds of other facts', () => {
 const state = {};
 S.hopes(state, at(9), 1, [{name: 'Stay', instance: 7}], {'(Value=7)': finished});
 for (let i = 0; i < 900; i++) S.event(state, {minute: at(10), zoi: 1, kind: 'request', key: 'r' + i});
 assert.deepEqual(S.hopes(state, at(11), 1, [{name: 'Stay', instance: 7}], {'(Value=7)': finished}), []);
 assert.equal(S.hopesChanged(state, 1, ['Stay']), false);
 assert.equal(S.summary(state, day, 1).completed, 1);
 assert.equal(S.summary(state, day, 1).offered, 1);
 // Once it leaves the list it is simply forgotten, not reported as vanished.
 assert.deepEqual(S.hopes(state, at(12), 1, [], {'(Value=7)': finished}), []);
 assert.equal(S.summary(state, day, 1).gone, 0);
});

test('receipts from a discarded timeline are not restored; receipts the loaded timeline already contains are', () => {
 const R = require(path.join(ui, 'recovery.js'));
 const mirror = {people: {'1': {payments: {early: {phase: 'ledger-matched', minute: 500}, late: {phase: 'requested', minute: 900}, old: {phase: 'requested'}},
  replyRequests: {early: {phase: 'outgoing', minute: 480}, late: {phase: 'requested', minute: 910}}}}};
 // The player loaded a save from game minute 700: what the mod did at 900+ never happened there.
 const rewound = {people: {}};
 assert.equal(R.mergeProcessed(rewound, mirror, {minute: 700, continuous: false}), 2);
 assert.deepEqual(Object.keys(rewound.people['1'].payments), ['early']);
 assert.deepEqual(Object.keys(rewound.people['1'].replyRequests), ['early']);
 // Travel return: the game's timeline continued past every receipt, so all are restored (also undated ones).
 const returned = {people: {}};
 assert.equal(R.mergeProcessed(returned, mirror, {minute: 1200, continuous: true}), 5);
});

// The running mod: a managed Zoi's hope finishes between two household cycles.
function appHarness(execute) {
 const elements = new Map(), intervals = new Map();
 const element = () => ({style: {}, addEventListener() {}, appendChild() {}, setAttribute() {}, scrollHeight: 0, textContent: '', innerHTML: ''});
 let deliver;
 const context = vm.createContext({console: {log() {}, error() {}}, engine: {}, innerWidth: 1920, innerHeight: 1080,
  document: {body: element(), getElementById: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
   createElement: element, addEventListener() {}},
  inzoi: {cli: {execute: (name, args) => name === 'uimod.cfg_save' ? {success: true} : name === 'uimod.cfg_load' ? {value: null} : execute(name, args)},
   view: {show() {}}, trigger: {onActivated() {}}, saveState: {register() {}, onLoad: fn => deliver = fn}},
  setInterval: (fn, ms) => intervals.set(ms, fn), setTimeout: () => 0, clearTimeout() {}, addEventListener() {}, Date});
 context.window = context;
 const order = [...fs.readFileSync(path.join(ui, 'index.html'), 'utf8').matchAll(/<script src="([a-z-]+)\.js"/g)].map(m => m[1]).filter(n => n !== 'devprobe');
 for (const name of order) vm.runInContext(fs.readFileSync(path.join(ui, name + '.js'), 'utf8'), context, {filename: name + '.js'});
 return {context, intervals, elements, load: value => deliver(JSON.stringify(value))};
}
test('in the running mod, a finished mission is tallied for the right Zoi and shown in the window', async () => {
 let clock = {day: 3, hour: 10, minute: 0}, listed = true;
 const h = appHarness((name, args) => {
  if (name === 'game.get_state') return {phase: 'in_game', map_id: 'Cahaya_Map', possessed_entity_id: 1, blocking: {}};
  if (name === 'environment.get_time') return clock;
  if (name === 'household.get_members') return {household_id: 11, name: '진', members: [{entity_id: 1, first_name: '가', last_name: '진', household_id: 11, age_group: 'Adult'}]};
  if (name === 'cli.help') return {id: args.command, access: 'Public'};
  if (name === 'environment.get_simulation') return {is_paused: false};
  if (name === 'entity.reflect' && args.Component === 'Hope') return {selectedHopes: listed ? [{hopeId: 'Hope_ReadBook', missionId: {value: 7}}] : []};
  if (name === 'entity.reflect' && args.Component === 'Mission') return {missionMap: {'(Value=7)': {bIsFinished: !listed}}};
  if (name === 'entity.reflect' && !args.Component) return {locatedCityName: 'Cahaya_Map', locatedSiteId: {value: 30}};
  if (name === 'stat.get_all') return {stats: {Hunger: {pct: 80}, Sleep: {pct: 80}, Toilet: {pct: 80}, Cleanliness: {pct: 80}}, stat_names: {}};
  if (name === 'interaction.get_queue') return {queue_count: 0, is_empty: true};
  if (name === 'hope.list') return {selected_count: listed ? 1 : 0, selected: listed ? [{hope_id: 'Hope_ReadBook'}] : []};
  return {};
 });
 h.load({schema: 1, enabled: true, people: {}, household: 11});
 await h.intervals.get(10000)();
 const state = h.context.wf.state;
 assert.equal(S.summary(state, 3, 1).offered, 1);
 assert.equal(S.summary(state, 3, 1).completed, 0);
 listed = false; clock = {day: 3, hour: 10, minute: 20};
 await h.intervals.get(10000)();
 // Looking again never counts the same hope twice.
 clock = {day: 3, hour: 10, minute: 30};
 await h.intervals.get(10000)();
 assert.equal(S.summary(state, 3, 1).completed, 1);
 assert.match(h.elements.get('log').textContent, /소망 완료 집계 \(게임 미션 확인\) \/ Hope_ReadBook/);
 assert.match(h.elements.get('people').innerHTML, /오늘 소망 1\/5/);
});
