// A hope that cannot run at home is taken to a real facility, tried there, and the Zoi comes home.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ui = path.join(__dirname, '../ZoiObserver_XDX478/ui/HouseholdObserver');
const globals = {
 ObserverLife: require(path.join(ui, 'life.js')), ObserverPolicy: require(path.join(ui, 'policy.js')),
 ObserverGoalMemory: require(path.join(ui, 'goal-memory.js')), ObserverChoices: require(path.join(ui, 'choices.js')),
 ObserverAgenda: require(path.join(ui, 'agenda.js')), ObserverRecovery: require(path.join(ui, 'recovery.js')),
 ObserverRelations: require(path.join(ui, 'relations.js')), ObserverCareerPath: require(path.join(ui, 'career-path.js')), ObserverGameData: require(path.join(ui, 'game-data.js')),
};
function lifeActions(api) {
 const context = vm.createContext({...globals, setTimeout: fn => { fn(); return 0; }});
 vm.runInContext(fs.readFileSync(path.join(ui, 'life-actions.js'), 'utf8'), context, {filename: 'life-actions.js'});
 return context.ObserverLifeActions.create(api);
}
const HOME = 30, CAFE = 40, PARK = 50, MACHINE = 41;
function world(opts = {}) {
 const writes = [], logs = [], unexpected = [];
 const member = {entity_id: 1, household_id: 10, first_name: '진', age_group: 'Adult'};
 const character = {locatedSiteId: {value: HOME}, boundSiteId: {value: HOME}, worldTransform: {translation: {x: 0, y: 0, z: 0}}};
 const stats = {Hunger: {pct: 90}, Toilet: {pct: 90}, Sleep: {pct: 90}, Cleanliness: {pct: 90}, Fun: {pct: 90}, Society: {pct: 90}};
 const snapshot = {queue: {queue_count: 0}, stats: {stats}, work: {}, hope: {selected: [{hope_id: 'Hope_Winter_DrinkCoffee'}]}};
 const sites = [{entity_id: HOME, id: 'Cahaya_Residence_1', l10n: '집'}, {entity_id: PARK, id: 'Cahaya_Public_Park1', l10n: '공원'},
  {entity_id: CAFE, id: 'Cahaya_Business_Cafe1', l10n: '카페'}];
 const siteRows = [
  {_row_name: 'Cahaya_Residence_1', defaultInfo: {siteType: 'Residence', tags: []}},
  {_row_name: 'Cahaya_Public_Park1', defaultInfo: {siteType: 'Public', tags: ['SiteTag_Park']}},
  {_row_name: 'Cahaya_Business_Cafe1', defaultInfo: {siteType: 'Business', tags: opts.cafeTags || ['Coffee', 'Orderable']}}];
 let done = false;
 const cli = async (name, args = {}) => {
  if (name === 'entity.reflect') {
   if (args.Component === 'Hope') return {selectedHopes: [{hopeId: 'Hope_Winter_DrinkCoffee', missionId: {value: 100}}]};
   if (args.Component === 'Mission') return {missionMap: {'(Value=100)': {bIsFinished: done,
    conditionStates: [{currentCount: done ? 1 : 0, goalCount: 1, compareType: 'GreaterOrEqual'}]}}};
   if (String(args.entity_id) === '10') return {residanceSiteId: {value: HOME}};
   return {};
  }
  if (name === 'data.table_get' && args.Alias === 'Hope') return {missionId: 'M1'};
  if (name === 'data.table_get' && args.Alias === 'Mission') return {conditions: [{conditionType: 'InteractionBagCount', conditionId1: 'Coffee'}]};
  if (name === 'data.table_get_all' && args.Alias === 'Site') return siteRows;
  if (name === 'data.table_get') throw Error('Row not found');
  if (name === 'interaction.search') return {results: args.Keyword === 'Coffee' ? [{interaction_bag_id: 'CoffeeMachine_Order', display_name: '커피 주문하기', tags: ['Coffee']}] : []};
  if (name === 'world.get_loaded_sites') return {map_id: 'Cahaya_Map', sites};
  if (name === 'build.get_site_info') return character.locatedSiteId.value === HOME ? {site_id: 'Cahaya_Residence_1', site_type: 'Residence'} : {site_id: 'Cahaya_Business_Cafe1', site_type: 'Business'};
  if (name === 'build.scan_objects') {
   const objects = character.locatedSiteId.value === CAFE ? [{entity_id: MACHINE, table_id: 'CoffeeMachine01', world_location: {x: 1, y: 0, z: 0}}] :
    [{entity_id: 31, table_id: 'Bed01', world_location: {x: 1, y: 0, z: 0}}];
   return {total: objects.length, objects};
  }
  if (name === 'entity.scan_objects') return {objects: []};
  if (name === 'interaction.list_available') return {interactions: Number(args.target_entity_id) === MACHINE ?
   [{enabled: true, interaction_bag_id: 'CoffeeMachine_Order', display_name: '커피 주문하기'}] : [{enabled: true, interaction_bag_id: 'Sleep_Bed01', display_name: '자기'}]};
  if (name === 'schedule.diagnose') return {has_schedule: false};
  if (name === 'interaction.get_queue') return {queue_count: 0};
  if (name === 'skill.get_all') return {skills: []};
  if (name === 'movement.get_site_move_interaction') return {execution_tool: 'interaction.execute', entity_id: 1,
   target_entity_id: Number(args.target_entity_id), interaction_bag_id: 'LLM_WalkToSite', smartzoi: true};
  unexpected.push(name + ' ' + JSON.stringify(args));
  throw Error('Unexpected CLI ' + name);
 };
 const actions = lifeActions({cli, write: async (...a) => writes.push(a), log: s => logs.push(s), state: {},
  game: () => ({map_id: 'Cahaya_Map', possessed_entity_id: 1}), members: () => [member], snapshot: () => snapshot, active: () => true});
 return {member, character, snapshot, writes, logs, unexpected, actions, decision: {},
  arrive: site => { character.locatedSiteId = {value: site}; }, finish: () => { done = true; }};
}
const at = (hour, minute = 0) => ({day: 0, hour, minute});

