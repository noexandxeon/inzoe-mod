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
    item.phase='ended';item.reason='게임 목록에서 종료 · 완료 여부 미확인';item.next='새 목표 확인';
   }
  });
  // Keep all active plans and a bounded recent history across long sessions.
  Object.keys(memory).filter(function(id){return /^(completed|ended)$/.test(memory[id].phase);})
   .sort(function(a,b){return memory[b].lastSeen-memory[a].lastSeen;}).slice(16).forEach(function(id){delete memory[id];});
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
 function practiceAllowed(decision,plan,minute){
  var item=record(decision,plan,minute), day=Math.floor(minute/1440);
  if(!item.practice||item.practice.day!==day)item.practice={day:day,sessions:0};
  return item.practice.sessions<3;
 }
 function started(decision,plan,minute,skill){
  var item=note(decision,plan,skill?'preparing':'running',
   skill?'선행 기술 연습 요청 · 성장 확인 대기':'행동 요청 · 실제 진행 확인 대기',
   skill?'기술 성장 확인 후 원래 목표 재평가':'게임 미션 진행 확인',minute);
  if(skill){practiceAllowed(decision,plan,minute);item.practice.sessions++;}
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
  flow(decision,plan,'prepare',{need:prep.need||prep.skill,prep:prep.label||null},minute);
  return item.prep;
 }
 function prepared(decision,plan,minute,evidence){
  var item=record(decision,plan,minute);
  if(item.prep){item.prep.grown=minute;item.prep.evidence=evidence||null;}
  flow(decision,plan,'retry',{},minute);
  return item;
 }
 var api={key:key,record:record,note:note,sync:sync,allowed:allowed,failed:failed,
  practiceAllowed:practiceAllowed,started:started,flow:flow,flowText:flowText,prepare:prepare,prepared:prepared,STEP_LABELS:STEP_LABELS};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.ObserverGoalMemory=api;
})(this);
