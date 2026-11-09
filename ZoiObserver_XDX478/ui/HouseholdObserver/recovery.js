(function(root){
 'use strict';
 // Failure kinds decide the next step. A request that the game accepted is not success, and a
 // refusal is not permanent: each kind has its own wait and its own alternative.
 var KINDS={
  sleeping:{label:'상대 또는 본인이 수면 중',wait:120,next:'기상 후 다시 시도'},
  occupied:{label:'대상을 다른 조이가 사용 중',wait:30,next:'다른 대상 또는 사용이 끝난 뒤 재시도'},
  path:{label:'이동 경로 막힘 또는 도달 불가',wait:240,next:'같은 대상을 피하고 다른 대상·장소 탐색'},
  skill:{label:'필요 기술 부족',wait:0,next:'선행 기술 연습 후 원래 목표 재시도'},
  missing:{label:'필요한 물건·시설 없음',wait:60,next:'외부 시설 이동 또는 구매 검토'},
  busy:{label:'다른 행동 진행 중',wait:20,next:'현재 행동 종료 후 재확인'},
  refused:{label:'게임이 행동을 받지 않음',wait:60,next:'상태 변경 후 재시도'},
  condition:{label:'행동 조건 미충족',wait:90,next:'조건을 바꾸는 준비 행동 탐색'},
  unknown:{label:'원인 미확인',wait:90,next:'다른 행동·대상 탐색 후 재시도'}
 };
 var skillHints=[
  ['Art',/Easel|Draw|Paint|Canvas|Mural|_Art_|^Art_/i],
  ['Instruments',/Guitar|Piano|Keyboard|Violin|Drum|Instrument/i],
  ['Performance',/Mic_|Karaoke|Sing/i],
  ['Logic',/Chess|Logic|CriticalThinking/i],
  ['HandCraft',/HandCraft|Woodwork|Workbench|WorkTable|Craft_/i],
  ['Housework',/Mop|Sweep|Vacuum|Housework/i],
  ['Charisma',/Charisma|Appeal|Confidence/i],
  ['Speaking',/Speech|PublicSpeaking|Speaking/i]
 ];
 // Disabled actions sometimes carry a tooltip or reason. The field name differs between builds,
 // so read any short string field except identifiers and names.
 function disabledReason(action){
  if(!action||action.enabled!==false)return '';
  var skip=/^(?:interaction_bag_id|display_name|id|name|icon|category|tags|target_entity_id)$/;
  return Object.keys(action).filter(function(k){return !skip.test(k)&&typeof action[k]==='string';})
   .map(function(k){return action[k];}).filter(function(v){return v&&v.length<160;}).join(' / ');
 }
 function classify(input){
  input=input||{};
  var text=[input.reason,input.message,input.tooltip].filter(Boolean).join(' ');
  if(input.sleeping||/수면|잠|sleep/i.test(text))return 'sleeping';
  if(input.occupiedBy||/사용 ?중|이미 사용|in use|occupied|누군가/i.test(text))return 'occupied';
  if(/경로|길|도달|갈 수 없|path|reach|navigat|route/i.test(text))return 'path';
  if(/기술|스킬|레벨|skill|level/i.test(text))return 'skill';
  if(/상태 변경|자동 명령 보류|대기열|queue/i.test(text))return 'busy';
  if(input.noTargets)return 'missing';
  if(input.refused||/거부|refus|reject|not allowed|불가/i.test(text))return 'refused';
  if(input.disabled)return 'condition';
  if(input.notStarted&&input.sameTargetMisses>=2)return 'path';
  return 'unknown';
 }
 function strategy(kind){return KINDS[kind]||KINDS.unknown;}
 function skillFor(bag,reason){
  var clue=String(bag||'')+' '+String(reason||'');
  var hit=skillHints.find(function(h){return h[1].test(clue);});
  return hit?hit[0]:null;
 }
 // Records why a goal is blocked and what the mod will try next; survives save/load as JSON.
 function block(memory,kind,minute,detail){
  var s=strategy(kind);
  memory.block={kind:kind,label:s.label,detail:detail||null,since:memory.block&&memory.block.kind===kind?memory.block.since:minute,
   until:minute+s.wait,next:s.next,count:(memory.block&&memory.block.kind===kind?memory.block.count:0)+1};
  return memory.block;
 }
 function clear(memory){if(memory)memory.block=null;}
 // Target-level misses: a target that twice accepted a request but never started it is treated
 // as unreachable for a while instead of being retried forever.
 function miss(store,target,minute){
  if(!target)return 0;
  var key=String(target), item=store[key]&&store[key].until>minute-720?store[key]:{count:0};
  item.count++;item.at=minute;item.until=minute+(item.count>=2?240:60);
  store[key]=item;
  var keys=Object.keys(store);
  if(keys.length>40)keys.sort(function(a,b){return store[a].at-store[b].at;}).slice(0,keys.length-40).forEach(function(k){delete store[k];});
  return item.count;
 }
 function reachable(store,target,minute){
  var item=store&&store[String(target)];
  return !item||item.count<2||minute>=item.until;
 }

 // Resume decision after the game reloads a city (travel return, save load, view rebuild).
 // The mirror is written outside the save file, so it can bring back the user's Start intent
 // when the loaded save predates it. It never overrides an explicit Stop.
 function resumeDecision(saved,mirror,household,game,now){
  if(!mirror||mirror.enabled!==true||mirror.stoppedByUser)return null;
  if(!game||game.phase!=='in_game'||game.loading)return null;
  if(!Number.isFinite(mirror.at)||now-mirror.at>6*3600*1000)return null;
  var id=String(household&&household.household_id||'');
  if(!id)return null;
  var away=mirror.awayTravel;
  var home=mirror.scope==='played'||String(mirror.household)===id;
  var returning=away&&game.map_id===away.origin&&String(away.household)===id;
  var abroad=away&&game.map_id===away.destination&&String(away.awayHousehold)===id;
  if(!home&&!returning&&!abroad)return null;
  return {enable:!(saved&&saved.enabled===true),scope:mirror.scope==='played'?'played':'current',household:mirror.scope==='played'?id:String(mirror.household),
   reason:returning?'여행 귀환':abroad?'여행지 도시 불러옴':'저장 상태 불러옴',returning:!!returning,awayTravel:abroad?away:null};
 }
 function mirrorOf(state,now,stoppedByUser){
  var people={};
  Object.keys(state.people||{}).forEach(function(id){
   var p=state.people[id]||{};
   // Only idempotency records: what was already paid, answered or booked must not repeat.
   var keep={};
   if(p.payments)keep.payments=p.payments;
   if(p.replyRequests)keep.replyRequests=p.replyRequests;
   if(Object.keys(keep).length)people[id]=keep;
  });
  return {v:1,at:now,enabled:state.enabled===true,stoppedByUser:!!stoppedByUser,scope:state.scope,household:state.household,
   background:state.background,awayTravel:state.awayTravel||null,travel:state.travel?{stage:state.travel.stage,actor:state.travel.actor,
   destination:state.travel.destination,origin:state.travel.origin,day:state.travel.day}:null,people:people};
 }
 // Merge processed payments and replies back so a reloaded older save cannot pay twice.
 function mergeProcessed(state,mirror){
  var merged=0;
  if(!mirror||!mirror.people)return 0;
  state.people=state.people||{};
  Object.keys(mirror.people).forEach(function(id){
   var source=mirror.people[id], target=state.people[id]||(state.people[id]={});
   ['payments','replyRequests'].forEach(function(field){
    if(!source[field])return;
    target[field]=target[field]||{};
    Object.keys(source[field]).forEach(function(k){if(!target[field][k]){target[field][k]=source[field][k];merged++;}});
   });
  });
  return merged;
 }
 var api={KINDS:KINDS,classify:classify,strategy:strategy,skillFor:skillFor,disabledReason:disabledReason,block:block,clear:clear,
  miss:miss,reachable:reachable,resumeDecision:resumeDecision,mirrorOf:mirrorOf,mergeProcessed:mergeProcessed};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.ObserverRecovery=api;
})(this);
