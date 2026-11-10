(function(root){
 'use strict';
 // 0.5.5: a Zoi who is home invites people they are close to, or holds a party when several are close.
 // Which game action does that is NOT assumed: actions are found from what the game offers (names/ids that
 // mention inviting or parties), tried once, and judged only by evidence — the guest standing at the home
 // site afterwards. An action that never brings anyone is dropped; one that works is remembered for the family.
 var FRIEND=50, ROMANCE=40, WAIT=240, STAY=240;
 var INVITE=/Invite|CallOver|Call_Over|ComeOver|Come_Over|HangOutAtHome|초대|놀러\s*오|집으로\s*부르/i;
 var PARTY=/Party|파티/i;
 var NEVER=/Wedding|Funeral|Travel|Trip|Vacation|Leave|Kick|GoHome|Cancel|Quit|Stop|Decline|Reject|Refuse|Accept|Join|Attend|Visit|Fail|Feedback|_Sub_|Break|Divorce|결혼|장례|여행|데이트|취소|거절|수락|참가|보내|종료/i;
 // Case-sensitive on purpose: 'Friend' and 'Update' must not count as End / Date.
 var NEVER_WORD=/Date(?![a-z])|End(?![a-z])/;
 function ent(v){return v&&typeof v==='object'?Number(v.value):Number(v);}
 function num(stats,key){return stats&&stats[key]&&Number.isFinite(stats[key].value)?stats[key].value:0;}
 function kindOf(action){
  var text=(action.interaction_bag_id||'')+' '+(action.display_name||'');
  if(NEVER.test(text)||NEVER_WORD.test(text))return null;
  return PARTY.test(text)?'party':INVITE.test(text)?'invite':null;
 }
 function close(relationship){
  var s=relationship&&relationship.stats||{};
  return num(s,'Friendship')>=FRIEND||num(s,'Romance')>=ROMANCE;
 }
 function warmth(relationship){
  var s=relationship&&relationship.stats||{};
  return Math.max(num(s,'Friendship'),num(s,'Romance')+10);
 }
 function memory(decision){return decision.gather||(decision.gather={});}
 function learned(life){return life.gatherBags||(life.gatherBags={});}
 function usable(life,bag,minute){
  var b=learned(life)[bag];
  // Two misses in a row rest the action, also one that worked before.
  return !b||b.fail<2||minute>=(b.retry||0);
 }
 function due(decision,time,minute){
  var g=decision.gather||{};
  return !g.pending&&minute>=(g.next||0)&&time.hour>=10&&time.hour<20;
 }
 function create(api){
  var cli=api.cli, write=api.write, log=api.log, L=api.L, Rel=api.Rel;
  var searched=null;
  async function candidates(member,minute,home){
   var id=String(member.entity_id), life=api.life(), book=(life.contacts||{})[id]||{};
   // Only the host's own household is family: friends living in other played households can be invited.
   var family=api.members().filter(function(m){return m.household_id===member.household_id;}).map(function(m){return String(m.entity_id);});
   var ids=Object.keys(book).filter(function(k){
    return family.indexOf(k)<0&&Rel.ready(life,id,k,minute)&&!/^(?:worse|rejected)$/.test(book[k].outcome||'');
   }).sort(function(a,b){return (book[b].last||0)-(book[a].last||0);}).slice(0,6);
   var out=[];
   for(var i=0;i<ids.length;i++){
    var relationship;
    try{relationship=await cli('relationships.get_value_between',{owner_id:id,target_id:ids[i]});}catch(_){continue;}
    if(!close(relationship))continue;
    try{
     var info=await cli('entity.reflect',{entity_id:ids[i]});
     if(info.locatedCityName&&api.game().map_id&&info.locatedCityName!==api.game().map_id)continue;
     // Someone already visiting cannot prove that an invitation worked.
     if(ent(info.locatedSiteId)===home)continue;
     if(L.sleeping(await cli('interaction.get_queue',{entity_id:ids[i]})))continue;
    }catch(_){continue;}
    out.push({id:ids[i],name:book[ids[i]].name||ids[i],relationship:relationship,warmth:warmth(relationship)});
   }
   return out.sort(function(a,b){return b.warmth-a.warmth;});
  }
  // Actions the game data names as inviting / party, for when the friend is not in front of the Zoi (phone).
  async function catalog(){
   if(searched)return searched;
   var found={}, keys=['Invite','Party'];
   for(var i=0;i<keys.length;i++){
    try{
     var res=await cli('interaction.search',{Keyword:keys[i],max_results:60});
     (res.results||[]).forEach(function(a){
      var kind=kindOf(a);
      if(kind&&/^(?:Self_|Phone|SmartPhone|Co_)/i.test(a.interaction_bag_id||''))found[a.interaction_bag_id]={interaction_bag_id:a.interaction_bag_id,display_name:a.display_name,kind:kind,remote:true};
     });
    }catch(_){}
   }
   return searched=Object.keys(found).map(function(k){return found[k];});
  }
  async function options(member,guest,minute){
   var id=String(member.entity_id), life=api.life(), list=[];
   function ok(a){return usable(life,a.interaction_bag_id,minute);}
   try{
    var offered=await cli('interaction.list_available',{entity_id:id,target_entity_id:guest.id});
    (offered.interactions||[]).forEach(function(a){
     var kind=a.enabled===true&&kindOf(a);
     if(kind)list.push({interaction_bag_id:a.interaction_bag_id,display_name:a.display_name,kind:kind,target:guest.id});
    });
   }catch(_){}
   list=list.filter(ok);
   if(!list.length)(await catalog()).forEach(function(a){
    // Self_ actions only ran in game with the Zoi itself as the target.
    list.push(Object.assign({},a,{target:/^Self_/i.test(a.interaction_bag_id)?id:guest.id}));
   });
   var known=learned(life);
   return list.filter(ok).sort(function(a,b){
    return ((known[b.interaction_bag_id]||{}).ok||0)-((known[a.interaction_bag_id]||{}).ok||0);
   });
  }
  async function host(member,character,decision,snapshot,time,minute,token){
   var g=memory(decision), id=String(member.entity_id);
   if(!due(decision,time,minute))return false;
   if(snapshot.work.is_at_work||snapshot.work.is_working_time||snapshot.work.is_commute_time||!L.goalReady(snapshot.queue,snapshot.work))return false;
   var stats=snapshot.stats.stats;
   if(['Hunger','Sleep','Toilet','Cleanliness'].some(function(k){return stats[k]&&stats[k].pct<35;}))return false;
   var home=await api.home(member,character);
   if(!(home>0)||ent(character.locatedSiteId)!==home)return false;
   g.next=minute+120;
   var people=await candidates(member,minute,home);
   if(!people.length){g.next=minute+360;g.status='가까운 지인 없음';return false;}
   var wantParty=people.length>=2&&minute>=(g.nextParty||0);
   for(var i=0;i<people.length;i++){
    var guest=people[i], list=await options(member,guest,minute);
    if(wantParty)list.sort(function(a,b){return (b.kind==='party')-(a.kind==='party');});
    else list=list.filter(function(a){return a.kind==='invite';});
    var action=list[0];
    if(!action)continue;
    await write('interaction.execute',{entity_id:id,target_entity_id:String(action.target),interaction_bag_id:action.interaction_bag_id},token);
    var guests=action.kind==='party'?people.slice(0,4):[guest];
    g.pending={bag:action.interaction_bag_id,kind:action.kind,at:minute,home:home,
     guests:guests.map(function(p){return {id:p.id,name:p.name};})};
    g.status=(action.kind==='party'?'파티 요청: ':'집 초대 요청: ')+guests.map(function(p){return p.name;}).join(', ');
    log((member.first_name||id)+': '+g.status+' ('+(action.display_name||action.interaction_bag_id)+')');
    if(api.score)api.score({minute:minute,zoi:id,kind:'request',name:action.kind==='party'?'파티':'집 초대'});
    return true;
   }
   g.next=minute+720;g.status='초대 행동을 찾지 못함';
   if(!g.warned){g.warned=true;log((member.first_name||id)+': 가까운 지인은 있지만 게임이 제공하는 초대·파티 행동을 찾지 못함');}
   return false;
  }
  // Judge a pending invitation by where the guests actually are.
  async function review(member,decision,minute){
   var g=decision.gather, id=String(member.entity_id);
   if(!g)return null;
   if(g.pending&&g.pending.at>minute)g.pending=null;
   if(g.hosting&&(minute>=g.hosting.until||g.hosting.since>minute))g.hosting=null;
   var p=g.pending;
   if(!p)return null;
   var life=api.life(), arrived=[];
   for(var i=0;i<p.guests.length;i++){
    try{
     var info=await cli('entity.reflect',{entity_id:p.guests[i].id});
     if(ent(info.locatedSiteId)===p.home)arrived.push(p.guests[i]);
    }catch(_){}
   }
   var bag=learned(life)[p.bag]||(learned(life)[p.bag]={ok:0,fail:0});
   if(arrived.length){
    bag.ok++;bag.fail=0;
    g.pending=null;g.warned=false;
    g.hosting={since:minute,until:minute+STAY,kind:p.kind,guests:arrived};
    g.next=minute+1440;
    if(p.kind==='party')g.nextParty=minute+3*1440;
    arrived.forEach(function(a){Rel.remember(life,id,a.id,{name:a.name},minute);});
    decision.nextTalk=0;
    g.status=(p.kind==='party'?'파티 중: ':'손님 방문: ')+arrived.map(function(a){return a.name;}).join(', ');
    log((member.first_name||id)+': '+g.status);
    return 'came';
   }
   if(minute-p.at<WAIT)return 'waiting';
   bag.fail++;bag.retry=minute+3*1440;
   g.pending=null;g.next=minute+180;
   g.status='초대했지만 오지 않음';
   log((member.first_name||id)+': '+(p.kind==='party'?'파티':'집 초대')+' 요청 후 손님이 오지 않음 ('+p.bag+', '+bag.fail+'회)');
   if(api.score)api.score({minute:minute,zoi:id,kind:'failed',reason:'초대 불발',name:p.bag});
   return 'missed';
  }
  function waiting(decision){var g=decision.gather;return !!(g&&(g.pending||g.hosting));}
  return {host:host,review:review,waiting:waiting,reset:function(){searched=null;}};
 }
 var api={create:create,due:due,kindOf:kindOf,close:close,FRIEND:FRIEND,ROMANCE:ROMANCE,WAIT:WAIT};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.ObserverGathering=api;
})(this);
