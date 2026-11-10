// The departure button is pressed only if the preparation is still valid after the last game reads.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ui = path.join(__dirname, '../ZoiObserver_XDX478/ui/HouseholdObserver');
const Travel = require(path.join(ui, 'travel.js'));
const L = require(path.join(ui, 'life.js'));
const P = require(path.join(ui, 'policy.js'));

const notices = [
 '여행에 함께 오지 않은 가족은 조작할 수 없습니다.',
 '가족 구성원이 아닌 조이와는 그룹 기능을 이용해 함께 다닐 수 있습니다.',
 '진행 중이거나, 예정된 이벤트는 즉시 취소됩니다.',
 '미션은 유지되지만 조건에 따라 달성이 불가할 수 있습니다.',
 '여행 기간 동안 직장은 무급 휴가로, 학교는 인정 결석으로 처리됩니다.',
 '다른 도시에서는 기존 도시에 있는 가족의 정보가 즉시 갱신되지 않을 수 있음을 확인했습니다.'
];
const CONFIRM = 'Travel_1/BW_WBP_Button_Ready/BW_Button';
const time = {day: 3, hour: 10, minute: 30};
const game = {possessed_entity_id: '42', map_id: 'Cahaya_Map',
 blocking: {popup_count: 1, primary_detail: 'None', pause_reasons: ['CityMoveMainPopup']}};

function setup(onFinalRead) {
 const trip = {actor: '42', household: '10', familySize: 1, origin: 'Cahaya_Map', destination: 'Gangnam_Map', day: time.day,
  weekday: 'Friday', stage: 'review', started: Date.now(), window: 'Travel_1', room: '102호 도미토리', party: 1, roomParty: 1,
  price: 70, companions: [], tried: []};
 const state = {travel: trip, background: false, people: {'42': {}}};
 const writes = [], logs = [];
 let treeReads = 0;
 const screen = () => ({window: 'Travel_1', nodes: [
  ...['내 여행 정보', '여행 도시', '도원', '숙소', trip.room, '여행 기간', '1박', '여행 인원', '총 여행 비용', '70'].map(text => ({role: 'text', text})),
  ...notices.map((text, i) => ({role: 'toggle', text, state: ['on'], ref: 'Travel_1/BW_WBP_Confirm/BW_DynamicEntryBox_CheckBox/row' + i + '/BW_CheckBox'})),
  {role: 'button', text: '여행 떠나기', ref: 'Travel_1/BW_WBP_Button_Ready'},
  {role: 'button', text: '여행 떠나기', ref: CONFIRM},
  {role: 'button', ref: 'Travel_1/BW_Button_Close'}]});
 const api = {
  state, log: note => logs.push(note), active: token => token === 7, game: () => game,
  async cli(name, args) {
   if (name === 'ui.list_windows') return {windows: [{ui_type: 'TravelPopup', window: 'Travel_1'}]};
   if (name === 'ui.get_tree') {
    // 1st read: the screen being reviewed. 2nd read: the last look before departure.
    if (++treeReads === 2 && onFinalRead) onFinalRead({trip, state});
    return screen();
   }
   if (name === 'entity.reflect' && args.Component === 'Currency') return {currencyMap: {mew: 100000}};
   if (name === 'entity.reflect' && args.Component === 'Timeline') return {careerTimelineParams: {},
    overrideTimelines: Array.from({length: 7}, () => ({name: 'None'}))};
   if (name === 'entity.reflect') return {entityTags: []};
   if (name === 'career.get_work_status') return {is_working_day: false, has_job: false};
   if (name === 'schedule.diagnose') return {has_schedule: false};
   if (name === 'stat.get_all') return {stats: {Hunger: {pct: 90}, Sleep: {pct: 90}, Toilet: {pct: 90}, Cleanliness: {pct: 90}}};
   throw Error('Unexpected CLI ' + name);
  },
  async write(...args) { writes.push(args); }
 };
 return {observer: Travel.create(api, L, P), trip, state, writes, logs};
}
const departures = writes => writes.filter(w => w[0] === 'ui.click' && w[1].ref === CONFIRM);

test('a verified review with every notice accepted requests departure exactly once', async () => {
 const {observer, trip, writes} = setup();
 assert.equal(await observer.advance(game, time, 7), true);
 assert.equal(departures(writes).length, 1);
 assert.equal(trip.stage, 'submitted');
 assert.equal(trip.balanceBefore, 100000);
});

test('preparation time running out during the final reads cancels the departure', async () => {
 const {observer, trip, state, writes} = setup(({trip}) => { trip.started -= 120000; });
 assert.equal(await observer.advance(game, time, 7), false);
 assert.equal(departures(writes).length, 0);
 assert.notEqual(trip.stage, 'submitted');
 assert.equal(state.travel, null);
});

test('switching to 다른 작업 모드 during the final reads cancels the departure', async () => {
 const {observer, trip, state, writes} = setup(({state}) => { state.background = true; });
 assert.equal(await observer.advance(game, time, 7), false);
 assert.equal(departures(writes).length, 0);
 assert.notEqual(trip.stage, 'submitted');
 assert.equal(state.travel, null);
});

test('a plan replaced during the final reads does not press the old departure button', async () => {
 const {observer, trip, writes} = setup(({state}) => { state.travel = {stage: 'city'}; });
 assert.equal(await observer.advance(game, time, 7), false);
 assert.equal(departures(writes).length, 0);
 assert.notEqual(trip.stage, 'submitted');
});
