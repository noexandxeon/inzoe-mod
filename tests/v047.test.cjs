const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ui = path.join(__dirname, '..', 'ZoiObserver_XDX478', 'ui', 'HouseholdObserver');
const L = require(path.join(ui, 'life.js'));

test('goals seen stuck in game get a venue from Site tags', () => {
  assert.deepEqual(L.goalVenueTags('Trait_Intellect_Fishing', 'Hope_Fishing'), [['TPO_Site_Activity_Fishing']]);
  assert.deepEqual(L.goalVenueTags('Ambition_Villain_1_1', 'Ambition_Destroy_Furniture'), [['SiteTag_Market'], ['SiteTag_Park']]);
  assert.deepEqual(L.goalVenueTags('Hope_Resort_GatherCollectibles', 'Hope_Collect'), [['SiteTag_Beach']]);
  assert.deepEqual(L.goalVenueTags('Hope_Coffee', 'Coffee'), [['Coffee', 'Orderable']]);
  assert.deepEqual(L.goalVenueTags('Hope_Unknown', 'Something'), []);
});

test('a goal that needs a home object names the object to buy', () => {
  const pc = L.goalHomeItem('Hope_SearchNews_Computer', 'Hope_SearchNews', ['Computer_Use_Search', 'Laptop_Use_Search']);
  assert.equal(pc.item, 'Computer01');
  assert.ok(pc.fixture.test('Computer01'));
  assert.equal(L.goalHomeItem('Hope_Preference_Drawing', 'Hope_Preference_Drawing', []).item, 'Easel01');
  assert.equal(L.goalHomeItem('Hope_Art', 'Art', []).item, 'Easel01');
  assert.equal(L.goalHomeItem('Trait_Intellect_Fishing', 'Hope_Fishing', ['Next_Click_Fishing_5times_2']), null);
});

test('routine needs start before the urgent limit, lowest first', () => {
  assert.equal(L.fixtureMatches('Hunger','E01_Fridge01'),true);
  assert.equal(L.fixtureMatches('Hunger','E01_Fridge01_Broke'),false);
  const s = (c, h, t) => ({Cleanliness: {pct: c}, Hunger: {pct: h}, Toilet: {pct: t}});
  assert.equal(L.routineNeed(s(27, 90, 90)).key, 'Cleanliness');
  assert.equal(L.routineNeed(s(38, 30, 90)).key, 'Hunger');
  assert.equal(L.routineNeed(s(60, 60, 60)), null);
  assert.equal(L.urgentNeed(s(27, 90, 90)), null, 'urgent limit unchanged');
});

test('goals can queue behind an autonomous action, not while sleeping or with a pending queue', () => {
  assert.equal(L.goalReady({queue_count: 0, current: {interaction_bag_id: 'Creation_MoveTo_Computer'}}, {}), true);
  assert.equal(L.goalReady({queue_count: 0, current: {interaction_bag_id: 'KebabCart_Eat'}}, {}), true);
  assert.equal(L.goalReady({queue_count: 1, current: null}, {}), true);
  assert.equal(L.goalReady({queue_count: 4, current: null}, {}), false);
  assert.equal(L.goalReady({queue_count: 0, current: {interaction_bag_id: 'Sleep_Bed01'}}, {}), false);
  assert.equal(L.goalReady({queue_count: 0, current: {interaction_bag_id: 'Go_Work'}}, {}), false);
});

test('instrument practice buys a guitar; venue ids rank the city search', () => {
  assert.equal(L.goalHomeItem('Hope_LowSkill_LearnInstrument', 'Instruments', []).item, 'Guitar01');
  assert.ok(L.goalVenueIds('Hope_HouseholdBiz_21 Hope_WatchMovie_Any MovieScreen_WatchMovie').test('Cahaya_Public_OutdoorCinema1'));
  assert.ok(L.goalVenueIds('Ambition_Destroy_Furniture Object_ATM01_Kicking_Lv3').test('Cahaya_Business_CVS1'));
  assert.equal(L.goalVenueIds('Hope_Something'), null);
});

