(function (root) {
 'use strict';
 var L=root.ObserverLife, P=root.ObserverPolicy, M=root.ObserverGoalMemory;

 function create(api){
  var cli=api.cli, write=api.write, log=api.log, state=api.state;
  var rows={}, sites=null, householdCache={}, homeCache={}, hopeActions={}, houseTasks={}, repairs={};
  function decisions(){return state.life||(state.life={pairs:{}});}
  function entity(value){return value&&value.value;}
  function named(member){return member.first_name||String(member.entity_id);}
  function readAt(id,component){return cli('entity.reflect',component?{entity_id:String(id),Component:component}:{entity_id:String(id)});}
  async function row(alias,id){
   var key=alias+':'+id;
   if(!rows[key])rows[key]=await cli('data.table_get',{Alias:alias,Row:id});
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
    var target=String(objects[i].entity_id), available;
    try{
     available=offers&&offers[target];
     if(!available){
      available=await cli('interaction.list_available',{entity_id:id,target_entity_id:target});
      if(offers)offers[target]=available;
     }
    }
    catch(_){continue;}
    var action=choose(available.interactions||[],target);
    if(!action)continue;
    try{await write('interaction.execute',{entity_id:id,target_entity_id:target,interaction_bag_id:action.interaction_bag_id},token);}
    catch(e){e.observerBag=action.interaction_bag_id;e.observerTarget=target;throw e;}
    return Object.assign({},action,{observer_target:target});
   }
   return null;
  }
  async function move(member,target,token){
   var id=String(member.entity_id);
   var descriptor=await cli('movement.get_site_move_interaction',{entity_id:id,target_entity_id:String(target)});
   if(descriptor.execution_tool!=='interaction.execute'||String(descriptor.entity_id)!==id||
      Number(descriptor.target_entity_id)!==Number(target)||descriptor.requires_zoi_group||!descriptor.interaction_bag_id)return false;
   await write('interaction.execute',{entity_id:id,target_entity_id:String(target),interaction_bag_id:descriptor.interaction_bag_id,SmartZoi:descriptor.smartzoi===true},token);
   return true;
  }
  async function homeMember(member,character){
   var family=await readAt(member.household_id);
   var home=entity(family.residanceSiteId)||entity(character.boundSiteId);
   return home>0?home:0;
  }
  async function needs(member,character,decision,snapshot,minute,token){
   var need=L.urgentNeed(snapshot.stats.stats);
   if(!need){decision.needFallback=null;return false;}
   if(!L.relaxed(snapshot.queue)||minute<(decision.nextNeed||0)||snapshot.work.is_at_work)return false;
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
   if(home>0&&location!==home&&need.key!=='Cleanliness'&&await move(member,home,token)){
    decision.needFallback=null;
    log(named(member)+': 필수 욕구를 해결하려고 귀가');return true;
   }
   decision.needFallback={key:need.key,until:minute+25};
   return false;
  }
  async function clean(member,character,decision,snapshot,minute,token){
   if(!L.relaxed(snapshot.queue)||minute<(decision.nextCleaning||0))return false;
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
   if(!L.relaxed(snapshot.queue)||minute<(decision.nextRepair||0))return false;
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
   if(!L.relaxed(snapshot.queue)||minute<(decision.nextParcel||0))return false;
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
   if(String(member.entity_id)!==String(api.game().possessed_entity_id)||!L.adultAge.test(member.age_group)||
      !L.relaxed(snapshot.queue)||minute<(decision.nextMarket||0))return null;
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
  }
  async function reviewGoal(member,decision,snapshot,minute){
   if(!decision.goal)return;
   var goal=decision.goal;
   var current=snapshot.queue.current;
   var playing=current&&current.interaction_bag_id===goal.bag&&
    (!goal.target||!current.target_entity_id||String(current.target_entity_id)===String(goal.target));
   if(playing)goal.seen=true;
   var data=await readAt(member.entity_id,'Mission');
   var mission=data.missionMap&&data.missionMap['(Value='+goal.instance+')'];
   var ambition=goal.kind==='ambition', label=ambition?'야망 목표':'소망';
   var plans=ambition&&decision.ambition?decision.ambition.plans:decision.goalPlans;
   var plan=(plans||[]).find(function(p){return p.instance===goal.instance&&p.name===goal.name;})||goal;
   var progress=missionProgress(mission);
   var growth=false;
   if(goal.practice){
    var skills=await cli('skill.get_all',{entity_id:String(member.entity_id)});
    var skill=(skills.skills||[]).find(function(s){return s.id===goal.practice.skill;});
    if(skill&&Number.isFinite(skill.level)&&skill.level>goal.practice.level){
     growth=true;
     var memory=M.record(decision,plan,minute);
     memory.evidence=goal.practice.skill+' Lv.'+goal.practice.level+' → '+skill.level;
     if(goal.practice.observed!==skill.level){
      goal.practice.observed=skill.level;
      log(named(member)+': 실제 기술 성장 확인 / '+memory.evidence);
     }
    }
   }
   if(mission&&mission.bIsFinished){
    M.note(decision,plan,'completed','완료 확인','다음 목표 확인',minute);
    log(named(member)+': '+label+' 완료 확인 / '+goal.name);
    decision.nextHopeAction=minute;
    if(ambition)decision.nextAmbition=minute;
   }else if(!ambition&&!snapshot.hope.selected.some(function(h){return h.hope_id===goal.name;})){
    M.note(decision,plan,'ended','게임 목록에서 종료 · 완료 여부 미확인','새 목표 확인',minute);
    log(named(member)+': 소망 목록에서 사라짐 / '+goal.name+' (완료 여부 미확인)');
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
    if(playing)return;
   }else if(!goal.seen&&(Date.now()-(goal.sentAt||0)<20000||
     goal.at!=null&&minute-goal.at<(snapshot.queue.queue_count>0?90:30))){
    M.note(decision,plan,'running',snapshot.queue.queue_count>0?'행동 대기열 확인 중':'행동 시작 확인 중','실제 행동 시작 확인',minute);
    return;
   }else{
    var reason=goal.practice&&goal.seen?'연습 종료 · 기술 레벨 변화 미확인 (경험치 확인 필요)':
     goal.seen?'행동 후 조건 진행 없음':'행동 대기열 등록 또는 시작 미확인';
    // A short practice can earn XP without a level-up. Do not call it a failed action.
    if(goal.practice&&goal.seen)M.note(decision,plan,'preparing',reason,'일상 병행 후 다른 연습 대상 재검토',minute);
    else M.failed(decision,plan,goal.bag,goal.target,minute,reason);
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
    hopeActions[key]=(search.results||[]).filter(function(a){
     return String(a.interaction_bag_id).toLowerCase()===normalized||
      (a.tags||[]).some(function(t){return String(t).toLowerCase()===normalized;});
    }).map(function(a){return a.interaction_bag_id;});
   }
   return hopeActions[key];
  }
  function training(skill){
   return {
    Art:[/Easel/i,/^Art_Easel_(?:Drawing|Drawing_Small|Continue)$/],
    Instruments:[/Guitar|Piano|Keyboard|Violin|Drum/i,/^(?:Use_|Play_|Practice_).*(?:Guitar|Piano|Keyboard|Violin|Drum)/i],
    Performance:[/Mic|Karaoke/i,/^(?:Use_Mic_(?:Sing|RnB|Jazz|Rock)|.*SingingPractice)$/i],
    Speaking:[/Mirror/i,/^.*(?:Speech|PublicSpeaking|PracticeSpeaking).*$/i],
    Charisma:[/Mirror/i,/^.*(?:Charisma|Confidence|Speech|Appeal).*$/i],
    Logic:[/Chess|Computer|Bookcase|Bookshelf/i,/^(?:Use_|Computer_|Bookshelf_|Play_).*(?:Logic|Chess|CriticalThinking)/i],
    Housework:[/^(?:Mop\d|Broom\d|VacuumCleaner)/i,/^(?:Object_Mopping_Home|Object_.*(?:Sweep|Vacuum).*Home)$/],
    HandCraft:[/Workbench|WorkTable|Craft|Woodwork/i,/^(?!.*(?:Buy|Sell|Purchase|Destroy|Fail)).*(?:HandCraft|Woodwork|CraftPractice|Craft_Practice)/i]
   }[skill];
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
  async function recoverGoal(member,character,decision,snapshot,time,minute,token,plan,condition){
   var tags=L.goalVenueTags(plan.name,condition.conditionId1);
   if(!tags.length||plan.requiresTarget||decision.outing||L.urgentNeed(snapshot.stats.stats)||
      snapshot.work.is_at_work||snapshot.work.is_working_time||snapshot.work.is_commute_time||
      time.hour<8||time.hour>=17)return false;
   if(plan.expire_ticks>0&&plan.expire_ticks/600000000-minute<35)return false;
   if(decision.goalVisitDay!==time.day){decision.goalVisitDay=time.day;decision.goalVisits={};}
   var key=plan.name+':'+condition.conditionId1;
   if(decision.goalVisits[key]||Object.keys(decision.goalVisits).length>=3)return false;
   decision.goalVisits[key]=true;
   var actor=String(member.entity_id);
   var schedule=await cli('schedule.diagnose',{entity_id:actor});
   if(schedule.has_schedule!==false)return false;
   var location=entity(character.locatedSiteId), catalog=await currentSites();
   for(var i=0;i<catalog.length;i++){
    var site=catalog[i];
    if(!(site.entity_id>0)||site.entity_id===location||!/(?:Public|Business)/i.test(site.id)||
       /Airport|Residence|School|Prison|Dev_/i.test(site.id))continue;
    var info=(await row('Site',site.id)).defaultInfo;
    if(!info||info.bDisabled||info.bDevOnly||!/^(?:Business|Public)$/.test(info.siteType)||
       !tags.some(function(group){return group.every(function(tag){return (info.tags||[]).indexOf(tag)>=0;});}))continue;
    if(!await move(member,site.entity_id,token))continue;
    decision.outing={site:site.entity_id,name:site.l10n||site.id,start:minute,goalVisit:plan.name};
    plan.status='대체 장소로 이동 중 / '+decision.outing.name;
    log(named(member)+': '+plan.name+' 행동을 다시 찾으러 '+decision.outing.name+' 이동');
    return true;
   }
   return false;
  }
  async function pursueHope(member,character,decision,snapshot,time,minute,token,tryConversation){
   if(decision.goal||!L.relaxed(snapshot.queue)||minute<(decision.nextHopeAction||0))return false;
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
   if(decision.goal||!L.relaxed(snapshot.queue)||minute<(decision.nextAmbitionAction||0))return false;
   var ambition=await prepareAmbition(member,decision,minute);
   if(!ambition||!ambition.plans.length)return false;
   decision.nextAmbitionAction=minute+25;
   return pursuePlans(member,character,decision,snapshot,time,minute,token,ambition.plans,tryConversation);
  }
  async function pursuePlans(member,character,decision,snapshot,time,minute,token,plans,tryConversation){
   var local, nearby, offers=Object.create(null), missions=plans.length?await readAt(member.entity_id,'Mission'):{};
   for(var i=0;i<plans.length;i++){
    var plan=plans[i], progress=missions.missionMap&&missions.missionMap['(Value='+plan.instance+')'], label=plan.kind==='ambition'?'야망':'소망';
    if(progress&&progress.bIsFinished){M.note(decision,plan,'completed','완료 확인','다음 목표 확인',minute);continue;}
    if(plan.kind==='ambition'&&(!progress||!progress.bIsActive)){
     plan.status='게임에서 미션 활성화 대기';continue;
    }
    var retry=decision.goalRetry&&decision.goalRetry[plan.name];
    for(var j=0;j<plan.conditions.length;j++){
     var condition=plan.conditions[j], type=condition.conditionType;
     var count=progress&&progress.conditionStates&&progress.conditionStates[j];
     if(count&&count.compareType==='GreaterOrEqual'&&count.currentCount>=count.goalCount)continue;
     if(type==='EnterSiteCount'||type==='EnterSiteTagCount'){
      var site=await visitForGoal(member,character,condition,snapshot,time,token);
      plan.status=site?'목적지로 이동 중':'여유 시간 또는 이용 가능한 목적지 대기';
      if(site){
       trackGoal(decision,plan,'LLM_WalkToSite',site.entity_id,minute,progress);
       decision.outing={site:site.entity_id,name:site.l10n||site.id,start:minute};
       log(named(member)+'의 '+label+' 외출: '+decision.outing.name);return true;
      }
      continue;
     }
     if(/^(?:Marriage|NewRelationshipCount|RelationshipCount|TalkInteractionBagTag|InteractionBagCountAtFamilyRelationshipType)$/.test(type)){
      if(tryConversation&&await tryConversation(plan,progress)){
       plan.status=label+' 대화 실행 요청';return true;
      }
      plan.status='관계·대화 조건 또는 상대 대기';continue;
     }
     var practice=type==='SkillLevel'?training(condition.conditionId1):null;
     var skillBaseline=null;
     if(practice){
      if(!M.practiceAllowed(decision,plan,minute)){
       M.note(decision,plan,'waiting','오늘 준비 연습 3회 · 일상생활 우선','다음 게임 날짜에 연습 재검토',minute);continue;
      }
      var skillData=await cli('skill.get_all',{entity_id:String(member.entity_id)});
      var currentSkill=(skillData.skills||[]).find(function(s){return s.id===condition.conditionId1;});
      if(!currentSkill||!Number.isFinite(currentSkill.level)){
       M.note(decision,plan,'unsupported','현재 기술 수치 확인 필요 / '+condition.conditionId1,'게임 기술 응답 확인',minute);continue;
      }
      skillBaseline={skill:currentSkill.id,level:currentSkill.level};
      M.note(decision,plan,'preparing',condition.conditionId1+' Lv.'+currentSkill.level+' · 준비 연습 탐색',
       '가능한 행동 실행 후 실제 기술 성장 확인',minute);
     }
     if(type==='AddEntityTagCount'&&condition.conditionId1==='Stay_CheckIn'){
      M.note(decision,plan,'waiting','실제 숙소 체크인 필요','현지 체크인 행동과 게임 미션 진행 확인',minute);continue;
     }
     var bags=type==='AddBuffCount'&&condition.conditionId1==='Buff_GetLicense_Delivery'?
      ['Computer_Use_GetLicense_Delivery','Laptop_Use_GetLicense_Delivery']:
      isInteractionGoal(type)?await matchGoalBags(condition.conditionId1):[];
     if(!practice&&!bags.length){
      M.note(decision,plan,'unsupported','실행 연결 대기 / '+type+' '+condition.conditionId1,
       '게임에서 가능한 실행 경로 확인',minute);continue;
     }
     if(local===undefined)local=await inventory(member,character);
     var items=local?local.objects:[];
     var pattern=practice?practice[0]:/GetLicense/i.test(condition.conditionId1)?/Computer|Laptop|Desktop/i:
      /wash.*hand/i.test(condition.conditionId1)?/Sink|Washstand/i:
      /disinfect/i.test(condition.conditionId1)?/^(?:Bed\d|Sofa\d)/i:
      /drink.*water/i.test(condition.conditionId1)?/WaterPurifier/i:
      /Drawing/i.test(condition.conditionId1)?/Easel|Mural|Canvas/i:
      /DisplayOre/i.test(condition.conditionId1)?/DecoShelf|Display/i:
      /Coffee/i.test(condition.conditionId1)?/Coffee|Espresso/i:
      /Phone_Sofa/i.test(condition.conditionId1)?/Sofa/i:
      /Ambition_Collect/i.test(condition.conditionId1)?/Collect|Spawn|Dig|Gem|Ore|Stone|Metal|Rock|Shell/i:
      /Read|Book/i.test(condition.conditionId1)?/Book|Shelf|Tablet|Chair|Sofa|Computer/i:/.*/;
     var targets=plan.requiresTarget?(plan.target>0?[{entity_id:plan.target}]:[]):closest(items,character,pattern,20);
     if(!plan.requiresTarget&&!targets.length&&String(api.game().possessed_entity_id)===String(member.entity_id)){
      if(nearby===undefined){
       try{nearby=(await cli('entity.scan_objects',{Radius:30,Limit:22,ref:'pawn'})).objects||[];}
       catch(_){nearby=[];}
      }
      targets=nearby;
     }
     if(!plan.requiresTarget&&(/_Self(?:_|$)/i.test(plan.name)||bags.some(function(b){return /^Self_/i.test(b);})))
      targets=[{entity_id:member.entity_id}].concat(targets);
     if(!plan.requiresTarget&&local&&L.goalVenueTags(plan.name,condition.conditionId1).length)
      targets=targets.concat({entity_id:local.site.entity_id});
     var action;
     try{
      action=await objectAction(member,targets,function(choices,target){
       return choices.find(function(a){
        return canAttempt(a)&&M.allowed(decision,plan,a.interaction_bag_id,target,minute)&&
         !(retry&&retry.until>minute&&retry.bag===a.interaction_bag_id&&String(retry.target)===target)&&
         (practice?practice[1].test(a.interaction_bag_id):bags.indexOf(a.interaction_bag_id)>=0);
       });
      },token,offers);
     }catch(e){
      if(e.observerBag)M.failed(decision,plan,e.observerBag,e.observerTarget,minute,'게임 행동 응답 확인 필요 / '+e.message);
      else M.note(decision,plan,'waiting','게임이 행동을 받지 않음 / '+e.message,'게임 상태 변경 후 재검토',minute);
      continue;
     }
     plan.status=action?label+' 행동 실행 요청':!targets.length?'조건에 맞는 대상이 근처에 없음':
      '근처 대상에서 사용할 수 있는 행동 없음';
     if(action){
      trackGoal(decision,plan,action.interaction_bag_id,action.observer_target,minute,progress,skillBaseline);
      log(named(member)+'의 '+label+' 행동 요청: '+action.display_name);
      return true;
     }
     if(await recoverGoal(member,character,decision,snapshot,time,minute,token,plan,condition))return true;
     if(type==='SkillLevel'&&condition.conditionId1==='Art'&&local&&
        !local.objects.some(function(o){return /Easel|Mural|Canvas/i.test(o.table_id||'');})&&
        (!plan.expire_ticks||plan.expire_ticks/600000000-minute>=90)&&minute>=(decision.nextGoalFurnish||0)&&
        canFurnish(member,snapshot)&&local.summary.site_type==='Residence'&&
        local.site.entity_id===await homeMember(member,character)){
      decision.nextGoalFurnish=minute+1440;
      var funds=await budget(member,minute);
      if(funds&&await placeHouseItem(member,local,'Easel01',funds,300,token)){
       plan.status='이젤 배치 · 다음 실행에서 그림 연습 확인';return true;
      }
     }
     if(decision.outing&&decision.outing.goalVisit===plan.name)
      plan.status='대체 장소에서 이용 가능한 '+condition.conditionId1+' 행동 확인 중';
     M.note(decision,plan,'waiting',plan.status,practice?'대체 연습 대상·장소 재탐색':'조건·대상 변경 후 재탐색',minute);
    }
   }
   return false;
  }
  async function goalConversation(decision,available,other,minute,goal){
   var plans=goal?[goal.plan]:decision.goalPlans||[];
   for(var i=0;i<plans.length;i++){
    var plan=plans[i];
    if(plan.requiresTarget&&String(plan.target)!==String(other.entity_id))continue;
    var retry=decision.goalRetry&&decision.goalRetry[plan.name];
    for(var j=0;j<plan.conditions.length;j++){
     var c=plan.conditions[j];
     if(!isInteractionGoal(c.conditionType))continue;
     if(c.conditionType==='InteractionBagCountAtFamilyRelationshipType')continue;
     var bags=await matchGoalBags(c.conditionId1);
     var chosen=available.find(function(a){return canAttempt(a)&&M.allowed(decision,plan,a.interaction_bag_id,other.entity_id,minute)&&bags.indexOf(a.interaction_bag_id)>=0&&
      !(retry&&retry.until>minute&&retry.bag===a.interaction_bag_id&&String(retry.target)===String(other.entity_id))&&
      !/(?:Marriage|Propose|Confession)/i.test(a.interaction_bag_id);});
     if(chosen)return {action:chosen,plan:plan,progress:goal&&goal.progress};
    }
   }
   return null;
  }
  async function affection(member,other,decision,snapshot,available,forward,minute,token){
   var id=String(member.entity_id), targetId=String(other.entity_id);
   if(!L.adultAge.test(member.age_group)||!L.adultAge.test(other.age_group)||member.is_married)return false;
   if(!available.some(function(a){return a.enabled&&/^Co_(?:Romance_R|Love_Confession_|Propose_Romance_|Marriage_)/.test(a.interaction_bag_id);}))return false;
   var reverse=await cli('relationships.get_value_between',{owner_id:targetId,target_id:id});
   var actorRel=await readAt(id,'Relationship'), targetRel=await readAt(targetId,'Relationship');
   var a=L.relationshipEntry(actorRel,targetId), b=L.relationshipEntry(targetRel,id);
   var targetInfo=await readAt(targetId), household=entity(targetInfo.householdEntityId);
   if(!(household>0))return false;
   var family=await cli('household.get_members',{household_id:String(household)});
   var target=(family.members||[]).find(function(m){return String(m.entity_id)===targetId;});
   if(!target||target.is_married)return false;
   var pairs=decisions().pairs, key=[id,targetId].sort().join(':');
   var pair=pairs[key]||(pairs[key]={});
   var stage=L.relationshipStage(a,b,false);
   if(pair.stage!==stage||pair.since>minute){
    if(pair.pending&&pair.stage&&pair.stage!==stage)log(named(member)+' / '+named(other)+': 관계 단계 확인 - '+stage);
    pair.stage=stage;pair.since=minute;pair.pending=null;
   }
   if(pair.pending&&minute<pair.pending.until)return false;
   if(pair.pending){pair.pending=null;pair.rejectedUntil=minute+1440;}
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
   if(!choice)return false;
   pair.next=minute+90;
   await write('interaction.execute',{entity_id:id,target_entity_id:targetId,interaction_bag_id:choice.action.interaction_bag_id},token);
   pair.lastBag=choice.action.interaction_bag_id;
   if(choice.kind!=='courtship')pair.pending={kind:choice.kind,until:minute+180};
   decision.lastTalk=named(other)+' / '+choice.action.display_name;
   log(named(member)+'의 관계 행동 요청: '+decision.lastTalk);
   return true;
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
    plan.primary=candidate&&profit>0&&!finance.short?'사업 우선':'사업 수입과 본업 비교';
   }
   if(finance.short)plan.primary='생활비 보충 우선';
   decision.lifePlan=plan;
   return plan;
  }
  async function sideIncome(member,character,decision,plan,snapshot,skills,minute,token){
   if(!plan||!plan.short||!L.adultAge.test(member.age_group)||!L.relaxed(snapshot.queue)||minute<(decision.nextSide||0))return false;
   var local=await inventory(member,character);
   if(!local)return false;
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
   if(action){log(named(member)+': 생활비 보충 행동 요청 / '+action.display_name);return true;}
   return false;
  }
  async function attend(member,character,decision,snapshot,time,minute,token,news){
   if(!L.adultAge.test(member.age_group)||!L.relaxed(snapshot.queue)||L.urgentNeed(snapshot.stats.stats)||
      snapshot.work.is_working_time||snapshot.work.is_commute_time||snapshot.work.is_at_work)return false;
   var trip=decision.outing, location=entity(character.locatedSiteId);
   if(trip&&trip.event&&location===trip.site&&!trip.activity&&minute<trip.end){
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
    if(action){trip.activity=action.interaction_bag_id;log(named(member)+': '+trip.name+' 현장 활동 요청 / '+action.display_name);return true;}
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
    if(location!==site.entity_id&&!await move(member,site.entity_id,token))continue;
    decision.lastEvent=time.day+':'+event.id;
    decision.outing={site:site.entity_id,name:event.title,start:minute,event:event.id,end:event.end,rules:event.rules||[],tags:event.tags||[]};
    log(named(member)+': 소식함 행사 선택 / '+event.title+' · '+(site.l10n||site.id));
    return true;
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
     if(await move(member,home,token)){trip.returning=true;log(named(member)+': 외출을 마치고 귀가 요청');return true;}
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
   var present=function(regex){return local.objects.some(function(o){return regex.test(o.table_id);});};
   var requirements=[
    ['침대',/^(?:Bed\d|BedAssemble|BunkBed)/i,'Bed01'],
    ['냉장고',/^Fridge/i,'Fridge04'],
    ['변기',/^Toilet\d/i,'Toilet01'],
    ['청소 도구',/^(?:Mop\d|Broom\d|VacuumCleaner)/i,'Mop01']
   ];
   var missing=[];
   for(var i=0;i<requirements.length;i++){
    var item=requirements[i];
    if(present(item[1]))continue;
    var product=await row('Object',item[2]);
    missing.push({label:item[0],item:item[2],price:product.price,affordable:product.price<=plan.cash-plan.reserve});
   }
   decision.housePlan={site:local.site.l10n,missing:missing};
   var people=api.members().filter(function(m){return m.household_id===member.household_id;}).length;
   var rooms=local.summary.counts&&local.summary.counts.rooms;
   if(rooms>0&&rooms<people+1){
    var listed=await cli('game.list_move_in_sites',{Limit:30});
    var candidates=[];
    for(var j=0;j<(Array.isArray(listed)?listed.length:0);j++){
     var next=listed[j];
     if(!next.selectable||next.is_empty_land)continue;
     var details=(await row('Site',next.site_id)).defaultInfo;
     if(details&&details.size)candidates.push(Object.assign({},next,{area:details.size.x*details.size.y}));
    }
    var source=(await row('Site',local.site.id)).defaultInfo;
    decision.housePlan.move=source&&source.size?L.housingChoice(source.size.x*source.size.y,candidates,plan.cash-plan.reserve):null;
    decision.housePlan.cramped=true;
   }
   var traits=P.traits(api.snapshot(member.entity_id).trait);
   decision.housePlan.adoption=people>=1&&rooms>=people+2&&plan.cash>plan.reserve+6000&&
    traits.some(function(t){return /^(?:Helper|Cooperator|Romantic)$/.test(t);})?'돌봄과 가족 목표를 더 확인할 후보':null;
  }
  function clearTile(floors,walls,objects,bounds){
   var floor=(floors.floors||[]).find(function(f){return f.floor_level===0;});
   if(!floor||!bounds||!bounds.min||!bounds.max||!walls.walls||walls.walls.length!==walls.total)return null;
   function distance(p,w){
    var ax=w.left.x, ay=w.left.y, dx=w.right.x-ax, dy=w.right.y-ay;
    var t=Math.max(0,Math.min(1,((p.x-ax)*dx+(p.y-ay)*dy)/(dx*dx+dy*dy||1)));
    return Math.hypot(p.x-ax-t*dx,p.y-ay-t*dy);
   }
   return (floor.rooms||[]).map(function(r){return r.center;}).find(function(p){
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
   if(!plan||!canFurnish(member,snapshot)||minute<(decision.nextFurnish||0))return false;
   var local=await inventory(member,character);
   if(!local||local.summary.site_type!=='Residence'||local.site.entity_id!==await homeMember(member,character))return false;
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
   if(!await placeHouseItem(member,local,item,plan,550,token))return false;
   decision.skillGoal=null;
   return true;
  }
  async function placeHouseItem(member,local,item,plan,maxPrice,token){
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
       fresh.objects.some(function(o){return o.table_id===item;}))return false;
    if(!clearTile({floors:[{floor_level:0,rooms:[{center:point}]}]},walls,fresh.objects,local.summary.coord_space))return false;
    var cash=await readAt(member.household_id,'Currency');
    if(!cash.currencyMap||!Number.isFinite(cash.currencyMap.mew)||cash.currencyMap.mew-plan.reserve<data.price||!api.active(token))return false;
    var placedObject=await cli('building.place_object',{object_table_id:item,X:point.x,Y:point.y,floor_level:0,Yaw:0});
    if(!placedObject||placedObject.committed!==true)return false;
    placed=true;
    var after=await cli('build.scan_objects',{table_id_prefix:item,Limit:0});
    if((after.objects||[]).some(function(o){return o.entity_id===placedObject.entity_id&&o.table_id===item;})){
     log(named(member)+': 물건 구매·배치 확인 / '+item+' ('+placedObject.price+')');
    }
    return true;
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
  function reset(){sites=null;householdCache={};homeCache={};houseTasks={};repairs={};}
  return {reset:reset,needs:needs,clean:clean,repair:repair,parcels:parcels,marketNeed:marketNeed,reviewGoal:reviewGoal,trackGoal:trackGoal,prepareGoals:prepareGoals,attend:attend,
   pursueHope:pursueHope,prepareAmbition:prepareAmbition,pursueAmbition:pursueAmbition,
   affection:affection,goalConversation:goalConversation,
   occupation:occupation,sideIncome:sideIncome,outing:outing,vacation:vacation,householdPlan:householdPlan,furnish:furnish,move:move};
 }
 root.ObserverLifeActions={create:create};
})(this);
