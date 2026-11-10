'use strict';
// 0.5.7: working lives that differ per Zoi (직장인 / 창업 / 자유직), retirement and what comes after.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const ui = path.join(__dirname, '..', 'ZoiObserver_XDX478', 'ui', 'HouseholdObserver');
const CP = require(path.join(ui, 'career-path.js'));
const Persona = require(path.join(ui, 'persona.js'));
const P = require(path.join(ui, 'policy.js'));

// Individuals picked by their fixed leaning, so the tests do not depend on one magic id.
function idWith(test_) { for (let i = 1; i < 5000; i++) if (test_(CP.quirk(i))) return i; throw new Error('no id'); }
const BOLD = idWith(q => q > 0.85), CAUTIOUS = idWith(q => q < 0.15);
const shop = {type: '음식점', score: 20};
function ctx(over) {
  return Object.assign({id: BOLD, day: 10, age: 'Adult', traits: [], skills: [], ambition: null, employed: false, daysInJob: 0,
    cash: 5000, reserve: 2000, short: false, business: null, ownsBusiness: false, bizOperating: false, bizProfit: 0}, over);
}

test('temperament and ambition choose different paths', () => {
  assert.strictEqual(CP.choosePath(['Risk-averse', 'Faithful'], [], null, 1).path, 'employee');
  assert.strictEqual(CP.choosePath(['Independent', 'Adventurer'], [], null, 1).path, 'founder');
  assert.strictEqual(CP.choosePath(['Artist', 'Introvert'], [{id: 'Art', level: 5}], null, 1).path, 'freelancer');
  assert.strictEqual(CP.choosePath(['Faithful'], [], {id: 'Ambition_Tycoon', name: '재벌', plans: []}, 1).path, 'founder', 'a wealth ambition outweighs one steady trait');
  assert.strictEqual(CP.choosePath([], [], null, 1).path, 'employee');
});

test('an even split is settled by the individual, so two similar Zois can differ', () => {
  const traits = ['Independent', 'Faithful'];
  assert.strictEqual(CP.choosePath(traits, [], null, BOLD).path, 'founder');
  assert.strictEqual(CP.choosePath(traits, [], null, CAUTIOUS).path, 'employee');
  assert.strictEqual(CP.quirk(BOLD), CP.quirk(BOLD), 'never re-rolled');
});

test('the ambition is read for the skills and theme it needs', () => {
  const f = CP.ambitionFocus({id: 'Ambition_MasterChef', name: '요리 명인', plans: [{name: 'M1', conditions: [{conditionType: 'SkillLevel', skillId: 'Cooking'}]}]});
  assert.deepStrictEqual(f.skills, ['Cooking']);
  assert.strictEqual(f.career, true);
  assert.deepStrictEqual(CP.ambitionBonus(['Cooking', 'Speaking'], {id: 'x', plans: [{conditions: [{skillId: 'Cooking'}]}]}), {score: 10, reasons: ['야망 / Cooking']});
});

test('job choice counts the ambition: the same openings give different jobs', () => {
  const openings = [{vacancy: 1, career_entity_id: 1, job_id: 'chef', career_dt_id: 'Restaurant'}, {vacancy: 1, career_entity_id: 2, job_id: 'dev', career_dt_id: 'ITCompany'}];
  const rows = {Restaurant: {recommendSkillIds: ['Cooking']}, ITCompany: {recommendSkillIds: ['Programming']}};
  const cook = {id: 'a', plans: [{conditions: [{skillId: 'Cooking'}]}]}, coder = {id: 'b', plans: [{conditions: [{skillId: 'Programming'}]}]};
  const pick = amb => P.pick(openings, {}, [], rows, 7, d => CP.ambitionBonus(d, amb)).opening.job_id;
  assert.strictEqual(pick(cook), 'chef');
  assert.strictEqual(pick(coder), 'dev');
});

