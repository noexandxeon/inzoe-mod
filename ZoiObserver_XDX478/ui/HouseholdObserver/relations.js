(function(root){
 'use strict';
 // Per-Zoi contact memory: who they met, what was tried, how the relationship moved, and why the
 // last attempt did not work. Stored in wf.state.life.contacts[actor][target].
 var OUTCOMES={
  improved:'호감 상승',
  flat:'변화 없음',
  worse:'호감 하락',
  busy:'상대가 바쁨',
  sleeping:'상대가 수면 중',
  low:'호감 부족',
  rejected:'관계 진전 거절',
  not_executed:'행동이 실행되지 않음',
  away:'만날 수 있는 곳에 없음'
 };
 function book(life,actor){
  var contacts=life.contacts||(life.contacts={});
  return contacts[String(actor)]||(contacts[String(actor)]={});
 }
 function value(stats,key){return stats&&stats[key]&&Number.isFinite(stats[key].value)?stats[key].value:null;}
 function remember(life,actor,target,info,minute){
  var list=book(life,actor), key=String(target);
  var item=list[key]||(list[key]={name:info&&info.name||key,first:minute,meetings:0,history:[]});
  if(item.last>minute){item.next=null;item.pending=null;item.cooldown=null;}
  if(info&&info.name)item.name=info.name;
  item.last=minute;
  var keys=Object.keys(list);
  if(keys.length>30)keys.sort(function(a,b){return (list[a].last||0)-(list[b].last||0);}).slice(0,keys.length-30).forEach(function(k){delete list[k];});
  return item;
 }
 // Call when a talk or romance action was requested.
 function attempted(life,actor,target,info,relationship,bag,kind,minute){
  var item=remember(life,actor,target,info,minute), stats=relationship&&relationship.stats||{};
  item.pending={bag:bag,kind:kind||'talk',at:minute,friendship:value(stats,'Friendship'),romance:value(stats,'Romance')};
  item.meetings++;
  return item;
 }
 // Call on the next encounter (or when the queue showed the action never started).
 function settle(life,actor,target,relationship,minute,evidence){
  var list=book(life,actor), item=list[String(target)];
  if(!item||!item.pending)return null;
  var p=item.pending, stats=relationship&&relationship.stats||{};
  var f=value(stats,'Friendship'), r=value(stats,'Romance');
  var delta=(f!=null&&p.friendship!=null?f-p.friendship:0)+(r!=null&&p.romance!=null?r-p.romance:0);
  // A conversation can start and finish between two inspections, so "never seen running" is not proof
  // that it did not happen. A measured change in the relationship is the stronger evidence.
  var unseen=evidence&&evidence.notStarted&&Math.abs(delta)<=0.5;
  var outcome=unseen?'not_executed':evidence&&evidence.stageChanged?'improved':
   p.kind!=='courtship'&&p.kind!=='talk'&&evidence&&evidence.formalExpired?'rejected':
   delta>0.5?'improved':delta<-0.5?'worse':'flat';
  item.outcome=outcome;item.reason=OUTCOMES[outcome];item.settledAt=minute;
  item.history.push({minute:minute,kind:p.kind,bag:p.bag,outcome:outcome,delta:Math.round(delta*10)/10});
  item.history=item.history.slice(-6);
  item.pending=null;
  item.next=plan(item,minute);
  return item;
 }
 // When to try this person again and why.
 function plan(item,minute){
  var o=item.outcome;
  var wait=o==='improved'?180:o==='flat'?360:o==='not_executed'?60:o==='busy'?120:o==='sleeping'?240:
   o==='worse'||o==='low'?1440:o==='rejected'?2*1440:360;
  var recentBad=item.history.slice(-3).filter(function(h){return /^(?:worse|rejected)$/.test(h.outcome);}).length;
  if(recentBad>=2)wait=4*1440;
  return {at:minute+wait,why:OUTCOMES[o]||'재회 계획'};
 }
 function blocked(life,actor,target,kind,minute){
  var item=remember(life,actor,target,null,minute);
  item.outcome=kind;item.reason=OUTCOMES[kind]||kind;item.settledAt=minute;
  item.next=plan(item,minute);
  return item;
 }
 function ready(life,actor,target,minute){
  var item=book(life,actor)[String(target)];
  return !item||!item.next||minute>=item.next.at;
 }
 // Remembered people worth meeting again, best relationship first, excluding cooled-off ones.
 function reunion(life,actor,minute,exclude){
  var list=book(life,actor);
  return Object.keys(list).filter(function(k){
   var item=list[k];
   return (!exclude||exclude.indexOf(k)<0)&&ready(life,actor,k,minute)&&item.outcome!=='rejected'&&
    item.history.some(function(h){return h.outcome==='improved';});
  }).sort(function(a,b){return (list[b].last||0)-(list[a].last||0);}).slice(0,4);
 }
 function describe(life,actor,minute){
  var list=book(life,actor);
  return Object.keys(list).map(function(k){
   var item=list[k];
   return {id:k,name:item.name,reason:item.reason||null,next:item.next&&item.next.at>minute?item.next.at:null,why:item.next&&item.next.why};
  }).sort(function(a,b){return (list[b.id].last||0)-(list[a.id].last||0);}).slice(0,3);
 }
 // 0.6.15: in game a Zoi 1036 days old knew 39 people and none of them well (best friendship 5 of 100):
 // talk was only requested for a relationship hope or a low social need, and always with whoever stood nearest.
 // bonds() sums up what the game's relationship list says so the Zoi can keep returning to the same few people.
 function bonds(list){
  var close=0, favor={};
  (list||[]).forEach(function(r){
   var s=r.stats||{}, v=function(k){return s[k]&&Number.isFinite(s[k].value)?s[k].value:0;};
   var lv=function(k){return s[k]&&Number.isFinite(s[k].level)?s[k].level:0;};
   if(r.is_family)return;
   if(v('Friendship')>=40||v('Romance')>=30||lv('Friendship')>0||lv('Romance')>0)close++;
   favor[String(r.target_id)]=Math.round((v('Friendship')+v('Romance'))*100)/100;
  });
  return {close:close,favor:favor};
 }
 // Known and liked people first, strangers next, people who dislike the Zoi left out.
 function bondOrder(targets,favor){
  return targets.map(function(t,i){return {t:t,i:i,f:favor[String(t.entity_id)]||0};})
   .filter(function(x){return x.f>-5;})
   .sort(function(a,b){return b.f-a.f||a.i-b.i;}).map(function(x){return x.t;});
 }
 // 0.6.16: a villain ambition asks for shoving, fighting and stealing. Those go to people the Zoi does not know;
 // family, a romance, or a friendship that has started are left alone.
 var HOSTILE=/Fight|Push|Shove|Slap|Punch|Kick|Insult|Threat|Steal|Bully|Mock|Scold|Grab|Rumor|Negative|Mean_|Villain|Rob|Scam|밀쳐|싸움|욕하|모욕|위협|협박|훔치|괴롭|때리|조롱|험담|루머|갈취|사기/i;
 function hostile(action){return HOSTILE.test((action&&action.interaction_bag_id||'')+' '+(action&&action.display_name||''));}
 function spared(relationship){
  var s=relationship&&relationship.stats||{}, v=function(k){return s[k]&&Number.isFinite(s[k].value)?s[k].value:0;};
  return !!(relationship&&relationship.is_family)||v('Family')>0||v('Romance')>0||v('Friendship')>=3||v('Business')>=10;
 }
 var api={hostile:hostile,spared:spared,bonds:bonds,bondOrder:bondOrder,OUTCOMES:OUTCOMES,remember:remember,attempted:attempted,settle:settle,blocked:blocked,ready:ready,reunion:reunion,describe:describe,plan:plan};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.ObserverRelations=api;
})(this);
