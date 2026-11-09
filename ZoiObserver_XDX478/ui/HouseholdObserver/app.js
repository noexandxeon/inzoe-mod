(function () {
 'use strict';
 var VERSION='0.4.3', P=ObserverPolicy, L=ObserverLife, C=ObserverChoices, protocol=ObserverProtocol, state=wf.state;
 var busy=false, epoch=0, index=0, cache={}, profiles={}, rows={}, logs=[], members=[], lastReport=0;
 var status='Start를 누르면 현재 가구를 자동 관리합니다.', errors=0, lastGame=null;
 var caps={}, snapshots={}, lastCycle=0, popupRows={}, lastPopup=null, blockedPopup=null;
 var popupTries=0, nextPopupTry=0, checkingPopup=false, watching=false, calendar=null;
 var playedGroups=[], rosterAt=0, rosterMap='';
 var scheduleCancel=null;
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
 var life=ObserverLifeActions.create({cli:cli,write:write,log:log,state:state,
  game:function(){return lastGame;},members:function(){return members;},snapshot:function(id){return snapshots[id];},
  active:function(token){return state.enabled&&token===epoch;}});
 var panels=ObserverPanels.create({cli:cli,write:write,log:log,state:state,game:function(){return lastGame;},
  background:function(){return state.background;},
  active:function(token){return state.enabled&&token===epoch;}});
 var travel=ObserverTravel.create({cli:cli,write:write,log:log,state:state,game:function(){return lastGame;},
  active:function(token){return state.enabled&&token===epoch;}},L,P);
 wf.content.innerHTML='<div class="summary"><b>가구 관찰 실험판 '+VERSION+'</b><p id="status"></p></div>'+
  '<div class="buttons"><button id="start">Start</button><button id="played">Played</button><button id="stop">Stop</button><button id="report">Report</button></div>'+
  '<p class="help">Start: 현재 가구 / Played: 플레이한 가구들 / Stop: 중지 / Report: 진단 저장</p>'+
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
  var toggle=document.getElementById('background');
  toggle.textContent='다른 작업 모드 '+(state.background?'켜짐':'꺼짐');
  toggle.setAttribute('aria-pressed',String(state.background));
  document.getElementById('mode-note').textContent=state.background?'마우스 입력이 필요한 작업은 대기':'게임 화면 입력 허용';
  document.getElementById('people').innerHTML=members.map(function(m){
   var id=String(m.entity_id), s=snapshots[id], p=state.people[id]||{};
   var html='<div class="person"><b>'+esc(m.last_name+' '+m.first_name)+'</b><span> '+esc(m.job_name||'무직')+'</span>';
   if(state.scope==='played')html+='<p>가구: '+esc(m.observer_household_name||m.household_id)+'</p>';
   if(s){
    html+='<p>기질: '+esc(P.traits(s.trait||{}).join(', ')||'읽는 중')+'</p>';
    html+='<p>자율 행동 설정: '+esc(s.autonomy.label)+' / 소망 '+s.hope.selected_count+'개</p>';
    ['Hunger','Cleanliness','Sleep','Toilet','Fun','Society'].forEach(function(k){var n=s.stats.stats[k];if(n)html+='<span class="need'+(n.pct<20?' urgent':'')+'">'+esc(s.stats.stat_names[k]||k)+' '+Math.round(n.pct)+'%</span>';});
    html+='<p>행동: '+esc(s.queue.current&&s.queue.current.interaction_bag_id||'대기')+'</p>';
    html+='<p>상태: '+esc(s.note||'관찰 중')+'</p>';
   }
   if(p.lastTalk)html+='<p>최근 대화 요청: '+esc(p.lastTalk)+'</p>';
   if(p.goal)html+='<p>추구 중인 '+(p.goal.kind==='ambition'?'야망':'소망')+': '+esc(p.goal.name)+'</p>';
   if(p.goalBlock)html+='<p>소망·야망 대기 · '+esc(p.goalBlock)+'</p>';
   if(p.repairStatus)html+='<p>집 수리 · '+esc(p.repairStatus)+'</p>';
   if(p.marketStatus)html+='<p>포켓마켓 · '+esc(p.marketStatus)+'</p>';
   if(p.goalPlans&&p.goalPlans.length)html+='<p>소망 (만료가 가까운 순)</p>'+p.goalPlans.map(function(g,i){
    return '<p>'+String(i+1)+'. '+esc(g.name)+' · '+esc(g.status)+'</p>';
   }).join('');
   if(p.ambition)html+='<p>야망 '+esc(p.ambition.name)+' · '+p.ambition.step+'단계</p>'+
    p.ambition.plans.map(function(g){return '<p>'+esc(g.label||g.name)+' · '+esc(g.status)+'</p>';}).join('');
   if(p.outing)html+='<p>외출: '+esc(p.outing.name)+(p.outing.returning?' (귀가 중)':p.outing.arrived?' (도착)':' (이동 중)')+'</p>';
   if(p.vacation)html+='<p>휴가 '+p.vacation.trips.length+'회 · 다음 '+(p.vacation.next===null?'다음 게임 연도':p.vacation.next+'일부터')+
    (p.vacationNote?' · '+esc(p.vacationNote):'')+'</p>';
   if(p.target)html+='<p>구인 후보: '+esc(p.target.name)+' / 적합도 '+esc(p.target.score)+'</p>';
   if(p.openings)html+='<p>현재 빈자리 '+p.openings.length+'종: '+esc(p.openings.slice(0,4).join(', ')||'없음')+'</p>';
   if(p.lifePlan){
    var plan=p.lifePlan;
    html+='<p>진로 판단: '+esc(plan.primary)+'</p>';
    if(plan.side)html+='<p>부수입 후보: '+esc(plan.side.label)+'</p>';
    if(plan.business)html+='<p>사업 적합: '+esc(plan.business.type)+' ('+plan.business.score+'점)</p>';
    if(plan.ownedBusiness)html+='<p>보유 사업: '+(plan.ownedBusiness.operating?'영업 중':'영업 대기')+'</p>';
   }
   if(p.housePlan){
    if(p.housePlan.missing.length)html+='<p>필요 가구: '+esc(p.housePlan.missing.map(function(x){return x.label+' '+x.price;}).join(', '))+'</p>';
    if(p.housePlan.cramped)html+='<p>이사 판단: '+esc(p.housePlan.move?p.housePlan.move.name:'조건에 맞는 주택 없음')+'</p>';
    if(p.housePlan.adoption)html+='<p>가족 계획: '+esc(p.housePlan.adoption)+'</p>';
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
 async function table(id){if(!rows[id])rows[id]=await cli('data.table_get',{Alias:'Career',Row:id});return rows[id];}
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
  return cli(name,args);
 }
 async function report(manual){
  var payload={version:VERSION,created:new Date().toISOString(),enabled:state.enabled,scope:state.scope,background:state.background,household:state.household,status:status,game:lastGame,popup:blockedPopup,travel:state.travel,news:panels.latestNews(),members:members,snapshots:snapshots,decisions:state.people,capabilities:caps,logs:logs,last_cycle:lastCycle};
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
   if(!members.some(function(m){return String(m.entity_id)===actor;}))return;
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
 async function nearbyTargets(member,character){
  if(String(lastGame.possessed_entity_id)===String(member.entity_id)){
   var selected=await cli('entity.get_possessed');
   if(String(selected.entity_id)!==String(member.entity_id))return [];
   var scan=await cli('entity.scan_characters',{Radius:18,Limit:12,ref:'pawn'});
   return (scan.characters||[]).filter(function(other){
    return other.entity_id!==member.entity_id&&other.distance<=18;
   }).slice(0,3);
  }
  var origin=character.worldTransform&&character.worldTransform.translation;
  if(!origin)return [];
  var siblings=members.filter(function(other){
   return other.entity_id!==member.entity_id&&other.household_id===member.household_id&&other.current_site===member.current_site;
  });
  var candidates=[];
  for(var i=0;i<siblings.length;i++){
   var other=siblings[i];
   var info=await cli('entity.reflect',{entity_id:String(other.entity_id)});
   var position=info.worldTransform&&info.worldTransform.translation;
   if(!position||info.locatedCityName!==character.locatedCityName||
      !info.locatedSiteId||!character.locatedSiteId||info.locatedSiteId.value!==character.locatedSiteId.value)continue;
   var meters=Math.hypot(origin.x-position.x,origin.y-position.y,origin.z-position.z)/100;
   if(meters<=18)candidates.push(Object.assign({},other,{distance:meters}));
  }
  return candidates.sort(function(a,b){return a.distance-b.distance;}).slice(0,3);
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
  if(!L.relaxed(snapshot.queue))return;
  var stats=snapshot.stats.stats;
  if(['Hunger','Sleep','Toilet'].some(function(key){return stats[key]&&stats[key].pct<20;}))return;
  var traits=P.traits(snapshot.trait);
  var outgoing=traits.indexOf('Extrovert')>=0||traits.indexOf('Entertainer')>=0;
  var wantsRelationship=snapshot.hope.selected.some(function(h){return /StartRomance|MakeFriends|Lover|Friendship/i.test(h.hope_id);})||
   (decision.goalPlans||[]).some(function(p){return p.conditions.some(function(c){return /TalkInteractionBagTag|NewRelationshipCount|RelationshipCount/.test(c.conditionType);});});
  var socialNeed=stats.Society&&stats.Society.pct<=(outgoing?75:60);
  if(!onlyGoal)decision.nextTalk=minute+(outgoing?75:120);
  var id=String(member.entity_id);
  try{
   var targets=await nearbyTargets(member,character);
   for(var i=0;i<targets.length;i++){
    var other=targets[i], targetId=String(other.entity_id);
    var simulated=await cli('entity.get_simulate_state',{entity_ids:id+','+targetId});
    if(!Array.isArray(simulated.results)||simulated.results.filter(function(x){return x.simulated===true;}).length!==2)continue;
    var available=await cli('interaction.list_available',{entity_id:id,target_entity_id:targetId});
    if(!Array.isArray(available.interactions))continue;
    var relationship=await cli('relationships.get_value_between',{owner_id:id,target_id:targetId});
    var related=onlyGoal?await life.goalConversation(decision,available.interactions,other,minute,onlyGoal):null;
    if(onlyGoal&&!related)continue;
    if(!related&&await life.affection(member,other,decision,snapshot,available.interactions,relationship,minute,token))return;
    if(!related&&!wantsRelationship&&!socialNeed)continue;
    var choice=related?related.action:conversationChoice(available.interactions,relationship,decision,targetId,minute);
    if(!choice)continue;
    if(choice.interaction_bag_id==='Co_Friendship_Positive_FocusSelection_Up2step'){
     var reciprocal=await cli('relationships.get_value_between',{owner_id:targetId,target_id:id});
     if(!reciprocal.stats||!reciprocal.stats.Friendship||reciprocal.stats.Friendship.value<65)continue;
    }
    await write('interaction.execute',{entity_id:id,target_entity_id:targetId,interaction_bag_id:choice.interaction_bag_id},token);
    if(related)life.trackGoal(decision,related.plan,choice.interaction_bag_id,targetId,minute,related.progress);
    decision.lastTalkBag=choice.interaction_bag_id;
    if(choice.interaction_bag_id==='Co_Friendship_Positive_FocusSelection_Up2step'){
     decision.friendProposals=decision.friendProposals||{};
     decision.friendProposals[targetId]=minute+720;
    }
    decision.lastTalk=other.first_name+' / '+(choice.display_name||choice.interaction_bag_id);
    log(member.first_name+'의 대화 요청: '+decision.lastTalk);
    return true;
   }
  }catch(e){log(member.first_name+': 대화 요청 보류 - '+e.message);}
  return false;
 }
 async function inspect(m,time,token){
  var id=String(m.entity_id), args={entity_id:id}, p=state.people[id]||(state.people[id]={firstDay:time.day});
  var minute=time.day*1440+time.hour*60+time.minute;
  if(p.lastMinute>minute){
   ['nextAutonomy','nextHope','nextCommute','nextTalk','nextPlanning','nextNeed','nextCleaning','nextRepair',
    'nextHopeAction','nextSide','nextOuting','nextHousePlan','nextFurnish','nextPhone','nextPhoneAction',
    'nextTaste','nextParcel','nextMarket','nextCatShop','nextAmbition','nextAmbitionAction','nextVacation','nextGoalFurnish','ambitionTurn'].forEach(function(key){p[key]=0;});
   p.lastCareerMinute=undefined;p.idleSince=undefined;p.commutePending=false;
   p.goal=null;p.outing=null;p.scheduleChoice=null;
  }
  p.lastMinute=minute;
  var character=await cli('entity.reflect',args);
  var auto=personalAutonomy(character);
  var sameCity=character.locatedCityName===lastGame.map_id;
  if(state.enabled&&sameCity&&auto.value===false&&String(lastGame.possessed_entity_id)===id&&minute>=(p.nextAutonomy||0)){
   p.nextAutonomy=minute+120;
   try {
    character=await enablePersonal(id,character,token);
    auto=personalAutonomy(character);
    if(auto.value===true)log(m.first_name+': 자율 행동 개인 설정 켜짐 확인');
    else log(m.first_name+': 개인 설정 켜기 결과 미확인');
   }catch(e){log(m.first_name+': 자율 행동 설정 보류 - '+e.message);}
  }
  var stats=await cli('stat.get_all',args),queue=await cli('interaction.get_queue',args),hope=await cli('hope.list',args),work=await cli('career.get_work_status',args);
  if(!stats.stats||!Array.isArray(hope.selected))throw Error('욕구 또는 소망 응답 형식 변경');
  if(!profiles[id]||profiles[id].day!==time.day){
   profiles[id]={day:time.day,trait:await cli('entity.reflect',{entity_id:id,Component:'Trait'}),skills:await cli('skill.get_all',args)};
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
  if(work.is_working_day&&work.is_working_time&&!work.is_at_work)note='근무 시간에 직장 밖: 출근 여부 확인 필요';
  if(sleeping)note='수면 중 · 깨어난 뒤 미처리 행동 재평가';
  snapshots[id]={sampled_at:new Date().toISOString(),stats:stats,queue:queue,hope:hope,work:work,autonomy:auto,trait:profile.trait,note:note};
  if(cache[id]!==note){cache[id]=note;log(m.first_name+': '+note);}
  if(!state.enabled||token!==epoch||!sameCity)return;
  if(sleeping){p.wasSleeping=true;return;}
  if(p.wasSleeping){
   p.wasSleeping=false;
   p.nextNeed=p.nextHopeAction=p.nextTalk=p.nextCommute=p.nextRepair=p.nextParcel=p.nextPhoneAction=minute;
   log(m.first_name+': 기상 확인. 대기 중인 행동을 다시 확인합니다.');
  }
  try{
   await life.reviewGoal(m,p,snapshots[id],minute);
   if(await life.needs(m,character,p,snapshots[id],minute,token))return;
  }catch(e){log(m.first_name+': 생활 판단 보류 - '+e.message);}
  if(work.is_working_time||work.is_commute_time||work.is_at_work){
   await commute(m,p,minute,token,snapshots[id]);
   return;
  }
  if(await attempt('휴대폰',function(){return panels.phone(m,p,snapshots[id],minute,token);}))return;
  if(await attempt('냥스토어',function(){return panels.catShop(m,p,snapshots[id],minute,token);}))return;
  async function attempt(label,run){
   var key=id+':'+label;
   try{var value=await run();delete cache[key];return value;}
   catch(e){if(cache[key]!==e.message){cache[key]=e.message;log(m.first_name+': '+label+' 보류 / '+e.message);}}
  }
  try{
   var marketNeed=await life.marketNeed(m,character,p,snapshots[id],minute);
   if(marketNeed&&marketNeed.kind==='clean'&&await panels.market(m,p,snapshots[id],minute,token,marketNeed))return;
   if(await life.repair(m,character,p,snapshots[id],minute,token))return;
   if(marketNeed&&marketNeed.kind!=='clean'&&await panels.market(m,p,snapshots[id],minute,token,marketNeed))return;
  }catch(e){if(cache[id+':home']!==e.message){cache[id+':home']=e.message;log(m.first_name+': 집 관리 보류 / '+e.message);}}
  await attempt('취향',function(){return panels.preference(m,snapshots[id],profile.skills.skills||[],p,minute,token);});
  await attempt('야망 단계',function(){return life.prepareAmbition(m,p,minute);});
  await attempt('소망 생성',function(){return generateHopes(m,p,minute,token,snapshots[id]);});
  await attempt('소망 조건',function(){return life.prepareGoals(m,p,minute,snapshots[id].hope.selected);});
  try{
   if(p.outing&&await life.outing(m,character,p,snapshots[id],time,minute,token))return;
   var due=(p.goalPlans||[]).some(function(plan){return plan.expire_ticks>0&&plan.expire_ticks/600000000-minute<=120;});
   var handleTalk=function(plan,progress){
    return talk(m,character,p,minute,token,snapshots[id],{plan:plan,progress:progress});
   };
   var ambitionTurn=!due&&!p.goal&&p.ambition&&L.relaxed(queue)&&minute>=(p.ambitionTurn||0);
   var checkIn=(p.goalPlans||[]).some(function(g){return g.status==='실제 숙소 체크인 필요';});
   if((!due||checkIn)&&!p.goal&&await attempt('휴가',function(){
    return life.vacation(m,character,p,snapshots[id],time,minute,token,calendar&&calendar.seasonLength,
     function(){return travel.start(m,p,snapshots[id],time,token);});
   }))return;
   if(ambitionTurn){
    p.ambitionTurn=minute+90;
    if(await life.pursueAmbition(m,character,p,snapshots[id],time,minute,token,handleTalk))return;
   }
   if(await life.pursueHope(m,character,p,snapshots[id],time,minute,token,handleTalk))return;
   if(p.goal)return;
   if(!ambitionTurn&&await life.pursueAmbition(m,character,p,snapshots[id],time,minute,token,handleTalk))return;
   if(await life.parcels(m,character,p,snapshots[id],minute,token))return;
   if(minute>=(p.nextPlanning||0)){
    p.nextPlanning=minute+90;
    await life.occupation(m,character,p,snapshots[id],profile.skills.skills||[],minute);
    await life.householdPlan(m,character,p,p.lifePlan,minute);
   }
   if(await life.furnish(m,character,p,p.lifePlan,snapshots[id],profile.skills.skills||[],minute,token))return;
   if(await life.attend(m,character,p,snapshots[id],time,minute,token,panels.latestNews()))return;
   if(await life.clean(m,character,p,snapshots[id],minute,token))return;
   if(await life.sideIncome(m,character,p,p.lifePlan,snapshots[id],profile.skills.skills||[],minute,token))return;
   if(await life.outing(m,character,p,snapshots[id],time,minute,token))return;
  }catch(e){log(m.first_name+': 활동 보류 - '+e.message);}
  await talk(m,character,p,minute,token,snapshots[id]);
  if(!state.enabled||token!==epoch)return;
  if(!m.has_career&&m.employable!==true)return;
  if(m.has_career&&!/^(Youth|YoungAdult|Adult|Old|Elder)$/.test(m.age_group||''))return;
  if(work.is_working_time||work.is_commute_time||work.is_at_work)return;
  if(p.lastCareerMinute!==undefined&&minute-p.lastCareerMinute<360)return;
  p.lastCareerMinute=minute;
  var current=await cli('entity.reflect',{entity_id:id,Component:'Career'}), slot=current.careerSlots&&current.careerSlots.business;
  var key=slot&&slot.careerDtId;
  if(p.currentCareer!==key){p.currentCareer=key;p.careerSince=time.day;}
  var list=await cli('career.list_openings');if(!Array.isArray(list.openings))throw Error('구인 응답 형식 변경');
  var available=list.openings.filter(function(o){return o.vacancy>0&&(!slot||o.job_id!==slot.jobDtId);});
  p.openings=Array.from(new Set(list.openings.filter(function(o){return o.vacancy>0;}).map(function(o){return o.job_name||o.job_id;})));
  if(p.lifePlan&&p.lifePlan.primary==='사업 우선')return;
  // Limit table fetches per evaluation to avoid flooding the game on large worlds.
  available=available.slice(0,60);
  for(var i=0;i<available.length;i++)await table(available[i].career_dt_id);
  var best=P.pick(available,profile.trait,profile.skills.skills||[],rows,id);
  if(!best){p.target=null;return;}
  p.target={name:best.opening.job_name,id:best.opening.job_id,score:best.fit.score,reasons:best.fit.reasons};
  if(slot){
   var fit=P.score(profile.trait,profile.skills.skills||[],await table(key),key);
   var days=time.day-(p.careerSince===undefined?time.day:p.careerSince);
   if(!P.shouldSwitch(profile.trait,days,fit,best))return;
  }
  // Re-read availability and membership immediately before the write.
  var fresh=await cli('household.get_members',{household_id:String(m.household_id)});
  var member=(fresh.members||[]).filter(function(x){return String(x.entity_id)===id;})[0];
  if(!member||String(fresh.household_id)!==String(m.household_id)||member.has_career!==m.has_career)return;
  var latest=await cli('career.list_openings');
  if(!(latest.openings||[]).some(function(o){return o.job_id===best.opening.job_id&&o.career_entity_id===best.opening.career_entity_id&&o.vacancy>0;}))return;
  log(m.first_name+': '+(slot?'이직':'취업')+' 선택 - '+best.opening.job_name+' ('+(best.fit.reasons.join(', ')||'현재 가능한 일자리')+')');
  await write('career.join',{entity_id:id,career_entity_id:String(best.opening.career_entity_id),job_id:best.opening.job_id},token);
  var after=await cli('entity.reflect',{entity_id:id,Component:'Career'}), next=after.careerSlots&&after.careerSlots.business;
  if(!next||next.jobDtId!==best.opening.job_id)throw Error('취업/이직 결과 미확인. 기존 직장을 별도로 그만두게 하지 않았습니다.');
  p.currentCareer=next.careerDtId;p.careerSince=time.day;
  log(m.first_name+': '+best.opening.job_name+' 변경 확인');
 }
 async function cycle(){
  if(busy)return;busy=true;var token=epoch;
  try{
   lastGame=await cli('game.get_state');
   if(lastGame.phase!=='in_game'||lastGame.loading){status='게임 로딩/생활 진입 대기';return;}
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
   if(state.awayTravel&&lastGame.map_id===state.awayTravel.origin)state.awayTravel=null;
   var household=await cli('household.get_members');
   if(!Array.isArray(household.members))throw Error('가구 응답 형식 변경');
   var traveling=awayHousehold(household,lastGame);
   if(state.enabled&&state.scope!=='played'&&!traveling&&String(household.household_id)!==String(state.household)){status='다른 가구를 보고 있습니다. 원래 가구로 돌아가면 재개합니다.';return;}
   members=await roster(household,lastGame.map_id);
   await capability('career.join');
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
   errors=0;lastCycle=Date.now();
   if(Date.now()-lastReport>60000)await report();
  }catch(e){status=String(e.message||e);log(status);if(++errors>=3){state.enabled=false;epoch++;log('반복 오류로 자동 관리를 중지했습니다. Report를 저장해 주세요.');}}
  finally{busy=false;render();}
 }
 async function watchChoice(){
  if(!state.enabled||checkingPopup||watching||!lastGame||lastGame.phase!=='in_game')return;
  watching=true;
  var token=epoch;
  try{
   var game=await cli('game.get_state');
   if(game.phase!=='in_game'||game.loading||game.map_id!==lastGame.map_id)return;
   if(state.travel){
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
  }catch(_){}
  finally{watching=false;}
 }
 async function start(scope){
  if(busy){status='현재 확인이 끝난 뒤 Start를 눌러 주세요.';render();return;}
  busy=true;
  try{
   var h=await cli('household.get_members');if(!h.household_id||!h.members.length)throw Error('플레이할 가구를 먼저 불러오세요.');
   if(state.enabled&&state.scope===scope&&(scope==='played'||String(state.household)===String(h.household_id)))return;
   state.scope=scope;state.household=h.household_id;state.enabled=true;rosterAt=0;epoch++;errors=0;
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
 };
 document.getElementById('stop').onclick=function(){if(!state.enabled)return;state.enabled=false;epoch++;log('자동 명령 중지.');};
 document.getElementById('report').onclick=function(){report(true).then(function(){log('수동 진단 저장 완료: saved/observer-report.cfg');}).catch(function(e){log('진단 저장 실패: '+e.message);});};
 window._onStateLoaded=function(){epoch++;init();profiles={};snapshots={};index=0;log('저장된 관찰 설정을 불러왔습니다.');};
 log(VERSION+' 준비. 다른 작업 모드와 행동 결과를 확인합니다.');
 render();setInterval(cycle,10000);setInterval(watchChoice,1500);setTimeout(cycle,2500);
})();