test('employee: looks for work, stays, retires in old age only with savings', () => {
  const book = {};
  assert.strictEqual(CP.plan(book, ctx({id: CAUTIOUS, traits: ['Faithful']})).step, 'seek_job');
  assert.strictEqual(CP.plan(book, ctx({id: CAUTIOUS, traits: ['Faithful'], employed: true, daysInJob: 30})).step, 'keep_job');
  assert.strictEqual(CP.plan(book, ctx({id: CAUTIOUS, traits: ['Faithful'], employed: true, age: 'Elderly', cash: 3000})).step, 'keep_job');
  assert.strictEqual(CP.plan(book, ctx({id: CAUTIOUS, traits: ['Faithful'], employed: true, age: 'Elderly', cash: 20000})).step, 'retire');
  assert.strictEqual(CP.plan(book, ctx({id: CAUTIOUS, traits: ['Faithful'], age: 'Elderly', cash: 20000})).step, 'rest');
  assert.strictEqual(CP.mayApply(book, false), false, 'a retiree is not put back to work');
});

test('founder: job first for seed money, then a business while employed, then leaving the job', () => {
  const t = {traits: ['Independent', 'Leader'], business: shop};
  const book = {};
  assert.strictEqual(CP.plan(book, ctx(Object.assign({cash: 3000}, t))).step, 'seek_job');
  assert.strictEqual(CP.plan(book, ctx(Object.assign({cash: 3000, employed: true, daysInJob: 20}, t))).step, 'prepare_business');
  assert.strictEqual(CP.mayApply(book, true), true);
  assert.strictEqual(CP.plan(book, ctx(Object.assign({cash: 30000, employed: true, daysInJob: 20}, t))).step, 'start_business');
  assert.strictEqual(CP.plan(book, ctx(Object.assign({cash: 30000, employed: true, daysInJob: 20, ownsBusiness: true}, t))).step, 'run_business');
  const step = CP.plan(book, ctx(Object.assign({cash: 30000, employed: true, ownsBusiness: true, bizOperating: true, bizProfit: 900}, t)));
  assert.strictEqual(step.step, 'resign');
  assert.strictEqual(CP.plan(book, ctx(Object.assign({cash: 30000, ownsBusiness: true, bizOperating: true, bizProfit: 900}, t))).step, 'run_business');
});

test('a bold founder starts sooner and with less saved than a cautious one', () => {
  const t = {traits: ['Independent', 'Leader'], business: shop, employed: true, daysInJob: 6, cash: 6500};
  assert.strictEqual(CP.plan({}, ctx(Object.assign({id: BOLD}, t))).step, 'start_business');
  assert.strictEqual(CP.plan({}, ctx(Object.assign({id: CAUTIOUS}, t))).step, 'prepare_business');
});

test('no way to found a business in the game: the founder goes on as a one-person business, leaves the job later', () => {
  const t = {traits: ['Independent', 'Leader'], business: shop, employed: true, daysInJob: 20, cash: 30000};
  const book = {foundingBlocked: true};
  assert.strictEqual(CP.plan(book, ctx(t)).step, 'freelance');
  assert.ok(CP.worksAlone(book));
  book.solo = {since: 6};
  assert.strictEqual(CP.plan(book, ctx(t)).step, 'resign');
});

test('freelancer: works alone, takes a job only when money stays short', () => {
  const t = {traits: ['Artist', 'Introvert'], skills: [{id: 'Art', level: 5}]};
  const book = {};
  assert.strictEqual(CP.plan(book, ctx(t)).step, 'freelance');
  assert.strictEqual(CP.mayApply(book, false), false);
  assert.strictEqual(CP.plan(book, ctx(Object.assign({short: true, day: 11}, t))).step, 'freelance', 'one bad day is not enough');
  assert.strictEqual(CP.plan(book, ctx(Object.assign({short: true, day: 13}, t))).step, 'seek_job');
});

test('after retiring: a venturesome retiree opens a business, a steady one rests', () => {
  const venturer = CP.plan({}, ctx({age: 'Elderly', traits: ['Independent', 'Adventurer'], business: shop, cash: 40000}));
  assert.strictEqual(venturer.step, 'start_business');
  assert.match(venturer.why, /은퇴 후/);
  assert.strictEqual(CP.plan({}, ctx({id: CAUTIOUS, age: 'Elderly', traits: ['Faithful'], cash: 40000})).step, 'rest');
});

