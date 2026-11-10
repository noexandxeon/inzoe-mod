// Goal planner, first increment: the practice budget counts practice that ran, and ambitions get a larger share.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const M = require(path.join(__dirname, '../ZoiObserver_XDX478/ui/HouseholdObserver/goal-memory.js'));
const hope = {name: 'Hope_Craft', kind: 'hope', instance: 1}, ambition = {name: 'Amb_Fight', kind: 'ambition', instance: 2};
const day = 4, at = h => day * 1440 + h * 60;

test('a practice request that never started gives its slot back; practice that ran keeps it', () => {
 const d = {};
 for (let i = 0; i < 6; i++) {
  assert.equal(M.practiceAllowed(d, hope, at(8) + i), true, 'request ' + i);
  M.started(d, hope, at(8) + i, 'HandCraft');
  assert.equal(M.practiceMissed(d, hope, at(8) + i), true);
 }
 assert.equal(d.goalMemory[M.key(hope)].practice.sessions, 0);
 assert.equal(d.goalMemory[M.key(hope)].practice.missed, 6);
 for (let i = 0; i < 3; i++) {
  assert.equal(M.practiceAllowed(d, hope, at(10) + i), true);
  M.started(d, hope, at(10) + i, 'HandCraft');
  M.practiceRan(d, hope, at(10) + i);
  assert.equal(M.practiceMissed(d, hope, at(10) + i), false, 'a session that ran is not refunded');
 }
 assert.equal(M.practiceAllowed(d, hope, at(12)), false);
 assert.equal(M.practiceAllowed(d, hope, at(12) + 1440), true, 'a new game day starts a new share');
});

test('an ambition practises more per day than a hope', () => {
 const d = {};
 assert.equal(M.practiceLimit(hope), 3);
 assert.equal(M.practiceLimit(ambition), 5);
 for (let i = 0; i < 5; i++) { assert.equal(M.practiceAllowed(d, ambition, at(9) + i), true); M.started(d, ambition, at(9) + i, 'Exercise'); M.practiceRan(d, ambition, at(9) + i); }
 assert.equal(M.practiceAllowed(d, ambition, at(15)), false);
});
