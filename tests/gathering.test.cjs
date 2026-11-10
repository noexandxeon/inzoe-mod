'use strict';
// 0.5.5: inviting close acquaintances home / holding a party, judged by where the guests end up.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const ui = path.join(__dirname, '..', 'ZoiObserver_XDX478', 'ui', 'HouseholdObserver');
const G = require(path.join(ui, 'gathering.js'));
const Rel = require(path.join(ui, 'relations.js'));
const L = require(path.join(ui, 'life.js'));

const HOME = 900, PARK = 901;
function world(opts) {
  opts = opts || {};
  const w = {
    life: {contacts: {'1': {}}}, writes: [], logs: [], scores: [], where: {}, values: opts.values || {'50': 72, '51': 20, '52': 64},
    offered: opts.offered || [
      {interaction_bag_id: 'Co_Friendship_InviteHome', display_name: '집으로 초대하기', enabled: true},
      {interaction_bag_id: 'Co_Career_SmallTalk', display_name: '잡담', enabled: true},
      {interaction_bag_id: 'Co_Party_Decline', display_name: '파티 거절', enabled: true},
    ],
    search: opts.search || [],
  };
  Object.keys(w.values).forEach(id => { Rel.remember(w.life, '1', id, {name: 'N' + id}, 100); w.where[id] = PARK; });
  w.api = {
    L, Rel, life: () => w.life, members: () => [{entity_id: 1}, {entity_id: 2}], game: () => ({map_id: 'Dowon'}),
    home: async () => HOME, log: m => w.logs.push(m), score: e => w.scores.push(e),
    write: async (name, args) => { w.writes.push(args); },
    cli: async (name, args) => {
      if (name === 'relationships.get_value_between') return {stats: {Friendship: {value: w.values[args.target_id] || 0}, Romance: {value: 0}}};
      if (name === 'entity.reflect') return {locatedCityName: 'Dowon', locatedSiteId: {value: w.where[args.entity_id]}};
      if (name === 'interaction.get_queue') return {current: opts.asleep === args.entity_id ? {interaction_bag_id: 'Sleep_Bed'} : null, items: []};
      if (name === 'interaction.list_available') { if (opts.far) throw new Error('target not reachable'); return {interactions: w.offered}; }
      if (name === 'interaction.search') return {results: w.search};
      throw new Error('unexpected ' + name);
    },
  };
  w.g = G.create(w.api);
  w.member = {entity_id: 1, first_name: '하나'};
  w.character = {locatedSiteId: {value: HOME}};
  w.snapshot = {work: {}, queue: {current: null, items: []}, stats: {stats: {Hunger: {pct: 80}, Sleep: {pct: 80}, Toilet: {pct: 80}, Cleanliness: {pct: 80}, Society: {pct: 40}}}};
  w.host = (p, minute, hour) => w.g.host(w.member, w.character, p, w.snapshot, {hour: hour == null ? 14 : hour}, minute, 1);
  return w;
}

test('names that only look like inviting are not treated as invitations', () => {
  assert.strictEqual(G.kindOf({interaction_bag_id: 'Co_Friendship_InviteHome'}), 'invite');
  assert.strictEqual(G.kindOf({interaction_bag_id: 'Self_Phone_HostParty', display_name: '파티 열기'}), 'party');
  assert.strictEqual(G.kindOf({interaction_bag_id: 'Co_Invite_Accept'}), null);
  assert.strictEqual(G.kindOf({interaction_bag_id: 'Co_WeddingParty_Start'}), null);
  assert.strictEqual(G.kindOf({interaction_bag_id: 'Co_InviteDate'}), null);
  assert.strictEqual(G.kindOf({interaction_bag_id: 'Co_Career_SmallTalk'}), null);
});

test('only a close acquaintance is invited, and the arrival is what confirms it', async () => {
  const w = world(), p = {};
  assert.strictEqual(await w.host(p, 1000), true);
  assert.deepStrictEqual(w.writes, [{entity_id: '1', target_entity_id: '50', interaction_bag_id: 'Co_Friendship_InviteHome'}]);
  assert.strictEqual(p.gather.pending.kind, 'invite');
  assert.strictEqual(await w.host(p, 1010), false, 'no second request while waiting');
  assert.strictEqual(await w.g.review(w.member, p, 1030), 'waiting');
  w.where['50'] = HOME;
  assert.strictEqual(await w.g.review(w.member, p, 1060), 'came');
  assert.strictEqual(w.life.gatherBags.Co_Friendship_InviteHome.ok, 1);
  assert.strictEqual(p.nextTalk, 0);
  assert.ok(w.g.waiting(p), 'stays home while the guest is there');
  assert.strictEqual(await w.host(p, 1100), false, 'not again the same day');
});

