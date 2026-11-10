// Development probe: lets a developer read game data while the game runs.
// It reads saved/dev-cmd.cfg, runs only read-only CLI commands, and writes saved/dev-result.cfg.
// It never runs commands that change the game (execute, click, place, buy and similar).
(function () {
 'use strict';
 var MOD_ID = 'ZoiObserver_XDX478', SECTION = 'ui/HouseholdObserver/saved';
 var READ_ONLY = /^(?:[a-z_]+\.(?:get|list|scan|reflect|diagnose|search|find|help)(?:_[a-z_]+)?|data\.table_get(?:_all)?|ui\.get_[a-z_]+|cli\.help)$/;
 var DENY = /(?:^|[._])(?:execute|click|place|buy|purchase|set|add|remove|delete|dismiss|enter|exit|force|save|join|quit|send|reply|spawn|destroy|sell|pay)(?:_|$)/;
 var lastId = null, running = false;
 function cli(cmd, args) { return inzoi.cli.execute(cmd, args || {}); }
 function sessionDone(id) {
  try { if (sessionStorage.getItem('zoiDevReload') === id) return true; sessionStorage.setItem('zoiDevReload', id); } catch (e) {}
  return false;
 }
 function allowed(cmd) { return typeof cmd === 'string' && READ_ONLY.test(cmd) && !DENY.test(cmd); }
 function trim(value, limit) {
  var text;
  try { text = JSON.stringify(value); } catch (e) { text = String(value); }
  if (text && text.length > limit) return { truncated: true, length: text.length, head: text.slice(0, limit) };
  return value;
 }
 // Live update: stop the running observer, then load the changed script files again in this page.
 // The page is not navigated, so the game bridge (inzoi.cli) stays attached and wf.state is kept.
 var ORDER = ['policy.js','protocol.js','life.js','child-care.js','game-data.js','goal-memory.js','scoreboard.js','agenda.js','recovery.js','career-path.js','persona.js','why.js','duty.js','family.js','rotation.js','fieldcheck.js','relations.js','gathering.js',
  'choices.js','life-actions.js','panels.js','travel.js','app.js'];
 function inject(src) {
  return new Promise(function (resolve, reject) {
   var el = document.createElement('script');
   el.src = src; el.onload = function () { resolve(src); }; el.onerror = function () { reject(Error('load failed: ' + src)); };
   document.body.appendChild(el);
  });
 }
 async function liveUpdate(request) {
  var stamp = String(request.id), loaded = [], error = null;
  try {
   if (typeof window.ZoiObserverShutdown === 'function') window.ZoiObserverShutdown();
   for (var i = 0; i < ORDER.length; i++) {
    try { loaded.push(await inject(ORDER[i] + '?v=' + stamp)); }
    catch (e) { loaded.push(await inject(ORDER[i])); }
   }
  } catch (e) { error = String(e && e.message || e); }
  await cli('uimod.cfg_save', { mod_id: MOD_ID, section: SECTION, key: 'dev-update',
   value: JSON.stringify({ id: request.id, at: new Date().toISOString(), loaded: loaded, error: error }) });
 }
 async function poll() {
  if (running) return;
  running = true;
  try {
   var res = await cli('uimod.cfg_load', { mod_id: MOD_ID, section: SECTION, key: 'dev-cmd' });
   var raw = res && (res.value || res.data && res.data.value);
   if (!raw) return;
   var request = JSON.parse(raw);
   if (!request || !request.id || request.id === lastId || !Array.isArray(request.calls)) return;
   // Reload and hot update both outlive this JS context. Expired or handled requests must not
   // restart the observer when the player shows the view or remounts the mod.
   if (request.reload === true || request.update === true) {
    var age = Date.now() - Number(request.at);
    if (!Number.isFinite(age) || age < 0 || age >= 120000) { lastId = request.id; return; }
    var key = request.reload === true ? 'dev-result' : 'dev-update';
    var prev = await cli('uimod.cfg_load', { mod_id: MOD_ID, section: SECTION, key: key });
    var prevRaw = prev && (prev.value || prev.data && prev.data.value);
    var done = false;
    try { done = !!prevRaw && JSON.parse(prevRaw).id === request.id; } catch (e) {}
    if (done || sessionDone(request.id)) { lastId = request.id; return; }
   }
   lastId = request.id;
   var results = [], limit = Math.min(Number(request.limit) || 60000, 400000);
   // Keep well under the game's CLI rate limit so the observer itself is never blocked.
   for (var i = 0; i < request.calls.length && i < 12; i++) {
    if (i) await new Promise(function (r) { setTimeout(r, 400); });
    var call = request.calls[i] || {};
    if (!allowed(call.cmd)) { results.push({ cmd: call.cmd, ok: false, error: '읽기 전용 명령만 허용' }); continue; }
    try { results.push({ cmd: call.cmd, args: call.args, ok: true, value: trim(await cli(call.cmd, call.args), limit) }); }
    catch (e) { results.push({ cmd: call.cmd, args: call.args, ok: false, error: String(e && e.message || e) }); }
   }
   await cli('uimod.cfg_save', { mod_id: MOD_ID, section: SECTION, key: 'dev-result',
    value: JSON.stringify({ id: request.id, at: new Date().toISOString(), results: results }) });
   // Reload only this mod's own page so new script files take effect without a save/load.
   // The observer resumes from its saved state (observer-resume) after the page comes back.
   if (request.reload === true) setTimeout(function () { window.location.reload(); }, 300);
   if (request.update === true) await liveUpdate(request);
  } catch (e) {
  } finally { running = false; }
 }
 if (typeof inzoi !== 'undefined' && inzoi.cli) setInterval(poll, 3000);
})();
