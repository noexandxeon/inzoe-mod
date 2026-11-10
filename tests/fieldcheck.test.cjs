'use strict';
// 0.5.9: the mod asks the game itself about what could only be guessed, read-only, one question per turn.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const ui = path.join(__dirname, '..', 'ZoiObserver_XDX478', 'ui', 'HouseholdObserver');
const F = require(path.join(ui, 'fieldcheck.js'));
const G = require(path.join(ui, 'gathering.js'));
const CP = require(path.join(ui, 'career-path.js'));
const classify = a => G.kindOf(a) || (CP.matches(CP.LEAVE, a) ? 'leave' : CP.matches(CP.FOUND, a) ? 'found' : CP.matches(CP.OPEN, a) ? 'open' : null);

function game() {
  const calls = [];
  const cli = async (name, args) => {
    calls.push(name);
    if (name === 'interaction.search') {
      if (args.Keyword === 'Invite') return {results: [{interaction_bag_id: 'Co_Friendship_InviteHome', display_name: '집으로 초대'}, {interaction_bag_id: 'Co_Invite_Accept'}]};
      if (args.Keyword === 'Quit') return {results: [{interaction_bag_id: 'CareerCommon_Quit', display_name: '퇴사'}]};
      return {results: []};
    }
    if (name === 'cli.help') { if (args.command === 'entity.possess') throw new Error('unknown command'); return {id: args.command, access: 'Public'}; }
    if (name === 'relationships.list') return {relationships: [{target_id: 5, name: '비밀', stats: {Friendship: {value: 70}}}]};
    return {};
  };
  return {calls, cli};
}

test('only read-only questions are asked', async () => {
  const g = game(), state = {};
  while (await F.run(state, '1', {minute: 10, selected: '1', home: 9}, g.cli, classify));
  assert.ok(state.fieldCheck.done);
  const allowed = new Set(['interaction.search', 'cli.help', 'relationships.list', 'contacts.get_all', 'site.get_visitors', 'event.list']);
  g.calls.forEach(name => assert.ok(allowed.has(name), name));
  assert.strictEqual(g.calls.length, F.steps().length, 'one question per step, none repeated');
});

test('real action names are recorded by what they are; look-alikes are listed apart', async () => {
  const g = game(), state = {};
  while (await F.run(state, '1', {minute: 10, selected: '1', home: 9}, g.cli, classify));
  const r = state.fieldCheck.results;
  assert.deepStrictEqual(r['search:Invite'].known, [{id: 'Co_Friendship_InviteHome', name: '집으로 초대', as: 'invite'}]);
  assert.deepStrictEqual(r['search:Invite'].other, ['Co_Invite_Accept']);
  assert.strictEqual(r['search:Quit'].known[0].as, 'leave');
  assert.strictEqual(r['command:character.possess'].access, 'Public');
  assert.strictEqual(r['command:entity.possess'].ok, false, 'a failing question is recorded, not retried forever');
  assert.match(F.line(state), /완료 · 찾은 행동: 초대 1, 파티 0, 퇴사·은퇴 1/);
});

test('answers keep the form of the data, not the data', () => {
  const s = F.shape({relationships: [{target_id: 5, name: '비밀', stats: {Friendship: {value: 70}}}]}, 3);
  assert.deepStrictEqual(s, {relationships: {array: 1, of: {target_id: 'number', name: 'string', stats: 'object'}}});
  assert.ok(!JSON.stringify(s).includes('비밀'));
});

test('one step per turn, and a new version asks again', async () => {
  const g = game(), state = {};
  assert.strictEqual(await F.run(state, '1', {minute: 1, selected: '1', home: 0}, g.cli, classify), 'search:Invite');
  assert.strictEqual(g.calls.length, 1);
  assert.match(F.line(state), /현장 점검 1\//);
  assert.strictEqual(await F.run(state, '2', {minute: 2, selected: '1', home: 0}, g.cli, classify), 'search:Invite');
  assert.strictEqual(Object.keys(state.fieldCheck.results).length, 1);
});

test('without a home site the visitor question is skipped, not sent with a bad id', async () => {
  const g = game(), state = {};
  while (await F.run(state, '1', {minute: 10, selected: '1', home: 0}, g.cli, classify));
  assert.strictEqual(state.fieldCheck.results['shape:site.get_visitors'].skipped, '조건 없음');
  assert.ok(!g.calls.includes('site.get_visitors'));
});