test('no goal actions while walking between places; a removed hope stays unconfirmed', () => {
  assert.equal(L.goalReady({queue_count: 0, current: {interaction_bag_id: 'Self_GoHome'}}, {}), false);
  assert.equal(L.goalReady({queue_count: 0, current: {interaction_bag_id: 'LLM_WalkToSite'}}, {}), false);
  const M = require(path.join(ui, 'goal-memory.js'));
  assert.equal(M.gone({expire: 1000, lastAction: 880}, 900).phase, 'ended');
  assert.equal(M.gone({expire: 1000}, 900).phase, 'ended');
  assert.equal(M.gone({expire: 1000}, 995).phase, 'ended');
  assert.equal(M.gone({}, 995).reason, '게임 목록에서 종료 · 완료 여부 미확인');
});

test('cat donuts only at critical levels', () => {
  const C = require(path.join(ui, 'choices.js'));
  assert.equal(C.catDonut('Sleep', {pct: 9}), 'CatDonut01');
  assert.equal(C.catDonut('Sleep', {pct: 15}), null);
  assert.equal(C.catDonut('Fun', {pct: 0}), null);
});

test('agenda fills several queue slots in one turn but stops after a trip', async () => {
  const A = require(path.join(ui, 'agenda.js'));
  const ran = [];
  const mk = (key, base, acts) => ({key, label: key, base, run: async () => { ran.push(key); return acts; }});
  const d = {};
  const r = await A.run(d, [mk('a', 50, true), mk('b', 40, false), mk('c', 30, true), mk('d', 20, true)], 100, {}, {slots: 2});
  assert.equal(r, 'a,c');
  assert.deepEqual(ran, ['a', 'b', 'c']);
  let moved = false;
  const r2 = await A.run({}, [{key: 'trip', base: 60, run: async () => { moved = true; return true; }}, mk('x', 10, true)], 100, {}, {slots: 3, moved: () => moved});
  assert.equal(r2, 'trip');
});

test('no new actions while a trip waits in the queue', () => {
  assert.equal(L.goalReady({queue_count: 1, items: ['LLM_WalkToSite'], current: {interaction_bag_id: 'Idle'}}, {}), false);
  assert.equal(L.goalReady({queue_count: 1, items: ['Toilet01_Use'], current: {interaction_bag_id: 'Idle'}}, {}), true);
});

test('the object an action needs is read from the action id', () => {
  const h = L.objectHints(['Computer_Use_Search', 'Laptop_Use_Search']);
  assert.ok(h.test('SkillReward_Computer02'));
  assert.ok(h.test('Laptop01'));
  assert.ok(!h.test('Bed01'));
  assert.ok(L.objectHints(['Object_ATM01_Kicking_Lv3']).test('ATM01'));
  assert.ok(L.objectHints(['Bookshelf_SitRead_Art']).test('Bookshelf03'));
  assert.equal(L.objectHints([]), null);
});

test('trips need enough hunger, toilet, sleep and hygiene left', () => {
  const s = (h, t, sl, c) => ({Hunger: {pct: h}, Toilet: {pct: t}, Sleep: {pct: sl}, Cleanliness: {pct: c}});
  assert.equal(L.tripReady(s(60, 60, 60, 60)), true);
  assert.equal(L.tripReady(s(30, 60, 60, 60)), false);
  assert.equal(L.tripReady(s(60, 60, 60, 15)), false);
});

test('game data search teaches practice for unlisted skills', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const ctx = vm.createContext({ObserverLife: L, ObserverPolicy: require(path.join(ui, 'policy.js')),
    ObserverGoalMemory: require(path.join(ui, 'goal-memory.js')), ObserverChoices: require(path.join(ui, 'choices.js')),
    ObserverRecovery: require(path.join(ui, 'recovery.js')), ObserverRelations: require(path.join(ui, 'relations.js')),
    ObserverGameData: require(path.join(ui, 'game-data.js')), console});
  ctx.root = ctx; vm.runInContext('this.root=this;', ctx);
  vm.runInContext(fs.readFileSync(path.join(ui, 'life-actions.js'), 'utf8'), ctx);
  const cli = async (name, args) => {
    if (name === 'interaction.search') return {results: [{interaction_bag_id: 'Fishing_Rod_Cast', display_name: '낚시'}, {interaction_bag_id: 'Buy_Fishing_Bait'}]};
    throw Error(name);
  };
  const logs = [];
  const a = ctx.ObserverLifeActions.create({cli, write: async () => {}, log: s => logs.push(s), state: {}, game: () => ({}), members: () => []});
  const fishing = await a.ensureTraining('Fishing');
  assert.ok(fishing[0].test('FishingRod01'));
  assert.ok(fishing[1].test('Fishing_Rod_Cast'));
  assert.ok(!fishing[1].test('Buy_Fishing_Bait'));
});
