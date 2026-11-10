const {test} = require('node:test');
const assert = require('node:assert/strict');
const Travel = require('../ZoiObserver_XDX478/ui/HouseholdObserver/travel.js');

const time = {day: 3, hour: 10, minute: 30};
const game = {
  possessed_entity_id: '42',
  map_id: 'Cahaya_Map',
  blocking: {popup_count: 1, primary_detail: 'None', pause_reasons: ['CityMoveMainPopup']}
};
const surfaces = [
  {ui_type: 'TravelPopup', window: 'Travel_1', close: '/BW_Button_Close'},
  {ui_type: 'TravelCityMovePopup', window: 'Purpose_1', close: '/BW_WBP_Title/BW_Button_Back'},
  {ui_type: 'Smartphone', window: 'Phone_1', close: '/WBP_Mobile/WBP_Common_CloseButton/BW_Button'}
];

function setup({trip: changes, windows = surfaces, background = true, readError = false, retainWindow = false} = {}) {
  const trip = {
    actor: '42', origin: 'Cahaya_Map', destination: 'Gangnam_Map', day: time.day,
    stage: 'review', started: Date.now(), window: 'Travel_1', purposeWindow: 'Purpose_1',
    phoneWindow: 'Phone_1', ...changes
  };
  const state = {travel: trip, background, people: {'42': {}}};
  const writes = [], reads = [], logs = [];
  let open = windows.slice();
  const api = {
    state, log: (note) => logs.push(note), active: (token) => token === 7,
    async cli(name, args) {
      reads.push(name);
      if (readError) throw Error('read failed');
      if (name === 'ui.list_windows') return {windows: open};
      assert.equal(name, 'ui.get_tree');
      const entry = open.find((entry) => entry.window === args.Window);
      return {window: entry.window, nodes: [{role: 'button', ref: entry.window + entry.close}]};
    },
    async write(...args) {
      writes.push(args);
      if (!retainWindow) open = open.filter((entry) => entry.window + entry.close !== args[1].ref);
    }
  };
  return {observer: Travel.create(api, {}, {}), state, trip, writes, reads, logs};
}

test('background mode releases an unsubmitted trip using its recorded native close controls', async () => {
  const {observer, state, writes, logs} = setup();
  assert.equal(await observer.advance(game, time, 7), false);
  assert.equal(state.travel, null);
  assert.equal(state.people['42'].nextVacation, (time.day + 1) * 1440);
  assert.deepEqual(writes, surfaces.map(({window, close}) => [
    'ui.click', {ref: window + close, Force: true}, 7, ':travel', '42'
  ]));
  assert.match(logs[0], /미제출 여행 준비 종료$/);
});

test('background mode leaves a different travel window alone while releasing the plan', async () => {
  const {observer, state, writes, logs} = setup({windows: [{...surfaces[0], window: 'Player_2'}]});
  assert.equal(await observer.advance(game, time, 7), false);
  assert.equal(state.travel, null);
  assert.deepEqual(writes, []);
  assert.match(logs[0], /게임 화면 확인 필요$/);
});

test('a foreign popup cannot postpone the pre-submission deadline', async () => {
  const {observer, state, writes, reads} = setup({background: false, trip: {stage: 'city', started: Date.now() - 111000}});
  const blocked = {...game, blocking: {popup_count: 1, primary_detail: 'Other'}};
  assert.equal(await observer.advance(blocked, time, 7), false);
  assert.equal(state.travel, null);
  assert.deepEqual(writes, []);
  assert.deepEqual(reads, []);
});

test('UI failure cannot keep travel preparation active or retry its close control', async () => {
  const failed = setup({readError: true});
  assert.equal(await failed.observer.advance(game, time, 7), false);
  assert.equal(failed.state.travel, null);

  const unchanged = setup({retainWindow: true});
  assert.equal(await unchanged.observer.advance(game, time, 7), false);
  assert.equal(unchanged.state.travel, null);
  assert.equal(unchanged.writes.length, 1);
  assert.match(unchanged.logs[0], /게임 화면 확인 필요$/);
});

test('background mode keeps an already submitted request for receipt reconciliation', async () => {
  const {observer, state, trip, writes, reads} = setup({trip: {stage: 'submitted', submitted: Date.now()}});
  assert.equal(await observer.advance(game, time, 7), true);
  assert.equal(state.travel, trip);
  trip.submitted -= 121000;
  assert.equal(await observer.advance(game, time, 7), false);
  assert.equal(state.travel, trip);
  assert.equal(trip.stage, 'unconfirmed');
  assert.deepEqual(writes, []);
  assert.deepEqual(reads, []);
});
