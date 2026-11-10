(function () {
 'use strict';
 var VERSION='0.5.7', P=ObserverPolicy, L=ObserverLife, C=ObserverChoices, protocol=ObserverProtocol, state=wf.state;
 var A=ObserverAgenda, R=ObserverRecovery, Rel=ObserverRelations, M=ObserverGoalMemory;
 var ChildCare=ObserverChildCare, Score=ObserverScoreboard, CP=ObserverCareerPath, Persona=ObserverPersona;
 var busy=false, epoch=0, index=0, cache={}, profiles={}, rows={}, members=[], lastReport=0;
 // Kept on window so a live update keeps the log history.
 var logs=window.ZoiObserverLogs||(window.ZoiObserverLogs=[]);
 var status='Start를 누르면 현재 가구를 자동 관리합니다.', errors=0, lastGame=null;
 var caps={}, snapshots={}, lastCycle=0, popupRows={}, lastPopup=null, blockedPopup=null;
 var popupTries=0, nextPopupTry=0, checkingPopup=false, watching=false, calendar=null;
 var playedGroups=[], rosterAt=0, rosterMap='';
 var scheduleCancel=null;
 var receiptSerial=0;
 var lastPendingPoll=0, queueSampleAt={};
 var pausedUntil=0, firstError=0, pendingResume=true, lastMirror=0, mirrorStopped=false;
 var timerKeys=['nextAutonomy','nextHope','nextCommute','nextTalk','nextPlanning','nextNeed','nextCleaning','nextRepair',
  'nextHopeAction','nextSide','nextOuting','nextHousePlan','nextFurnish','nextPhone','nextPhoneAction',
  'nextTaste','nextParcel','nextMarket','nextCatShop','nextAmbition','nextAmbitionAction','nextVacation','nextGoalFurnish','ambitionTurn'];
 function resetTimers(p,minute){timerKeys.forEach(function(key){p[key]=minute||0;});}
 function clock(minute){
  if(!Number.isFinite(minute))return '';
  var d=Math.floor(minute/1440), h=Math.floor(minute%1440/60), m=Math.floor(minute%60);
  return d+'일 '+h+':'+('0'+m).slice(-2);
 }
 function gameMinute(time){return time.day*1440+time.hour*60+time.minute;}
 var popupIds=['RabbitHole_Go','JobRankUp','SelectJobPromotion','NoticeBirth','NoticeAdopt',
  'NoticePregnancy','NoticePregnancy_Fail','NoticeEngagement','NoticeWedding','FriendArrivedMessage','ChangeGrowthStep',
  'ChangeGrowthStep_Toddler','ChangeGrowthStep_Child','ChangeGrowthStep_LowTeen',
  'ChangeGrowthStep_HighTeen','ChangeGrowthStep_Youth','ChangeGrowthStep_Adult',
  'ChangeGrowthStep_Old','ChangeGrowthStep_Elderly'];
 var extended=['hope.force_update','interaction.execute','ui.click_popup_button','ui.click','ui.scroll','build.enter_mode'];
 function init(){
  if(state.schema!==1){Object.keys(state).forEach(function(k){delete state[k];});state.schema=1;state.enabled=false;state.household=null;state.people={};}
  state.people=state.people||{};
  if(state.scope!=='played')state.scope='current';
  state.background=state.background!==false;
 }
 init();
 var gameData=ObserverGameData.create(cli);
 var life=ObserverLifeActions.create({cli:cli,write:write,log:log,state:state,gameData:gameData,
  markAccepted:function(){receiptSerial++;},
  game:function(){return lastGame;},members:function(){return members;},snapshot:function(id){return snapshots[id];},
  queued:function(id){var s=snapshots[String(id)];return s&&s.queue&&s.queue.items||[];},
  // Counted when the request is made: a short action can finish, and its goal be cleared, before the next full look.
  requested:function(decision,plan,minute){
   var id=Object.keys(state.people).find(function(k){return state.people[k]===decision;});
   if(id===undefined||!decision.goal||decision.goal.scored)return;
   decision.goal.scored=true;
   Score.event(state,{minute:minute,zoi:id,kind:'request',name:plan.name});
  },
  active:function(token){return state.enabled&&token===epoch;}});
 var gathering=ObserverGathering.create({cli:cli,write:write,log:log,L:L,Rel:Rel,
  life:function(){return lifeBook();},members:function(){return members;},game:function(){return lastGame;},
  home:function(member,character){return life.home(member,character);},
  score:function(e){Score.event(state,e);}});
 var vocation=CP.create({cli:cli,write:write,log:log,
  computers:function(member,character){return life.computers(member,character);},
  objects:function(member,character){return life.siteObjects(member,character);},
  act:function(member,objects,choose,token,offers){return life.objectAction(member,objects,choose,token,offers);},
  move:function(member,site,token){return life.move(member,site,token);},
  score:function(e){Score.event(state,e);}});
 var panels=ObserverPanels.create({cli:cli,write:write,log:log,state:state,game:function(){return lastGame;},
  background:function(){return state.background;},
  active:function(token){return state.enabled&&token===epoch;}});
 var travel=ObserverTravel.create({cli:cli,write:write,log:log,state:state,game:function(){return lastGame;},
  active:function(token){return state.enabled&&token===epoch;}},L,P);
 var care=ChildCare.create({cli:cli,write:write,log:log,move:life.move,state:state,game:function(){return lastGame;},
  queued:async function(id){return (await readQueue(String(id))).entries;},
  active:function(token){return state.enabled&&token===epoch;}},L);
 wf.content.innerHTML='<div class="summary"><b>가구 관찰 실험판 '+VERSION+'</b><p id="status"></p></div>'+
  '<div class="buttons"><button id="start">Start</button><button id="played">Played</button><button id="stop">Stop</button><button id="report">Report</button></div>'+
  '<p class="help">Start: 현재 가구 / Played: 플레이한 가구들 / Stop: 중지 / Report: 진단 저장</p>'+
  '<p class="help" id="data-status"></p><p class="help">창 복구 Ctrl+Shift+O</p>'+
  '<p class="help"><button id="background" aria-pressed="true"></button><span id="mode-note"></span></p>'+
  '<div id="people"></div><p id="news"></p><p class="limit">욕구·수리·택배·소망 / 소식·일정 / 취향·관계</p>'+
  '<div id="log"></div>';
 function log(message){
  var d=new Date(), pad=function(n){return ('0'+n).slice(-2);};
  var stamp=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());
  logs.push(stamp+' '+message);if(logs.length>150)logs.shift();console.log('[ZoiObserver] '+message);render();
 }
 function esc(x){return String(x==null?'':x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
 function render(){
  document.getElementById('status').textContent=(state.enabled?'[자동 관리] ':'[관찰 대기] ')+status;
  var data=gameData.summary();
  document.getElementById('data-status').textContent=data.tableCount?
   '게임 데이터 · '+data.tableCount+'개 표 / 읽은 행 '+Object.values(data.queried).reduce(function(n,x){return n+x;},0)+'개':
   '게임 데이터 목록 확인 대기';
  var toggle=document.getElementById('background');
  toggle.textContent='다른 작업 모드 '+(state.background?'켜짐':'꺼짐');
  toggle.setAttribute('aria-pressed',String(state.background));
  document.getElementById('mode-note').textContent=state.background?'마우스 입력이 필요한 작업은 대기':'게임 화면 입력 허용';
  document.getElementById('people').innerHTML=members.map(function(m){
   var id=String(m.entity_id), s=snapshots[id], p=state.people[id]||{};
   var html='<div class="person"><b>'+esc(m.last_name+' '+m.first_name)+'</b><span> '+esc(ChildCare.dependent(m)?m.age_group_text||'영유아':m.job_name||'무직')+'</span>';
   if(state.scope==='played')html+='<p>가구: '+esc(m.observer_household_name||m.household_id)+'</p>';
   if(s){
    html+='<p>기질: '+esc(P.traits(s.trait||{}).join(', ')||'읽는 중')+'</p>';
    html+='<p>자율 행동 설정: '+esc(s.autonomy.label)+' / 소망 '+s.hope.selected_count+'개</p>';
    ['Hunger','Cleanliness','Sleep','Toilet','Fun','Society'].forEach(function(k){var n=s.stats.stats[k];if(n)html+='<span class="need'+(n.pct<20?' urgent':'')+'">'+esc(s.stats.stat_names[k]||k)+' '+Math.round(n.pct)+'%</span>';});
    html+='<p>행동: '+esc(s.queue.current&&s.queue.current.interaction_bag_id||'대기')+'</p>';
    html+='<p>상태: '+esc(s.note||'관찰 중')+'</p>';
   }
   var now=p.lastMinute, view=A.summary(p,now);
   if(view&&view.intent)html+='<p class="intent">최근 '+(view.intent.status==='verified'?'반영 확인':'실행 요청')+': '+esc(view.intent.label)+(view.intent.why?' · '+esc(view.intent.why):'')+
    ' <span class="help">('+esc(clock(view.intent.minute))+')</span></p>';
   if(view&&view.waiting.length)html+='<p class="help">대기: '+esc(view.waiting.map(function(task){return task.label+' · '+task.reason;}).join(' / '))+'</p>';
   if(p.lastAction)html+='<p class="help">행동 결과: '+esc(p.lastAction.note||'게임 대기열 확인 중')+'</p>';
   if(p.goal){
    var gm=p.goal.kind==='ambition'?null:(p.goalPlans||[]).find(function(g){return g.name===p.goal.name&&g.instance===p.goal.instance;});
    html+='<p>추구 중인 '+(p.goal.kind==='ambition'?'야망':'소망')+': '+esc(p.goal.name)+'</p>';
    var ft=gm&&M.flowText(gm.memory);
    if(ft)html+='<p class="help">'+esc(ft)+'</p>';
   }
   var tally=Number.isFinite(p.lastMinute)&&Score.line(state,Score.dayOf(p.lastMinute),id);
   if(tally)html+='<p class="intent">'+esc(tally)+'</p>';
   if(p.goalBlock)html+='<p>막힘: '+esc(p.goalBlock)+'</p>';
   if(ChildCare.dependent(m)&&p.childCare&&p.childCare.status)html+='<p>돌봄: '+esc(p.childCare.status)+'</p>';
   if(p.upcoming&&p.upcoming.length)html+='<p class="help">다음 차례: '+esc(p.upcoming.join(' → '))+'</p>';
   if(view&&view.starved.length)html+='<p class="urgent">오래 밀린 작업: '+esc(view.starved.map(function(k){
    return (p.agenda.tasks[k]&&p.agenda.tasks[k].label)||k;}).join(', '))+'</p>';
   if(p.lastTalk)html+='<p>최근 대화 요청: '+esc(p.lastTalk)+'</p>';
   var people=Rel.describe(state.life||{},id,now);
   if(people.length)html+='<p class="help">관계: '+esc(people.map(function(c){
    return c.name+(c.reason?' · '+c.reason:'')+(c.next?' · 다음 '+clock(c.next):'');}).join(' / '))+'</p>';
   if(p.gather&&p.gather.status)html+='<p>초대·파티 · '+esc(p.gather.status)+'</p>';
   if(p.repairStatus)html+='<p>집 수리 · '+esc(p.repairStatus)+'</p>';
   if(p.marketStatus)html+='<p>포켓마켓 · '+esc(p.marketStatus)+'</p>';
   if(p.goalPlans&&p.goalPlans.length)html+='<p>소망 (만료가 가까운 순)</p>'+p.goalPlans.map(function(g,i){
    var mem=g.memory||{}, block=mem.block, when=block&&block.until>now?' · '+clock(block.until)+' 이후':'';
    return '<p>'+String(i+1)+'. '+esc(g.name)+' · '+esc(g.status)+'</p>'+
     (block?'<p class="help">왜 막혔나: '+esc(block.label+(block.detail?' ('+block.detail+')':''))+'</p>':'')+
     (mem.next?'<p class="help">다음: '+esc(mem.next+when)+(mem.evidence?' · 확인: '+esc(mem.evidence):'')+'</p>':'')+
     (mem.flow?'<p class="help">'+esc(M.flowText(mem))+'</p>':'');
   }).join('');
   if(p.ambition)html+='<p>야망 '+esc(p.ambition.name)+' · '+p.ambition.step+'단계</p>'+
    p.ambition.plans.map(function(g){return '<p>'+esc(g.label||g.name)+' · '+esc(g.status)+'</p>';}).join('');
   if(p.outing)html+='<p>외출: '+esc(p.outing.name)+(p.outing.returning?' (귀가 중)':p.outing.arrived?' (도착)':' (이동 중)')+'</p>';
   if(p.vacation)html+='<p>휴가 '+p.vacation.trips.length+'회 · 다음 '+(p.vacation.next===null?'다음 게임 연도':p.vacation.next+'일부터')+
    (p.vacationNote?' · '+esc(p.vacationNote):'')+'</p>';
   if(p.target)html+='<p>구인 후보: '+esc(p.target.name)+' / 적합도 '+esc(p.target.score)+'</p>';
   if(p.openings)html+='<p>현재 빈자리 '+p.openings.length+'종: '+esc(p.openings.slice(0,4).join(', ')||'없음')+'</p>';
   if(p.persona)html+='<p class="help">성향: '+esc(Persona.describe(p.persona))+'</p>';
   if(CP.describe(p.careerPath))html+='<p>삶의 방향: '+esc(CP.describe(p.careerPath))+'</p>';
   if(p.lifePlan){
    var plan=p.lifePlan;
    html+='<p>진로 판단: '+esc(plan.primary)+'</p>';
    if(plan.side)html+='<p>부수입 후보: '+esc(plan.side.label)+'</p>';
    if(plan.business&&!plan.ownedBusiness)html+='<p>창업 후보: '+esc(plan.business.type)+'</p>';
    if(plan.ownedBusiness)html+='<p>보유 사업: '+(plan.ownedBusiness.operating?'영업 중':'영업 대기')+'</p>';
   }
   if(p.housePlan){
    if(p.housePlan.missing.length)html+='<p>필요 가구: '+esc(p.housePlan.missing.map(function(x){return x.label+' '+x.price;}).join(', '))+'</p>';
    if(p.housePlan.cramped)html+='<p>이사: '+esc(p.housePlan.moveStatus||'기존 가구 실행 경로 확인 필요')+'</p>';
    if(p.housePlan.adoption)html+='<p>입양: '+esc(p.housePlan.adoption)+'</p>';
   }
   if(p.skillGoal)html+='<p>연습 목표: '+esc(p.skillGoal)+'</p>';
   if(p.preferences)html+='<p>취향 '+Object.keys(p.preferences.saved).length+'개 / 대기 '+p.preferences.pending.length+'개</p>';
   if(p.phone&&p.phone.unread)html+='<p>휴대폰 미확인 '+p.phone.unread+'건: '+esc(p.phone.items.map(function(x){return x.kind;}).join(', '))+'</p>';
   if(p.pendingReplies)html+='<p>답장 필요한 메시지 '+esc(p.pendingReplies)+'건</p>';
   return html+'</div>';
  }).join('');
  var news=panels.latestNews();
  document.getElementById('news').textContent=news?'소식함 '+news.entries.length+'건 확인'+
   (news.events.length?' · 현재 행사 '+news.events.map(function(e){return e.title;}).join(', '):''):'';
  var el=document.getElementById('log');el.textContent=logs.slice(-35).join('\n');el.scrollTop=el.scrollHeight;
 }
 async function cli(name,args){
  if(state.background&&!protocol.backgroundInputAllowed(name,args))throw Error('다른 작업 모드에서 화면 입력 대기');
  var timer;
  try{return protocol.decode(await Promise.race([wf.cli(name,args||{}),new Promise(function(_,reject){timer=setTimeout(function(){reject(Error('응답 시간 초과: '+name));},12000);})]));}
  finally{clearTimeout(timer);}
 }
 async function capability(name){
  if(caps[name])return caps[name];
  var h=await cli('cli.help',{command:name});
  if(typeof h==='string'){var at=h.indexOf('{');if(at>=0)h=JSON.parse(h.slice(at));}
  if(!h||h.id!==name)throw Error('기능 정보 확인 실패: '+name);
  caps[name]=h;return h;
 }
 async function table(id){if(!rows[id])rows[id]=await gameData.row('Career',id);return rows[id];}
 async function roster(household,mapId){
  if(state.scope!=='played')return household.members;
  if(rosterMap!==mapId||Date.now()-rosterAt>30000){
   var result=[],offset=0,total=0;
   do{
    var page=await cli('household.list',{Limit:100,Offset:offset,Include:'all'});
    if(!Array.isArray(page.households))throw Error('플레이 가구 목록을 읽지 못했습니다.');
    result=result.concat(page.households.filter(function(h){return h.ever_possessed===true;}));
    offset+=page.households.length;total=page.total;
    if(!page.households.length)break;
   }while(offset<total);
   playedGroups=result;rosterAt=Date.now();rosterMap=mapId;
  }
  var combined=household.members.map(function(m){return Object.assign({},m,{observer_household_name:household.name});});
  for(var i=0;i<playedGroups.length;i++){
   var group=playedGroups[i];
   if(String(group.household_id)===String(household.household_id))continue;
   try{
    var data=await cli('household.get_members',{household_id:String(group.household_id)});
    if(String(data.household_id)!==String(group.household_id)||!Array.isArray(data.members))continue;
    combined=combined.concat(data.members.map(function(m){return Object.assign({},m,{observer_household_name:data.name});}));
   }catch(e){
    var key='roster:'+group.household_id;
    if(cache[key]!==e.message){cache[key]=e.message;log(group.name+': 가구 정보를 기다리는 중');}
   }
  }
  return combined.filter(function(m,i,a){return a.findIndex(function(other){return other.entity_id===m.entity_id;})===i;});
 }
 function personalAutonomy(character){
  var option=character.autonomyOption&&character.autonomyOption.autonomyEnable;
  if(!option||typeof option.value!=='boolean')return {value:null,label:'확인 대기'};
  if(option.bFollowParent)return {value:null,label:'상위 설정 따름',saved_value:option.value};
  return {value:option.value,label:option.value?'켜짐':'꺼짐'};
 }
 async function findHudButton(name,suffix){
  var results=await cli('ui.find',{Name:name,Window:'Hud',Limit:25});
  if(!Array.isArray(results))return null;
  var matches=results.filter(function(n){return n.role==='button'&&typeof n.ref==='string'&&n.ref.endsWith(suffix);});
  return matches.length===1?matches[0].ref:null;
 }
 async function enablePersonal(id,character,token){
  var selected=await cli('entity.get_possessed');
  if(String(selected.entity_id)!==id)return character;
  var option=await findHudButton('Button_InteractionToggle','/WBP_Autonomy_OptionPanel/WBP_Autonomy_OptionListEntry/BW_ToggleSwitch/BW_Button_InteractionToggle');
  var opened=false;
  try {
   if(!option){
    var settings=await findHudButton('AutonomySettings','/WBP_HUD_Autonomy/BW_Button_AutonomySettings');
    if(!settings)return character;
    await write('ui.click',{ref:settings,Force:true},token,null,id);
    opened=true;
    option=await findHudButton('Button_InteractionToggle','/WBP_Autonomy_OptionPanel/WBP_Autonomy_OptionListEntry/BW_ToggleSwitch/BW_Button_InteractionToggle');
   }
   if(!option)return character;
   var fresh=await cli('entity.reflect',{entity_id:id});
   if(personalAutonomy(fresh).value!==false)return fresh;
   await write('ui.click',{ref:option,Force:true},token,null,id);
   return await cli('entity.reflect',{entity_id:id});
  } finally {
   if(opened){
    var close=await findHudButton('Button_Close','/WBP_Autonomy_OptionPanel/BW_Button_Close');
    if(close)await write('ui.click',{ref:close,Force:true},token,null,id);
   }
  }
 }
 async function writable(token,entityId,popup,selectedId){
  if(!state.enabled||token!==epoch)return false;
  var h=await cli('household.get_members');
  if(state.scope!=='played'&&String(h.household_id)!==String(state.household)&&!awayHousehold(h,lastGame))return false;
  if(entityId&&!(h.members||[]).some(function(m){return String(m.entity_id)===String(entityId);})){
   if(state.scope!=='played')return false;
   var member=members.find(function(m){return String(m.entity_id)===String(entityId);});
   if(!member||!playedGroups.some(function(group){return String(group.household_id)===String(member.household_id);}))return false;
   var remote=await cli('household.get_members',{household_id:String(member.household_id)});
   if(String(remote.household_id)!==String(member.household_id)||!(remote.members||[]).some(function(m){return String(m.entity_id)===String(entityId);}))return false;
  }
  var sim=await cli('environment.get_simulation');
  var camera=await cli('camera.get_view');
  var game=await cli('game.get_state');
  if(!state.enabled||token!==epoch||game.phase!=='in_game'||game.loading||game.map_id!==lastGame.map_id||/build|custom/i.test(camera.camera_mode||''))return false;
  if(selectedId&&String(game.possessed_entity_id)!==String(selectedId))return false;
  var block=game.blocking||{};
  if(block.loading||block.coach_mark||block.cat_talk||block.level_sequence)return false;
  if(popup===':talk')return block.primary_kind==='modal_ui'&&!block.popup_count;
  if(popup===':call')return !block.popup_count;
  if(popup===':travel'){
   if(ObserverTravel.travelOverlay(block)){
    var current=(await cli('ui.get_blocking')).popups||[];
    return current.length===1&&current[0].popup_id==='None'&&!current[0].desc&&!(current[0].buttons||[]).length;
   }
   return !block.popup_count&&(!block.blocked||block.primary_kind==='modal_ui');
  }
  if(popup)return block.popup_count===1&&block.primary_detail===popup;
  return !sim.is_paused&&!(block.popup_count>0);
 }
 function awayHousehold(h,game){
  var trip=state.awayTravel;
  return trip&&game.map_id===trip.destination&&String(h.household_id)===trip.awayHousehold&&
   (h.members||[]).some(function(m){return String(m.entity_id)===trip.actor||m.last_name+' '+m.first_name===trip.actorName;});
 }
 async function write(name,args,token,popup,selectedId){
  var h=await capability(name);
  if(h.access!=='Public'&&extended.indexOf(name)<0)throw Error('등록되지 않은 명령: '+name);
  if(!await writable(token,args.entity_id||args.character_id,popup,selectedId))throw Error('상태 변경으로 자동 명령 보류');
  var result=await cli(name,args);
  // 0.4.7: keep the game's answer to recent action requests in the report, to see why an action did not start.
  if(name==='interaction.execute'){
   receiptSerial++;
   var id=String(args.entity_id||lastGame.possessed_entity_id);
   var decision=state.people[id]||(state.people[id]={});
   decision.lastAction={bag:args.interaction_bag_id,target:args.target_entity_id||null,at:Date.now(),
    minute:decision.lastMinute,status:'requested'};
   var trail=state.execTrail||(state.execTrail=[]);
   var text;try{text=JSON.stringify(result);}catch(_){text=String(result);}
   trail.push({at:new Date().toISOString(),bag:args.interaction_bag_id,target:args.target_entity_id||null,result:String(text).slice(0,240)});
   if(trail.length>12)trail.shift();
  }
  if(name==='career.join')receiptSerial++;
  return result;
 }
 function observeAction(decision,queue,minute){
  var action=decision.lastAction;
  if(!action||action.status==='ended')return;
  var observed=R.actionState(queue,action);
  if(observed==='playing'){
   action.status='started';action.note='실제 행동 시작 확인';
  }else if(action.status==='started'){
   action.status='ended';action.note='행동 종료 관찰 · 목표 결과는 별도 확인';
  }else if(observed==='queued'){
   action.status='queued';action.note='같은 행동과 대상이 대기열에 있음';
  }else if(observed!=='unknown'&&!R.awaitingStart(Date.now(),minute,action.at,action.minute)){
   action.status='unconfirmed';action.note='행동 시작 미확인';
  }
 }
 async function readQueue(id){
  var queue=await cli('interaction.get_queue',{entity_id:id});
  queue.entries=queue.queue_count>0?null:[];
  if(queue.queue_count>0){
   try{
    var ic=await cli('entity.reflect',{entity_id:id,Component:'Interaction'}), list=ic.interactionQueue;
    if(Array.isArray(list)){
     queue.entries=R.queueEntries(list,id);
     if(list.length&&!state.queueSample)state.queueSample=JSON.stringify(list[0]).slice(0,400);
    }
   }catch(_){}
  }
  queue.items=(queue.entries||[]).map(function(entry){return entry.bag;});
  queueSampleAt[id]=Date.now();
  return queue;
 }
 async function watchPending(game,token){
  var now=Date.now();
  if(!state.enabled||token!==epoch||now-lastPendingPoll<3000)return;
  if(state.scope!=='played'&&!members.some(function(m){return String(m.entity_id)===String(game.possessed_entity_id);}))return;
  var oldest=Infinity, member=null;
  members.forEach(function(m){
   var id=String(m.entity_id), decision=state.people[id], sampled=queueSampleAt[id]||0;
   if(!decision||sampled>=oldest||now-sampled<2500)return;
   var action=decision.lastAction;
   if(decision.goal||action&&action.status!=='ended'&&now-action.at<120000){oldest=sampled;member=m;}
  });
  if(!member)return;
  lastPendingPoll=now;
  var id=String(member.entity_id), decision=state.people[id];
  var minute=gameMinute(await cli('environment.get_time'));
  if(!Number.isFinite(minute)||decision.lastMinute>minute||!state.enabled||token!==epoch)return;
  var queue=await readQueue(id);
  if(!state.enabled||token!==epoch)return;
  observeAction(decision,queue,minute);
  if(snapshots[id]){
   snapshots[id].queue=queue;
   snapshots[id].queue_sampled_at=new Date().toISOString();
  }
  await life.reviewGoal(member,decision,{queue:queue},minute);
 }
 async function report(manual){
  var payload={score:Score.report(state),gameData:gameData.summary(),queueSample:state.queueSample||null,execTrail:state.execTrail||[],daily:state.daily||{},lastReturn:state.lastReturn||null,version:VERSION,created:new Date().toISOString(),enabled:state.enabled,scope:state.scope,background:state.background,household:state.household,status:status,game:lastGame,popup:blockedPopup,travel:state.travel,awayTravel:state.awayTravel,news:panels.latestNews(),members:members,snapshots:snapshots,decisions:state.people,capabilities:caps,logs:logs,last_cycle:lastCycle};
  await cli('uimod.cfg_save',{mod_id:wf.MOD_ID,section:'ui/'+wf.APP_NAME+'/saved',key:manual?'observer-report':'observer-auto',value:JSON.stringify(payload)});
  lastReport=Date.now();return payload;
 }
 async function answerPopup(token,game){
  var blocking=game.blocking||{};
  if(!blocking.popup_count){blockedPopup=null;lastPopup=null;return;}
  if(ObserverTravel.travelOverlay(blocking)){blockedPopup=null;return;}
  if(checkingPopup)return;
  checkingPopup=true;
  try {
   var current=await cli('ui.get_blocking');
   var popups=current.popups||[];
   blockedPopup=popups;
   if(!state.enabled||token!==epoch||popups.length!==1)return;
   var popup=popups[0], id=popup.popup_id, actor=String(game.possessed_entity_id);
   // 0.4.7: menu, save/load and quit dialogs belong to the player. In game the mod cancelled a quit request twice.
   if(/^(?:GameMenu_|Data(?:Saved|Loaded|Save|Load)|Save|Load|Quit|Exit|Option|Setting|Title|Lobby|System_)/i.test(String(id||'')))return;
   // Purchase confirmations belong to the flow that opened them (냥스토어 confirms its own; a player's purchase is the player's).
   if(/^(?:CatShopBuy|.*Buy$|.*Purchase.*)/i.test(String(id||'')))return;
   var member=members.find(function(m){return String(m.entity_id)===actor;});
   if(!member||id==='RabbitHole_Go'&&ChildCare.dependent(member))return;
   var key=String(id)+':'+popup.desc;
   if(lastPopup!==key){lastPopup=key;popupTries=0;nextPopupTry=0;}
   if(popupTries>=2||Date.now()<nextPopupTry)return;
   popupTries++;
   nextPopupTry=Date.now()+(id==='Choice_Card'?1200:15000);
   var s=snapshots[actor], unavailable=s&&(L.sleeping(s.queue,s.work)||L.urgentNeed(s.stats.stats)||s.work.is_working_time||s.work.is_at_work);
   if(id==='Choice_Card'){
    var card=await panels.choiceCard(actor,s,token);
    if(card){log('선택 카드 자동 판단 / '+card);}
    return;
   }
   var scheduleConfirm=id==='CancelOverrideTimeline'&&scheduleCancel&&Date.now()<scheduleCancel.until&&
    String(lastGame.possessed_entity_id)===scheduleCancel.actor;
   if(!popupRows[id]){
    try{popupRows[id]=await cli('data.table_get',{Alias:'Popup',Row:id});}
    catch(_){popupRows[id]={};}
   }
   var allowed=popupIds.slice();
   var row=popupRows[id];
   if(L.noticeAllowed(id)&&row.buttonDetail&&row.buttonDetail.length===1&&row.buttonDetail[0].scriptId==='None')allowed.push(id);
   if(scheduleConfirm)allowed.push(id);
   var button=id==='NoticeScheduleConflict'?(popup.buttons||[]).find(function(b){
    return b.dimmed===false&&/^(?:기존 일정 유지|유지하기|기존 일정 유지하기|Keep existing schedule)$/i.test(b.text||'');
   }):protocol.popupChoice(popup,row,allowed);
   var picked=!button&&C.popup(popup,row,{busy:!!unavailable});
   if(picked)button=picked.button;
   var replyArgs=protocol.popupArgs(popup,button);
   if(!replyArgs){if(popupTries===1)log('자동 응답 보류: '+id+' / 선택의 효과를 확인할 수 없음');return;}
   var confirm=await cli('ui.get_blocking');
   if(!(confirm.popups||[]).some(function(p){return p.popup_id===id&&p.desc===popup.desc&&
     (p.buttons||[]).some(function(b){return b.list_key===button.list_key&&b.index===button.index&&b.text===button.text&&b.dimmed===false;});}))return;
   await write('ui.click_popup_button',replyArgs,token,id,actor);
   var after=await cli('ui.get_blocking');
   blockedPopup=after.popups||[];
   if(blockedPopup.some(function(p){return p.popup_id===id&&p.desc===popup.desc;})){
    log('팝업 응답 결과 미확인: '+id);
   }else{
    log('팝업 자동 응답 확인: '+id+' / '+button.text+(picked?' · '+picked.why:''));
    if(scheduleConfirm)scheduleCancel=null;
    lastPopup=null;
   }
  }catch(e){log('팝업 처리 보류: '+e.message);}
  finally{checkingPopup=false;}
 }
 async function scheduleChoice(time,token){
  var actor=String(lastGame.possessed_entity_id);
  if(!state.enabled||token!==epoch||!(Number(actor)>0)||!(members||[]).some(function(m){return String(m.entity_id)===actor;}))return;
  var options=await cli('ui.find',{Name:'AcceptScheduleButton',Window:'Hud',Limit:10});
  var buttons=(Array.isArray(options)?options:[]).filter(function(b){
   return b.role==='button'&&/\/WBP_HUD_ScheduleControlBox(?:_\d+)?\/BW_AcceptScheduleButton$/.test(b.ref||'');
  });
  if(buttons.length!==1)return;
  var route=await cli('schedule.diagnose',{entity_id:actor});
  if(!route.has_schedule||route.is_located_dest||!(route.dest_target_entity_id>0))return;
  var routing=route.routing||'';
  var match=routing.match(/\bScheduleId:\s*(\d+)/);
  if(!match)return;
  var work=/bIsWorkingSchedule:\s*true/i.test(routing);
  var scheduledMember=members.find(function(m){return String(m.entity_id)===actor;});
  if(ChildCare.dependent(scheduledMember)||scheduledMember&&care.reserved(scheduledMember,members))return;
  var leisure=/TimelineName:\s*DefaultLeisureTimeline\b/.test(routing);
  var p=state.people[actor]||(state.people[actor]={});
  var minute=time.day*1440+time.hour*60+time.minute;
  if(p.scheduleChoice&&p.scheduleChoice.id===match[1]&&minute-p.scheduleChoice.minute<45)return;
  var queue=await cli('interaction.get_queue',{entity_id:actor});
  if(!L.relaxed(queue))return;
  var stats=await cli('stat.get_all',{entity_id:actor});
  var urgent=L.urgentNeed(stats.stats||{});
  if(urgent&&urgent.pct<15&&!leisure)return;
  var ref=buttons[0].ref, cancel=leisure&&urgent&&urgent.pct<20;
  if(cancel){
   var reject=await cli('ui.find',{Name:'RejectScheduleButton',Window:'Hud',Limit:10});
   var matching=(Array.isArray(reject)?reject:[]).find(function(b){
    return b.ref===ref.replace('/BW_AcceptScheduleButton','/BW_RejectScheduleButton');
   });
   if(!matching)return;
   ref=matching.ref;
  }
  var verified=await cli('schedule.diagnose',{entity_id:actor});
  if(!verified.has_schedule||verified.dest_target_entity_id!==route.dest_target_entity_id||verified.is_located_dest||
     !(verified.routing||'').match(new RegExp('\\bScheduleId:\\s*'+match[1]+'\\b')))return;
  p.scheduleChoice={id:match[1],minute:minute};
  if(cancel)scheduleCancel={actor:actor,until:Date.now()+45000};
  await write('ui.click',{ref:ref,Force:true},token,null,actor);
  log(cancel?'필수 욕구가 낮아 여가 일정 취소 요청':work?'근무 일정 이동 요청':'진행 중인 일정 이동 요청');
 }
 async function generateHopes(member,decision,minute,token,snapshot){
  var before=snapshot.hope.selected.length;
  var capacity=snapshot.hope.max_hope_size;
  if(!Number.isFinite(capacity)||before>=capacity||minute<(decision.nextHope||0))return;
  decision.nextHope=minute+120;
  var args={entity_id:String(member.entity_id)};
  try{
   await write('hope.force_update',args,token);
   snapshot.hope=await cli('hope.list',args);
   log(member.first_name+(snapshot.hope.selected_count>before?
    ': 소망 자동 생성 확인 ('+before+' → '+snapshot.hope.selected_count+'개)':': 소망 추가 없음. 2게임시간 뒤 다시 확인합니다.'));
  }catch(e){log(member.first_name+': 소망 생성 보류 - '+e.message);}
 }
 async function commute(member,decision,minute,token,snapshot){
  if(!ChildCare.workAge(member,L))return;
  var work=snapshot.work;
  if(work.is_at_work){
   if(decision.commutePending){log(member.first_name+': 직장 도착 확인');decision.commutePending=false;}
   return;
  }
  if(!work.has_job||!work.is_working_day||!(work.is_commute_time||work.is_working_time)||work.simulated===false)return;
  if(minute<(decision.nextCommute||0))return;
  if(snapshot.queue.current&&snapshot.queue.current.interaction_bag_id===decision.commuteBag)return;
  if(decision.commutePending&&snapshot.queue.queue_count>0)return;
  decision.nextCommute=minute+45;
  var id=String(member.entity_id);
  try{
   var career=await cli('entity.reflect',{entity_id:id,Component:'Career'});
   var slot=career.careerSlots&&career.careerSlots.business;
   if(!slot||!slot.careerDtId)return;
   var timeline=await cli('entity.reflect',{entity_id:id,Component:'Timeline'});
   var business=timeline.careerTimelineParams&&timeline.careerTimelineParams.business;
   var liveBag=business&&business.rabbitholeInteractionBagId;
   var bag=liveBag&&liveBag!=='None'?liveBag:protocol.commuteBag(await table(slot.careerDtId),slot);
   var args={entity_id:id,insert_front:true};
   if(bag){
    var rabbitHole=await cli('entity.reflect',{entity_id:id,Component:'RabbitHole'});
    if(rabbitHole.currentRabbitHoleId&&rabbitHole.currentRabbitHoleId!=='None'){
     if(decision.commutePending&&(rabbitHole.currentRabbitHoleInteractionId===bag||'Go_'+rabbitHole.currentRabbitHoleId===bag)){
      log(member.first_name+': 근무 일정 진입 확인');
      decision.commutePending=false;
     }
     return;
    }
    args.interaction_bag_id=bag;
   }else{
    if(!(work.work_site_id>0))return;
    var move=await cli('movement.get_site_move_interaction',{entity_id:id,target_entity_id:String(work.work_site_id)});
    if(!move.interaction_bag_id||Number(move.target_entity_id)!==Number(work.work_site_id)||move.requires_zoi_group)return;
    args.interaction_bag_id=move.interaction_bag_id;
    args.target_entity_id=String(move.target_entity_id);
   }
   if(snapshot.queue.current&&snapshot.queue.current.interaction_bag_id===args.interaction_bag_id)return;
   var latest=await cli('career.get_work_status',{entity_id:id});
   if(latest.is_at_work||latest.work_site_id!==work.work_site_id||!(latest.is_working_time||latest.is_commute_time))return;
   await write('interaction.execute',args,token);
   decision.commutePending=true;
   decision.commuteBag=args.interaction_bag_id;
   log(member.first_name+': 출근 행동 요청. 도착을 확인합니다.');
  }catch(e){log(member.first_name+': 출근 요청 보류 - '+e.message);}
 }
 function lifeBook(){return state.life||(state.life={pairs:{}});}
 async function nearbyTargets(member,character){
  if(String(lastGame.possessed_entity_id)===String(member.entity_id)){
   var selected=await cli('entity.get_possessed');
   if(String(selected.entity_id)!==String(member.entity_id))return [];
   var scan=await cli('entity.scan_characters',{Radius:30,Limit:16,ref:'pawn'});
   return (scan.characters||[]).filter(function(other){
    return other.entity_id!==member.entity_id&&other.distance<=30;
   }).sort(function(a,b){return a.distance-b.distance;}).slice(0,6);
  }
  var origin=character.worldTransform&&character.worldTransform.translation;
  if(!origin)return [];
  // Unselected Zois cannot scan around themselves: check the managed Zois at the same site and the
  // people they remember meeting before.
  var siblings=members.filter(function(other){
   return other.entity_id!==member.entity_id&&(other.household_id===member.household_id||state.scope==='played')&&other.current_site===member.current_site;
  });
  var remembered=Object.keys((lifeBook().contacts||{})[String(member.entity_id)]||{}).filter(function(id){
   return !siblings.some(function(s){return String(s.entity_id)===id;});
  }).slice(0,4).map(function(id){
   var c=lifeBook().contacts[String(member.entity_id)][id];
   return {entity_id:Number(id),first_name:c.name,remembered:true};
  });
  var candidates=[], pool=siblings.concat(remembered);
  for(var i=0;i<pool.length;i++){
   var other=pool[i], info;
   try{info=await cli('entity.reflect',{entity_id:String(other.entity_id)});}catch(_){continue;}
   var position=info.worldTransform&&info.worldTransform.translation;
   if(!position||info.locatedCityName!==character.locatedCityName||
      !info.locatedSiteId||!character.locatedSiteId||info.locatedSiteId.value!==character.locatedSiteId.value)continue;
   var meters=Math.hypot(origin.x-position.x,origin.y-position.y,origin.z-position.z)/100;
   if(meters<=30)candidates.push(Object.assign({},other,{distance:meters}));
  }
  return candidates.sort(function(a,b){return a.distance-b.distance;}).slice(0,6);
 }
 function conversationChoice(interactions,relationship,decision,targetId,minute){
  var stats=relationship.stats||{};
  var friends=stats.Friendship&&stats.Friendship.value||0;
  var family=stats.Family&&stats.Family.value||0;
  var bestFriends='Co_Friendship_Positive_FocusSelection_Up2step';
  var options=interactions.filter(function(action){
   if(action.enabled!==true)return false;
   var id=action.interaction_bag_id;
   if(id===bestFriends){
    var cooldown=(decision.friendProposals||{})[targetId];
    return friends>=70&&family<=0&&!(typeof cooldown==='number'&&minute<cooldown);
   }
   return [
    'Co_Career_SmallTalk','Co_Friendship_G08_2','Co_friendship_R02_2',
    'Co_Skill_Performance_01','Co_SLM_CheerUpTalk','Co_SLM_ComplimentTalk',
    'Co_Sharing_Preference','Co_friendship_R03_2'
   ].indexOf(id)>=0 || /^(인사하기|친근하게 인사하기|자기소개하기|Say Hello|Introduce Yourself)$/i.test(action.display_name||'');
  });
  return options.find(function(action){return action.interaction_bag_id===bestFriends;})||
   options.find(function(action){return action.interaction_bag_id!==decision.lastTalkBag;})||options[0];
 }
 async function talk(member,character,decision,minute,token,snapshot,onlyGoal){
  if(!onlyGoal&&minute<(decision.nextTalk||0)||snapshot.work.is_at_work||snapshot.work.is_working_time||snapshot.work.is_commute_time)return false;
  if(!L.goalReady(snapshot.queue,snapshot.work))return false;
  var stats=snapshot.stats.stats;
  if(['Hunger','Sleep','Toilet'].some(function(key){return stats[key]&&stats[key].pct<20;}))return false;
  var traits=P.traits(snapshot.trait);
  var outgoing=traits.indexOf('Extrovert')>=0||traits.indexOf('Entertainer')>=0;
  var wantsRelationship=snapshot.hope.selected.some(function(h){return /StartRomance|MakeFriends|Lover|Friendship|Marri|Date/i.test(h.hope_id);})||
   (decision.goalPlans||[]).some(function(p){return p.conditions.some(function(c){return /TalkInteractionBagTag|NewRelationshipCount|RelationshipCount|Marriage/.test(c.conditionType);});});
  var socialNeed=stats.Society&&stats.Society.pct<=(outgoing?75:60);
  if(!onlyGoal)decision.nextTalk=minute+(outgoing?75:120);
  var id=String(member.entity_id), book=lifeBook(), contacts=(book.contacts||{})[id]||{};
  try{
   var targets=await nearbyTargets(member,character);
   for(var i=0;i<targets.length;i++){
    var other=targets[i], targetId=String(other.entity_id), known=contacts[targetId];
    // Someone who reacted badly recently gets time; the Zoi looks for another person instead.
    if(known&&known.next&&minute<known.next.at&&/^(?:worse|rejected|sleeping)$/.test(known.outcome||''))continue;
    var simulated=await cli('entity.get_simulate_state',{entity_ids:id+','+targetId});
    if(!Array.isArray(simulated.results)||simulated.results.filter(function(x){return x.simulated===true;}).length!==2)continue;
    try{
     var theirQueue=await cli('interaction.get_queue',{entity_id:targetId});
     if(L.sleeping(theirQueue)){Rel.blocked(book,id,targetId,'sleeping',minute);continue;}
    }catch(_){}
    var available=await cli('interaction.list_available',{entity_id:id,target_entity_id:targetId});
    if(!Array.isArray(available.interactions))continue;
    var relationship=await cli('relationships.get_value_between',{owner_id:id,target_id:targetId});
    if(known&&known.pending)Rel.settle(book,id,targetId,relationship,minute,{notStarted:!known.pending.seen});
    var related=onlyGoal?await life.goalConversation(decision,available.interactions,other,minute,onlyGoal,relationship):null;
    if(onlyGoal&&!related)continue;
    if(related&&related.romance){
     var romance=await life.affection(member,other,decision,snapshot,available.interactions,relationship,minute,token,{goal:true});
     if(romance){
      life.trackGoal(decision,related.plan,romance.bag,targetId,minute,related.progress);
      decision.talkRequest={target:targetId,bag:romance.bag,at:minute};
      return true;
     }
     // Not ready for a romantic step yet: build the friendship that the next step needs.
     var warm=conversationChoice(available.interactions,relationship,decision,targetId,minute);
     if(!warm)continue;
     related={action:warm,plan:related.plan,progress:related.progress};
    }
    if(!related){
     var affectionate=Rel.ready(book,id,targetId,minute)||!known||known.outcome!=='low'?
      await life.affection(member,other,decision,snapshot,available.interactions,relationship,minute,token):false;
     if(affectionate){decision.talkRequest={target:targetId,bag:affectionate.bag,at:minute};return true;}
    }
    if(!related&&!wantsRelationship&&!socialNeed)continue;
    var choice=related?related.action:conversationChoice(available.interactions,relationship,decision,targetId,minute);
    if(!choice)continue;
    if(choice.interaction_bag_id==='Co_Friendship_Positive_FocusSelection_Up2step'){
     var reciprocal=await cli('relationships.get_value_between',{owner_id:targetId,target_id:id});
     if(!reciprocal.stats||!reciprocal.stats.Friendship||reciprocal.stats.Friendship.value<65)continue;
    }
    await write('interaction.execute',{entity_id:id,target_entity_id:targetId,interaction_bag_id:choice.interaction_bag_id},token);
    if(related)life.trackGoal(decision,related.plan,choice.interaction_bag_id,targetId,minute,related.progress);
    Rel.attempted(book,id,targetId,{name:other.first_name||other.name},relationship,choice.interaction_bag_id,'talk',minute);
    decision.talkRequest={target:targetId,bag:choice.interaction_bag_id,at:minute};
    decision.lastTalkBag=choice.interaction_bag_id;
    if(choice.interaction_bag_id==='Co_Friendship_Positive_FocusSelection_Up2step'){
     decision.friendProposals=decision.friendProposals||{};
     decision.friendProposals[targetId]=minute+720;
    }
    decision.lastTalk=(other.first_name||other.name||targetId)+' / '+(choice.display_name||choice.interaction_bag_id);
    log(member.first_name+'의 대화 요청: '+decision.lastTalk);
    return true;
   }
   // Nobody suitable around while lonely: go where people are.
   if(!onlyGoal&&!gathering.waiting(decision)&&stats.Society&&stats.Society.pct<=35)
    return await life.socialOuting(member,character,decision,snapshot,{hour:Math.floor(minute%1440/60)},minute,token);
  }catch(e){log(member.first_name+': 대화 요청 보류 - '+e.message);}
  return false;
 }
 async function inspect(m,time,token){
  var id=String(m.entity_id), args={entity_id:id}, p=state.people[id]||(state.people[id]={firstDay:time.day});
  var minute=time.day*1440+time.hour*60+time.minute;
  if(p.lastMinute>minute){
   resetTimers(p,0);
   p.lastCareerMinute=undefined;p.idleSince=undefined;p.commutePending=false;
   p.goal=null;p.outing=null;p.scheduleChoice=null;p.lastAction=null;p.furnitureRetries={};
  }
  p.lastMinute=minute;
  var character=await cli('entity.reflect',args);
  var auto=personalAutonomy(character);
  var sameCity=character.locatedCityName===lastGame.map_id;
  var dependent=ChildCare.dependent(m), ghost=ChildCare.ghost(character);
  if(state.enabled&&sameCity&&!dependent&&!ghost&&auto.value===false&&String(lastGame.possessed_entity_id)===id&&minute>=(p.nextAutonomy||0)){
   p.nextAutonomy=minute+120;
   try {
    character=await enablePersonal(id,character,token);
    auto=personalAutonomy(character);
    if(auto.value===true)log(m.first_name+': 자율 행동 개인 설정 켜짐 확인');
    else log(m.first_name+': 개인 설정 켜기 결과 미확인');
   }catch(e){log(m.first_name+': 자율 행동 설정 보류 - '+e.message);}
  }
  var stats=await cli('stat.get_all',args),queue=await readQueue(id);
  if(dependent||ghost){
   observeAction(p,queue,minute);
   var note=ghost?'유령 상태 · 생활 자동 명령 대기':m.has_career?'영유아 직업 기록 감지 · 자동 취업·출근 차단':'영유아 · 나이에 맞는 돌봄 관찰';
   p.goalBlock=null;
   p.commutePending=false;
   if(cache[id]!==note){cache[id]=note;log(m.first_name+': '+note);}
   snapshots[id]={sampled_at:new Date().toISOString(),stats:stats,queue:queue,hope:{selected_count:0,selected:[]},
    work:{},autonomy:auto,trait:{},note:note};
   if(!ghost&&state.enabled&&token===epoch&&sameCity)await care.run(m,members,minute,token,{character:character,stats:stats,queue:queue});
   return;
  }
  var hope=await cli('hope.list',args),work=await cli('career.get_work_status',args);
  observeAction(p,queue,minute);
  if(!stats.stats||!Array.isArray(hope.selected))throw Error('욕구 또는 소망 응답 형식 변경');
  if(!profiles[id]||profiles[id].day!==time.day||minute<profiles[id].minute||minute-profiles[id].minute>=60){
   profiles[id]={day:time.day,minute:minute,trait:await cli('entity.reflect',{entity_id:id,Component:'Trait'}),skills:await cli('skill.get_all',args)};
  }
  var profile=profiles[id],low=P.lowest(stats.stats), note='자율 행동 개인 설정 '+auto.label;
  if(auto.value===false&&String(lastGame.possessed_entity_id)!==id)note='꺼짐 상태. 이 조이를 선택하면 켜기를 시도합니다.';
  if(low&&stats.stats[low].pct<20)note=(stats.stat_names[low]||low)+' 부족: 자율 행동 해결 여부 관찰 중';
  // An empty pending queue can still have a currently playing action.
  var playing=queue.current&&queue.current.interaction_bag_id;
  var sleeping=L.sleeping(queue,work);
  p.goalBlock=sleeping?'수면 중':work.is_working_time||work.is_at_work||work.is_commute_time?'근무 또는 출근 중':
   !L.relaxed(queue)?'현재 행동이 끝나기를 기다리는 중':null;
  if(!playing&&queue.is_empty){if(p.idleSince===undefined)p.idleSince=minute;if(minute-p.idleSince>=120)note='2시간 이상 행동 없음: 길막힘/가구 배치 확인 필요';}else p.idleSince=undefined;
  // In game the Zoi went to work (career exp 106 → 111) while is_at_work stayed false on the way and in the work rabbit hole.
  if(work.is_working_day&&work.is_working_time&&!work.is_at_work)
   note=p.commutePending?'출근 요청 완료 · 직장 이동 또는 근무 중':'근무 시간에 직장 밖: 출근 여부 확인 필요';
  if(sleeping)note='수면 중 · 깨어난 뒤 미처리 행동 재평가';
  snapshots[id]={sampled_at:new Date().toISOString(),stats:stats,queue:queue,hope:hope,work:work,autonomy:auto,trait:profile.trait,note:note};
  if(cache[id]!==note){cache[id]=note;log(m.first_name+': '+note);}
  if(!state.enabled||token!==epoch||!sameCity)return;
  await keepScore(m,p,hope,stats,work,sleeping,minute);
  try{await vocation.review(m,p,minute);}catch(e){log(m.first_name+': 진로 확인 보류 / '+e.message);}
  try{await gathering.review(m,p,minute);}catch(e){log(m.first_name+': 초대 확인 보류 / '+e.message);}
  try{await life.reviewGoal(m,p,snapshots[id],minute);}
  catch(e){log(m.first_name+': 목표 결과 확인 보류 - '+e.message);}
  if(sleeping){p.wasSleeping=true;return;}
  if(p.wasSleeping){
   p.wasSleeping=false;
   p.nextNeed=p.nextHopeAction=p.nextAmbitionAction=p.nextTalk=p.nextCommute=p.nextRepair=p.nextParcel=p.nextPhoneAction=minute;
   log(m.first_name+': 기상 확인. 대기 중인 행동을 다시 확인합니다.');
  }
  if(ChildCare.workAge(m,L)){
   for(var child of members){
    if(!ChildCare.dependent(child)||String(child.household_id)!==String(m.household_id))continue;
    try{await care.run(child,members,minute,token);}
    catch(e){
     var careKey='care:'+child.entity_id;
     if(cache[careKey]!==e.message){cache[careKey]=e.message;log(child.first_name+': 돌봄 확인 보류 / '+e.message);}
    }
   }
   if(care.reserved(m,members))return;
  }
  try{if(await life.needs(m,character,p,snapshots[id],minute,token))return;}
  catch(e){log(m.first_name+': 필수 욕구 처리 보류 - '+e.message);}
  if(work.is_working_time||work.is_commute_time||work.is_at_work){
   await commute(m,p,minute,token,snapshots[id]);
   return;
  }
  async function attempt(label,run){
   var key=id+':'+label;
   try{var value=await run();delete cache[key];return value;}
   catch(e){
    if(cache[key]!==e.message){cache[key]=e.message;log(m.first_name+': '+label+' 보류 / '+e.message);}
    return A.result('failed',e.message,minute+20);
   }
  }
  if(p.talkRequest){
   var heard=queue.current&&String(queue.current.target_entity_id)===p.talkRequest.target&&queue.current.interaction_bag_id===p.talkRequest.bag;
   var contact=heard&&((lifeBook().contacts||{})[id]||{})[p.talkRequest.target];
   if(contact&&contact.pending)contact.pending.seen=true;
   if(heard||minute-p.talkRequest.at>60)p.talkRequest=null;
  }
  // Bookkeeping that never requests a game action by itself.
  await attempt('야망 단계',function(){return life.prepareAmbition(m,p,minute);});
  await attempt('소망 생성',function(){return generateHopes(m,p,minute,token,snapshots[id]);});
  await attempt('소망 조건',function(){return life.prepareGoals(m,p,minute,snapshots[id].hope.selected);});
  if(ChildCare.workAge(m,L)&&minute>=(p.nextPlanning||0)){
   p.nextPlanning=minute+90;
   await attempt('진로 판단',function(){return life.occupation(m,character,p,snapshots[id],profile.skills.skills||[],minute);});
   await attempt('주거 판단',function(){return life.householdPlan(m,character,p,p.lifePlan,minute);});
  }
  var plans=p.goalPlans||[];
  var deadlines=plans.map(function(plan){return plan.expire_ticks>0?plan.expire_ticks/600000000:NaN;}).filter(function(expiry){return expiry>minute;});
  var dueAt=deadlines.length?Math.min.apply(null,deadlines):NaN;
  var due=Number.isFinite(dueAt)&&dueAt-minute<=120;
  var checkIn=plans.some(function(g){return g.status==='실제 숙소 체크인 필요';});
  var handleTalk=function(plan,progress){return talk(m,character,p,minute,token,snapshots[id],{plan:plan,progress:progress});};
  var news=panels.latestNews();
  var eventEnd=news&&news.events&&news.events.length?Math.min.apply(null,news.events.map(function(e){return e.end;})):NaN;
  var needs=snapshots[id].stats.stats;
  var lowNeeds=['Hunger','Sleep','Toilet'].some(function(k){return needs[k]&&needs[k].pct<40;});
  var lonely=needs.Society&&needs.Society.pct<45;
  var skills=profile.skills.skills||[];
  var routine=L.routineNeed(needs);
  var urgent=['Toilet','Hunger','Sleep','Cleanliness'].some(function(k){return C.catDonut(k,needs[k]);});
  var step=p.careerPath&&p.careerPath.step;
  var tasks=[
   {key:'outingProgress',label:'외출 진행·귀가',base:95,duringGoal:true,eligible:!!p.outing,
    run:function(){return life.outing(m,character,p,snapshots[id],time,minute,token);}},
   {key:'phone',label:'휴대폰 확인·답장',base:45,duringGoal:true,bonus:(p.pendingReplies?15:0)+(p.phone&&p.phone.unread?5:0),
    run:function(){return attempt('휴대폰',function(){return panels.phone(m,p,snapshots[id],minute,token);});}},
   {key:'catShop',label:'냥스토어 긴급 도넛',base:90,duringGoal:true,eligible:urgent,
    run:function(){return attempt('냥스토어',function(){return panels.catShop(m,p,snapshots[id],minute,token);});}},
   {key:'home',label:'집 수리·청소 서비스',base:40,duringGoal:true,run:async function(){
    try{
     var marketNeed=await life.marketNeed(m,character,p,snapshots[id],minute);
     if(marketNeed&&marketNeed.kind==='clean'&&await panels.market(m,p,snapshots[id],minute,token,marketNeed))return true;
     if(await life.repair(m,character,p,snapshots[id],minute,token))return true;
     if(marketNeed&&marketNeed.kind!=='clean'&&await panels.market(m,p,snapshots[id],minute,token,marketNeed))return true;
    }catch(e){if(cache[id+':home']!==e.message){cache[id+':home']=e.message;log(m.first_name+': 집 관리 보류 / '+e.message);}}
    return false;
   }},
   {key:'preference',label:'취향 정리',base:5,duringGoal:true,
    run:function(){return attempt('취향',function(){return panels.preference(m,snapshots[id],skills,p,minute,token);});}},
   {key:'routine',label:'일상 욕구 관리',base:33,duringGoal:true,eligible:!!routine,
    run:function(){return attempt('일상 욕구',function(){return life.routine(m,character,p,snapshots[id],minute,token);});}},
   {key:'vacation',label:'휴가',base:25,long:true,eligible:(!due||checkIn)&&!p.goal&&!gathering.waiting(p),run:function(){
    return attempt('휴가',function(){
     return life.vacation(m,character,p,snapshots[id],time,minute,token,calendar&&calendar.seasonLength,
      function(){return travel.start(m,p,snapshots[id],time,token);});
    });
   }},
   {key:'hope',label:'소망 추구',base:50,eligible:plans.length>0,deadline:dueAt,why:due?'만료가 가까운 소망':null,
    run:function(){return attempt('소망',function(){return life.pursueHope(m,character,p,snapshots[id],time,minute,token,handleTalk);});}},
   {key:'ambition',label:'야망 단계',base:42,eligible:!!(p.ambition&&p.ambition.plans.length),
    run:function(){return attempt('야망',function(){return life.pursueAmbition(m,character,p,snapshots[id],time,minute,token,handleTalk);});}},
   {key:'parcels',label:'택배 개봉',base:30,duringGoal:true,run:function(){return attempt('택배',function(){return life.parcels(m,character,p,snapshots[id],minute,token);});}},
   {key:'furnish',label:'필요 물건 마련',base:20,long:true,bonus:p.housePlan&&p.housePlan.missing.length?35:0,
    run:function(){return attempt('가구',function(){return life.furnish(m,character,p,p.lifePlan,snapshots[id],skills,minute,token);});}},
   {key:'event',label:'소식함 행사',base:32,long:true,eligible:!!(p.outing&&p.outing.event||!gathering.waiting(p)&&news&&news.events&&news.events.length),deadline:eventEnd,
    run:function(){return attempt('행사',function(){return life.attend(m,character,p,snapshots[id],time,minute,token,news);});}},
   {key:'clean',label:'집 청소',base:30,duringGoal:true,run:function(){return attempt('청소',function(){return life.clean(m,character,p,snapshots[id],minute,token);});}},
   {key:'vocation',label:'진로 실행',base:36,eligible:ChildCare.workAge(m,L)&&!p.goal&&!p.outing&&!!step&&/^(?:resign|retire|start_business|run_business)$/.test(step)&&
     !(p.careerPath.pending)&&!work.is_working_time&&!work.is_commute_time&&!work.is_at_work,
    run:function(){return attempt('진로 실행',function(){
     if(step==='resign'||step==='retire')return vocation.leave(m,character,p,minute,token);
     if(step==='start_business')return vocation.start(m,character,p,minute,token);
     return vocation.run(m,character,p,p.lifePlan&&p.lifePlan.ownedBusiness,time,minute,token);
    });}},
   {key:'side',label:p.lifePlan&&p.lifePlan.short?'생활비 보충':'자유 작업',base:p.lifePlan&&p.lifePlan.short?55:30,eligible:!!(p.lifePlan&&(p.lifePlan.short||CP.worksAlone(p.careerPath))),
    run:function(){return attempt('부수입',function(){return life.sideIncome(m,character,p,p.lifePlan,snapshots[id],skills,minute,token);});}},
   {key:'outing',label:'여가 외출',base:15,long:true,eligible:!p.outing&&!gathering.waiting(p),
    run:function(){return attempt('외출',function(){return life.outing(m,character,p,snapshots[id],time,minute,token);});}},
   {key:'gather',label:'지인 초대·파티',base:26,bonus:lonely?25:0,eligible:!p.outing&&!p.goal&&ObserverGathering.due(p,time,minute),
    run:function(){return attempt('초대',function(){return gathering.host(m,character,p,snapshots[id],time,minute,token);});}},
   {key:'social',label:'대화·관계',base:28,bonus:needs.Society&&needs.Society.pct<25?40:lonely?20:0,run:function(){return talk(m,character,p,minute,token,snapshots[id]);}},
   {key:'career',label:'구직·이직',base:m.has_career?8:38,eligible:ChildCare.mayJoin(m,L),
    run:function(){return attempt('진로',function(){return career(m,p,time,minute,token,profile,work,queue);});}}
  ];
  // Each Zoi weighs free-time activities by temperament, ambition and a personal leaning of its own.
  p.persona=Persona.weights(P.traits(profile.trait),CP.ambitionFocus(p.ambition),id);
  Persona.apply(tasks,p.persona);
  var context={late:time.hour>=19,lowNeeds:lowNeeds};
  var ranked=A.order(p,tasks,minute,context);
  p.upcoming=ranked.slice(0,3).map(function(r){return r.task.label;});
  var turnStart=Date.now();
  await A.run(p,tasks,minute,context,{
   receipt:function(){return receiptSerial;},
   moved:function(){return (state.lastMoveAt||0)>=turnStart;},
   skip:function(task){
   return !state.enabled||token!==epoch||(!!p.goal&&!task.duringGoal);
  }});
  A.compact(p);
  daily(time,id,p);
 }
 // 0.5.3 scoreboard: dated facts per Zoi. Hope completion is taken from the game's mission record only.
 async function keepScore(m,p,hope,stats,work,sleeping,minute){
  var id=String(m.entity_id), day=Score.dayOf(minute);
  try{
   if(p.scoreDay!==undefined&&p.scoreDay!==day){
    var past=Score.line(state,p.scoreDay,id);
    if(past)log(m.first_name+': 지난 하루 성적 · '+past.replace(/^오늘 /,''));
   }
   p.scoreDay=day;
   Score.observe(state,minute,id,{stats:stats.stats,sleeping:sleeping,
    working:!!(work.is_at_work||work.is_working_time||work.is_commute_time)},Date.now());
   var names=hope.selected.map(function(h){return h.hope_id;});
   // The mission record is read only when the hope list changed, or hourly to catch a hope that
   // finished while still listed. This keeps the extra game calls small.
   if(Score.hopesChanged(state,id,names)||minute>=(p.nextScoreRead||0)||minute<(p.lastScoreRead||0)){
    p.nextScoreRead=minute+60;p.lastScoreRead=minute;
    var own=await cli('entity.reflect',{entity_id:id,Component:'Hope'}), missions=await cli('entity.reflect',{entity_id:id,Component:'Mission'});
    var selected=(own.selectedHopes||[]).map(function(h){
     var listed=hope.selected.find(function(x){return x.hope_id===h.hopeId;}), expiry=L.hopeDeadline(listed||h);
     var instance=h.missionId&&typeof h.missionId==='object'?h.missionId.value:h.missionId;
     return {name:h.hopeId,instance:instance>0?instance:null,expire:Number.isFinite(expiry)?expiry/600000000:null};
    });
    Score.hopes(state,minute,id,selected,missions.missionMap||null).forEach(function(x){
     log(m.first_name+(x.outcome==='completed'?': 소망 완료 집계 (게임 미션 확인) / ':
      x.outcome==='expired'?': 소망 기한 만료 / ':': 소망이 목록에서 빠짐 · 완료 기록 없음 / ')+x.name);
    });
   }
   Score.memory(state,minute,id,p);
  }catch(e){
   if(cache['score:'+id]!==e.message){cache['score:'+id]=e.message;log(m.first_name+': 성적표 기록 보류 - '+e.message);}
  }
 }
 function daily(time,id,p){
  var days=state.daily||(state.daily={}), key=String(time.day), today=days[key]||(days[key]={});
  var memory=p.goalMemory||{}, items=Object.keys(memory).map(function(k){return memory[k];});
  today[id]={
   completed:items.filter(function(x){return x.phase==='completed'&&Math.floor((x.lastSeen||0)/1440)===time.day;}).length,
   waiting:items.filter(function(x){return x.phase==='waiting'||x.phase==='unsupported';}).length,
   preparing:items.filter(function(x){return x.phase==='preparing';}).length,
   failures:items.reduce(function(n,x){return n+Object.keys(x.failures||{}).length;},0),
   starved:A.starved(p,gameMinute(time)).length,
   pendingReplies:p.pendingReplies||0,unread:p.phone&&p.phone.unread||0
  };
  Object.keys(days).map(Number).sort(function(a,b){return a-b;}).slice(0,-10).forEach(function(d){delete days[String(d)];});
 }
 async function career(m,p,time,minute,token,profile,work,queue){
  var id=String(m.entity_id);
  if(!L.relaxed(queue)||!state.enabled||token!==epoch)return false;
  if(!ChildCare.mayJoin(m,L))return false;
  if(work.is_working_time||work.is_commute_time||work.is_at_work)return false;
  if(p.lastCareerMinute!==undefined&&minute-p.lastCareerMinute<360)return false;
  p.lastCareerMinute=minute;
  var current=await cli('entity.reflect',{entity_id:id,Component:'Career'}), slot=current.careerSlots&&current.careerSlots.business;
  var key=slot&&slot.careerDtId;
  if(p.currentCareer!==key){p.currentCareer=key;p.careerSince=time.day;}
  var list=await cli('career.list_openings');if(!Array.isArray(list.openings))throw Error('구인 응답 형식 변경');
  var available=list.openings.filter(function(o){return o.vacancy>0&&(!slot||o.job_id!==slot.jobDtId);});
  p.openings=Array.from(new Set(list.openings.filter(function(o){return o.vacancy>0;}).map(function(o){return o.job_name||o.job_id;})));
  if(!CP.mayApply(p.careerPath,!!slot))return A.result('waiting','진로 계획: '+(CP.STEPS[p.careerPath.step]||p.careerPath.step),minute+360);
  if(p.lifePlan&&p.lifePlan.primary==='사업 우선')return A.result('waiting','현재 운영 중인 사업 수익 확인',minute+360);
  if(!available.length){p.target=null;return A.result('waiting','게임의 실제 채용 공석 없음',minute+360);}
  // Limit table fetches per evaluation to avoid flooding the game on large worlds.
  available=available.slice(0,60);
  for(var i=0;i<available.length;i++)await table(available[i].career_dt_id);
  available=available.filter(function(opening){
   var organization=(rows[opening.career_dt_id].organizations||[]).find(function(o){return o.jobId===opening.job_id;});
   return ObserverGameData.careerAgeAllowed(organization,m.age_group);
  });
  // The current ambition and this individual's own taste count toward which job fits.
  var taste=function(desired,careerId){var b=CP.ambitionBonus(desired,p.ambition);b.score+=Math.round(CP.quirk(id,careerId)*6);return b;};
  var best=P.pick(available,profile.trait,profile.skills.skills||[],rows,id,taste);
  if(!best){p.target=null;return A.result('waiting','현재 나이·조건에 맞는 채용 공석 없음',minute+360);}
  p.target={name:best.opening.job_name,id:best.opening.job_id,score:best.fit.score,reasons:best.fit.reasons};
  if(slot){
   var fit=P.score(profile.trait,profile.skills.skills||[],await table(key),key,taste);
   var days=time.day-(p.careerSince===undefined?time.day:p.careerSince);
   if(!P.shouldSwitch(profile.trait,days,fit,best))return false;
  }
  // Re-read availability and membership immediately before the write.
  var fresh=await cli('household.get_members',{household_id:String(m.household_id)});
  var member=(fresh.members||[]).filter(function(x){return String(x.entity_id)===id;})[0];
  if(!member||!ChildCare.mayJoin(member,L)||String(fresh.household_id)!==String(m.household_id)||member.has_career!==m.has_career)return false;
  var careerNow=await cli('entity.reflect',{entity_id:id,Component:'Career'}), slotNow=careerNow.careerSlots&&careerNow.careerSlots.business;
  if(!!slot!==!!slotNow||slot&&(slot.jobDtId!==slotNow.jobDtId||slot.careerDtId!==slotNow.careerDtId))return false;
  var latest=await cli('career.list_openings');
  if(!(latest.openings||[]).some(function(o){return o.job_id===best.opening.job_id&&o.career_entity_id===best.opening.career_entity_id&&o.vacancy>0;}))return false;
  log(m.first_name+': '+(slot?'이직':'취업')+' 선택 - '+best.opening.job_name+' ('+(best.fit.reasons.join(', ')||'현재 가능한 일자리')+')');
  await write('career.join',{entity_id:id,career_entity_id:String(best.opening.career_entity_id),job_id:best.opening.job_id},token);
  var after=await cli('entity.reflect',{entity_id:id,Component:'Career'}), next=after.careerSlots&&after.careerSlots.business;
  if(!next||next.jobDtId!==best.opening.job_id)throw Error('취업/이직 결과 미확인. 기존 직장을 별도로 그만두게 하지 않았습니다.');
  p.currentCareer=next.careerDtId;p.careerSince=time.day;
  log(m.first_name+': '+best.opening.job_name+' 변경 확인');
  return A.result('verified',best.opening.job_name+' 직업 반영');
 }
 function returned(trip,time){
  var minute=gameMinute(time);
  Object.keys(state.people).forEach(function(id){
   var p=state.people[id];
   resetTimers(p,minute);p.outing=null;p.goal=null;p.idleSince=undefined;p.commutePending=false;p.scheduleChoice=null;
  });
  var p=state.people[trip.actor];
  if(p)p.vacationNote='여행 귀환 확인 · 생활 재개';
  state.lastReturn={from:trip.destination,room:trip.room,minute:minute,checkIn:trip.checkIn||'unconfirmed'};
  state.awayTravel=null;
  log('여행 귀환 확인 · 미뤄 둔 생활 작업과 답장·납부를 다시 확인합니다.');
 }
 async function saveMirror(force){
  if(!force&&Date.now()-lastMirror<30000)return;
  lastMirror=Date.now();
  try{await cli('uimod.cfg_save',{mod_id:wf.MOD_ID,section:'ui/'+wf.APP_NAME+'/saved',key:'observer-resume',
   value:JSON.stringify(R.mirrorOf(state,Date.now(),mirrorStopped))});}catch(_){}
 }
 async function loadMirror(){
  try{
   var res=await cli('uimod.cfg_load',{mod_id:wf.MOD_ID,section:'ui/'+wf.APP_NAME+'/saved',key:'observer-resume'});
   var raw=res&&typeof res==='object'&&res.v===1?res:res&&typeof res==='object'&&res.value!=null?res.value:res;
   if(typeof raw==='string'){try{raw=JSON.parse(raw);}catch(_){return null;}}
   return raw&&raw.v===1?raw:null;
  }catch(_){return null;}
 }
 async function cycle(){
  if(busy||watching||Date.now()<pausedUntil)return;busy=true;var token=epoch;
  try{
   lastGame=await cli('game.get_state');
   // City transitions and loading screens are not errors; they must never stop the observer.
   if(lastGame.phase!=='in_game'||lastGame.loading){status='게임 로딩/생활 진입 대기';errors=0;firstError=0;return;}
   await gameData.catalog();
   var time=await cli('environment.get_time');
   if(state.enabled&&state.travel){
    try{
     if(await travel.advance(lastGame,time,token)){
      status=state.people[state.travel&&state.travel.actor]&&state.people[state.travel.actor].vacationNote||'도시 여행 진행 중';
      if(Date.now()-lastReport>60000)await report();
      return;
     }
    }catch(e){
     if(cache.travel!==e.message){cache.travel=e.message;log('도시 여행 단계 확인 중 / '+e.message);}
     return;
    }
   }
   var household=await cli('household.get_members');
   if(!Array.isArray(household.members))throw Error('가구 응답 형식 변경');
   if(pendingResume){
    pendingResume=false;
    var mirror=await loadMirror(), resume=R.resumeDecision(state,mirror,household,lastGame,Date.now());
    if(resume){
     var merged=R.mergeProcessed(state,mirror,{minute:gameMinute(time),continuous:!!(resume.returning||resume.awayTravel)});
     if(merged)log('이전 진행에서 처리한 납부·답장 기록 '+merged+'건 복원 · 중복 처리 방지');
     if(resume.awayTravel&&!state.awayTravel)state.awayTravel=resume.awayTravel;
     if(resume.returning&&!state.awayTravel)state.awayTravel=mirror.awayTravel;
     if(resume.enable){
      state.enabled=true;state.scope=resume.scope;state.household=resume.household;state.background=mirror.background!==false;
      rosterAt=0;epoch++;token=epoch;errors=0;mirrorStopped=false;
      log('자동 관리 재개 · '+resume.reason+' · Stop을 누르면 중지합니다.');
     }
    }
   }
   if(state.awayTravel&&lastGame.map_id===state.awayTravel.origin)returned(state.awayTravel,time);
   var traveling=awayHousehold(household,lastGame);
   if(state.enabled&&traveling)await travel.observeStay(state.awayTravel,time.day*1440+time.hour*60+time.minute);
   if(state.enabled&&state.scope!=='played'&&!traveling&&String(household.household_id)!==String(state.household)){
    status='관리 대상과 다른 가구입니다. 현재 가구를 관리하려면 Start를 눌러 주세요.';
    lastCycle=Date.now();
    if(Date.now()-lastReport>60000)await report();
    return;
   }
   members=await roster(household,lastGame.map_id);
   await answerPopup(token,lastGame);
   var sim=await cli('environment.get_simulation');
   if(sim.is_paused){
    status=blockedPopup&&blockedPopup.length?'팝업 대기: '+(blockedPopup[0].popup_id||'이름 없음'):'게임 일시정지 중';
    if(Date.now()-lastReport>60000)await report();
    return;
   }
   if(state.enabled&&(!calendar||calendar.day!==time.day||calendar.city!==lastGame.map_id)){
    try{
     var calendarState=await cli('environment.get_state');
     if(calendarState.day===time.day&&Number.isInteger(calendarState.season_length)){
      calendar={day:time.day,city:lastGame.map_id,seasonLength:calendarState.season_length};
     }
    }catch(_){}
   }
   try{if(await panels.restorePhoneActor(token))lastGame=await cli('game.get_state');}
   catch(e){if(cache.phoneReturn!==e.message){cache.phoneReturn=e.message;log('휴대폰 처리 후 원래 조이 복귀 대기');}}
   try{await scheduleChoice(time,token);}
   catch(e){if(cache.schedule!==e.message){cache.schedule=e.message;log('일정 판단 보류 - '+e.message);}}
   var familyCount=new Set(members.map(function(m){return m.household_id;})).size;
   status=(state.scope==='played'?'플레이한 '+familyCount+'가구':(household.name||'현재')+' 가구')+' / '+members.length+'명 / '+time.day+'일 '+time.hour+':'+('0'+time.minute).slice(-2);
   if(members.length){
    try{await panels.readNews(time,token);}catch(e){if(cache.news!==e.message){cache.news=e.message;log('소식함 읽기 보류 / '+e.message);}}
    var member=members[(index++)%members.length];
    try{await inspect(member,time,token);}
    catch(e){log(member.first_name+': 관찰 보류 - '+e.message);}
   }
   errors=0;firstError=0;lastCycle=Date.now();
   if(Date.now()-lastReport>60000)await report();
   await saveMirror();
  }catch(e){
   status=String(e.message||e);log(status);
   if(!firstError)firstError=Date.now();
   errors++;
   // Back off instead of switching off: travel returns and reloads often fail a few calls.
   pausedUntil=Date.now()+Math.min(300000,10000*Math.pow(2,Math.min(errors,5)));
   if(errors>=8&&Date.now()-firstError>600000){
    state.enabled=false;epoch++;mirrorStopped=false;
    log('10분 이상 반복 오류로 자동 관리를 중지했습니다. Report를 저장해 주세요.');
    saveMirror(true);
   }else if(errors>=3)log('일시적인 오류 반복 · '+Math.round((pausedUntil-Date.now())/1000)+'초 뒤 다시 확인합니다.');
  }
  finally{busy=false;render();}
 }
 async function watchChoice(){
  if(!state.enabled||busy||checkingPopup||watching||!lastGame||lastGame.phase!=='in_game')return;
  watching=true;
  var token=epoch;
  try{
   var game=await cli('game.get_state');
   if(game.phase!=='in_game'||game.loading||game.map_id!==lastGame.map_id)return;
   if(state.travel&&state.travel.stage!=='unconfirmed'){
    if(!busy){
     busy=true;
     try{await travel.advance(game,await cli('environment.get_time'),token);}
     catch(e){if(cache.travel!==e.message){cache.travel=e.message;log('도시 여행 단계 확인 중 / '+e.message);}}
     finally{busy=false;}
    }
    return;
   }
   if(game.blocking&&game.blocking.popup_count)await answerPopup(token,game);
   else if(members.some(function(m){return String(m.entity_id)===String(game.possessed_entity_id);})){
    var answered=await panels.answerCall(game.possessed_entity_id,token);
    if(!answered&&!busy&&game.blocking&&game.blocking.primary_kind==='modal_ui')await panels.relationshipChoice(game.possessed_entity_id,token);
   }
   await watchPending(game,token);
  }catch(_){}
  finally{watching=false;}
 }
 async function start(scope){
  if(busy){status='현재 확인이 끝난 뒤 Start를 눌러 주세요.';render();return;}
  busy=true;
  try{
   var h=await cli('household.get_members');if(!h.household_id||!h.members.length)throw Error('플레이할 가구를 먼저 불러오세요.');
   if(state.enabled&&state.scope===scope&&(scope==='played'||String(state.household)===String(h.household_id)))return;
   state.scope=scope;state.household=h.household_id;state.enabled=true;rosterAt=0;epoch++;errors=0;pausedUntil=0;
   mirrorStopped=false;pendingResume=false;saveMirror(true);
   log(scope==='played'?'플레이한 가구 전체 관리 시작':'자동 관리 시작: '+h.name);
  }catch(e){log(e.message);}finally{busy=false;cycle();}
 }
 document.getElementById('start').onclick=function(){return start('current');};
 document.getElementById('played').onclick=function(){return start('played');};
 document.getElementById('background').onclick=function(){
  state.background=!state.background;
  Object.keys(state.people).forEach(function(id){
   var p=state.people[id];
   p.nextTaste=p.nextPhoneAction=p.nextMarket=0;
  });
  log(state.background?'다른 작업 모드 켜짐. 게임 내부 동작으로 처리합니다.':'다른 작업 모드 꺼짐. 대기 중인 화면 작업을 다시 확인합니다.');
  if(state.enabled)saveMirror(true);
 };
 document.getElementById('stop').onclick=function(){
  mirrorStopped=true;pendingResume=false;
  if(state.enabled){state.enabled=false;epoch++;log('자동 명령 중지.');}
  saveMirror(true);
 };
 document.getElementById('report').onclick=function(){report(true).then(function(){log('수동 진단 저장 완료: saved/observer-report.cfg');}).catch(function(e){log('진단 저장 실패: '+e.message);});};
 window._onStateLoaded=function(){
  epoch++;init();profiles={};snapshots={};cache={};index=0;calendar=null;lastGame=null;rosterAt=0;
  members=[];playedGroups=[];rosterMap='';
  lastPendingPoll=0;queueSampleAt={};
  lastPopup=null;blockedPopup=null;popupTries=0;nextPopupTry=0;scheduleCancel=null;
  life.reset();panels.reset();care.reset();gathering.reset();vocation.reset();
  pendingResume=true;pausedUntil=0;errors=0;firstError=0;
  log('저장된 관찰 설정을 불러왔습니다. 목표와 현재 게임 상태를 다시 확인합니다.');
 };
 log(VERSION+' 준비. 다른 작업 모드와 행동 결과를 확인합니다.');
 render();
 // 0.4.7: a running copy can be stopped so new script files load in place (live update, no save/load).
 var loopTimers=[setInterval(cycle,10000),setInterval(watchChoice,1500)], firstCycle=setTimeout(cycle,2500);
 window.ZoiObserverShutdown=function(){
  loopTimers.forEach(clearInterval);clearTimeout(firstCycle);epoch++;
  log('새 버전 코드로 교체합니다. 자동 관리 상태는 그대로 이어집니다.');
 };
})();