test('nobody comes: the action is counted as failed and dropped after two misses', async () => {
  const w = world(), p = {};
  await w.host(p, 1000);
  assert.strictEqual(await w.g.review(w.member, p, 1000 + G.WAIT), 'missed');
  assert.strictEqual(w.scores.filter(e => e.kind === 'failed').length, 1);
  assert.strictEqual(await w.host(p, 1500), true);
  await w.g.review(w.member, p, 1500 + G.WAIT);
  assert.strictEqual(w.life.gatherBags.Co_Friendship_InviteHome.fail, 2);
  assert.strictEqual(await w.host(p, 2500 - 2500 % 1440 + 1440 + 840, 14), false, 'unconfirmed action is not repeated');
  assert.strictEqual(w.writes.length, 2);
});

test('not at home, at night, hungry, or with nobody close: no invitation', async () => {
  let w = world(), p = {};
  w.character.locatedSiteId.value = PARK;
  assert.strictEqual(await w.host(p, 1000), false);
  w = world(); assert.strictEqual(await w.host({}, 1000, 22), false);
  w = world(); w.snapshot.stats.stats.Hunger.pct = 10; assert.strictEqual(await w.host({}, 1000), false);
  w = world({values: {'50': 30, '51': 10}}); p = {};
  assert.strictEqual(await w.host(p, 1000), false);
  assert.strictEqual(p.gather.status, '가까운 지인 없음');
  w = world({asleep: '50', values: {'50': 80}}); assert.strictEqual(await w.host({}, 1000), false, 'sleeping friend is left alone');
  assert.strictEqual(w.writes.length, 0);
});

test('household members and people who reacted badly are not invited', async () => {
  const w = world({values: {'2': 90, '50': 80}}), p = {};
  Rel.blocked(w.life, '1', '50', 'rejected', 990);
  assert.strictEqual(await w.host(p, 1000), false);
  assert.strictEqual(w.writes.length, 0);
});

test('two close friends and a party action offered: a party, at most once in three days', async () => {
  const w = world({offered: [
    {interaction_bag_id: 'Co_Friendship_InviteHome', display_name: '집으로 초대하기', enabled: true},
    {interaction_bag_id: 'Co_HouseParty_Start', display_name: '홈 파티 열기', enabled: true},
  ]}), p = {};
  assert.strictEqual(await w.host(p, 1000), true);
  assert.strictEqual(p.gather.pending.kind, 'party');
  assert.deepStrictEqual(p.gather.pending.guests.map(g => g.id), ['50', '52']);
  w.where['52'] = HOME;
  assert.strictEqual(await w.g.review(w.member, p, 1050), 'came');
  assert.ok(p.gather.nextParty >= 1050 + 3 * 1440);
  assert.strictEqual(await w.host(p, 1050 + 1440 + 30, 14), true);
  assert.strictEqual(p.gather.pending.kind, 'invite', 'next day is a plain invitation');
});

test('friend out of reach: a phone action found in game data is used, Self_ with the Zoi as target', async () => {
  const w = world({far: true, search: [
    {interaction_bag_id: 'Self_Phone_InviteFriendHome', display_name: '친구 초대'},
    {interaction_bag_id: 'Object_Table_PartyDecoration', display_name: '파티 장식'},
  ]}), p = {};
  assert.strictEqual(await w.host(p, 1000), true);
  assert.deepStrictEqual(w.writes, [{entity_id: '1', target_entity_id: '1', interaction_bag_id: 'Self_Phone_InviteFriendHome'}]);
});

test('no inviting action anywhere: nothing is requested and it is said once', async () => {
  const w = world({offered: [{interaction_bag_id: 'Co_Career_SmallTalk', enabled: true}]}), p = {};
  assert.strictEqual(await w.host(p, 1000), false);
  assert.strictEqual(await w.host(p, 1000 + 720), false);
  assert.strictEqual(w.logs.length, 1);
  assert.strictEqual(w.writes.length, 0);
});

test('loading an earlier save clears a pending invitation', async () => {
  const w = world(), p = {};
  await w.host(p, 5000);
  assert.strictEqual(await w.g.review(w.member, p, 4000), null);
  assert.strictEqual(p.gather.pending, null);
});
