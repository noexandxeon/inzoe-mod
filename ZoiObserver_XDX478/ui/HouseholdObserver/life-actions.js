(function (root) {
 'use strict';
 var L=root.ObserverLife, P=root.ObserverPolicy, M=root.ObserverGoalMemory, R=root.ObserverRecovery, Rel=root.ObserverRelations, A=root.ObserverAgenda, CP=root.ObserverCareerPath;
 var essentials=[
  {label:'침대',fixture:/(?:^|_)(?:Bed\d|BedAssemble|BunkBed)/i,item:'Bed01',max:1200},
  {label:'냉장고',fixture:/(?:^|_)Fridge\d/i,item:'Fridge02',max:2700},
  {label:'변기',fixture:/(?:^|_)Toilet\d/i,item:'Toilet01',max:250},
  {label:'청소 도구',fixture:/(?:^|_)(?:Mop\d|Broom\d|VacuumCleaner)/i,item:'Mop01',max:60}
 ];

 function create(api){
  var cli=api.cli, write=api.write, log=api.log, state=api.state;
  var gameData=api.gameData||root.ObserverGameData.create(cli);
  var rows={}, siteTable=null, sites=null, householdCache={}, homeCache={}, hopeActions={}, bagNames={}, houseTasks={}, repairs={};
  function decisions(){return state.life||(state.life={pairs:{}});}
  function entity(value){return value&&value.value;}
  function named(member){return member.first_name||String(member.entity_id);}
  function readAt(id,component){return cli('entity.reflect',component?{entity_id:String(id),Component:component}:{entity_id:String(id)});}
  async function row(alias,id){
   var key=alias+':'+id;
   if(rows[key])return rows[key];
   // 0.4.7: Site rows are read in one call. One call per site (about 80) hit the game's CLI rate limit in play.
   if(alias==='Site'){
    if(!siteTable){
     var list=await cli('data.table_get_all',{Alias:'Site'});
     siteTable={};
     (Array.isArray(list)?list:[]).forEach(function(r){var name=r&&(r._row_name||r.iD);if(name)siteTable[name]=r;});
    }
    if(siteTable[id])return rows[key]=siteTable[id];
   }
   rows[key]=await gameData.row(alias,id);
   return rows[key];
  }
  async function currentSites(){
   var city=api.game().map_id;
   if(!sites||sites.map_id!==city)sites=await cli('world.get_loaded_sites');
   return sites.sites||[];
  }
  async function inventory(member,character){
   var game=api.game(), location=entity(character.locatedSiteId);
   if(!(location>0))return null;
   var key=game.map_id+':'+location;
   if(homeCache[key]&&Date.now()-homeCache[key].at<10000)return homeCache[key];
   if(String(game.possessed_entity_id)!==String(member.entity_id)){
    var active=await readAt(game.possessed_entity_id);
    if(entity(active.locatedSiteId)!==location)return null;
   }
   var site=(await currentSites()).find(function(s){return s.entity_id===location;});
   if(!site)return null;
   var summary;
   try{summary=await cli('build.get_site_info',{Detail:'floors'});}
   catch(e){if(!/no site area|inside a building/i.test(e.message))throw e;return null;}
   if(summary.site_id!==site.id)return null;
   var scan=await cli('build.scan_objects',{Limit:0});
   if(!Array.isArray(scan.objects)||scan.total!==scan.objects.length)return null;
   return homeCache[key]={at:Date.now(),site:site,summary:summary,objects:scan.objects};
  }
  function closest(objects,character,pattern,limit){
   var position=character.worldTransform&&character.worldTransform.translation;
   if(!position)return [];
   return objects.filter(function(o){return pattern.test(o.table_id||'')&&o.world_location;}).map(function(o){
    var w=o.world_location;
    return {object:o,dist:Math.hypot(w.x-position.x,w.y-position.y,w.z-position.z)};
   }).sort(function(a,b){return a.dist-b.dist;}).slice(0,limit||5).map(function(o){return o.object;});
  }
  async function objectAction(member,objects,choose,token,offers){
   var id=String(member.entity_id);
   for(var i=0;i<objects.length;i++){
    var target=String(objects[i].entity_id), available, self=target===id;
    try{
     available=offers&&offers[target];
     // 0.4.7: interaction.list_available rejects the actor itself ("not a supported target type"),
     // so Self_ goals (e.g. 야망 '바닥에 몰래 버리기') never ran. Callers seed offers[actor] with the Self_ bags.
     if(!available&&self)continue;
     if(!available){
      available=await cli('interaction.list_available',{entity_id:id,target_entity_id:target});
      if(offers)offers[target]=available;
     }
    }
    catch(_){continue;}
    var queued=api.queued?api.queued(id):[];
    var observed=api.snapshot&&api.snapshot(id), playing=observed&&observed.queue&&observed.queue.current;
    var action=choose((available.interactions||[]).filter(function(a){
     return queued.indexOf(a.interaction_bag_id)<0&&
      !(playing&&playing.interaction_bag_id===a.interaction_bag_id&&String(playing.target_entity_id)===target);
    }),target);
    if(!action)continue;
    var run={entity_id:id,interaction_bag_id:action.interaction_bag_id};
    // In game the Self_ action only counted with target=self (야망 2/3); without a target it queued but never ran.
    run.target_entity_id=target;
    try{await write('interaction.execute',run,token);}
    catch(e){e.observerBag=action.interaction_bag_id;e.observerTarget=target;throw e;}
    return Object.assign({},action,{observer_target:target});
   }
   return null;
  }
  async function move(member,target,token){
   var id=String(member.entity_id);
   // One trip at a time: in game the return home was queued twice in a row.
   var observed=api.snapshot&&api.snapshot(id), playing=observed&&observed.queue&&observed.queue.current;
   if(playing&&L.TRAVEL.test(playing.interaction_bag_id||''))return false;
   if((api.queued?api.queued(id):[]).some(function(b){return L.TRAVEL.test(b);}))return false;
   var descriptor=await cli('movement.get_site_move_interaction',{entity_id:id,target_entity_id:String(target)});
   if(descriptor.execution_tool!=='interaction.execute'||String(descriptor.entity_id)!==id||
      Number(descriptor.target_entity_id)!==Number(target)||descriptor.requires_zoi_group||!descriptor.interaction_bag_id)return false;
   await write('interaction.execute',{entity_id:id,target_entity_id:String(target),interaction_bag_id:descriptor.interaction_bag_id,SmartZoi:descriptor.smartzoi===true},token);
   state.lastMoveAt=Date.now();
   return true;
  }
  async function homeMember(member,character){
   var family=await readAt(member.household_id);
   var home=entity(family.residanceSiteId)||entity(character.boundSiteId);
   return home>0?home:0;
  }
  async function needs(member,character,decision,snapshot,minute,token){
   var need=L.urgentNeed(snapshot.stats.stats);
   if(!need){
    decision.needFallback=null;
    return false;
   }
   if(!L.goalReady(snapshot.queue,snapshot.work)||minute<(decision.nextNeed||0)||snapshot.work.is_at_work)return false;
   decision.nextNeed=minute+25;
   var home=await homeMember(member,character), location=entity(character.locatedSiteId);
   var local=await inventory(member,character);
   if(local){
    var eligible=local.objects.filter(function(o){return L.fixtureMatches(need.key,o.table_id);});
    var ordered=closest(eligible,character,/.*/,5);
    var action=await objectAction(member,ordered,function(items){return L.needChoice(need.key,items);},token);
    if(action){
     if(need.key==='Hunger')decision.noMeal=0;
     decision.needFallback=null;
     log(named(member)+'의 '+(snapshot.stats.stat_names[need.key]||need.key)+' 해결 요청: '+action.display_name);return true;
    }
    if(need.key==='Hunger'&&location===home)decision.noMeal=minute+40;
   }
   if(home>0&&location!==home&&(need.key!=='Cleanliness'||need.pct<=12)&&await move(member,home,token)){
    if(decision.outing&&decision.outing.goalVisit)decision.outing=null;
    decision.needFallback=null;
    log(named(member)+': 필수 욕구를 해결하려고 귀가');return true;
   }
   decision.needFallback={key:need.key,until:minute+25};
   return false;
  }
  // 0.4.7: shower or eat at home before the need turns urgent, at most once per 2 game hours per need.
  async function routine(member,character,decision,snapshot,minute,token){
   var need=L.routineNeed(snapshot.stats.stats);
   if(!need||!L.goalReady(snapshot.queue,snapshot.work)||snapshot.work.is_at_work||snapshot.work.is_working_time||snapshot.work.is_commute_time)return false;
   var timers=decision.routineNext||(decision.routineNext={});
   if(minute<(timers[need.key]||0))return false;
   timers[need.key]=minute+120;
   var home=await homeMember(member,character);
   if(!(home>0)||entity(character.locatedSiteId)!==home)return false;
   var local=await inventory(member,character);
   if(!local)return false;
   var eligible=local.objects.filter(function(o){return L.fixtureMatches(need.key,o.table_id);});
   var action=await objectAction(member,closest(eligible,character,/.*/,5),function(items){return L.needChoice(need.key,items);},token);
   if(!action)return false;
   log(named(member)+': '+(snapshot.stats.stat_names&&snapshot.stats.stat_names[need.key]||need.key)+' '+need.pct+'% · 미리 해결 요청: '+action.display_name);
   return true;
  }
  async function clean(member,character,decision,snapshot,minute,token){
   if(!L.goalReady(snapshot.queue,snapshot.work)||minute<(decision.nextCleaning||0))return false;
   var home=await homeMember(member,character);
   if(home!==entity(character.locatedSiteId))return false;
   var local=await inventory(member,character);
   if(!local)return false;
   var key='clean:'+local.site.entity_id;
   if(minute<(houseTasks[key]||0))return false;
   var dirt=local.objects.filter(function(o){return /^DEV_DustDecal/i.test(o.table_id);}).length;
   if(dirt<2)return false;
   decision.nextCleaning=minute+90;
   var supplies=closest(local.objects,character,/^(?:Mop\d|Broom\d|VacuumCleaner)/i,5);
   var action=await objectAction(member,supplies,function(items){
    return items.find(function(a){return a.enabled===true&&/^(?:Object_Mopping_Home|Object_.*(?:Sweep|Vacuum).*Home|Self_(?:Basic_)?Vacuum_Home)$/.test(a.interaction_bag_id);});
   },token);
   if(action){houseTasks[key]=minute+45;decision.cleanCount=(decision.cleanCount||0)+1;log(named(member)+': 집 청소 요청 (먼지 '+dirt+'곳)');return true;}
   decision.houseNeedsCleaning=true;
   return false;
  }
  async function repair(member,character,decision,snapshot,minute,token){
   var actor=String(member.entity_id), current=snapshot.queue.current;
   Object.keys(repairs).forEach(function(id){
    var repair=repairs[id];
    if(repair.actor===actor&&current&&String(current.target_entity_id)===id&&current.interaction_bag_id===repair.bag)repair.started=true;
   });
   if(!L.goalReady(snapshot.queue,snapshot.work)||minute<(decision.nextRepair||0))return false;
   var local=await inventory(member,character);
   if(!local||local.site.entity_id!==await homeMember(member,character))return false;
   var key='repair:'+local.site.entity_id;
   if(minute<(houseTasks[key]||0))return false;
   decision.nextRepair=minute+35;
   var appliances=closest(local.objects,character,
    /broke|fridge|sink|washstand|toilet|shower|bath|washer|dryer|stove|computer|laptop|television|kitchenrange|oven|microwave|purifier|vacuum|dishwasher|^(?:tv|pc)\d/i,24);
   var replaceBag='Object_Change_State_Broken_to_Normal';
   decision.repairStatus=null;
   for(var i=0;i<appliances.length;i++){
    var object=appliances[i], id=String(object.entity_id), pending=repairs[id];
    var offered;
    try{offered=await cli('interaction.list_available',{entity_id:actor,target_entity_id:id});}
    catch(_){continue;}
    var items=offered.interactions||[];
    var fix=items.find(function(a){return a.enabled===true&&/^(?:Object_.*_Repair|.*_Repair_Object)$/.test(a.interaction_bag_id);});
    var replace=items.find(function(a){return a.enabled===true&&a.interaction_bag_id===replaceBag;});
    if(pending&&pending.site!==local.site.entity_id){delete repairs[id];pending=null;}
    if(!fix&&!replace){
     if(pending&&(pending.started||pending.bag===replaceBag)&&items.some(function(a){return a.enabled;})){
      log(named(member)+': '+object.table_id+' '+(pending.bag===replaceBag?'교체':'수리')+' 후 정상 행동 확인');
     }
     if(pending)delete repairs[id];
     continue;
    }
    if(pending&&(minute-pending.at<35||Date.now()-(pending.sentAt||0)<12000))continue;
    if(pending&&pending.bag===replaceBag&&minute-pending.at<180)continue;
    if(pending&&pending.started&&pending.bag!==replaceBag){pending.failures++;pending.started=false;}
    var failures=pending&&pending.failures||0;
    var action=fix;
    if(replace&&(!fix||failures>=1)){
     var objectState=await readAt(id);
     if(entity(objectState.locatedSiteId)!==local.site.entity_id||objectState.objectTableId!==object.table_id)continue;
     var finances=await budget(member,minute), wallet=await readAt(member.household_id,'Currency');
     var product=await row('Object',object.table_id), prices=[object.price,product.price].filter(function(price){return Number.isFinite(price)&&price>0;});
     var price=prices.length?Math.max.apply(null,prices):null;
     if(price&&wallet.currencyMap&&wallet.currencyMap.mew-finances.reserve>=price&&
        (!pending||pending.bag!==replaceBag||wallet.currencyMap.mew>=pending.balance)){
      action=replace;
     }
     else decision.repairStatus=object.table_id+' 교체 대기 · '+(price?'생활비 여유 부족':'가격 확인 필요');
    }
    if(!action)continue;
    await write('interaction.execute',{entity_id:actor,target_entity_id:id,interaction_bag_id:action.interaction_bag_id},token);
    var progress=await cli('interaction.get_queue',{entity_id:actor});
    var active=progress.current;
    repairs[id]={actor:actor,site:local.site.entity_id,bag:action.interaction_bag_id,at:minute,sentAt:Date.now(),failures:failures,
     balance:action===replace&&wallet&&wallet.currencyMap.mew,
     started:!!(active&&String(active.target_entity_id)===id&&active.interaction_bag_id===action.interaction_bag_id)};
    houseTasks[key]=minute+28;
    decision.repairStatus=object.table_id+' '+(action===replace?'새 제품 교체 요청':'수리 요청');
    log(named(member)+': '+decision.repairStatus);
    return true;
   }
   return false;
  }
  async function parcels(member,character,decision,snapshot,minute,token){
   if(!L.goalReady(snapshot.queue,snapshot.work)||minute<(decision.nextParcel||0))return false;
   var home=await homeMember(member,character);
   if(home!==entity(character.locatedSiteId))return false;
   var local=await inventory(member,character);
   if(!local||local.site.entity_id!==home)return false;
   decision.nextParcel=minute+25;
   var boxes=closest(local.objects,character,/^GiftBox\d+(?:_v\d+)?$/i,15);
   if(decision.parcel){
    if(!boxes.some(function(o){return String(o.entity_id)===String(decision.parcel.target);})){
     log(named(member)+': 택배 개봉 후 상자가 사라진 것을 확인');
     decision.parcel=null;
    }else if(minute-decision.parcel.at>=45){
     log(named(member)+': 택배 상자가 남아 있어 개봉을 다시 시도합니다.');
     decision.parcel=null;
    }else return false;
   }
   for(var i=0;i<boxes.length;i++){
    var box=boxes[i], info=await readAt(box.entity_id), owner=info.ownershipData;
    if(!owner||owner.ownershipType!=='Character'||String(entity(owner.ownerId))!==String(member.entity_id))continue;
    var action=await objectAction(member,[box],function(actions){
     return actions.find(function(a){return a.enabled===true&&a.interaction_bag_id==='OpenCommonBox_All';})||
      actions.find(function(a){return a.enabled===true&&a.interaction_bag_id==='OpenCommonBox';});
    },token);
    if(!action)continue;
    decision.parcel={target:box.entity_id,at:minute};
    log(named(member)+': 도착한 내 택배 개봉 요청 / '+action.display_name);
    return true;
   }
   return false;
  }
  async function marketNeed(member,character,decision,snapshot,minute){
   // 0.4.7: ordering through the phone does not need an idle Zoi (relaxed was almost never true with autonomy on).
   if(String(member.entity_id)!==String(api.game().possessed_entity_id)||!L.adultAge.test(member.age_group)||
      L.sleeping(snapshot.queue,snapshot.work)||minute<(decision.nextMarket||0))return null;
   var local=await inventory(member,character);
   if(!local||local.site.entity_id!==await homeMember(member,character))return null;
   var dust=local.objects.filter(function(o){return /^DEV_DustDecal/i.test(o.table_id);}).length;
   var broken=local.objects.filter(function(o){
    return repairs[o.entity_id]&&repairs[o.entity_id].failures>=1;
   }).length;
   var need=dust>8?'clean':broken>=2?'repair':
    decision.noMeal>=minute&&snapshot.stats.stats.Hunger&&snapshot.stats.stats.Hunger.pct<22?'food':null;
   if(!need)return null;
   var finances=await budget(member,minute);
   return {kind:need,dust:dust,reserve:finances.reserve,limit:need==='food'?25:150};
  }
  function missionProgress(mission){
   return mission&&Array.isArray(mission.conditionStates)?
    mission.conditionStates.map(function(s){return s.currentCount+'/'+s.goalCount;}).join(', '):null;
  }
  function trackGoal(decision,plan,bag,target,minute,progress,practice){
   M.started(decision,plan,minute,practice&&practice.skill);
   decision.goal={name:plan.name,kind:plan.kind,instance:plan.instance,bag:bag,target:target,at:minute,
    sentAt:Date.now(),progress:missionProgress(progress),practice:practice||null};
   if(api.requested)api.requested(decision,plan,minute);
  }
  async function skillEvidence(member,skillId){
   var component;
   try{component=await readAt(member.entity_id,'Skill');}catch(_){}
   var skills=component&&component.skills||{};
   var direct=Object.values(skills).find(function(s){return s.iD===skillId;});
   if(direct&&Number.isFinite(direct.level))return {skill:skillId,level:direct.level,experience:direct.experience};
   var listed=await cli('skill.get_all',{entity_id:String(member.entity_id)});
   var summary=(listed.skills||[]).find(function(s){return s.id===skillId;});
   return summary&&Number.isFinite(summary.level)?{skill:skillId,level:summary.level}:null;
  }
  async function reviewGoal(member,decision,snapshot,minute){
   if(!decision.goal)return;
   var goal=decision.goal;
   var action=R.actionState(snapshot.queue,goal), playing=action==='playing';
   if(playing)goal.seen=true;
   var data=await readAt(member.entity_id,'Mission');
   var mission=data.missionMap&&data.missionMap['(Value='+goal.instance+')'];
   var ambition=goal.kind==='ambition', label=ambition?'야망 목표':'소망';
   var plans=ambition&&decision.ambition?decision.ambition.plans:decision.goalPlans;
   var plan=(plans||[]).find(function(p){return p.instance===goal.instance&&p.name===goal.name;})||goal;
   var progress=missionProgress(mission);
   if(goal.venue&&!goal.venue.observed&&(playing||goal.progress!=null&&progress!==null&&progress!==goal.progress)){
    venueNote(plan,{conditionId1:goal.venue.condition},goal.venue.site,true,minute);
    goal.venue.observed=true;
    if(decision.outing&&decision.outing.site===goal.venue.site)decision.outing.found=true;
   }
   var growth=false;
   if(goal.practice){
    var skill=await skillEvidence(member,goal.practice.skill);
    var levelUp=skill&&skill.level>goal.practice.level;
    var xpUp=skill&&skill.level===goal.practice.level&&Number.isFinite(goal.practice.experience)&&
     Number.isFinite(skill.experience)&&skill.experience-goal.practice.experience>0.001;
    if(levelUp||xpUp){
     growth=true;
     var memory=M.record(decision,plan,minute);
     memory.evidence=goal.practice.skill+(levelUp?' Lv.'+goal.practice.level+' → '+skill.level:
      ' 경험치 +'+(skill.experience-goal.practice.experience).toFixed(2));
     if(goal.practice.observed!==memory.evidence){
      goal.practice.observed=memory.evidence;
      log(named(member)+': 실제 기술 성장 확인 / '+memory.evidence);
     }
     if(memory.prep&&memory.prep.kind==='skill'&&memory.prep.skill===goal.practice.skill&&!memory.prep.grown&&
        (!Number.isFinite(memory.prep.requiredLevel)||skill.level>=memory.prep.requiredLevel)){
      M.prepared(decision,plan,minute,memory.evidence);
      log(named(member)+': 준비 연습 성장 확인 · 원래 '+label+' 재시도 예정 / '+goal.name);
     }
    }
   }
   if(mission&&mission.bIsFinished){
    var done=M.note(decision,plan,'completed','완료 확인','다음 목표 확인',minute);
    M.flow(decision,plan,'done',{},minute);R.clear(done);
    log(named(member)+': '+label+' 완료 확인 / '+goal.name);
    decision.nextHopeAction=minute;
    if(ambition)decision.nextAmbition=minute;
   }else if(!ambition&&snapshot.hope&&!snapshot.hope.selected.some(function(h){return h.hope_id===goal.name;})){
    var verdict=M.gone(M.record(decision,plan,minute),minute);
    M.note(decision,plan,verdict.phase,verdict.reason,'새 목표 확인',minute);
    if(verdict.phase==='completed')M.flow(decision,plan,'done',{},minute);
    log(named(member)+(verdict.phase==='completed'?': 소망 완료 / ':': 소망 종료 / ')+goal.name+' · '+verdict.reason);
    decision.nextHopeAction=minute;
   }else if(ambition&&!mission){
    decision.nextAmbition=minute;
   }else if(playing||growth||goal.progress!=null&&progress!==null&&progress!==goal.progress){
    var changed=goal.progress!=null&&progress!==null&&progress!==goal.progress;
    M.note(decision,plan,goal.practice?'preparing':'running',
     changed?'진행 확인 '+progress:growth?'실제 기술 성장 확인':'게임 행동 진행 중',
     goal.practice?'연습 종료 후 원래 소망 재평가':'현재 행동 종료 후 조건 재확인',minute);
    if(changed){
     log(named(member)+': '+label+' 진행 / '+goal.name+' '+progress);
     goal.progress=progress;
    }
    if(playing||action==='queued'||action==='unknown')return;
   }else if(action==='queued'||action==='unknown'||!goal.seen&&R.awaitingStart(Date.now(),minute,goal.sentAt||0,goal.at)){
    var waiting=action==='queued'?'같은 행동과 대상이 대기열에 있음':action==='unknown'?'행동 대기열 상세 미확인':'행동 시작 확인 중';
    M.note(decision,plan,'running',waiting,'실제 행동 시작 확인',minute);
    return;
   }else if(L.sleeping(snapshot.queue,snapshot.work)){
    if(goal.practice&&!goal.seen)M.practiceMissed(decision,plan,minute);
    M.note(decision,plan,'waiting','수면 중 · 목표 진행 미확인','기상 후 다시 시도',minute);
    decision.nextHopeAction=minute;
    if(ambition)decision.nextAmbitionAction=minute;
    log(named(member)+': '+goal.name+' / 수면 중 · 기상 후 다시 시도');
   }else{
    var reason=goal.practice&&goal.seen?'연습 종료 · 기술 성장 미확인':
     goal.seen?'행동 후 조건 진행 없음':'행동 대기열 등록 또는 시작 미확인';
    // Practice that never started does not use up today's practice share.
    if(goal.practice)goal.seen?M.practiceRan(decision,plan,minute):M.practiceMissed(decision,plan,minute);
    // A short practice can earn XP without a level-up. Do not call it a failed action.
    if(goal.practice&&goal.seen)M.note(decision,plan,'preparing',reason,'일상 병행 후 다른 연습 대상 재검토',minute);
    else{
     M.failed(decision,plan,goal.bag,goal.target,minute,reason);
     var kind=goal.seen?'condition':'unknown';
     var blocked=R.block(M.record(decision,plan,minute),kind,minute,reason);
     M.note(decision,plan,'waiting',reason+' · '+blocked.label,blocked.next,minute);
    }
    var skipped=decision.goalRetry||(decision.goalRetry={});
    skipped[goal.name]={bag:goal.bag,target:goal.target,until:minute+90};
    decision.nextHopeAction=minute;
    if(ambition)decision.nextAmbitionAction=minute;
    log(named(member)+': '+goal.name+' / '+reason);
   }
   decision.goal=null;
  }
  function isInteractionGoal(type){
   return /^(?:InteractionCount|InteractionBagCount|InteractionBagCountDuringEmotion|InteractionBagCountAtFamilyRelationshipType|TalkInteractionBagTag|AddEntityTagCount|AddBuffCount|RemoveBuffCount|EatFood|ReadBook|CompleteRecipe)$/.test(type);
  }
  function canAttempt(action){
   return action.enabled===true&&!/(?:_Fail|_Feedback|_Sub_|Steal|Embezzlement|Divorce|Breakup|Kill|Gamble|Buy_Ticket|_Destroy|Reset)/i.test(action.interaction_bag_id||'');
  }
  async function matchGoalBags(key){
   if(!key||key==='None')return [];
   if(!hopeActions[key]){
    var search=await cli('interaction.search',{Keyword:key,max_results:100});
    var normalized=String(key).toLowerCase();
    (search.results||[]).forEach(function(a){if(a.display_name)bagNames[a.interaction_bag_id]=a.display_name;});
    hopeActions[key]=(search.results||[]).filter(function(a){
     return String(a.interaction_bag_id).toLowerCase()===normalized||
      (a.tags||[]).some(function(t){return String(t).toLowerCase()===normalized;});
    }).map(function(a){return a.interaction_bag_id;});
   }
   return hopeActions[key];
  }
  // 0.4.7: skills without a written practice rule get one from game data: actions tagged
  // Ambition_<Skill> / Mission_M_<Skill> or named after the skill (interaction.search).
  var dynTraining={};
  async function ensureTraining(skill){
   if(!skill||training(skill)||dynTraining[skill]!==undefined)return training(skill);
   dynTraining[skill]=null;
   var found={};
   var keys=['Ambition_'+skill,'Mission_M_'+skill,skill];
   for(var i=0;i<keys.length;i++){
    try{
     var res=await cli('interaction.search',{Keyword:keys[i],max_results:40});
     (res.results||[]).forEach(function(a){
      var id=a.interaction_bag_id||'';
      if(/(?:Buy|Sell|Purchase|Fail|Destroy|Pickup|PickUp|_Sub_|Coop|^C_|Teach|Watch)/i.test(id))return;
      if(a.display_name)bagNames[id]=a.display_name;
      found[id]=true;
     });
    }catch(_){}
   }
   var bags=Object.keys(found).slice(0,30), hint=L.objectHints(bags);
   if(bags.length&&hint)dynTraining[skill]=[hint,new RegExp('^(?:'+bags.map(function(b){return b.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}).join('|')+')$')];
   if(dynTraining[skill])log('연습 방법 학습 / '+skill+' · 행동 '+bags.length+'개');
   return training(skill);
  }
  function training(skill){
   var fixed={
    Art:[/Easel/i,/^Art_Easel_(?:Drawing|Drawing_Small|Continue)$/],
    Instruments:[/Guitar|Piano|Keyboard|Violin|Drum/i,/^(?:Use_|Play_|Practice_).*(?:Guitar|Piano|Keyboard|Violin|Drum)/i],
    Performance:[/Mic|Karaoke/i,/^(?:Use_Mic_(?:Sing|RnB|Jazz|Rock)|.*SingingPractice)$/i],
    Speaking:[/Mirror/i,/^.*(?:Speech|PublicSpeaking|PracticeSpeaking).*$/i],
    Charisma:[/Mirror/i,/^.*(?:Charisma|Confidence|Speech|Appeal).*$/i],
    Logic:[/Chess|Computer|Bookcase|Bookshelf/i,/^(?:Use_|Computer_|Bookshelf_|Play_).*(?:Logic|Chess|CriticalThinking)/i],
    Housework:[/^(?:Mop\d|Broom\d|VacuumCleaner)/i,/^(?:Object_Mopping_Home|Object_.*(?:Sweep|Vacuum).*Home)$/],
    HandCraft:[/Workbench|WorkTable|Craft|Woodwork/i,/^(?!.*(?:Buy|Sell|Purchase|Destroy|Fail)).*(?:HandCraft|Woodwork|CraftPractice|Craft_Practice)/i]
   }[skill];
   return fixed||dynTraining[skill]||null;
  }
  async function prepareGoals(member,decision,minute,selected){
   var visible=Array.isArray(selected)?L.expiringFirst(selected):null;
   var signature=visible&&visible.map(function(h){return h.hope_id+':'+L.hopeDeadline(h);}).join('|');
   if(decision.goalPlans&&signature===decision.goalSignature&&
      minute>=(decision.goalScanMinute||0)&&minute-decision.goalScanMinute<30)return decision.goalPlans;
   var component=await readAt(member.entity_id,'Hope'), plans=[];
   var ordered=L.expiringFirst(component.selectedHopes);
   if(visible){
    var ranks={};
    visible.forEach(function(h,i){ranks[h.hope_id]=i;});
    ordered=ordered.filter(function(h){return Object.prototype.hasOwnProperty.call(ranks,h.hopeId);})
     .sort(function(a,b){return ranks[a.hopeId]-ranks[b.hopeId];});
   }
   for(var i=0;i<ordered.length;i++){
    var h=ordered[i], expiry=visible?L.hopeDeadline(visible.find(function(x){return x.hope_id===h.hopeId;})):L.hopeDeadline(h);
    var plan={name:h.hopeId,instance:entity(h.missionId),target:entity(h.reasonTargetEntityId),expire_ticks:Number.isFinite(expiry)?expiry:null,conditions:[],status:'조건 확인 중'};
    try{
     var hope=await row('Hope',h.hopeId);
     if(hope.missionId&&hope.missionId!=='None'){
      var mission=await row('Mission',hope.missionId);
      plan.conditions=mission.conditions||[];
      plan.requiresTarget=mission.isTargetEntityMission===true;
     }
     var old=(decision.goalPlans||[]).find(function(g){return g.name===plan.name&&g.instance===plan.instance;});
     plan.status=old&&old.status||(plan.conditions.length?'실행 차례 대기':'게임 이벤트 또는 직접 완료 조건 대기');
    }catch(e){plan.status='게임 조건 조회 보류';}
    plans.push(plan);
   }
   decision.goalPlans=plans;
   decision.goalScanMinute=minute;
   decision.goalSignature=signature;
   M.sync(decision,plans,minute);
   return plans;
  }
  async function visitForGoal(member,character,condition,snapshot,time,token){
   if(snapshot.work.is_working_time||snapshot.work.is_commute_time||snapshot.work.is_at_work||
      L.urgentNeed(snapshot.stats.stats)||time.hour<8||time.hour>18)return null;
   var location=entity(character.locatedSiteId);
   var all=(await currentSites()).filter(function(s){
    return s.entity_id>0&&s.entity_id!==location&&
     (condition.conditionType==='EnterSiteCount'?s.id===condition.conditionId1:
      /(?:Public|Business)/.test(s.id)&&!/(?:Airport|Residence|School|Prison|Dev_)/i.test(s.id));
   });
   for(var i=0;i<all.length;i++){
    var s=all[i], data=(await row('Site',s.id)).defaultInfo;
    if(!data||data.bDisabled||data.bDevOnly||
       (condition.conditionType!=='EnterSiteCount'&&(data.tags||[]).indexOf(condition.conditionId1)<0))continue;
    if(await move(member,s.entity_id,token))return s;
   }
   return null;
  }
  // 0.4.7: where each goal action was (or was not) found, per city. Kept in the saved state.
  function venueBook(){var book=state.venues||(state.venues={});return book;}
  function venueKey(condition){return (api.game().map_id||'')+':'+condition.conditionId1;}
  function venueNote(plan,condition,site,hit,minute){
   var book=venueBook(), key=venueKey(condition), entry=book[key]||(book[key]={hits:{},misses:{}});
   if(hit){entry.hits[site]=minute;delete entry.misses[site];}
   else entry.misses[site]=minute;
  }
  // Only visit a place with a goal-specific facility clue or a previously observed action.
  async function recoverGoal(member,character,decision,snapshot,time,minute,token,plan,condition,bags,nativeTags){
   var tags=nativeTags.length?[nativeTags]:L.goalVenueTags(plan.name,condition.conditionId1);
   var hint=L.goalVenueIds(plan.name+' '+condition.conditionId1+' '+(bags||[]).join(' '));
   var entry=venueBook()[venueKey(condition)]||{hits:{},misses:{}};
   if((!tags.length&&!hint&&!Object.keys(entry.hits).length)||plan.requiresTarget||decision.outing||!L.tripReady(snapshot.stats.stats)||
      snapshot.work.is_at_work||snapshot.work.is_working_time||snapshot.work.is_commute_time||
      time.hour<7||time.hour>=21)return false;
   if(plan.expire_ticks>0&&plan.expire_ticks/600000000-minute<35)return false;
   if(decision.goalVisitDay!==time.day){decision.goalVisitDay=time.day;decision.goalVisits={};}
   var key=plan.name+':'+condition.conditionId1, visits=decision.goalVisits;
   var total=Object.keys(visits).reduce(function(n,k){return n+visits[k];},0);
   if((visits[key]||0)>=4||total>=6)return false;
   var actor=String(member.entity_id);
   var schedule=await cli('schedule.diagnose',{entity_id:actor});
   if(schedule.has_schedule!==false)return false;
   var location=entity(character.locatedSiteId), catalog=await currentSites();
   var candidates=[];
   for(var i=0;i<catalog.length;i++){
    var site=catalog[i];
    if(!(site.entity_id>0)||site.entity_id===location||!/(?:Public|Business)/i.test(site.id)||
       /Airport|Residence|School|Prison|Dev_|RabbitHole|PierWalkway|Cemetery|Funeral|Police/i.test(site.id))continue;
    var info=(await row('Site',site.id)).defaultInfo;
    if(!info||info.bDisabled||info.bDevOnly||!/^(?:Business|Public)$/.test(info.siteType))continue;
    var siteTags=info.tags||[];
    if(nativeTags.some(function(tag){return siteTags.indexOf(tag)<0;}))continue;
    if(siteTags.indexOf('Resort_Room')>=0||siteTags.indexOf('Cahaya_DesertIsland')>=0)continue;
    var missed=entry.misses[site.entity_id];
    if(missed&&minute-missed<3*1440)continue;
    var score=entry.hits[site.entity_id]?100:0;
    if(tags.some(function(group){return group.every(function(t){return siteTags.indexOf(t)>=0;});}))score+=50;
    if(hint&&hint.test(site.id))score+=60;
    if(!score)continue;
    if(/TPO_Site_Public|SiteTag_Market|SiteTag_Park|CanBuySnacks|Arcade/.test(siteTags.join(' ')))score+=10;
    candidates.push({site:site,score:score});
   }
   candidates.sort(function(a,b){return b.score-a.score;});
   for(var j=0;j<candidates.length&&j<3;j++){
    var pick=candidates[j].site;
    if(!await move(member,pick.entity_id,token))continue;
    visits[key]=(visits[key]||0)+1;
    decision.outing={site:pick.entity_id,name:pick.l10n||pick.id,start:minute,goalVisit:plan.name,cond:condition.conditionId1};
    plan.status='맵 탐색 중 / '+decision.outing.name+' ('+(candidates.length-j)+'곳 남음)';
    log(named(member)+': '+plan.name+' 행동을 찾으러 '+decision.outing.name+' 이동 · 남은 후보 '+(candidates.length-j-1)+'곳');
    return true;
   }
   if(!candidates.length)M.note(decision,plan,'waiting','도시 전체 탐색 완료 · 사용 가능한 장소 없음','3일 뒤 재탐색',minute);
   return false;
  }
  async function pursueHope(member,character,decision,snapshot,time,minute,token,tryConversation){
   if(decision.goal||!L.goalReady(snapshot.queue,snapshot.work)||minute<(decision.nextHopeAction||0))return false;
   var plans=await prepareGoals(member,decision,minute,snapshot.hope&&snapshot.hope.selected);
   decision.nextHopeAction=minute+18;
   return pursuePlans(member,character,decision,snapshot,time,minute,token,plans,tryConversation);
  }
  async function prepareAmbition(member,decision,minute){
   if(minute<(decision.nextAmbition||0))return decision.ambition;
   decision.nextAmbition=minute+20;
   var id=String(member.entity_id), playing=await cli('ambition.get',{entity_id:id});
   if(!playing.is_playing||!playing.playing_ambition_item_id||playing.is_all_completed){
    if(decision.ambition&&playing.is_all_completed)log(named(member)+': 야망 완료 확인 / '+decision.ambition.name);
    M.sync(decision,[],minute,'ambition');
    decision.ambition=null;return null;
   }
   var name=playing.playing_ambition_item_id, step=playing.current_step;
   if(decision.ambition&&decision.ambition.id===name&&decision.ambition.step===step)return decision.ambition;
   var native=await row('AmbitionItem',name), ambition=await readAt(id,'Ambition'), missions=await readAt(id,'Mission');
   var progress=ambition.ambitionItems&&ambition.ambitionItems[name.toLowerCase()];
   var current=(native.ambitionSteps||[]).find(function(x){return x.step===step;});
   if(!progress||!current)return null;
   var keys=[native.displayTextId], plans=[];
   for(var i=0;i<current.stepMissions.length;i++){
    var task=current.stepMissions[i], key=task.missionId, active=progress.stepMissionIds.map(entity).find(function(instance){
     var record=missions.missionMap&&missions.missionMap['(Value='+instance+')'];
     return record&&record.missionDtId===key;
    });
    if(!(active>0))continue;
    var detail=await row('Mission',key), record=missions.missionMap['(Value='+active+')'];
    var text=detail.conditions&&detail.conditions[0]&&detail.conditions[0].descTextId;
    if(text)keys.push(text);
    plans.push({name:key,textKey:text,kind:'ambition',instance:active,target:entity(record.targetEntityId),
     conditions:detail.conditions||[],requiresTarget:detail.isTargetEntityMission===true,status:'실행 차례 대기'});
   }
   var localized=await cli('l10n.get',{Keys:JSON.stringify(keys.filter(Boolean))});
   plans.forEach(function(plan){plan.label=localized[plan.textKey]||plan.name;});
   if(decision.ambition&&decision.ambition.id===name&&step>decision.ambition.step)log(named(member)+': 야망 '+step+'단계 진입 확인');
   M.sync(decision,plans,minute,'ambition');
   return decision.ambition={id:name,name:localized[native.displayTextId]||name,step:step,plans:plans};
  }
  async function pursueAmbition(member,character,decision,snapshot,time,minute,token,tryConversation){
   if(decision.goal||!L.goalReady(snapshot.queue,snapshot.work)||minute<(decision.nextAmbitionAction||0))return false;
   var ambition=await prepareAmbition(member,decision,minute);
   if(!ambition||!ambition.plans.length)return false;
   decision.nextAmbitionAction=minute+25;
   return pursuePlans(member,character,decision,snapshot,time,minute,token,ambition.plans,tryConversation);
  }
  // Objects or Zois another household member is using right now (from the latest snapshots).
  function busyTargets(member){
   var used={};
   (api.members&&api.members()||[]).forEach(function(other){
    if(String(other.entity_id)===String(member.entity_id))return;
    var s=api.snapshot&&api.snapshot(other.entity_id), c=s&&s.queue&&s.queue.current;
    if(c&&c.target_entity_id&&String(c.target_entity_id)!==String(other.entity_id))used[String(c.target_entity_id)]=other.first_name||String(other.entity_id);
   });
   return used;
  }
  function goalPattern(practice,id){
   return practice?practice[0]:/GetLicense/i.test(id)?/Computer|Laptop|Desktop/i:
    /wash.*hand/i.test(id)?/Sink|Washstand/i:
    /disinfect/i.test(id)?/^(?:Bed\d|Sofa\d)/i:
    /drink.*water/i.test(id)?/WaterPurifier/i:
    /Drawing/i.test(id)?/Easel|Mural|Canvas/i:
    /DisplayOre/i.test(id)?/DecoShelf|Display/i:
    /Coffee/i.test(id)?/Coffee|Espresso/i:
    /Phone_Sofa/i.test(id)?/Sofa/i:
    /Ambition_Collect/i.test(id)?/Collect|Spawn|Dig|Gem|Ore|Stone|Metal|Rock|Shell/i:
    /Read|Book/i.test(id)?/Book|Shelf|Tablet|Chair|Sofa|Computer/i:/.*/;
  }
  var relationTypes=/^(?:Marriage|NewRelationshipCount|RelationshipCount|TalkInteractionBagTag|InteractionBagCountAtFamilyRelationshipType)$/;
  async function pursuePlans(member,character,decision,snapshot,time,minute,token,plans,tryConversation){
   var local, nearby, offers=Object.create(null), missions=plans.length?await readAt(member.entity_id,'Mission'):{};
   var used=busyTargets(member);
   var diagnosisContext, environment;
   async function home(){if(local===undefined)local=await inventory(member,character);return local;}
   async function gameConditions(bags){
    if(!diagnosisContext){
     diagnosisContext={age:member.age_group,gender:member.gender,city:api.game().map_id,hour:time.hour,
      hhmm:time.hour*100+time.minute,skills:{}};
     try{
      var skills=await cli('skill.get_all',{entity_id:String(member.entity_id)});
      (skills.skills||[]).forEach(function(skill){diagnosisContext.skills[skill.id]=skill.level;});
     }catch(_){}
     var localPlace=await home();
     if(localPlace)diagnosisContext.hasSiteObjectTag=function(tag){
      var item=L.itemForTag(tag), fixture=item&&L.goalHomeItem(item,item,[]);
      if(!fixture)return null;
      return localPlace.objects.some(function(object){return fixture.fixture.test(object.table_id||'');});
     };
     try{
      var site=(await currentSites()).find(function(s){return s.entity_id===entity(character.locatedSiteId);});
      if(site){
       var info=(await row('Site',site.id)).defaultInfo;
       if(info)diagnosisContext.siteTags=info.tags||[];
      }
     }catch(_){}
    }
    return gameData.diagnose(bags,diagnosisContext,function(){
     return environment||(environment=cli('environment.get_state'));
    });
   }
   // Tries one condition. Returns true when a game action was requested.
   async function attemptCondition(plan,condition,progress,label,retry,prepFor){
    var memory=M.record(decision,plan,minute), type=condition.conditionType;
    var practice=type==='SkillLevel'?await ensureTraining(condition.conditionId1):null;
    var skillBaseline=null;
    if(practice){
     if(!M.practiceAllowed(decision,plan,minute)){
      M.note(decision,plan,'waiting','오늘 준비 연습 '+M.practiceLimit(plan)+'회 실행 · 일상생활 우선','다음 게임 날짜에 연습 재검토',minute);return false;
     }
     skillBaseline=await skillEvidence(member,condition.conditionId1);
     if(!skillBaseline){
      M.note(decision,plan,'unsupported','현재 기술 수치 확인 필요 / '+condition.conditionId1,'게임 기술 응답 확인',minute);return false;
     }
     if(prepFor&&memory.prep&&Number.isFinite(memory.prep.requiredLevel)&&skillBaseline.level>=memory.prep.requiredLevel){
      M.prepared(decision,plan,minute,skillBaseline.skill+' Lv.'+skillBaseline.level);
      return false;
     }
     M.note(decision,plan,'preparing',condition.conditionId1+' Lv.'+skillBaseline.level+(prepFor?' · '+prepFor+' 준비 연습 탐색':' · 준비 연습 탐색'),
      '가능한 행동 실행 후 실제 기술 성장 확인',minute);
     M.flow(decision,plan,'prepare',{need:prepFor&&memory.flow&&memory.flow.need||condition.conditionId1+' 기술',
      prep:prepFor&&memory.flow&&memory.flow.prep||'연습'},minute);
    }
    if(type==='AddEntityTagCount'&&condition.conditionId1==='Stay_CheckIn'){
     M.note(decision,plan,'waiting','실제 숙소 체크인 필요','현지 체크인 행동과 게임 미션 진행 확인',minute);return false;
    }
    var bags=type==='AddBuffCount'&&condition.conditionId1==='Buff_GetLicense_Delivery'?
     ['Computer_Use_GetLicense_Delivery','Laptop_Use_GetLicense_Delivery']:
     isInteractionGoal(type)?await matchGoalBags(condition.conditionId1):[];
    // 0.4.7: the game tags the actions that count for a hope/ambition with Mission_<name>
    // (e.g. MovieScreen_WatchMovie carries Mission_Hope_HouseholdBiz_21). Use them when the condition id finds nothing.
    if(!practice&&!bags.length&&plan.name)bags=await matchGoalBags('Mission_'+plan.name);
    if(!practice&&!bags.length){
     M.note(decision,plan,'unsupported','실행 연결 대기 / '+type+' '+condition.conditionId1,
      '게임에서 가능한 실행 경로 확인',minute);return false;
    }
    if(!practice)M.flow(decision,plan,memory.prep&&memory.prep.grown?'retry':'need',{need:memory.flow&&memory.flow.need||condition.conditionId1},minute);
    var place=await home();
    var items=place?place.objects:[];
    var targets=plan.requiresTarget?(plan.target>0?[{entity_id:plan.target}]:[]):closest(items,character,goalPattern(practice,condition.conditionId1),20);
    // 0.4.7: objects that match the action come first, wherever they stand in the house.
    var hint=!plan.requiresTarget&&!practice&&L.objectHints(bags);
    if(hint){
     var fitting=closest(items,character,hint,8);
     targets=fitting.concat(targets.filter(function(t){return fitting.indexOf(t)<0;})).slice(0,20);
    }
    if(plan.requiresTarget&&plan.target>0){
     try{
      var other=await cli('interaction.get_queue',{entity_id:String(plan.target)});
      if(L.sleeping(other)){
       var sleep=R.block(memory,'sleeping',minute,'대상 조이 수면');
       M.note(decision,plan,'waiting',sleep.label,sleep.next,minute);return false;
      }
     }catch(_){}
    }
    if(!plan.requiresTarget&&!targets.length&&String(api.game().possessed_entity_id)===String(member.entity_id)){
     if(nearby===undefined){
      var searching=decision.outing&&decision.outing.goalVisit&&decision.outing.arrived;
      try{nearby=(await cli('entity.scan_objects',{Radius:searching?70:30,Limit:searching?45:22,ref:'pawn'})).objects||[];}
      catch(_){nearby=[];}
     }
     targets=nearby;
    }
    var found=targets.length;
    targets=targets.filter(function(t){return !used[String(t.entity_id)];});
    var occupied=found>0&&!targets.length;
    if(!plan.requiresTarget&&(/_Self(?:_|$)/i.test(plan.name)||bags.some(function(b){return /^Self_/i.test(b);}))){
     targets=[{entity_id:member.entity_id}].concat(targets);
     offers[String(member.entity_id)]={interactions:bags.filter(function(b){return /^Self_/i.test(b);})
      .map(function(b){return {interaction_bag_id:b,enabled:true,display_name:bagNames[b]||b};})};
    }
    if(!plan.requiresTarget&&place&&L.goalVenueTags(plan.name,condition.conditionId1).length)
     targets=targets.concat({entity_id:place.site.entity_id});
    var disabled=[], action;
    function wanted(a){return practice?practice[1].test(a.interaction_bag_id):bags.indexOf(a.interaction_bag_id)>=0;}
    try{
     action=await objectAction(member,targets,function(choices,target){
      var pick=choices.find(function(a){
       return canAttempt(a)&&M.allowed(decision,plan,a.interaction_bag_id,target,minute)&&
        !(retry&&retry.until>minute&&retry.bag===a.interaction_bag_id&&String(retry.target)===target)&&wanted(a);
      });
      if(!pick)choices.forEach(function(a){if(a.enabled===false&&wanted(a)&&disabled.length<6)disabled.push({action:a,target:target});});
      return pick;
     },token,offers);
    }catch(e){
     if(e.observerBag)M.failed(decision,plan,e.observerBag,e.observerTarget,minute,'게임 행동 응답 확인 필요 / '+e.message);
     else{
      var refused=R.block(memory,R.classify({message:e.message,refused:true}),minute,e.message);
      M.note(decision,plan,'waiting','게임이 행동을 받지 않음 / '+e.message+' · '+refused.label,refused.next,minute);
     }
     return false;
    }
    if(action){
     plan.status=label+' 행동 실행 요청';
     R.clear(memory);
     trackGoal(decision,plan,action.interaction_bag_id,action.observer_target,minute,progress,skillBaseline);
     if(decision.outing&&decision.outing.goalVisit===plan.name&&decision.outing.arrived&&
        entity(character.locatedSiteId)===decision.outing.site){
      decision.goal.venue={site:decision.outing.site,condition:condition.conditionId1};
     }
     if(!practice)M.flow(decision,plan,'confirm',{},minute);
     log(named(member)+'의 '+label+' 행동 요청: '+action.display_name+(prepFor?' (준비: '+prepFor+')':''));
     return true;
    }

    var nativeTags=[], dataItem=null;
    if(!practice&&!occupied&&bags.length){
     if(bags.every(function(bag){return /^CareerCommon_(?:UseVacation|SickLeave)$/.test(bag);})){
      M.note(decision,plan,'unsupported','게임에서 휴가·병가 행동 확인 · 근무 일정 실행 경로 미확인','일정 확인 후 재검토',minute);
      return false;
     }
     var diagnosis=await gameConditions(bags);
     var blockers=diagnosis?diagnosis.blocks:[];
     var restriction=blockers.find(function(b){return b.kind==='fixed'||b.kind==='timed'||b.kind==='other';});
     if(restriction){
      M.note(decision,plan,'waiting','게임 데이터 · '+restriction.label,'게임 조건이 바뀌면 다시 확인',minute);
      return false;
     }
     nativeTags=blockers.filter(function(b){return b.kind==='site';}).map(function(b){return b.id;});
     var missingItem=blockers.find(function(b){return b.kind==='object';});
     if(missingItem)dataItem=L.itemForTag(missingItem.id);
     var nativeSkill=blockers.find(function(b){return b.kind==='skill';});
     var shown=disabled.length?disabled[0].action:null;
     var reason=shown?R.disabledReason(shown):'';
     var kind=R.classify({reason:reason,disabled:!!shown});
     var skill=nativeSkill?nativeSkill.id:kind==='skill'&&shown?R.skillFor(shown.interaction_bag_id,reason):null;
     if(nativeSkill)reason='게임 조건: '+nativeSkill.label;
     if(!nativeTags.length&&skill&&await ensureTraining(skill)){
      if(memory.prep&&memory.prep.skill===skill&&memory.prep.grown){memory.prep.grown=null;memory.prep.rounds=(memory.prep.rounds||1)+1;}
      // An ambition is kept until it is achieved, however many practice rounds it takes.
      if(!memory.prep||memory.prep.skill!==skill||plan.kind==='ambition'||(memory.prep.rounds||1)<=5){
       M.prepare(decision,plan,{kind:'skill',skill:skill,requiredLevel:nativeSkill?nativeSkill.need:null,need:nativeSkill?skill+' Lv.'+nativeSkill.need:skill+' 기술',
        label:skill+' 연습',reason:reason},minute);
       var preparation=R.block(memory,'skill',minute,reason);
       M.note(decision,plan,'preparing',preparation.label+' / '+reason,preparation.next,minute);
       return attemptCondition(plan,{conditionType:'SkillLevel',conditionId1:skill},progress,label,retry,plan.name);
      }
     }
     if(nativeTags.length)plan.status='게임 데이터 · 다른 장소 필요 / '+nativeTags.join(', ');
     else if(missingItem)plan.status='게임 데이터 · '+missingItem.label;
     else if(shown){
      var cond=R.block(memory,kind,minute,reason||shown.display_name);
      plan.status=cond.label+(reason?' / '+reason:'');
     }else plan.status='게임에서 이용 가능한 행동 또는 대상 확인 중';
    }else if(occupied){
     var busy=R.block(memory,'occupied',minute,Object.values(used).join(', '));
     plan.status=busy.label;
    }else{
     plan.status=!targets.length?'조건에 맞는 대상이 근처에 없음':'근처 대상에서 사용할 수 있는 행동 없음';
     if(!targets.length)R.block(memory,'missing',minute,condition.conditionId1);
    }
    var trip=decision.outing, missed=false;
    if(trip&&trip.goalVisit===plan.name&&trip.arrived&&entity(character.locatedSiteId)===trip.site){
     venueNote(plan,condition,trip.site,false,minute);
     log(named(member)+': '+trip.name+'에서 '+condition.conditionId1+' 행동을 찾지 못함 · 다른 장소 탐색');
     decision.outing=null;missed=true;
    }
    if((nativeTags.length||!dataItem)&&await recoverGoal(member,character,decision,snapshot,time,minute,token,plan,condition,bags,nativeTags))return true;
    if(missed){
     var back=await homeMember(member,character);
     if(back>0&&await move(member,back,token)){log(named(member)+': 오늘 탐색 횟수 소진 · 귀가');return true;}
    }
    // 0.4.7: a goal that needs one household object the home lacks (easel, computer) buys and places it.
    var homeItem=!nativeTags.length&&(dataItem?L.goalHomeItem(dataItem,dataItem,[]):
     (type!=='SkillLevel'||/^(?:Art|Instruments)$/.test(condition.conditionId1))&&L.goalHomeItem(plan.name,condition.conditionId1,bags));
    if(homeItem&&place&&
       !place.objects.some(function(o){return homeItem.fixture.test(o.table_id||'');})&&
       (!plan.expire_ticks||plan.expire_ticks/600000000-minute>=90)&&minute>=(decision.nextGoalFurnish||0)&&
       canFurnish(member,snapshot)&&place.summary.site_type==='Residence'&&
       place.site.entity_id===await homeMember(member,character)){
     decision.nextGoalFurnish=minute+1440;
     var funds=await budget(member,minute);
     var placement=funds&&await placeHouseItem(member,place,homeItem.item,funds,homeItem.max,token,homeItem.fixture);
     if(placement){
      plan.status=homeItem.label+(placement.status==='verified'?' 배치 확인':' 배치 요청 · 결과 확인 대기');
      M.flow(decision,plan,'prepare',{need:homeItem.label,prep:'구매·배치'},minute);
      return true;
     }
     M.note(decision,plan,'waiting',homeItem.label+' 필요 · 예산 또는 빈 공간 부족','다음 날 구매 재검토',minute);
    }
    if(decision.outing&&decision.outing.goalVisit===plan.name)
     plan.status='대체 장소에서 이용 가능한 '+condition.conditionId1+' 행동 확인 중';
    var next=memory.block?memory.block.next:practice?'대체 연습 대상·장소 재탐색':'조건·대상 변경 후 재탐색';
    M.note(decision,plan,memory.prep&&!memory.prep.grown?'preparing':'waiting',plan.status,next,minute);
    return false;
   }
   for(var i=0;i<plans.length;i++){
    var plan=plans[i], progress=missions.missionMap&&missions.missionMap['(Value='+plan.instance+')'], label=plan.kind==='ambition'?'야망':'소망';
    if(progress&&progress.bIsFinished){M.note(decision,plan,'completed','완료 확인','다음 목표 확인',minute);M.flow(decision,plan,'done',{},minute);continue;}
    if(plan.kind==='ambition'&&(!progress||!progress.bIsActive)){
     plan.status='게임에서 미션 활성화 대기';continue;
    }
    var memory=M.record(decision,plan,minute);
    if(memory.block&&memory.block.until>minute&&/^(?:sleeping|busy)$/.test(memory.block.kind)){
     plan.status=memory.block.label+' · '+memory.block.next;continue;
    }
    var retry=decision.goalRetry&&decision.goalRetry[plan.name];
    // A preparation step (e.g. an inferred missing skill) runs before the original condition.
    var prep=memory.prep&&memory.prep.kind==='skill'&&!memory.prep.grown&&(plan.kind==='ambition'||minute-memory.prep.since<3*1440)?memory.prep:null;
    if(prep&&await ensureTraining(prep.skill)){
     if(await attemptCondition(plan,{conditionType:'SkillLevel',conditionId1:prep.skill},progress,label,retry,plan.name))return true;
     // No practice was possible right now: still look at the original condition, which may have opened up.
    }
    for(var j=0;j<plan.conditions.length;j++){
     var condition=plan.conditions[j], type=condition.conditionType;
     var count=progress&&progress.conditionStates&&progress.conditionStates[j];
     if(count&&count.compareType==='GreaterOrEqual'&&count.currentCount>=count.goalCount)continue;
     if(type==='EnterSiteCount'||type==='EnterSiteTagCount'){
      var site=await visitForGoal(member,character,condition,snapshot,time,token);
      plan.status=site?'목적지로 이동 중':'여유 시간 또는 이용 가능한 목적지 대기';
      if(site){
       trackGoal(decision,plan,'LLM_WalkToSite',site.entity_id,minute,progress);
       M.flow(decision,plan,'confirm',{need:'장소 방문',prep:'외출'},minute);
       decision.outing={site:site.entity_id,name:site.l10n||site.id,start:minute};
       log(named(member)+'의 '+label+' 외출: '+decision.outing.name);return true;
      }
      continue;
     }
     if(relationTypes.test(type)){
      M.flow(decision,plan,'need',{need:type==='NewRelationshipCount'?'새로운 인연':type==='Marriage'?'결혼 상대':'관계 상대'},minute);
      if(tryConversation&&await tryConversation(plan,progress)){
       plan.status=label+' 대화 실행 요청';M.flow(decision,plan,'confirm',{},minute);return true;
      }
      if(await meetForGoal(member,character,decision,snapshot,time,minute,token,plan,condition))return true;
      plan.status='관계·대화 조건 또는 상대 대기';
      M.note(decision,plan,'waiting',plan.status,'기억한 상대와 재회 또는 사람이 있는 장소 방문',minute);
      continue;
     }
     if(await attemptCondition(plan,condition,progress,label,retry,null))return true;
    }
   }
   return false;
  }
  // Relationship goals: meet a remembered person where they are now, or go where new people are.
  async function meetForGoal(member,character,decision,snapshot,time,minute,token,plan,condition){
   if(decision.outing||L.urgentNeed(snapshot.stats.stats)||snapshot.work.is_at_work||snapshot.work.is_working_time||
      snapshot.work.is_commute_time||time.hour<9||time.hour>=20)return false;
   if(decision.meetDay!==time.day){decision.meetDay=time.day;decision.meetings=0;}
   if(decision.meetings>=2)return false;
   var actor=String(member.entity_id), location=entity(character.locatedSiteId), catalog=await currentSites(), life=decisions();
   var schedule=await cli('schedule.diagnose',{entity_id:actor});
   if(schedule.has_schedule!==false)return false;
   async function publicSite(siteEntity){
    var site=catalog.find(function(s){return s.entity_id===siteEntity;});
    if(!site||!(site.entity_id>0)||/Airport|Residence|School|Prison|Dev_|Private/i.test(site.id))return null;
    var info=(await row('Site',site.id)).defaultInfo;
    return info&&!info.bDisabled&&!info.bDevOnly&&/^(?:Business|Public)$/.test(info.siteType)?site:null;
   }
   if(condition.conditionType!=='NewRelationshipCount'){
    var known=Rel.reunion(life,actor,minute,[]);
    for(var i=0;i<known.length;i++){
     var other;
     try{other=await readAt(known[i]);}catch(_){continue;}
     if(other.locatedCityName!==character.locatedCityName){Rel.blocked(life,actor,known[i],'away',minute);continue;}
     var at=entity(other.locatedSiteId);
     if(at===location)continue;
     var site=await publicSite(at);
     if(!site){Rel.blocked(life,actor,known[i],'away',minute);continue;}
     if(!await move(member,site.entity_id,token))continue;
     decision.meetings++;
     var person=book(life,actor)[known[i]];
     decision.outing={site:site.entity_id,name:site.l10n||site.id,start:minute,goalVisit:plan.name,reunion:known[i]};
     M.flow(decision,plan,'prepare',{prep:'재회 · '+(person&&person.name||known[i])},minute);
     log(named(member)+': '+(person&&person.name||known[i])+'을(를) 다시 만나러 '+decision.outing.name+' 이동');
     return true;
    }
   }
   var last=decision.lastSocialSite;
   var venue=L.leisureSite(catalog,P.traits((api.snapshot(member.entity_id)||snapshot).trait||{}),last);
   if(!venue||venue.entity_id===location||!await publicSite(venue.entity_id))return false;
   if(!await move(member,venue.entity_id,token))return false;
   decision.meetings++;decision.lastSocialSite=venue.entity_id;
   decision.outing={site:venue.entity_id,name:venue.l10n||venue.id,start:minute,goalVisit:plan.name,social:true};
   M.flow(decision,plan,'prepare',{prep:'사람이 있는 장소 방문'},minute);
   log(named(member)+': '+plan.name+' 상대를 찾으러 '+decision.outing.name+' 이동');
   return true;
  }
  function book(life,actor){return (life.contacts||(life.contacts={}))[String(actor)]||(life.contacts[String(actor)]={});}
  var friendlyTalk=['Co_Career_SmallTalk','Co_Friendship_G08_2','Co_friendship_R02_2','Co_SLM_CheerUpTalk',
   'Co_SLM_ComplimentTalk','Co_Sharing_Preference','Co_friendship_R03_2'];
  var greeting=/^(인사하기|친근하게 인사하기|자기소개하기|Say Hello|Introduce Yourself)$/i;
  function romanceGoal(condition,plan){
   return condition.conditionType==='Marriage'||condition.conditionType==='RelationshipCount'&&
    /Lover|Love|Engage|Spouse|Marri|Romance|Dating|Couple/i.test(String(condition.conditionId1)+' '+plan.name);
  }
  // Matches a goal to a conversation with this person. Returns {action,plan} for a talk, or
  // {romance:true,plan} so the courtship logic picks the step that fits the relationship stage.
  async function goalConversation(decision,available,other,minute,goal,relationship){
   var plans=goal?[goal.plan]:decision.goalPlans||[];
   var stats=relationship&&relationship.stats||{}, friend=stats.Friendship&&stats.Friendship.value;
   for(var i=0;i<plans.length;i++){
    var plan=plans[i];
    if(plan.requiresTarget&&String(plan.target)!==String(other.entity_id))continue;
    var retry=decision.goalRetry&&decision.goalRetry[plan.name];
    var usable=function(a){
     return canAttempt(a)&&M.allowed(decision,plan,a.interaction_bag_id,other.entity_id,minute)&&
      !(retry&&retry.until>minute&&retry.bag===a.interaction_bag_id&&String(retry.target)===String(other.entity_id));
    };
    for(var j=0;j<plan.conditions.length;j++){
     var c=plan.conditions[j];
     if(romanceGoal(c,plan)){
      if(!L.adultAge.test(other.age_group||'Adult'))continue;
      return {romance:true,plan:plan,progress:goal&&goal.progress};
     }
     if(c.conditionType==='NewRelationshipCount'||c.conditionType==='RelationshipCount'){
      // A new relationship needs someone the Zoi barely knows; friendship goals use known people too.
      if(c.conditionType==='NewRelationshipCount'&&Number.isFinite(friend)&&friend>=10)continue;
      var intro=available.find(function(a){return usable(a)&&greeting.test(a.display_name||'');})||
       available.find(function(a){return usable(a)&&friendlyTalk.indexOf(a.interaction_bag_id)>=0;});
      if(intro)return {action:intro,plan:plan,progress:goal&&goal.progress};
      continue;
     }
     if(!isInteractionGoal(c.conditionType))continue;
     if(c.conditionType==='InteractionBagCountAtFamilyRelationshipType')continue;
     var bags=await matchGoalBags(c.conditionId1);
     var chosen=available.find(function(a){return usable(a)&&bags.indexOf(a.interaction_bag_id)>=0&&
      !/(?:Marriage|Propose|Confession)/i.test(a.interaction_bag_id);});
     if(chosen)return {action:chosen,plan:plan,progress:goal&&goal.progress};
    }
   }
   return null;
  }
  async function affection(member,other,decision,snapshot,available,forward,minute,token,options){
   options=options||{};
   var id=String(member.entity_id), targetId=String(other.entity_id), life=decisions();
   if(!L.adultAge.test(member.age_group)||!L.adultAge.test(other.age_group)||member.is_married)return false;
   if(!available.some(function(a){return a.enabled&&/^Co_(?:Romance_R|Love_Confession_|Propose_Romance_|Marriage_)/.test(a.interaction_bag_id);})){
    if(options.goal)Rel.blocked(life,id,targetId,'low',minute);
    return false;
   }
   var reverse=await cli('relationships.get_value_between',{owner_id:targetId,target_id:id});
   var actorRel=await readAt(id,'Relationship'), targetRel=await readAt(targetId,'Relationship');
   var a=L.relationshipEntry(actorRel,targetId), b=L.relationshipEntry(targetRel,id);
   var targetInfo=await readAt(targetId), household=entity(targetInfo.householdEntityId);
   if(!(household>0))return false;
   var family=await cli('household.get_members',{household_id:String(household)});
   var target=(family.members||[]).find(function(m){return String(m.entity_id)===targetId;});
   if(!target||target.is_married)return false;
   var pairs=life.pairs||(life.pairs={}), key=[id,targetId].sort().join(':');
   var pair=pairs[key]||(pairs[key]={});
   var stage=L.relationshipStage(a,b,false);
   if(pair.stage!==stage||pair.since>minute){
    if(pair.pending&&pair.stage&&pair.stage!==stage){
     log(named(member)+' / '+named(other)+': 관계 단계 확인 - '+stage);
     Rel.settle(life,id,targetId,forward,minute,{stageChanged:true});
    }
    pair.stage=stage;pair.since=minute;pair.pending=null;
   }
   if(pair.pending&&minute<pair.pending.until)return false;
   if(pair.pending){
    pair.pending=null;pair.rejectedUntil=minute+1440;
    var refused=Rel.settle(life,id,targetId,forward,minute,{formalExpired:true});
    if(refused)log(named(member)+' / '+named(other)+': 관계 진전 결과 없음 · '+refused.reason+' · 시간을 두고 다시 시도');
   }
   if(minute<(pair.next||0))return false;
   var f=forward.stats||{}, r=reverse.stats||{};
   var actor=await readAt(id);
   var choice=L.romanceChoice({
    actorAge:member.age_group,targetAge:other.age_group,
    family:!!(a&&a.bIsFamilyRelationship||b&&b.bIsFamilyRelationship||f.Family&&f.Family.value>0||r.Family&&r.Family.value>0),
    otherPartner:L.hasOtherPartner(actorRel,targetId)||L.hasOtherPartner(targetRel,id),
    recentRejection:minute<(pair.rejectedUntil||0),stage:stage,stageMinutes:minute-pair.since,
    aFriend:f.Friendship&&f.Friendship.value,bFriend:r.Friendship&&r.Friendship.value,
    aRomance:f.Romance&&f.Romance.value,bRomance:r.Romance&&r.Romance.value,
    marriageAllowed:!!(actor.autonomyOption&&actor.autonomyOption.allowMarriage&&actor.autonomyOption.allowMarriage.value&&
      targetInfo.autonomyOption&&targetInfo.autonomyOption.allowMarriage&&targetInfo.autonomyOption.allowMarriage.value),
    lastBag:pair.lastBag
   },available);
   if(!choice){
    if(options.goal)Rel.blocked(life,id,targetId,minute<(pair.rejectedUntil||0)?'rejected':'low',minute);
    return false;
   }
   pair.next=minute+(options.goal?45:90);
   await write('interaction.execute',{entity_id:id,target_entity_id:targetId,interaction_bag_id:choice.action.interaction_bag_id},token);
   pair.lastBag=choice.action.interaction_bag_id;
   if(choice.kind!=='courtship')pair.pending={kind:choice.kind,until:minute+180};
   Rel.attempted(life,id,targetId,{name:named(other)},forward,choice.action.interaction_bag_id,choice.kind,minute);
   decision.lastTalk=named(other)+' / '+choice.action.display_name;
   log(named(member)+'의 관계 행동 요청: '+decision.lastTalk);
   return {kind:choice.kind,bag:choice.action.interaction_bag_id,display_name:choice.action.display_name};
  }
  async function budget(member,minute){
   var h=String(member.household_id);
   if(householdCache[h]&&minute>=householdCache[h].minute&&minute-householdCache[h].minute<60)return householdCache[h].value;
   var family=await cli('household.get_members',{household_id:h});
   var value=L.dayBudget(await readAt(h,'Currency'),(family.members||[]).length);
   if(value)householdCache[h]={minute:minute,value:value};
   return value;
  }
  async function occupation(member,character,decision,snapshot,skills,minute){
   var finance=await budget(member,minute);
   if(!finance)return null;
   var traits=P.traits(snapshot.trait), candidate=L.entrepreneur(traits,skills);
   var jobs=L.sideJobs(traits,skills);
   var owned=(character.householdBizProfile&&character.householdBizProfile.managedHouseholdBizIdList||[]).filter(function(x){return entity(x)>0;});
   var plan={cash:finance.cash,reserve:finance.reserve,short:finance.short,
    side:jobs[0],business:candidate,ownedBusiness:null,primary:'구직과 본업 비교'};
   if(owned.length){
    var id=entity(owned[0]);
    var info=await cli('household_biz.get_info',{household_biz_id:String(id)});
    var profit=finance.records.filter(function(r){return entity(r.bizId)===id;}).reduce(function(sum,r){return sum+r.amount;},0);
    plan.ownedBusiness={id:id,site:info.site_entity_id,operating:info.is_operating,profit:profit};
    plan.primary=info.is_operating===true&&candidate&&profit>0&&!finance.short?'사업 우선':'사업 수입과 본업 비교';
   }
   if(finance.short)plan.primary='생활비 보충 우선';
   // 0.5.7: the working life this individual is on (직장인 / 창업 / 자유직) and its next step.
   var day=Math.floor(minute/1440), book=decision.careerPath||(decision.careerPath={});
   CP.plan(book,{id:member.entity_id,day:day,age:member.age_group,traits:traits,skills:skills,ambition:decision.ambition,
    employed:member.has_career===true,daysInJob:Number.isFinite(decision.careerSince)?Math.max(0,day-decision.careerSince):0,
    cash:finance.cash,reserve:finance.reserve,short:finance.short,business:candidate,
    ownsBusiness:!!plan.ownedBusiness,bizOperating:!!(plan.ownedBusiness&&plan.ownedBusiness.operating===true),
    bizProfit:plan.ownedBusiness?plan.ownedBusiness.profit:0});
   if(CP.worksAlone(book)||book.step==='resign'&&book.solo){if(!book.solo||book.solo.since>day)book.solo={since:day};}
   else book.solo=null;
   decision.lifePlan=plan;
   return plan;
  }
  async function sideIncome(member,character,decision,plan,snapshot,skills,minute,token){
   if(!plan||!(plan.short||CP.worksAlone(decision.careerPath))||!L.adultAge.test(member.age_group)||!L.relaxed(snapshot.queue)||minute<(decision.nextSide||0))return false;
   var local=await inventory(member,character);
   if(!local)return A.result('waiting','부수입에 쓸 컴퓨터를 확인할 장소 대기',minute+45);
   var computers=closest(local.objects,character,/(?:Computer|Laptop|Desktop|^PC)/i,3);
   var choices=L.sideJobs(P.traits(snapshot.trait),skills).map(function(j){return j.kind;});
   decision.nextSide=minute+180;
   var action=await objectAction(member,computers,function(items){
    var valid=items.filter(function(a){return a.enabled===true;});
    for(var i=0;i<choices.length;i++){
     var publish=valid.find(function(a){return a.interaction_bag_id==='Creation_Publishing_'+choices[i];});
     if(publish)return publish;
    }
    for(var k=0;k<choices.length;k++){
     var create=valid.find(function(a){return a.interaction_bag_id==='Creation_Computer_'+choices[k];});
     if(create)return create;
    }
   },token);
   if(action){log(named(member)+': '+(plan.short?'생활비 보충':'자유 작업')+' 행동 요청 / '+action.display_name);return true;}
   return A.result('waiting',computers.length?'게임이 허용하는 제작·출판 행동이 없음':'사용 가능한 컴퓨터 없음',minute+90);
  }
  async function attend(member,character,decision,snapshot,time,minute,token,news){
   var trip=decision.outing, location=entity(character.locatedSiteId);
   var activity=trip&&trip.activity, playing=snapshot.queue.current;
   if(activity&&typeof activity==='object'&&playing&&playing.interaction_bag_id===activity.bag&&
      String(playing.target_entity_id)===String(activity.target)){
    activity.started=true;
    return false;
   }
   if(!L.adultAge.test(member.age_group)||!L.relaxed(snapshot.queue)||L.urgentNeed(snapshot.stats.stats)||
      snapshot.work.is_working_time||snapshot.work.is_commute_time||snapshot.work.is_at_work)return false;
   if(trip&&trip.event&&location===trip.site&&minute<trip.end){
    if(typeof activity==='string')activity=trip.activity={bag:activity,at:trip.arrived||trip.start,tries:1};
    if(activity&&(activity.started||activity.tries>=2||minute-activity.at<45))return false;
    var local=await inventory(member,character), tags=trip.tags.slice();
    if(!local||local.site.entity_id!==trip.site)return false;
    for(var i=0;i<trip.rules.length;i++){
     var rule=await row('CalendarEventRule',trip.rules[i]);
     if(rule.calendarEventRuleType==='InteractionBag'&&rule.tag)tags.push(rule.tag);
    }
    var bags=[];
    for(var j=0;j<tags.length;j++)bags=bags.concat(await matchGoalBags(tags[j]));
    if(!bags.length)return false;
    var targets=closest(local.objects,character,trip.event==='FullHaul'?/fish|pier|rod|ocean/i:/.*/,18);
    targets.unshift({entity_id:member.entity_id},{entity_id:trip.site});
    var action=await objectAction(member,targets,function(items){
     return items.find(function(a){return canAttempt(a)&&bags.indexOf(a.interaction_bag_id)>=0;});
    },token);
    if(action){
     trip.activity={bag:action.interaction_bag_id,target:action.observer_target,at:minute,tries:(activity&&activity.tries||0)+1};
     log(named(member)+': '+trip.name+' 현장 활동 요청 / '+action.display_name);
     return true;
    }
    return false;
   }
   if(trip||!news||news.day!==time.day||news.map!==api.game().map_id||
      ['Hunger','Sleep','Toilet'].some(function(k){return !snapshot.stats.stats[k]||snapshot.stats.stats[k].pct<40;}))return false;
   var catalog=(await currentSites());
   for(var k=0;k<news.events.length;k++){
    var event=news.events[k];
    if(event.end<=minute+20||decision.lastEvent===time.day+':'+event.id)continue;
    var site=catalog.find(function(s){return s.id===event.siteId&&s.entity_id>0;});
    if(!site)continue;
    var info=(await row('Site',site.id)).defaultInfo;
    if(!info||info.siteType!=='Public'||info.bDisabled||info.bDevOnly)continue;
    var moved=location!==site.entity_id;
    if(moved&&!await move(member,site.entity_id,token))continue;
    decision.lastEvent=time.day+':'+event.id;
    decision.outing={site:site.entity_id,name:event.title,start:minute,event:event.id,end:event.end,rules:event.rules||[],tags:event.tags||[]};
    if(moved){
     log(named(member)+': 소식함 행사 이동 요청 / '+event.title+' · '+(site.l10n||site.id));
     return true;
    }
    return attend(member,character,decision,snapshot,time,minute,token,news);
   }
   return false;
  }
  async function vacation(member,character,decision,snapshot,time,minute,token,seasonLength,startTravel){
   if(!L.adultAge.test(member.age_group))return false;
   var plan=L.vacationPlan(decision.vacation,time.day,seasonLength);
   if(!plan)return false;
   decision.vacation=plan;
   var wishes=(decision.goalPlans||[]).some(function(g){return g.conditions.some(function(c){
    return c.conditionType==='AddEntityTagCount'&&c.conditionId1==='Stay_CheckIn';
   });});
   if(decision.outing||plan.trips.length>=5||(!wishes&&(plan.next===null||time.day<plan.next))||
      plan.trips.some(function(t){return t.day===time.day;})||minute<(decision.nextVacation||0)||
      !L.relaxed(snapshot.queue)||snapshot.work.is_at_work||snapshot.work.is_working_time||snapshot.work.is_commute_time)return false;
   if(time.hour<8||time.hour>=15||L.urgentNeed(snapshot.stats.stats))return false;
   var location=entity(character.locatedSiteId), home=await homeMember(member,character);
   if(!(home>0)||location!==home)return false;
   decision.nextVacation=minute+60;
   var actor=String(member.entity_id), work=snapshot.work;
   var schedule=await cli('schedule.diagnose',{entity_id:actor});
   if(schedule.has_schedule){decision.vacationNote='진행 중 일정 이후';return false;}
   if(work.is_working_day){
    decision.vacationNote='다음 휴무일 대기';
    if(decision.leaveDay===time.day)return false;
    var local=await inventory(member,character);
    if(!local)return false;
    var timeline=await readAt(actor,'Timeline'), entry=timeline.careerTimelineParams&&timeline.careerTimelineParams.business;
    if(!entry||!Number.isFinite(entry.vacationDayFlags))return false;
    var computers=closest(local.objects,character,/Computer|Laptop|Desktop|^PC\d/i,3);
    var leave=await objectAction(member,computers,function(actions){
     return actions.find(function(a){return a.enabled===true&&a.interaction_bag_id==='CareerCommon_UseVacation';});
    },token);
    decision.leaveDay=time.day;
    if(leave){
     decision.leavePending={flags:entry.vacationDayFlags,day:time.day};
     decision.vacationNote='게임 휴가 사용 요청';
     log(named(member)+': 게임에 휴가 사용 요청');
     return true;
    }
    return false;
   }
   if(decision.leavePending){
    var after=await readAt(actor,'Timeline'), slot=after.careerTimelineParams&&after.careerTimelineParams.business;
    if(slot&&slot.vacationDayFlags!==decision.leavePending.flags)log(named(member)+': 게임 휴가 일정 반영 확인');
    decision.leavePending=null;
   }
   if(time.hour<9||['Hunger','Sleep','Toilet'].some(function(k){return !snapshot.stats.stats[k]||snapshot.stats.stats[k].pct<42;})){
    decision.vacationNote='출발 전 욕구 또는 시간 확인';return false;
   }
   if(plan.extra){
    var funds=await budget(member,minute);
    if(!funds||funds.cash<funds.reserve+600)return false;
   }
   if(!state.background&&startTravel)return startTravel();
   if(wishes)decision.vacationNote='숙소 체크인은 게임 화면 입력 대기';
   if(wishes)return false;
   var last=plan.trips[plan.trips.length-1];
   var site=L.leisureSite(await currentSites(),P.traits(snapshot.trait),last&&last.site);
   if(!site)return false;
   var info=(await row('Site',site.id)).defaultInfo;
   if(!info||info.siteType!=='Public'||info.bDisabled||info.bDevOnly||site.entity_id===home)return false;
   if(!await move(member,site.entity_id,token))return false;
   decision.outing={site:site.entity_id,name:site.l10n||site.id,start:minute,vacation:true};
   decision.vacationNote='여행지로 이동 중';
   log(named(member)+': 휴가 외출 요청 / '+decision.outing.name);
   return true;
  }
  async function outing(member,character,decision,snapshot,time,minute,token){
   if((!L.adultAge.test(member.age_group)&&!(decision.outing&&decision.outing.goalVisit))||
      !L.relaxed(snapshot.queue)||snapshot.work.is_at_work||snapshot.work.is_commute_time||snapshot.work.is_working_time)return false;
   var location=entity(character.locatedSiteId), home=await homeMember(member,character);
   if(decision.outing){
    var trip=decision.outing;
    if(location===home&&trip.returning){log(named(member)+': 외출 후 귀가 확인');decision.outing=null;return false;}
    if(location===trip.site&&!trip.arrived){
     trip.arrived=minute;log(named(member)+': '+trip.name+' 도착 확인');
     if(trip.vacation&&decision.vacation){
      var trips=decision.vacation.trips;
      if(trips.length<5&&!trips.some(function(t){return t.day===time.day;})){
       trips.push({day:time.day,site:trip.site});
       decision.vacationNote='여행 도착 확인';
       log(named(member)+': 이번 게임 연도 휴가 '+trips.length+'회 도착 확인');
      }
     }
    }
    if((trip.event?minute>=trip.end||trip.arrived&&minute-trip.arrived>=120:
       trip.arrived&&minute-trip.arrived>=120||time.hour>=19||minute-trip.start>=300)&&
       location!==home&&home>0&&minute>=(trip.nextReturn||0)){
     trip.nextReturn=minute+45;
     if(await move(member,home,token)){
      trip.returning=true;log(named(member)+': 외출을 마치고 귀가 요청');
      // A search trip that ends without the action counts as a miss, so the next search tries another place.
      if(trip.goalVisit&&trip.cond&&!trip.found)venueNote(null,{conditionId1:trip.cond},trip.site,false,minute);
      return true;
     }
    }
    if(location===home&&!trip.arrived&&minute-trip.start>=240)decision.outing=null;
    return false;
   }
   if(snapshot.work.is_working_day||time.hour<10||time.hour>15||location!==home||minute<(decision.nextOuting||0))return false;
   var stats=snapshot.stats.stats;
   if(['Hunger','Sleep','Toilet'].some(function(key){return !stats[key]||stats[key].pct<45;}))return false;
   var wants=snapshot.hope.selected.some(function(h){return /Travel|Resort|GoOut|Beach/i.test(h.hope_id);});
   if(!wants&&(!stats.Fun||stats.Fun.pct>65)&&(!stats.Society||stats.Society.pct>65))return false;
   var site=L.leisureSite(await currentSites(),P.traits(snapshot.trait),decision.lastOuting);
   if(!site)return false;
   var info=(await row('Site',site.id)).defaultInfo;
   if(!info||info.siteType!=='Public'||info.bDisabled||info.bDevOnly)return false;
   decision.nextOuting=minute+2*1440;
   if(!await move(member,site.entity_id,token))return false;
   decision.outing={site:site.entity_id,name:site.l10n||site.id,start:minute};
   decision.lastOuting=site.entity_id;
   log(named(member)+': 외출지 선택 / '+decision.outing.name);
   return true;
  }
  async function householdPlan(member,character,decision,plan,minute){
   if(!plan||minute<(decision.nextHousePlan||0))return;
   var local=await inventory(member,character);
   if(!local||local.site.entity_id!==await homeMember(member,character))return;
   decision.nextHousePlan=minute+360;
   var missing=[];
   for(var i=0;i<essentials.length;i++){
    var item=essentials[i];
    if(local.objects.some(function(o){return item.fixture.test(o.table_id||'');}))continue;
    var product=await row('Object',item.item);
    missing.push({label:item.label,item:item.item,price:product.price,
     affordable:product.price>0&&product.price<=Math.min(item.max,plan.cash-plan.reserve)});
   }
   decision.housePlan={site:local.site.l10n,missing:missing};
   var people=api.members().filter(function(m){return m.household_id===member.household_id;}).length;
   var rooms=local.summary.counts&&local.summary.counts.rooms;
   if(rooms>0&&rooms<people+1){
    decision.housePlan.cramped=true;
    decision.housePlan.moveStatus='기존 가구 이사에 사용할 수 있는 실행 경로 미확인';
   }
   var traits=P.traits(api.snapshot(member.entity_id).trait);
   decision.housePlan.adoption=people>=1&&rooms>=people+2&&plan.cash>plan.reserve+6000&&
    traits.some(function(t){return /^(?:Helper|Cooperator|Romantic)$/.test(t);})?'입양 메뉴 행동은 확인 · 실제 접수와 가구 합류 확인 경로 미지원':null;
  }
  function clearTile(floors,walls,objects,bounds){
   var floor=(floors.floors||[]).find(function(f){return f.floor_level===0;});
   if(!floor||!bounds||!bounds.min||!bounds.max||!walls.walls||walls.walls.length!==walls.total)return null;
   function distance(p,w){
    var ax=w.left.x, ay=w.left.y, dx=w.right.x-ax, dy=w.right.y-ay;
    var t=Math.max(0,Math.min(1,((p.x-ax)*dx+(p.y-ay)*dy)/(dx*dx+dy*dy||1)));
    return Math.hypot(p.x-ax-t*dx,p.y-ay-t*dy);
   }
   // 0.4.7: not only room centres (usually taken by a table): also points around each centre.
   // In game the easel and the guitar could not be placed because every centre was occupied.
   var offsets=[[0,0]];
   [120,220,320].forEach(function(r){[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]].forEach(function(d){offsets.push([d[0]*r,d[1]*r]);});});
   var points=[];
   (floor.rooms||[]).forEach(function(r){
    if(!r.center)return;
    offsets.forEach(function(o){points.push({x:r.center.x+o[0],y:r.center.y+o[1],z:r.center.z});});
   });
   return points.find(function(p){
    if(!p||p.x<bounds.min.x+100||p.y<bounds.min.y+100||p.x>bounds.max.x-100||p.y>bounds.max.y-100)return false;
    return walls.walls.every(function(w){return distance(p,w)>85;})&&
     objects.filter(function(o){return o.floor_level===0&&o.location;}).every(function(o){
      return Math.hypot(p.x-o.location.x,p.y-o.location.y)>110;
     });
   })||null;
  }
  async function waitBuild(siteId){
   for(var i=0;i<24;i++){
    var mode=await cli('build.get_mode_state');
    if(mode.phase==='ready')return mode.site_id===siteId?mode:null;
    await new Promise(function(resolve){setTimeout(resolve,500);});
   }
   return null;
  }
  function canFurnish(member,snapshot){
   return L.adultAge.test(member.age_group)&&L.relaxed(snapshot.queue)&&!L.urgentNeed(snapshot.stats.stats)&&
    String(api.game().possessed_entity_id)===String(member.entity_id);
  }
  async function furnish(member,character,decision,plan,snapshot,skills,minute,token){
   if(!plan)return false;
   if(!canFurnish(member,snapshot)){
    if(decision.housePlan&&decision.housePlan.missing.length)return A.result('waiting','선택한 보호자가 다른 행동을 끝내면 필수 가구 배치 재검토',minute+15);
    return false;
   }
   var local=await inventory(member,character);
   if(!local||local.summary.site_type!=='Residence'||local.site.entity_id!==await homeMember(member,character))return false;
   var retries=decision.furnitureRetries||(decision.furnitureRetries={});
   var missing=essentials.filter(function(item){return !local.objects.some(function(o){return item.fixture.test(o.table_id||'');});});
   for(var i=0;i<missing.length;i++){
    var basic=missing[i];
    if((retries[basic.item]||0)>minute)continue;
    var product=await row('Object',basic.item);
    if(!(product.price>0&&product.price<=Math.min(basic.max,plan.cash-plan.reserve)))continue;
    if(basic.item==='Fridge02'&&(product.objectCategory!=='Fridge'||!(product.objectTags||[]).includes('Fridge')||
       (product.objectTags||[]).includes('BizStaffOnly')))continue;
    retries[basic.item]=minute+90;
    var built=await placeHouseItem(member,local,basic.item,plan,basic.max,token,basic.fixture);
    retries[basic.item]=minute+(built?360:90);
    if(built){
     if(built.status==='verified'&&decision.housePlan)decision.housePlan.missing=decision.housePlan.missing.filter(function(x){return x.item!==basic.item;});
     decision.nextHousePlan=minute;
     return built;
    }
    return A.result('waiting',basic.label+' 배치 조건 또는 결과 확인 대기',minute+30);
   }
   if(missing.length)return A.result('waiting','필수 가구의 예산·배치 재시도 대기',minute+45);
   if(minute<(decision.nextFurnish||0))return false;
   var dirty=local.objects.filter(function(o){return /^DEV_DustDecal/.test(o.table_id);}).length;
   if(dirty<2)return false;
   var hasTool=local.objects.some(function(o){return /^(?:Mop\d|Broom\d|VacuumCleaner)/i.test(o.table_id);});
   var hasVacuum=local.objects.some(function(o){return /^VacuumCleaner/i.test(o.table_id);});
   var housework=skills.find(function(s){return s.id==='Housework';});
   if(hasVacuum){decision.skillGoal=null;return false;}
   if(hasTool&&dirty>=4&&(!housework||housework.level<3)){
    decision.skillGoal='집안일 '+(housework?housework.level:0)+'/3 · 청소 행동으로 연습';
    return false;
   }
   if(hasTool&&(dirty<4||(decision.cleanCount||0)<2))return false;
   var item=hasTool?'VacuumCleaner01':'Mop01';
   decision.nextFurnish=minute+1440;
   var upgraded=await placeHouseItem(member,local,item,plan,550,token);
   if(!upgraded)return false;
   decision.skillGoal=null;
   return upgraded;
  }
  async function placeHouseItem(member,local,item,plan,maxPrice,token,fixture){
   var data=await row('Object',item);
   var spare=plan.cash-plan.reserve;
   if(!Number.isFinite(data.price)||data.price<=0||data.price>Math.min(maxPrice,spare))return false;
   var floors=await cli('build.scan_floors',{floor_level:0});
   var walls=await cli('build.scan_walls',{floor_level:0,Limit:0});
   var point=clearTile(floors,walls,local.objects,local.summary.coord_space);
   if(!point){log(named(member)+': '+item+' 배치에 필요한 빈 공간 확인 대기');return false;}
   var original=await cli('build.get_mode_state');
   if(original.phase!=='none'||original.pending)return false;
   var entered=false, cleanSession=false, placed=false;
   try{
    var start=await write('build.enter_mode',{site_id:local.site.id},token,null,String(member.entity_id));
    if(!start||!start.accepted)return false;
    entered=true;
    var mode=await waitBuild(local.site.id);
    if(!mode||!mode.editable||mode.has_undo)return false;
    cleanSession=true;
    if(!api.active(token))return false;
    var fresh=await cli('build.scan_objects',{Limit:0});
    if(!Array.isArray(fresh.objects)||fresh.total!==fresh.objects.length||
       fresh.objects.some(function(o){return o.table_id===item||fixture&&fixture.test(o.table_id||'');}))return false;
    var again=clearTile({floors:[{floor_level:0,rooms:[{center:point}]}]},walls,fresh.objects,local.summary.coord_space);
    if(!again||again.x!==point.x||again.y!==point.y)return false;
    var cash=await readAt(member.household_id,'Currency');
    if(!cash.currencyMap||!Number.isFinite(cash.currencyMap.mew)||cash.currencyMap.mew-plan.reserve<data.price||!api.active(token))return false;
    var placedObject=await cli('building.place_object',{object_table_id:item,X:point.x,Y:point.y,floor_level:0,Yaw:0});
    if(!placedObject||placedObject.committed!==true)return false;
    placed=true;
    if(api.markAccepted)api.markAccepted();
    var after;
    try{after=await cli('build.scan_objects',{table_id_prefix:item,Limit:0});}
    catch(_){return A.result('requested',item+' 배치 명령 접수 · 물건 확인 대기');}
    if((after.objects||[]).some(function(o){return o.entity_id===placedObject.entity_id&&o.table_id===item;})){
     log(named(member)+': 물건 구매·배치 확인 / '+item+' ('+placedObject.price+')');
     return A.result('verified',item+' 배치 확인');
    }
    return A.result('requested',item+' 배치 명령 접수 · 물건 확인 대기');
   }finally{
    if(entered){
     var end=await cli('build.get_mode_state');
     if(end.phase==='ready'&&end.site_id===local.site.id&&(!end.has_undo||cleanSession&&placed)){
      await cli('build.exit_mode');
     }else if(end.phase!=='none')log('건축 화면 복귀 결과 미확인. 현재 건축 상태를 확인하세요.');
     delete homeCache[api.game().map_id+':'+local.site.entity_id];
    }
   }
  }
  // 0.4.7: lonely and nobody nearby: go where people are (park, market, cafe) instead of waiting at home.
  async function socialOuting(member,character,decision,snapshot,time,minute,token){
   if(decision.outing||minute<(decision.nextSocialOuting||0)||time.hour<9||time.hour>=20||!L.tripReady(snapshot.stats.stats))return false;
   var home=await homeMember(member,character);
   if(entity(character.locatedSiteId)!==home)return false;
   decision.nextSocialOuting=minute+480;
   var catalog=await currentSites(), best=null;
   for(var i=0;i<catalog.length;i++){
    var site=catalog[i];
    if(!(site.entity_id>0)||!/(?:Public|Business)/i.test(site.id)||/Residence|School|RabbitHole|PierWalkway|Cemetery|Funeral|Police|Resort/i.test(site.id))continue;
    var info=(await row('Site',site.id)).defaultInfo;
    if(!info||info.bDisabled||info.bDevOnly)continue;
    var t=(info.tags||[]).join(' ');
    var score=/SiteTag_Market|TPO_Site_Activity_StreetFood/.test(t)?3:/SiteTag_Park|TPO_Site_Public/.test(t)?2:/Cafe|Orderable/.test(t)?1:0;
    if(score&&(!best||score>best.score||score===best.score&&site.entity_id!==decision.lastSocialSite&&Math.random()<0.5))best={site:site,score:score};
   }
   if(!best||!await move(member,best.site.entity_id,token))return false;
   decision.outing={site:best.site.entity_id,name:best.site.l10n||best.site.id,start:minute,social:true};
   decision.lastSocialSite=best.site.entity_id;
   log(named(member)+': 사교 '+snapshot.stats.stats.Society.pct+'% · 사람을 만나러 '+decision.outing.name+' 이동');
   return true;
  }
  async function computers(member,character){
   var local=await inventory(member,character);
   return local?closest(local.objects,character,/(?:Computer|Laptop|Desktop|^PC)/i,3):[];
  }
  async function siteObjects(member,character){
   var local=await inventory(member,character);
   return local?closest(local.objects,character,/./,12):[];
  }
  function reset(){sites=null;householdCache={};homeCache={};houseTasks={};repairs={};}
  return {reset:reset,needs:needs,routine:routine,clean:clean,repair:repair,parcels:parcels,marketNeed:marketNeed,reviewGoal:reviewGoal,trackGoal:trackGoal,prepareGoals:prepareGoals,attend:attend,
   pursueHope:pursueHope,prepareAmbition:prepareAmbition,pursueAmbition:pursueAmbition,
   affection:affection,goalConversation:goalConversation,meetForGoal:meetForGoal,
   occupation:occupation,sideIncome:sideIncome,outing:outing,socialOuting:socialOuting,ensureTraining:ensureTraining,vacation:vacation,householdPlan:householdPlan,furnish:furnish,move:move,home:homeMember,computers:computers,siteObjects:siteObjects,objectAction:objectAction};
 }
 root.ObserverLifeActions={create:create};
})(this);