test('hope with no action at home: cafe chosen by facility tags, move requested, action run on arrival, then home', async () => {
 const w = world();
 // 1. At home the coffee action does not exist; the cafe is the only tagged facility.
 assert.equal(await w.actions.pursueHope(w.member, w.character, w.decision, w.snapshot, at(10), 600, 1), true);
 assert.deepEqual(w.unexpected, []);
 assert.equal(w.writes.length, 1);
 assert.equal(w.writes[0][0], 'interaction.execute');
 assert.equal(w.writes[0][1].interaction_bag_id, 'LLM_WalkToSite');
 assert.equal(w.writes[0][1].target_entity_id, String(CAFE));
 assert.equal(w.decision.outing.site, CAFE);
 assert.equal(w.decision.outing.goalVisit, 'Hope_Winter_DrinkCoffee');
 // 2. Arrival is observed, then the hope action is requested on the cafe's machine.
 w.arrive(CAFE);
 await w.actions.outing(w.member, w.character, w.decision, w.snapshot, at(10, 40), 640, 1);
 assert.ok(w.decision.outing.arrived);
 assert.equal(await w.actions.pursueHope(w.member, w.character, w.decision, w.snapshot, at(10, 45), 645, 1), true);
 assert.equal(w.writes.length, 2);
 assert.equal(w.writes[1][1].interaction_bag_id, 'CoffeeMachine_Order');
 assert.equal(w.writes[1][1].target_entity_id, String(MACHINE));
 // The game mission, not the request, is what counts: completion marks the cafe as a place that works.
 w.finish();
 await w.actions.reviewGoal(w.member, w.decision, w.snapshot, 660);
 assert.equal(w.decision.outing.found, true);
 assert.equal(w.decision.goal, null);
 assert.ok(w.logs.some(l => l.includes('Hope_Winter_DrinkCoffee')));
 // 3. After the stay the Zoi is sent home, and the trip is closed once home is observed.
 assert.equal(await w.actions.outing(w.member, w.character, w.decision, w.snapshot, at(12, 50), 770, 1), true);
 assert.equal(w.writes[2][1].target_entity_id, String(HOME));
 w.arrive(HOME);
 await w.actions.outing(w.member, w.character, w.decision, w.snapshot, at(13, 30), 810, 1);
 assert.equal(w.decision.outing, null);
 assert.deepEqual(w.unexpected, []);
});

test('no facility carries the tags: no trip is requested and the goal stays waiting', async () => {
 const w = world({cafeTags: ['Orderable']});
 assert.equal(await w.actions.pursueHope(w.member, w.character, w.decision, w.snapshot, at(10), 600, 1), false);
 assert.equal(w.writes.length, 0);
 assert.equal(w.decision.outing, undefined);
 assert.deepEqual(w.unexpected, []);
});