test('a steady employee with a bold streak may leave for a shop in mid-life; a cautious one never does', () => {
  const t = {traits: ['Faithful', 'Workaholic'], business: shop, employed: true, daysInJob: 40, cash: 60000};
  assert.strictEqual(CP.plan({}, ctx(Object.assign({id: BOLD}, t))).step, 'start_business');
  assert.strictEqual(CP.plan({}, ctx(Object.assign({id: CAUTIOUS}, t))).step, 'keep_job');
});

test('the path is kept, not re-decided every day; a new ambition may change it', () => {
  const book = {};
  CP.plan(book, ctx({traits: ['Faithful'], id: CAUTIOUS}));
  CP.plan(book, ctx({traits: ['Independent', 'Leader', 'Adventurer'], id: CAUTIOUS, day: 12}));
  assert.strictEqual(book.path, 'employee');
  CP.plan(book, ctx({traits: ['Independent', 'Leader', 'Adventurer'], id: CAUTIOUS, day: 30}));
  assert.strictEqual(book.path, 'founder');
  CP.plan(book, ctx({traits: ['Faithful'], id: CAUTIOUS, day: 31, ambition: {id: 'Ambition_Artist', name: '예술가', plans: []}}));
  assert.strictEqual(book.focus, 'Ambition_Artist');
});

test('only real leaving / founding / opening actions are recognised', () => {
  assert.ok(CP.matches(CP.LEAVE, {interaction_bag_id: 'CareerCommon_Quit'}));
  assert.ok(CP.matches(CP.LEAVE, {interaction_bag_id: 'X', display_name: '퇴사하기'}));
  assert.ok(!CP.matches(CP.LEAVE, {interaction_bag_id: 'CareerCommon_UseVacation'}));
  assert.ok(!CP.matches(CP.LEAVE, {interaction_bag_id: 'CareerCommon_Quit_Cancel'}));
  assert.ok(CP.matches(CP.FOUND, {interaction_bag_id: 'Self_Phone_StartBusiness'}));
  assert.ok(CP.matches(CP.OPEN, {interaction_bag_id: 'Biz_Counter_OpenStore'}));
  assert.ok(!CP.matches(CP.OPEN, {interaction_bag_id: 'Biz_Counter_CloseStore'}));
});

function executor(opts) {
  const w = {logs: [], asked: [], career: {careerSlots: {business: {jobDtId: 'j'}}}, owned: [], offered: opts.offered || [], search: opts.search || []};
  w.v = CP.create({
    log: m => w.logs.push(m), score: () => {},
    cli: async (name, args) => {
      if (name === 'interaction.search') return {results: w.search};
      if (name === 'entity.reflect') return args.Component === 'Career' ? w.career : {householdBizProfile: {managedHouseholdBizIdList: w.owned}};
      if (name === 'household_biz.get_info') return {is_operating: !!w.operating};
      if (name === 'household_biz.can_start_day_business') return {can_start: true};
      throw new Error('unexpected ' + name);
    },
    computers: async () => [{entity_id: 77}], objects: async () => [{entity_id: 88}],
    act: async (member, objects, choose, token, offers) => {
      const target = String(objects[0].entity_id), list = offers && offers[target] ? offers[target].interactions : w.offered;
      const a = choose(list, target);
      if (a) w.asked.push({bag: a.interaction_bag_id, target});
      return a || null;
    },
    move: async (m, site) => { w.moved = site; return true; },
  });
  w.member = {entity_id: 1, first_name: '하나'};
  return w;
}

test('resigning is confirmed only when the job is really gone', async () => {
  const w = executor({offered: [{interaction_bag_id: 'CareerCommon_Quit', display_name: '퇴사', enabled: true}]});
  const p = {careerPath: {step: 'resign', why: '사업 수익'}};
  assert.strictEqual(await w.v.leave(w.member, {}, p, 1000, 1), true);
  assert.strictEqual(await w.v.leave(w.member, {}, p, 1010, 1), false, 'one request at a time');
  assert.strictEqual(await w.v.review(w.member, p, 1030), 'waiting');
  w.career = {careerSlots: {}};
  assert.strictEqual(await w.v.review(w.member, p, 1060), 'left');
  assert.ok(p.careerPath.leftJob);
});

