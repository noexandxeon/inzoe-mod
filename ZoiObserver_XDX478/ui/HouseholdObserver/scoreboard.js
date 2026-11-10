(function(root){
 'use strict';
 // Scoreboard (0.5.3): what actually happened, per Zoi and game day, as dated events.
 // A hope counts as completed only with the game's own mission evidence, and only once.
 // Stored in wf.state.score so it travels with the save. Nothing here issues game commands.
 var TARGET=5, PERIOD_DAYS=15, KEEP_DAYS=PERIOD_DAYS+1, EVENT_DAYS=2, MAX_EVENTS=120, MAX_SEEN=400;
 var DANGER={Toilet:24,Hunger:24,Sleep:24,Cleanliness:18};
 var SHORTFALL={
  offered:'게임이 준 소망이 적음',skill:'기술 준비 중인 소망',busy:'출근·수면 시간이 김',missing:'필요한 물건·장소·상대 없음',
  occupied:'물건을 다른 조이가 사용 중',unsupported:'모드가 아직 처리하지 못하는 조건',failed:'행동 요청이 실행되지 않음',
  unverified:'완료 여부를 게임에서 확인하지 못함',expired:'기한 안에 하지 못함',care:'돌봄·긴급 욕구에 시간 사용',partial:'하루 일부만 관찰'
 };
 function book(state){
  var s=state.score;
  if(!s||typeof s!=='object')s=state.score={};
  if(!s.days||typeof s.days!=='object')s.days={};
  if(!s.seen||typeof s.seen!=='object')s.seen={};
  return s;
 }
 function dayOf(minute){return Math.floor(minute/1440);}
 function person(state,minute,zoi){
  var s=book(state), key=String(dayOf(minute)), day=s.days[key];
  if(!day){day=s.days[key]={people:{},events:[]};prune(state);}
  var id=String(zoi), p=day.people[id];
  if(!p)p=day.people[id]={completed:0,ambition:0,gone:0,expired:0,requests:0,failed:0,outings:0,outingFound:0,
   offered:0,first:minute,last:minute,minutes:{work:0,sleep:0,free:0,danger:0},low:{},reasons:{},watch:{max:0,sum:0,n:0}};
  return {day:day,p:p,key:key};
 }
 function prune(state){
  var s=book(state), days=Object.keys(s.days).map(Number).sort(function(a,b){return a-b;});
  days.slice(0,-KEEP_DAYS).forEach(function(d){delete s.days[String(d)];});
  days.slice(0,-EVENT_DAYS).forEach(function(d){if(s.days[String(d)])s.days[String(d)].events=[];});
  var keys=Object.keys(s.seen);
  if(keys.length>MAX_SEEN)keys.sort(function(a,b){return s.seen[a]-s.seen[b];}).slice(0,keys.length-MAX_SEEN).forEach(function(k){delete s.seen[k];});
 }
 // 0.6.0 (3) Household-level facts for the unattended run: how often a person had to step in, how popups
 // were dealt with and how long they blocked the game, and payments that went out twice.
 function houseOf(state,minute){
  var s=book(state), key=String(dayOf(minute)), day=s.days[key]||(s.days[key]={people:{},events:[]});
  return day.house||(day.house={popups:0,popupAuto:0,popupUser:0,popupStall:0,popupLongest:0,stops:0,selections:0,duplicates:0});
 }
 // kind: popup {auto,seconds} | stop | selection | duplicate
 function house(state,minute,kind,info){
  if(!Number.isFinite(minute))return false;
  var h=houseOf(state,minute);
  if(kind==='popup'){
   var seconds=Math.max(0,Math.round(info&&info.seconds||0));
   h.popups++;
   if(info&&info.auto)h.popupAuto++;else h.popupUser++;
   h.popupStall+=seconds;
   if(seconds>h.popupLongest)h.popupLongest=seconds;
  }else if(kind==='stop')h.stops++;
  else if(kind==='selection')h.selections++;
  else if(kind==='duplicate')h.duplicates++;
  else return false;
  return true;
 }
 // The unattended criterion over the last `days` game days: no manual step, no duplicate payment,
 // no popup left blocking for more than two real minutes.
 function unattended(state,today,days){
  var s=book(state), out={days:0,interventions:0,duplicates:0,popups:0,popupAuto:0,stalls:0,longest:0};
  for(var d=today-(days||7)+1;d<=today;d++){
   var day=s.days[String(d)], h=day&&day.house;
   if(!day)continue;
   out.days++;
   if(!h)continue;
   out.interventions+=h.popupUser+h.stops+h.selections;
   out.duplicates+=h.duplicates;out.popups+=h.popups;out.popupAuto+=h.popupAuto;
   if(h.popupLongest>120)out.stalls++;
   if(h.popupLongest>out.longest)out.longest=h.popupLongest;
  }
  out.pass=out.days>=(days||7)&&out.interventions===0&&out.duplicates===0&&out.stalls===0;
  return out;
 }
 function houseLine(state,today){
  var u=unattended(state,today,7);
  if(!u.days)return '';
  return '무인 운영 '+u.days+'/7일 · 개입 '+u.interventions+' · 팝업 자동 '+u.popupAuto+'/'+u.popups+
   (u.longest?' (최장 '+u.longest+'초)':'')+' · 중복 결제 '+u.duplicates+(u.pass?' · 기준 충족':'');
 }
 // Returns false when the same fact was already recorded (same key), so nothing is counted twice,
 // also after a save is loaded again.
 function event(state,e){
  if(!e||!Number.isFinite(e.minute)||e.zoi==null||!e.kind)return false;
  var s=book(state), slot=person(state,e.minute,e.zoi), p=slot.p;
  if(e.key){
   var seen=String(e.zoi)+'|'+e.kind+'|'+e.key;
   if(s.seen[seen]!==undefined)return false;
   s.seen[seen]=e.minute;
  }
  if(e.kind==='hope_completed')p.completed++;
  else if(e.kind==='ambition_completed')p.ambition++;
  else if(e.kind==='hope_gone'){if(e.reason==='expired')p.expired++;else p.gone++;}
  else if(e.kind==='request')p.requests++;
  else if(e.kind==='failed'){p.failed++;if(e.reason)p.reasons[e.reason]=(p.reasons[e.reason]||0)+1;}
  else if(e.kind==='blocked'&&e.reason)p.reasons[e.reason]=(p.reasons[e.reason]||0)+1;
  else if(e.kind==='outing')p.outings++;
  else if(e.kind==='outing_found')p.outingFound++;
  else if(e.kind==='offered')p.offered++;
  var entry={m:e.minute,z:String(e.zoi),k:e.kind};
  if(e.name)entry.n=e.name;
  if(e.reason)entry.r=e.reason;
  if(e.evidence)entry.e=e.evidence;
  slot.day.events.push(entry);
  if(slot.day.events.length>MAX_EVENTS)slot.day.events.splice(0,slot.day.events.length-MAX_EVENTS);
  prune(state);
  return true;
 }
 // One observation of a Zoi: time spent working, asleep, free and in danger, the lowest needs,
 // and how long the mod went without looking at this Zoi (real milliseconds).
 function observe(state,minute,zoi,info,now){
  var s=book(state), slot=person(state,minute,zoi), p=slot.p;
  var marks=s.marks||(s.marks={}), id=String(zoi), mark=marks[id];
  p.samples=(p.samples||0)+1;
  var span=mark&&minute>mark.minute?Math.min(minute-mark.minute,30):0;
  var stats=info&&info.stats||{}, danger=false;
  Object.keys(DANGER).forEach(function(k){
   var v=stats[k]&&stats[k].pct;
   if(!Number.isFinite(v))return;
   if(p.low[k]===undefined||v<p.low[k])p.low[k]=Math.round(v);
   if(v<=DANGER[k])danger=true;
  });
  if(span){
   p.minutes[info&&info.working?'work':info&&info.sleeping?'sleep':'free']+=span;
   if(danger)p.minutes.danger+=span;
  }
  if(mark&&Number.isFinite(now)&&Number.isFinite(mark.at)&&now>mark.at&&now-mark.at<600000){
   var gap=now-mark.at;
   p.watch.n++;p.watch.sum+=gap;if(gap>p.watch.max)p.watch.max=gap;
  }
  p.last=minute;
  marks[id]={minute:minute,at:Number.isFinite(now)?now:null};
 }
 // Follows the hopes the game currently lists for a Zoi. A hope that leaves the list is settled
 // from the mission record: finished → completed (once); otherwise gone, with the reason known.
 // selected: [{name,instance,expire}] · missions: the Mission component's missionMap (or null if unread).
 function hopes(state,minute,zoi,selected,missions,acted){
  var s=book(state), id=String(zoi), all=s.hopes||(s.hopes={}), mine=all[id]||(all[id]={}), settled=[];
  var live={};
  (selected||[]).forEach(function(h){
   if(h.instance==null)return;
   var k=String(h.instance);
   live[k]=true;
   if(!mine[k]){
    mine[k]={name:h.name,expire:Number.isFinite(h.expire)?h.expire:null,since:minute};
    event(state,{minute:minute,zoi:zoi,kind:'offered',key:k,name:h.name});
   }
  });
  // How many unexpired hopes leave in this look: more than one is the game clearing the list.
  var leaving=Object.keys(mine).filter(function(k){
   return !live[k]&&!mine[k].done&&!(Number.isFinite(mine[k].expire)&&minute>=mine[k].expire);
  }).length;
  Object.keys(mine).forEach(function(k){
   var record=missions&&missions['(Value='+k+')'], w=mine[k];
   if(record&&record.bIsFinished&&!w.done){
    // The mark stays on the watched hope while the game still lists it, so it cannot be counted again.
    w.done=true;
    if(event(state,{minute:minute,zoi:zoi,kind:'hope_completed',key:k,name:w.name,evidence:'mission'}))settled.push({name:w.name,outcome:'completed'});
   }
   if(live[k])return;
   if(w.done){delete mine[k];return;}
   // Left the list. Without the mission record nothing is concluded yet; ask again next time.
   if(!missions)return;
   var reason=Number.isFinite(w.expire)&&minute>=w.expire?'expired':'unverified';
   // A finished hope can leave with its mission record. An observed action supports an inference.
   if(reason==='unverified'&&leaving===1&&acted&&acted(w.name,k)){
    if(event(state,{minute:minute,zoi:zoi,kind:'hope_completed',key:k,name:w.name,evidence:'action'}))settled.push({name:w.name,outcome:'acted'});
    delete mine[k];
    return;
   }
   if(event(state,{minute:minute,zoi:zoi,kind:'hope_gone',key:k,name:w.name,reason:reason}))settled.push({name:w.name,outcome:reason});
   delete mine[k];
  });
  return settled;
 }
 // Requests, failures, blocks, outings and finished ambition missions, read from what the mod already remembers.
 // Each fact has a key, so looking again never counts it twice.
 function memory(state,minute,id,p){
  var goals=p.goalMemory||{};
  Object.keys(goals).forEach(function(k){
   // What was already counted is marked on the record itself, so the mark lives exactly as long as the
   // record can be read again. (A bounded key table would forget old marks and count the same fact twice.)
   var item=goals[k], done=item.scored||(item.scored={blocks:{},fails:{}});
   if(item.kind==='ambition'&&item.phase==='completed'&&!done.completed){
    done.completed=true;
    event(state,{minute:minute,zoi:id,kind:'ambition_completed',name:item.name,evidence:'mission'});
   }
   var kind=item.phase==='unsupported'?'unsupported':item.block&&item.block.kind;
   if(kind&&!done.blocks[kind]){
    done.blocks[kind]=true;
    event(state,{minute:minute,zoi:id,kind:'blocked',name:item.name,reason:kind});
   }
   var failures=item.failures||{};
   Object.keys(failures).forEach(function(f){
    var count=failures[f].count||0, counted=done.fails[f]||0;
    for(var n=counted;n<count;n++)event(state,{minute:minute,zoi:id,kind:'failed',name:item.name});
    done.fails[f]=count;
   });
   Object.keys(done.fails).forEach(function(f){if(!failures[f])delete done.fails[f];});
  });
  if(p.goal&&p.goal.sentAt&&!p.goal.scored){
   p.goal.scored=true;
   event(state,{minute:minute,zoi:id,kind:'request',name:p.goal.name});
  }
  if(p.outing&&p.outing.goalVisit){
   if(!p.outing.scored){p.outing.scored=true;event(state,{minute:minute,zoi:id,kind:'outing',name:p.outing.name});}
   if(p.outing.found&&!p.outing.scoredFound){p.outing.scoredFound=true;event(state,{minute:minute,zoi:id,kind:'outing_found',name:p.outing.name});}
  }
 }
 // Has the list changed since the last look? Lets the caller read the mission record only when needed.
 function hopesChanged(state,zoi,names){
  var s=book(state), mine=(s.hopes||{})[String(zoi)]||{};
  // Hopes already settled but still listed are part of the known list.
  var known=Object.keys(mine).map(function(k){return mine[k].name;}).sort().join('|');
  return known!==(names||[]).slice().sort().join('|');
 }
 function summary(state,day,zoi){
  var s=book(state), d=s.days[String(day)], p=d&&d.people[String(zoi)];
  if(!p)return null;
  var observed=Math.max(0,p.last-p.first), partial=observed<1200;
  var reasons=[];
  function add(kind,weight,detail){if(weight>0)reasons.push({kind:kind,label:SHORTFALL[kind],weight:weight,detail:detail||null});}
  if(p.completed<TARGET){
   if(p.offered<TARGET)add('offered',TARGET-p.offered+2,'새로 받은 소망 '+p.offered+'개');
   add('skill',p.reasons.skill||0);
   add('missing',(p.reasons.missing||0)+(p.reasons.absent||0));
   add('occupied',p.reasons.occupied||0);
   add('unsupported',p.reasons.unsupported||0);
   add('failed',p.failed);
   add('unverified',p.gone,p.gone+'개');
   add('expired',p.expired,p.expired+'개');
   var busy=p.minutes.work+p.minutes.sleep, total=busy+p.minutes.free;
   if(total>0&&busy/total>=0.7)add('busy',3,Math.round(busy/total*100)+'%');
   if(p.minutes.danger>=120)add('care',2,p.minutes.danger+'분');
   if(partial)add('partial',1,Math.round(observed/60)+'시간');
   reasons.sort(function(a,b){return b.weight-a.weight;});
  }
  return {day:day,zoi:String(zoi),completed:p.completed,target:TARGET,met:p.completed>=TARGET,ambition:p.ambition,
   offered:p.offered,gone:p.gone,expired:p.expired,requests:p.requests,failed:p.failed,outings:p.outings,outingFound:p.outingFound,
   minutes:p.minutes,low:p.low,partial:partial,observedMinutes:observed,samples:p.samples||0,
   watchSeconds:p.watch.n?{average:Math.round(p.watch.sum/p.watch.n/100)/10,max:Math.round(p.watch.max/100)/10}:null,
   shortfall:reasons.slice(0,3)};
 }
 function line(state,day,zoi){
  var r=summary(state,day,zoi);
  if(!r)return '';
  var text='오늘 소망 '+r.completed+'/'+r.target+(r.met?' 달성':'');
  if(!r.met&&r.shortfall.length)text+=' · '+r.shortfall.slice(0,2).map(function(x){return x.label+(x.detail?' ('+x.detail+')':'');}).join(', ');
  if(r.gone)text+=' · 확인 못 한 종료 '+r.gone+'개';
  return text;
 }
 // For Report: every retained day with one summary per Zoi and the recent raw events.
 function report(state,fromDay,toDay){
  var s=book(state), out={target:TARGET,days:{}};
  Object.keys(s.days).forEach(function(key){
   var day=Number(key);
   if((fromDay!==undefined&&day<fromDay)||(toDay!==undefined&&day>=toDay))return;
   var d=s.days[key];
   out.days[key]={people:Object.keys(d.people).map(function(id){return summary(state,Number(key),id);}),events:d.events,house:d.house||null};
  });
  return out;
 }
 function startCheckpoint(state,now){
  var s=book(state);
  if(!s.runId)s.runId=String(now)+'-'+Math.random().toString(36).slice(2);
  return s;
 }
 function checkpoint(state,minute,scope,household,map){
  var s=book(state), people={};
  s.recordedAt=minute;
  Object.keys(state.people||{}).forEach(function(id){
   var p=state.people[id], goals={}, marks={};
   Object.keys(p.goalMemory||{}).forEach(function(key){
    if(p.goalMemory[key].scored)goals[key]=p.goalMemory[key].scored;
   });
   if(Object.keys(goals).length)marks.goals=goals;
   if(p.goal&&p.goal.scored)marks.goal={instance:p.goal.instance,at:p.goal.sentAt,bag:p.goal.bag};
   if(p.outing&&p.outing.scored)marks.outing={site:p.outing.site,start:p.outing.start,goalVisit:p.outing.goalVisit,found:p.outing.scoredFound};
   if(Object.keys(marks).length)people[id]=marks;
  });
  return {v:1,scope:scope,household:String(household),map:map,minute:minute,score:s,period:state.periodicScore||null,people:people};
 }
 function restoreCheckpoint(state,copy,minute,scope,household,map,now){
  var saved=book(state), newer=copy&&copy.score;
  if(!copy||copy.v!==1||copy.scope!==scope||copy.household!==String(household)||copy.map!==map||
     !newer||!newer.runId||newer.runId!==saved.runId||!newer.days||!Number.isFinite(copy.minute))return false;
  if(minute<copy.minute){
   // The player went back to an older point. Keep that save's history and start a separate reporting run.
   delete saved.runId;
   startCheckpoint(state,now);
   return false;
  }
  if(saved.recordedAt>=copy.minute)return false;
  state.score=newer;
  newer.marks={};
  if(copy.period&&copy.period.scope===scope&&copy.period.household===String(household))state.periodicScore=copy.period;
  Object.keys(copy.people||{}).forEach(function(id){
   var p=state.people&&state.people[id], marks=copy.people[id];
   if(!p)return;
   Object.keys(marks.goals||{}).forEach(function(key){
    if(p.goalMemory&&p.goalMemory[key])p.goalMemory[key].scored=marks.goals[key];
   });
   var goal=marks.goal, outing=marks.outing;
   if(goal&&p.goal&&p.goal.instance===goal.instance&&p.goal.sentAt===goal.at&&p.goal.bag===goal.bag)p.goal.scored=true;
   if(outing&&p.outing&&p.outing.site===outing.site&&p.outing.start===outing.start&&p.outing.goalVisit===outing.goalVisit){
    p.outing.scored=true;
    if(outing.found)p.outing.scoredFound=true;
   }
  });
  return true;
 }
 // Use full calendar days so neighboring reports never share a day.
 function period(state,minute,scope,household){
  var day=dayOf(minute);
  var run=state.periodicScore;
  if(!run||run.scope!==scope||run.household!==household||day<run.lastDay){
   run=state.periodicScore={scope:scope,household:household,fromDay:day+1};
  }
  run.lastDay=day;
  return run;
 }
 function periodSummary(state,fromDay,toDay){
  var s=book(state), people={}, daysWithoutObservations=[];
  var house={popups:0,popupAuto:0,popupUser:0,popupLongest:0,stops:0,selections:0,duplicates:0};
  for(var day=fromDay;day<toDay;day++){
   var record=s.days[String(day)], observed=false;
   Object.keys(record&&record.people||{}).forEach(function(id){
    var p=record.people[id], r=summary(state,day,id);
    var total=people[id]||(people[id]={zoi:id,observedDays:0,partialDays:0,daysAtTarget:0,
     completed:0,offered:0,expired:0,unverified:0,ambition:0,failed:0,dangerMinutes:0,watchMaxSeconds:null,blockers:{}});
    if(p.samples){
     observed=true;
     total.observedDays++;
     if(r.partial)total.partialDays++;
     else if(r.met)total.daysAtTarget++;
    }
    total.completed+=r.completed;total.offered+=r.offered;total.expired+=r.expired;total.unverified+=r.gone;
    total.ambition+=r.ambition;total.failed+=r.failed;total.dangerMinutes+=r.minutes.danger;
    if(r.watchSeconds)total.watchMaxSeconds=Math.max(total.watchMaxSeconds||0,r.watchSeconds.max);
    Object.keys(p.reasons).forEach(function(reason){
     total.blockers[reason]=(total.blockers[reason]||0)+p.reasons[reason];
    });
   });
   if(!observed)daysWithoutObservations.push(day);
   if(record&&record.house)Object.keys(house).forEach(function(k){
    var value=record.house[k]||0;
    house[k]=k==='popupLongest'?Math.max(house[k],value):house[k]+value;
   });
  }
  var zois=Object.values(people).map(function(p){
   p.daysWithoutObservations=toDay-fromDay-p.observedDays;
   p.blockers=Object.keys(p.blockers).map(function(kind){
    return {kind:kind,label:SHORTFALL[kind]||(kind==='stalled'?'목표 정체':kind),records:p.blockers[kind]};
   }).sort(function(a,b){return b.records-a.records;});
   return p;
  });
  return {fromDay:fromDay,toDayExclusive:toDay,daysWithoutObservations:daysWithoutObservations,people:zois,house:house};
 }
 function dueReport(state,minute,scope,household,now){
  if(!Number.isFinite(minute))return null;
  var run=period(state,minute,scope,String(household)), day=dayOf(minute), end=run.fromDay+PERIOD_DAYS;
  if(run.pending)return run.pending;
  if(day<end)return null;
  var range=periodSummary(state,run.fromDay,end);
  if(range.daysWithoutObservations.length===PERIOD_DAYS){
   run.fromDay=day;
   return null;
  }
  var id=String(household).replace(/[^a-z0-9_-]/gi,'_');
  run.pending={key:'observer-15d-'+id+'-'+run.fromDay+'-'+(end-1)+'-'+scope+'-'+(book(state).runId||now),
   range:range,score:report(state,run.fromDay,end)};
  return run.pending;
 }
 function reportSaved(state,pending){
  var run=state.periodicScore;
  if(!run||run.pending!==pending)return;
  run.fromDay=pending.range.toDayExclusive;
  delete run.pending;
 }
 var api={dueReport:dueReport,reportSaved:reportSaved,PERIOD_DAYS:PERIOD_DAYS,house:house,unattended:unattended,houseLine:houseLine,TARGET:TARGET,memory:memory,event:event,observe:observe,hopes:hopes,hopesChanged:hopesChanged,summary:summary,line:line,report:report,dayOf:dayOf,
  startCheckpoint:startCheckpoint,checkpoint:checkpoint,restoreCheckpoint:restoreCheckpoint};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.ObserverScoreboard=api;
})(this);
