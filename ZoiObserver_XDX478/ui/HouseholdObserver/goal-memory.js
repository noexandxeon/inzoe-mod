(function(root){
 'use strict';
 // Stored in wf.state: requests are evidence of intent, never evidence of completion.
 function key(plan){return (plan.kind||'hope')+':'+plan.instance+':'+plan.name;}
 function record(decision,plan,minute){
  var memory=decision.goalMemory||(decision.goalMemory={});
  var id=key(plan), item=memory[id];
  if(!item)item=memory[id]={name:plan.name,kind:plan.kind||'hope',instance:plan.instance,
   phase:'ready',firstSeen:minute,failures:{},history:[]};
  item.failures=item.failures||{};item.history=item.history||[];
  if(item.lastSeen>minute){item.failures={};item.practice=null;item.block=null;if(item.prep)item.prep.grown=null;}
  item.lastSeen=minute;
  if(plan.expire_ticks>0)item.expire=plan.expire_ticks/600000000;
  plan.memory=item;
  return item;
 }
 function note(decision,plan,phase,reason,next,minute){
  var item=record(decision,plan,minute);
  if(item.phase!==phase||item.reason!==reason){
   item.history.push({minute:minute,phase:phase,reason:reason});
   item.history=item.history.slice(-8);
  }
  item.phase=phase;item.reason=reason;item.next=next;
  plan.status=reason;
  return item;
 }
 function sync(decision,plans,minute,kind){
  var active={};
  plans.forEach(function(p){active[key(p)]=true;record(decision,p,minute);});
  var memory=decision.goalMemory||{};
  Object.keys(memory).forEach(function(id){
   var item=memory[id];
   if(item.kind===(kind||'hope')&&!active[id]&&item.phase!=='completed'&&item.phase!=='ended'){
    var verdict=gone(item,minute);
    item.phase=verdict.phase;item.reason=verdict.reason;item.next='새 목표 확인';
    item.history.push({minute:minute,phase:verdict.phase,reason:verdict.reason});item.history=item.history.slice(-8);
   }
  });
  // Keep all active plans and a bounded recent history across long sessions.
  Object.keys(memory).filter(function(id){return /^(completed|ended)$/.test(memory[id].phase);})
   .sort(function(a,b){return memory[b].lastSeen-memory[a].lastSeen;}).slice(16).forEach(function(id){delete memory[id];});
 }
 // The game may remove or replace a hope without exposing the reason.
 function gone(item,minute){
  if(Number.isFinite(item.expire)&&minute>=item.expire)return {phase:'ended',reason:'기한 만료 후 목록에서 종료'};
  return {phase:'ended',reason:'게임 목록에서 종료 · 완료 여부 미확인'};
 }
 function attemptKey(bag,target){return JSON.stringify([bag,String(target||'')]);}
 function allowed(decision,plan,bag,target,minute){
  var item=record(decision,plan,minute), failure=item.failures[attemptKey(bag,target)];
  return !failure||minute>=failure.until;
 }
 function failed(decision,plan,bag,target,minute,reason){
  var item=note(decision,plan,'waiting',reason,'다른 행동·대상 탐색 후 재시도',minute);
  var id=attemptKey(bag,target), previous=item.failures[id];
  var count=(previous&&previous.count||0)+1;
  item.failures[id]={count:count,until:minute+Math.min(360,30*Math.pow(2,Math.min(count,4)))};
  var keys=Object.keys(item.failures).sort(function(a,b){return item.failures[b].until-item.failures[a].until;});
  keys.slice(24).forEach(function(k){delete item.failures[k];});
 }
 // Practice budget per goal and game day. It counts practice that actually ran: a request that never
 // started gives its slot back (practiceMissed). An ambition is a long-term goal the Zoi keeps working
 // on every day, so it gets a larger share than a hope that may expire.
 function practiceLimit(plan){return plan&&plan.kind==='ambition'?5:3;}
 function practiceAllowed(decision,plan,minute){
  var item=record(decision,plan,minute), day=Math.floor(minute/1440);
  if(!item.practice||item.practice.day!==day)item.practice={day:day,sessions:0};
  return item.practice.sessions<practiceLimit(plan);
 }
 function practiceMissed(decision,plan,minute){
  var item=record(decision,plan,minute), p=item.practice;
  if(!p||!p.open)return false;
  p.open=false;
  if(p.day===Math.floor(minute/1440)&&p.sessions>0)p.sessions--;
  p.missed=(p.missed||0)+1;
  return true;
 }
 function practiceRan(decision,plan,minute){
  var item=record(decision,plan,minute);
  if(item.practice)item.practice.open=false;
 }
 function started(decision,plan,minute,skill){
  var item=note(decision,plan,skill?'preparing':'running',
   skill?'선행 기술 연습 요청 · 성장 확인 대기':'행동 요청 · 실제 진행 확인 대기',
   skill?'기술 성장 확인 후 원래 목표 재평가':'게임 미션 진행 확인',minute);
  if(skill){practiceAllowed(decision,plan,minute);item.practice.sessions++;item.practice.open=true;}
  item.lastAction=minute;
 }
 // Goal flow: 목표 → 필요(기술·물건·상대) → 준비(연습·구매·외출) → 원래 목표 재시도 → 완료 확인.
 var STEPS=['need','prepare','retry','confirm','done'];
 var STEP_LABELS={need:'필요 조건 확인',prepare:'준비 중',retry:'원래 목표 재시도',confirm:'완료 확인 대기',done:'완료'};
 function flow(decision,plan,step,patch,minute){
  var item=record(decision,plan,minute), f=item.flow||(item.flow={});
  if(STEPS.indexOf(step)<0)step='need';
  Object.keys(patch||{}).forEach(function(k){f[k]=patch[k];});
  if(f.step!==step)f.since=minute;
  f.step=step;f.at=minute;
  return f;
 }
 function flowText(item){
  var f=item&&item.flow;
  if(!f)return null;
  var parts=['목표'];
  if(f.need)parts.push('필요: '+f.need);
  if(f.prep)parts.push('준비: '+f.prep);
  parts.push('재시도');parts.push('완료 확인');
  return parts.join(' → ')+' · 현재 '+(STEP_LABELS[f.step]||f.step);
 }
 // A preparation the goal depends on (e.g. a skill inferred from a disabled action).
 function prepare(decision,plan,prep,minute){
  var item=record(decision,plan,minute);
  if(!item.prep||item.prep.skill!==prep.skill||item.prep.kind!==prep.kind)item.prep=Object.assign({since:minute},prep);
  else if(Number.isFinite(prep.requiredLevel)){
   item.prep.requiredLevel=prep.requiredLevel;
   item.prep.need=prep.need;
  }
  flow(decision,plan,'prepare',{need:prep.need||prep.skill,prep:prep.label||null},minute);
  return item.prep;
 }
 function prepared(decision,plan,minute,evidence){
  var item=record(decision,plan,minute);
  if(item.prep){item.prep.grown=minute;item.prep.evidence=evidence||null;}
  flow(decision,plan,'retry',{},minute);
  return item;
 }
 // 0.6.0 (1) Picking a goal back up. An action that was cut short by work, a pressing need or a trip did
 // not fail: nothing is learned about the action, so it gets no penalty and is asked again when the Zoi is free.
 var NEED_BAG=/^(?:Eat_|Sleep_|Sleeping_|Nap_|Self_Sleep_|Self_Nap_|Shower\d|Use_Bath|(?:Object_)?Toilet\d)/i;
 function interruption(ctx){
  var w=ctx.work||{};
  if(w.is_at_work||w.is_working_time||w.is_commute_time)return '출근·근무';
  var bag=ctx.current&&ctx.current.interaction_bag_id||'';
  if(ctx.travel&&ctx.travel.test(bag))return '이동';
  if(NEED_BAG.test(bag)||ctx.urgent)return '욕구 해결';
  return null;
 }
 // At most three pick-ups per action and game day; after that it is treated as an ordinary miss.
 function resume(decision,plan,goal,minute,why){
  var item=record(decision,plan,minute), day=Math.floor(minute/1440), r=item.resume;
  var same=r&&r.day===day&&r.bag===goal.bag&&String(r.target)===String(goal.target);
  if(same&&r.count>=3)return false;
  item.resume={day:day,bag:goal.bag,target:goal.target,why:why,at:minute,count:same?r.count+1:1};
  note(decision,plan,'waiting','중단됨('+why+') · 끝나면 이어서','같은 행동 재요청',minute);
  return true;
 }
 // 0.6.0 (2) The chain from goal to what it needs, as steps with their state, for the window and the report.
 function chain(item){
  if(!item)return [];
  var f=item.flow||{}, order=STEPS.indexOf(f.step||'need'), steps=[];
  function add(label,at){steps.push({label:label,state:order>at?'done':order===at?'now':'todo'});}
  add(f.need?'필요: '+f.need:'필요 조건 확인',0);
  if(f.prep||item.prep)add('준비: '+(f.prep||item.prep&&item.prep.skill+' 연습'),1);
  add('원래 목표 재시도',2);add('완료 확인',3);
  if(item.park&&item.park.until>item.lastSeen)steps.push({label:'다른 목표 먼저',state:'now'});
  return steps;
 }
 // A goal that has sat in "need/prepare" too long without evidence. A hope steps aside for a while so the
 // other hopes get their turn (it may expire; the day's count matters more). An ambition never steps aside:
 // its dead ends are forgotten and the requirement is worked out again.
 function stalled(decision,plan,minute){
  var item=record(decision,plan,minute), f=item.flow;
  if(!f||!/^(?:need|prepare)$/.test(f.step)||!Number.isFinite(f.since)||f.since>minute)return null;
  var ambition=plan.kind==='ambition';
  var limit=ambition?2*1440:Number.isFinite(item.expire)?Math.max(120,Math.min(360,(item.expire-f.since)/3)):360;
  if(minute-f.since<limit)return null;
  item.failures={};item.block=null;
  f.since=minute;
  if(ambition){
   item.prep=null;f.step='need';f.need=null;f.prep=null;
   item.reroutes=(item.reroutes||0)+1;
   note(decision,plan,'waiting','오래 막혀 필요 조건을 처음부터 다시 확인','다른 행동·장소·대상 탐색',minute);
   return 'reroute';
  }
  item.park={until:minute+240,count:(item.park&&item.park.count||0)+1};
  note(decision,plan,'waiting','오래 막힘 · 다른 소망을 먼저 진행','4게임시간 뒤 다시 시도',minute);
  return 'park';
 }
 function parked(item,minute){
  if(item&&item.park&&item.park.until-minute>240)item.park=null;
  return !!(item&&item.park&&item.park.until>minute);
 }
 var api={interruption:interruption,resume:resume,chain:chain,stalled:stalled,parked:parked,gone:gone,key:key,record:record,note:note,sync:sync,allowed:allowed,failed:failed,
  practiceAllowed:practiceAllowed,practiceLimit:practiceLimit,practiceMissed:practiceMissed,practiceRan:practiceRan,started:started,flow:flow,flowText:flowText,prepare:prepare,prepared:prepared,STEP_LABELS:STEP_LABELS};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.ObserverGoalMemory=api;
})(this);
