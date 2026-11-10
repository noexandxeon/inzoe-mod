(function (root) {
 'use strict';
 var affinity = {
  Intellect:['Logic','Programming'], Genius:['Logic','Programming'], Bookworm:['Logic'],
  Artist:['Art','Instruments','Filming'], Romantic:['Art','Instruments'],
  Extrovert:['Charisma','Speaking'], Popular:['Charisma','Speaking'], Flirt:['Charisma'],
  Entertainer:['Performance','Speaking','Instruments'], Leader:['Speaking','Logic'],
  Helper:['Cooking','Housework'], Cooperator:['Speaking','Housework'],
  Active:['Exercise','Swimming'], Energetic:['Exercise'], Adventurer:['Exercise','Fishing'],
  CleanFreak:['Housework'], Perfectionist:['Logic','HandCraft'], Observer:['Logic','Art'],
  Introvert:['Programming','Art'], Independent:['Programming','HandCraft'],
  Aptitude_CoffeeMaster:['CoffeeArt'], Aptitude_BakingMaster:['BakingPastry'],
  Aptitude_BeverageMaster:['BeverageCraft'], Aptitude_Fishing:['Fishing'],
  Aptitude_Smith:['HandCraft'], Aptitude_Swim:['Swimming'], Aptitude_Wikipedia:['Logic'],
  Aptitude_FirstImpression:['Charisma'], Aptitude_Casanova:['Charisma']
 };
 function traits(t) { return [].concat(t.traitIdList||[],t.characteristics||[],t.aptitudes||[]); }
 function skillsFor(row,id) {
  if(row && Array.isArray(row.recommendSkillIds) && row.recommendSkillIds.length) return row.recommendSkillIds;
  if(/lawfirm/i.test(id)) return ['Logic','Speaking'];
  if(/hospital|doctor|scient/i.test(id)) return ['Logic'];
  if(/police|fire|sport/i.test(id)) return ['Exercise'];
  if(/restaurant|chef/i.test(id)) return ['Cooking'];
  if(/coffee|cafe/i.test(id)) return ['CoffeeArt','Speaking'];
  return [];
 }
 function score(t,skills,row,id,extra) {
  var desired=skillsFor(row,id), ts=traits(t), points=0, reasons=[];
  desired.forEach(function(s){
   var actual=skills.filter(function(x){return x.id===s;})[0];
   if(actual && actual.level>0){points+=actual.level*2; reasons.push(s+' Lv.'+actual.level);}
   ts.forEach(function(tr){if((affinity[tr]||[]).indexOf(s)>=0){points+=12;reasons.push(tr+' / '+s);}});
  });
  // extra: what this individual adds on top (ambition, personal taste) - see career-path.js.
  var more=extra&&extra(desired,id);
  if(more){points+=more.score;reasons=reasons.concat(more.reasons||[]);}
  return {score:points,reasons:reasons,known:desired.length>0};
 }
 function switchRule(t) {
  var ts=traits(t);
  if(ts.indexOf('Risk-averse')>=0 || ts.indexOf('Faithful')>=0) return {days:14,margin:24};
  if(ts.indexOf('Adventurer')>=0 || ts.indexOf('Independent')>=0) return {days:3,margin:10};
  return {days:7,margin:16};
 }
 function pick(openings,t,skills,rows,entityId,extra) {
  return openings.filter(function(o){return o.vacancy>0 && o.career_entity_id>0 && o.job_id;}).map(function(o){
   return {opening:o,fit:score(t,skills,rows[o.career_dt_id],o.career_dt_id,extra)};
  }).sort(function(a,b){
   var d=b.fit.score-a.fit.score;if(d)return d;
   var ak=a.opening.job_id+':'+a.opening.career_entity_id, bk=b.opening.job_id+':'+b.opening.career_entity_id;
   // Stable per-character tie breaker, not a new random roll each poll.
   function hash(s){var h=Number(entityId)||0;for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return h;}
   return hash(ak)-hash(bk);
  })[0]||null;
 }
 function shouldSwitch(t,days,current,best) {var r=switchRule(t);return !!best && current.known && best.fit.known && days>=r.days && best.fit.score-current.score>=r.margin;}
 function lowest(stats) {
  var keys=['Hunger','Cleanliness','Sleep','Toilet','Fun','Society'];
  return keys.filter(function(k){return stats[k] && typeof stats[k].pct==='number';}).sort(function(a,b){return stats[a].pct-stats[b].pct;})[0]||null;
 }
 var api={traits:traits,score:score,pick:pick,switchRule:switchRule,shouldSwitch:shouldSwitch,lowest:lowest};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ObserverPolicy=api;
})(this);
