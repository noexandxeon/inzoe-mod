(function(root){
 'use strict';
 // 0.6.1: one place that answers "why is this Zoi not doing anything right now?".
 // The waits live in many places (per-activity timers, the agenda's retry times, goal blocks, parked hopes).
 // Nothing is changed here: this only reads them and names the reason and when it ends.
 var TIMERS={
  nextNeed:'욕구 해결',nextHopeAction:'소망 행동',nextAmbitionAction:'야망 행동',nextTalk:'대화',nextSocialOuting:'사교 외출',
  nextOuting:'여가 외출',nextVacation:'휴가',nextSide:'개인 작업',nextMarket:'포켓마켓',nextCatShop:'냥스토어',nextRepair:'집 수리',
  nextParcel:'택배',nextCleaning:'청소',nextFurnish:'가구 마련',nextGoalFurnish:'목표용 가구',nextPhoneAction:'휴대폰',nextPhone:'휴대폰 확인',
  nextTaste:'취향 정리',nextCommute:'출근',nextHousePlan:'주거 판단',nextPlanning:'진로 판단',nextCheckIn:'숙소 체크인',nextReturn:'귀가'
 };
 function clock(minute){
  var h=Math.floor(minute%1440/60), m=Math.floor(minute%60);
  return h+':'+('0'+m).slice(-2);
 }
 // Every wait that is still running for this Zoi, soonest first: {label, until, why}.
 function waits(p,minute){
  var out=[];
  Object.keys(TIMERS).forEach(function(k){
   if(Number.isFinite(p[k])&&p[k]>minute&&p[k]-minute<=3*1440)out.push({label:TIMERS[k],until:p[k],why:'다음 시도 시각'});
  });
  var tasks=p.agenda&&p.agenda.tasks||{};
  Object.keys(tasks).forEach(function(k){
   var t=tasks[k];
   if(t.eligible!==false&&t.retryAt>minute)out.push({label:t.label||k,until:t.retryAt,why:t.reason||'재시도 대기'});
  });
  var memory=p.goalMemory||{};
  Object.keys(memory).forEach(function(k){
   var item=memory[k];
   if(/^(?:completed|ended)$/.test(item.phase))return;
   var name=(item.kind==='ambition'?'야망 ':'소망 ')+item.name;
   if(item.park&&item.park.until>minute)out.push({label:name,until:item.park.until,why:'오래 막혀 비켜 섬'});
   else if(item.block&&item.block.until>minute)out.push({label:name,until:item.block.until,why:item.block.label});
  });
  var g=p.gather;
  if(g&&g.next>minute&&g.next-minute<=3*1440)out.push({label:'지인 초대',until:g.next,why:g.status||'다음 초대 시각'});
  return out.sort(function(a,b){return a.until-b.until;});
 }
 // ctx: {sleeping, work, dependent, away, enabled, queueCount, current}
 function explain(p,minute,ctx){
  ctx=ctx||{};
  if(ctx.enabled===false)return '자동 관리 꺼짐';
  if(ctx.dependent)return '영유아 · 돌봄만 관리';
  if(ctx.away)return '다른 도시에 있음 · 돌아오면 재개';
  if(ctx.sleeping)return '수면 중';
  var w=ctx.work||{};
  if(w.is_at_work||w.is_working_time||w.is_commute_time)return '근무·출근 중';
  if(p.outing)return '외출 중: '+(p.outing.name||'');
  if(p.goal)return '목표 행동 결과 확인 중: '+p.goal.name;
  var intent=p.agenda&&p.agenda.intent;
  if(intent&&minute-intent.minute<=30&&minute>=intent.minute)return '방금 요청: '+intent.label;
  if(ctx.queueCount>0)return '게임 대기열의 행동 '+ctx.queueCount+'개 진행 중';
  var list=waits(p,minute);
  if(!list.length)return ctx.current?'자율 행동 중 · 요청할 일 없음':'요청할 일 없음 (조건에 맞는 작업이 없음)';
  var first=list[0];
  return '대기 '+list.length+'건 · 가장 먼저 풀림: '+first.label+' '+clock(first.until)+' ('+first.why+')';
 }
 // For the report: the whole list, so a stuck Zoi can be read from one file.
 function report(p,minute,ctx){
  return {line:explain(p,minute,ctx),waits:waits(p,minute).slice(0,12).map(function(x){return {label:x.label,until:x.until,why:x.why};})};
 }
 var api={TIMERS:TIMERS,waits:waits,explain:explain,report:report};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.ObserverWhy=api;
})(this);
