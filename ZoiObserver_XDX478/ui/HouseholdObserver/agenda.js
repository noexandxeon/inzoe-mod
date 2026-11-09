(function(root){
 'use strict';
 // One ordered agenda per Zoi. Every task is tried in score order; the first task that
 // actually requests a game action ends the turn. Waiting time raises a task's score so a
 // frequently busy task (phone, cleaning) cannot keep later work (hopes, social, career) out.
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
  return tasks.filter(function(t){return t&&t.eligible!==false;}).map(function(task){
   var item=entry(agenda,task.key,minute);
   item.label=task.label;
   return {task:task,score:score(task,item,minute,context),waited:waited(item,minute)};
  }).sort(function(a,b){return b.score-a.score||a.task.key.localeCompare(b.task.key);});
 }
 async function run(decision,tasks,minute,context,hooks){
  hooks=hooks||{};
  var agenda=book(decision,minute), ranked=order(decision,tasks,minute,context);
  agenda.turns=(agenda.turns||0)+1;
  for(var i=0;i<ranked.length;i++){
   var task=ranked[i].task, item=entry(agenda,task.key,minute), acted=false;
   if(hooks.skip&&hooks.skip(task)){item.preempted++;continue;}
   item.tried=minute;
   try{acted=await task.run();}
   catch(e){item.errors++;item.lastError=String(e&&e.message||e);acted=false;}
   if(acted){
    item.served=minute;item.served_count++;item.idle=0;
    agenda.intent={key:task.key,label:task.label,minute:minute,why:task.why||null};
    ranked.slice(i+1).forEach(function(r){entry(agenda,r.task.key,minute).preempted++;});
    return task.key;
   }
   item.idle++;
  }
  return null;
 }
 function starved(decision,minute){
  var agenda=decision.agenda;
  if(!agenda||!agenda.tasks)return [];
  return Object.keys(agenda.tasks).filter(function(k){
   var item=agenda.tasks[k];
   return item.preempted>0&&minute-(item.tried!=null?item.tried:item.since)>=STARVED;
  });
 }
 function summary(decision,minute){
  var agenda=decision.agenda;
  if(!agenda||!agenda.tasks)return null;
  var waiting=Object.keys(agenda.tasks).map(function(k){
   var item=agenda.tasks[k];
   return {key:k,label:item.label||k,minutes:minute-(item.served!=null?item.served:item.since),served:item.served_count,error:item.lastError||null};
  }).sort(function(a,b){return b.minutes-a.minutes;});
  return {intent:agenda.intent||null,waiting:waiting.slice(0,4),starved:starved(decision,minute)};
 }
 function compact(decision){
  var agenda=decision.agenda;
  if(!agenda||!agenda.tasks)return;
  var keys=Object.keys(agenda.tasks);
  if(keys.length<=KEEP)return;
  keys.sort(function(a,b){return (agenda.tasks[b].tried||0)-(agenda.tasks[a].tried||0);}).slice(KEEP).forEach(function(k){delete agenda.tasks[k];});
 }
 var api={order:order,run:run,starved:starved,summary:summary,compact:compact,score:score};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.ObserverAgenda=api;
})(this);