test('a resignation the game ignores is given up after two tries and the job is kept', async () => {
  const w = executor({offered: [{interaction_bag_id: 'CareerCommon_Quit', enabled: true}]});
  const p = {careerPath: {step: 'retire', why: '노년'}};
  for (const t of [1000, 2000]) { assert.strictEqual(await w.v.leave(w.member, {}, p, t, 1), true); assert.strictEqual(await w.v.review(w.member, p, t + 200), 'missed'); }
  assert.strictEqual(await w.v.leave(w.member, {}, p, 3000, 1), false);
  assert.strictEqual(w.asked.length, 2);
  assert.ok(!p.careerPath.retired);
  assert.match(p.careerPath.note, /직장 유지/);
});

test('no founding action in the game: founding is marked blocked instead of retried forever', async () => {
  const w = executor({});
  const p = {careerPath: {step: 'start_business', why: '창업'}};
  assert.strictEqual(await w.v.start(w.member, {}, p, 1000, 1), false);
  assert.strictEqual(p.careerPath.foundingBlocked, true);
  assert.strictEqual(w.asked.length, 0);
});

test('founding through a phone action found in game data, confirmed by owning a business', async () => {
  const w = executor({search: [{interaction_bag_id: 'Self_Phone_StartBusiness', display_name: '사업 시작'}]});
  const p = {careerPath: {step: 'start_business', why: '창업'}};
  assert.strictEqual(await w.v.start(w.member, {}, p, 1000, 1), true);
  assert.deepStrictEqual(w.asked, [{bag: 'Self_Phone_StartBusiness', target: '1'}]);
  w.owned = [{value: 555}];
  assert.strictEqual(await w.v.review(w.member, p, 1100), 'founded');
});

test('a closed business: go there by day, open it, confirmed by the game', async () => {
  const w = executor({offered: [{interaction_bag_id: 'Biz_Counter_OpenStore', enabled: true}]});
  const p = {careerPath: {step: 'run_business'}}, biz = {id: 555, site: 40, operating: false};
  assert.strictEqual(await w.v.run(w.member, {locatedSiteId: {value: 9}}, p, biz, {hour: 22}, 1000, 1), false, 'not at night');
  assert.strictEqual(await w.v.run(w.member, {locatedSiteId: {value: 9}}, p, biz, {hour: 10}, 1000, 1), true);
  assert.strictEqual(w.moved, 40);
  assert.strictEqual(await w.v.run(w.member, {locatedSiteId: {value: 40}}, p, biz, {hour: 11}, 1060, 1), true);
  w.operating = true;
  assert.strictEqual(await w.v.review(w.member, p, 1090), 'open');
});

test('persona: the same day is weighed differently by different Zois', () => {
  const host = Persona.weights(['Extrovert', 'Popular'], null, 1), loner = Persona.weights(['Introvert', 'Bookworm'], null, 2);
  assert.ok(host.gather > 10 && loner.gather < -10);
  const make = () => [{key: 'gather', base: 26}, {key: 'side', base: 30}, {key: 'catShop', base: 90}];
  const a = Persona.apply(make(), host), b = Persona.apply(make(), loner);
  assert.ok(a[0].base > a[1].base && b[0].base < b[1].base);
  assert.strictEqual(a[2].base, 90, 'urgent tasks are not touched');
  assert.notDeepStrictEqual(Persona.weights([], null, 1), Persona.weights([], null, 2), 'even without traits individuals differ');
  assert.deepStrictEqual(Persona.weights(['Artist'], null, 5), Persona.weights(['Artist'], null, 5));
  Persona.KEYS.forEach(k => assert.ok(Math.abs(host[k]) <= 18));
  assert.match(Persona.describe(host), /초대·파티/);
});
