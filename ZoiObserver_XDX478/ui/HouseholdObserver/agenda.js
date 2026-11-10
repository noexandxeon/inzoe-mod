(function(root){
 'use strict';
 // Every task is tried in score order. A prepared plan and an accepted game action are separate.
 var AGE_STEP=6, AGE_CAP=60, STARVED=360, KEEP=40;

 function book(decision,minute){
  var agenda=decision.agenda||(decision.agenda={tasks:{},turns:0});
  agenda.tasks=agenda.tasks||{};
  // A loaded older save rewinds game time. Old timestamps would otherwise look like the future.
  if(agenda.minute>minute){agenda.tasks={};agenda.intent=null;}
  agenda.minute=minute;
  return agenda;
 }
 function entry(agenda,key,minute){
  var item=agenda.tasks[key]||(agenda.tasks[key]={since:minute,tried:null,served:null,served_count:0,idle:0,preempted:0,errors:0});
  return item;
 }
 function waited(item,minute){
  var last=item.tried!=null?item.tried:item.since;
  return Math.max(0,minute-last);
 }
 function score(task,item,minute,context){
  var value=task.base||0;
  value+=Math.min(AGE_CAP,waited(item,minute)/AGE_STEP);
  if(Number.isFinite(task.deadline)){
   var left=task.deadline-minute;
   if(left<=0)value+=55;
   else if(left<=180)value+=55*(1-left/180);
  }
  if(task.bonus)value+=task.bonus;
  // Long trips started late or with low needs are usually cut short by the game.
  if(task.long&&context&&(context.late||context.lowNeeds))value-=35;
  return value;
 }
 function order(decision,tasks,minute,context){
  var agenda=book(decision,minute);
  Object.keys(agenda.tasks).forEach(function(key){agenda.tasks[key].eligible=false;});
  return tasks.filter(function(t){return t&&t.eligible!==false;}).map(function(task){
   var item=entry(agenda,task.key,minute);
   item.label=task.label;
   item.eligible=true;
   return {task:task,score:score(task,item,minute,context),waited:waited(item,minute)};
  }).filter(function(r){return !(agenda.tasks[r.task.key].retryAt>minute);})
   .sort(function(a,b){return b.score-a.score||a.task.key.localeCompare(b.task.key);});
 }
 function result(status,reason,retryAt){return {status:status,reason:reason||null,retryAt:retryAt||null};}
 function outcome(value){
  if(value===true)return result('requested');
  if(value&&/^(requested|verified|waiting|unsupported|failed)$/.test(value.status))return value;
  return result('idle');
 }
 async function run(decision,tasks,minute,context,hooks){
  hooks=hooks||{};
  var agenda=book(decision,minute), ranked=order(decision,tasks,minute,context);
  agenda.turns=(agenda.turns||0)+1;
  var done=[];
  for(var i=0;i<ranked.length;i++){
   var task=ranked[i].task, item=entry(agenda,task.key,minute), action;
   if(hooks.skip&&hooks.skip(task)){item.preempted++;continue;}
   item.tried=minute;
   var previous=hooks.receipt&&hooks.receipt();
   try{action=outcome(await task.run());}
   catch(e){action=result('failed',String(e&&e.message||e),minute+20);}
   if(hooks.receipt&&hooks.receipt()!==previous&&action.status!=='verified')action=result('requested',action.reason);
   item.status=action.status;
   item.reason=action.reason;
   item.retryAt=action.retryAt;
   if(action.status==='failed'){item.errors++;item.lastError=action.reason;}
   if(action.status==='requested'||action.status==='verified'){
    item.served=minute;item.served_count++;item.idle=0;
    agenda.intent={key:task.key,label:task.label,minute:minute,status:action.status,why:action.reason||task.why||null};
    // 0.4.7: the game queue holds 7 actions. Keep filling free slots in the same turn with
    // local actions; stop after a trip (moving elsewhere) or when the slots for this turn are used.
    done.push(task.key);
    var slots=hooks.slots||1;
    if(done.length>=slots||(hooks.moved&&hooks.moved())){
     ranked.slice(i+1).forEach(function(r){entry(agenda,r.task.key,minute).preempted++;});
     return done.join(',');
    }
    continue;
   }
   item.idle++;
  }
  return done.length?done.join(','):null;
 }
 function starved(decision,minute){
  var agenda=decision.agenda;
  if(!agenda||!agenda.tasks)return [];
  return Object.keys(agenda.tasks).filter(function(k){
   var item=agenda.tasks[k];
   return item.eligible!==false&&!(item.retryAt>minute)&&item.preempted>0&&minute-(item.tried!=null?item.tried:item.since)>=STARVED;
  });
 }
 function summary(decision,minute){
  var agenda=decision.agenda;
  if(!agenda||!agenda.tasks)return null;
  var waiting=Object.keys(agenda.tasks).filter(function(k){
   var item=agenda.tasks[k];
   return item.eligible!==false&&item.reason&&/^(waiting|unsupported|failed)$/.test(item.status);
  }).map(function(k){
   var item=agenda.tasks[k];
   return {label:item.label||k,reason:item.reason,tried:item.tried};
  }).sort(function(a,b){return b.tried-a.tried;});
  return {intent:agenda.intent||null,waiting:waiting.slice(0,2),starved:starved(decision,minute)};
 }
 function compact(decision){
  var agenda=decision.agenda;
  if(!agenda||!agenda.tasks)return;
  var keys=Object.keys(agenda.tasks);
  if(keys.length<=KEEP)return;
  keys.sort(function(a,b){return (agenda.tasks[b].tried||0)-(agenda.tasks[a].tried||0);}).slice(KEEP).forEach(function(k){delete agenda.tasks[k];});
 }
 var api={order:order,run:run,starved:starved,summary:summary,compact:compact,score:score,result:result};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.ObserverAgenda=api;
})(this);
