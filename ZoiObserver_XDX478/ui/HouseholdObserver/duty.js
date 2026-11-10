(function(root){
 'use strict';
 var TICKS_PER_MINUTE=600000000;
 function value(ref){return Number(ref&&typeof ref==='object'?ref.value:ref)||0;}
 function kind(category){
  var tip=category&&category.missionToolTipId||'';
  if(/AfterSchool/i.test(tip))return 'homework';
  if(/School/i.test(tip)||/AppIcon_School/i.test(category&&category.mainCategoryIcon||''))return 'school';
  if(/JobMission|HouseholdBiz/i.test(tip))return 'work';
  return null;
 }
 function key(quest,mission,end){return [quest.toLowerCase(),mission.toLowerCase(),end||0].join(':');}
 function tally(day){
  var rows=Object.values(day||{}), done=rows.filter(function(row){return row.status==='done';}).length;
  return {total:rows.length,done:done,failed:rows.filter(function(row){return row.status==='failed';}).length,
   target:Math.ceil(rows.length/2),percent:rows.length?Math.floor(100*done/rows.length):null};
 }
 function label(summary){
  return '기한 과제 '+summary.done+'/'+summary.total+' ('+summary.percent+'%) · 목표 '+summary.target+'개';
 }
 function create(api,L,R){
  var cli=api.cli, row=api.row, searches={};
  function reflect(id,component){return cli('entity.reflect',{entity_id:String(id),Component:component});}
  async function category(quest){
   try{
    var definition=await row('Quest',quest);
    return definition&&definition.questCategoryId?kind(await row('QuestCategory',definition.questCategoryId)):null;
   }catch(_){return null;}
  }
  function remember(book,day,id,type,quest,mission,status){
   var entries=book.days[day]||(book.days[day]={});
   var task=entries[id]||(entries[id]={kind:type,quest:quest,mission:mission});
   if(task.status!=='done'&&(task.status!=='failed'||status==='done'))task.status=status;
   return task;
  }
  async function observe(book,native,day,minute){
   var active=[], names={}, groups=native.todayQuestHistoryData||{}, now=minute*TICKS_PER_MINUTE;
   for(var entry of Object.values(native.executingQuestMap||{})){
    var info=entry.questInfo, mission=info&&info.questTask&&info.questTask.missionDtId;
    if(!mission||!info.questId||!(info.endTick>0))continue;
    var type=await category(info.questId);
    if(!type)continue;
    names[info.questId.toLowerCase()]=info.questId;
    var id=key(info.questId,mission,info.endTick);
    var issued=info.startTick>0?Math.floor(info.startTick/TICKS_PER_MINUTE/1440):day;
    if(issued>day||issued<day-1)continue;
    var record=remember(book,issued,id,type,info.questId,mission,'open');
    if(record.status==='open'&&info.startTick<now+TICKS_PER_MINUTE&&info.endTick>now)
     active.push({key:id,kind:type,info:info,instance:value(entry.missionId),mission:mission,record:record});
   }
   for(var name of Object.keys(groups)){
    // Unreal's map exports FName keys with a lowercase first letter.
    var quest=names[name.toLowerCase()]||name.charAt(0).toUpperCase()+name.slice(1);
    var groupType=await category(quest);
    if(!groupType)continue;
    for(var pair of Object.entries(groups[name].historyElementMap||{})){
     var data=pair[1];
     if(!(data.endTick>0)||!data.isActive&&!data.isSuccess&&!data.isFail)continue;
     var taskId=key(quest,pair[0],data.endTick), yesterday=book.days[day-1];
     remember(book,yesterday&&yesterday[taskId]?day-1:day,taskId,groupType,quest,pair[0],
      data.isSuccess?'done':data.isFail?'failed':'open');
    }
   }
   Object.keys(book.days).forEach(function(d){if(Number(d)<day-15||Number(d)>day)delete book.days[d];});
   book.summary=tally(book.days[day]);
   return active.filter(function(task){return task.record.status==='open';}).sort(function(a,b){return a.info.endTick-b.info.endTick;});
  }
  async function search(tag,book){
   var lookup=(book?'book:':'tag:')+tag;
   if(!searches[lookup]){
    var res=await cli('interaction.search',{Keyword:tag,max_results:100}), lower=tag.toLowerCase();
    searches[lookup]=(res.results||[]).filter(function(a){
     var bag=String(a.interaction_bag_id).toLowerCase();
     if(book)return bag==='bookshelf_sitread_'+lower||bag==='bookshelf_sitread_'+lower+'_45cm';
     return bag===lower||
     (a.tags||[]).some(function(t){return String(t).toLowerCase()===lower;});}).map(function(a){return a.interaction_bag_id;});
   }
   return searches[lookup];
  }
  async function linked(bag,condition){
   var spec=await row('InteractionBag',bag);
   if(!spec||spec.consumeCurrencyValue>0)return false;
   return (spec.interactionSequence||[]).some(function(seq){
    return seq.mainInteractionId===condition.conditionId1||(seq.interactionInfos||[]).some(function(info){return info.interactionId===condition.conditionId1;});
   });
  }
  async function attempt(task,member,character,career,selected,queue,mission,book,minute,token){
   var id=String(member.entity_id), site=value(character.locatedSiteId), spec=await row('Mission',task.mission);
   var condition=(spec&&spec.conditions||[]).find(function(c,i){
    var state=mission&&mission.conditionStates&&mission.conditionStates[i];
    return !state||state.currentCount<state.goalCount;
   });
   if(!condition)return false;
   var tag=condition.conditionId1, type=condition.conditionType;
   if(!tag||!/^(InteractionBagCount|InteractionCount|TalkInteractionBagTag|ActionTime|AddEntityTagCount|ReadBook)$/.test(type))return false;
   var reading=type==='ReadBook', bags=await search(type==='AddEntityTagCount'?task.mission:tag,reading), targets=[];
   var school=career.school, paper=tag==='EntityTag_School_PaperHomework_Complete';
   var question=tag==='Mission_School_Question', listen=tag==='Mission_School_Listen';
   if((paper||question)&&school&&value(school.careerEntityId)>0){
    var data=await reflect(value(school.careerEntityId));
    var assignment=(data.studentHomeworkMap||{})['(Value='+id+')'];
    if(paper&&assignment)targets.push(value(assignment.homeworkObjectId));
    if(question){
     var section=(data.classSections||[]).find(function(s){return (s.studentIds||[]).some(function(ref){return value(ref)===Number(id);});});
     if(section)targets.push(value(section.teacherId));
    }
   }
   var fixed=value(mission&&mission.targetEntityId);
   if(fixed>0)targets=[fixed];
   var canInspect=selected&&fixed<=0&&!paper&&!question;
   if(canInspect&&bags.some(function(b){return /^(Co_|Coop_|Talk)/i.test(b);})){
    var people=await cli('entity.scan_characters',{ref:'pawn',Radius:45,Limit:12});
    targets=targets.concat((people.Characters||people.characters||[]).map(function(p){return p.entity_id;}).filter(function(target){return String(target)!==id;}).slice(0,8));
   }
   if(canInspect&&!bags.some(function(b){return /^(Co_|Coop_|Talk)/i.test(b);})){
    var scan=listen?await cli('build.scan_objects',{table_id_prefix:'ChalkBoard',Limit:30}):
     await cli('entity.scan_objects',{ref:'pawn',Radius:60,Limit:55});
    var objects=(scan.objects||[]).slice();
    var clue=reading?/Bookshelf|Bookcase/i:/Computer/i.test(tag)?/Computer|Laptop|Terminal/i:/Meeting/i.test(tag)?/Chair|Desk|Table/i:
     /Tech_Appreciate/i.test(tag)?/Statue|Sculpture/i:null;
    if(clue)objects.sort(function(a,b){return Number(clue.test(b.table_id))-Number(clue.test(a.table_id));});
    targets=targets.concat(objects.map(function(o){return o.entity_id;}));
   }
   targets=Array.from(new Set(targets.filter(function(target){return target>0;})));
   var from=(task.record.cursor||0)%Math.max(1,targets.length);
   task.record.cursor=from+8;
   targets=targets.slice(from).concat(targets.slice(0,from)).slice(0,8);
   for(var target of targets){
    var available;
    try{available=await cli('interaction.list_available',{entity_id:id,target_entity_id:String(target)});}catch(_){continue;}
    for(var action of available.interactions||[]){
     var bag=action.interaction_bag_id;
     if(!action.enabled||!bag||/Fail|Feedback|Destroy|Quit|Cancel/i.test(bag))continue;
     var matched=bags.indexOf(bag)>=0;
     if(!matched&&/^(ActionTime|InteractionCount)$/.test(type)&&(/Computer|Meeting/i.test(tag)?/Computer|Meeting/i.test(bag):false))
      matched=await linked(bag,condition);
     if(!matched||book.skip&&book.skip.bag===bag&&book.skip.target===String(target)&&minute<book.skip.until)continue;
     var receipt={key:task.key,bag:bag,target:String(target),minute:minute,at:Date.now(),paper:paper};
     if(R.actionState(queue,receipt)==='playing')return true;
     var live=await reflect(id);
     if(value(live.locatedSiteId)!==site)return false;
     if(!paper&&value((await reflect(target)).locatedSiteId)!==site)continue;
     var fresh=await reflect(id,'Quest'), running=Object.values(fresh.executingQuestMap||{}).some(function(item){
      var info=item.questInfo;
      return info&&info.questId&&info.questTask&&info.questTask.missionDtId&&
       key(info.questId,info.questTask.missionDtId,info.endTick)===task.key;
     });
     if(!running)return false;
     book.pending=receipt;
     await api.write('interaction.execute',{entity_id:id,target_entity_id:String(target),interaction_bag_id:bag},token,null,canInspect?id:null);
     book.note='실행 요청 · '+(action.display_name||task.mission);
     return true;
    }
   }
   return false;
  }
  async function run(member,character,decision,snapshot,minute,token,selected,mayAct){
   var day=Math.floor(minute/1440), id=String(member.entity_id), site=value(character.locatedSiteId), work=snapshot.work;
   var native=await reflect(id,'Quest');
   if(!native||!native.executingQuestMap||!native.todayQuestHistoryData)return false;
   var book=decision.duty||(decision.duty={days:{}});
   var active=await observe(book,native,day,minute);
   book.note=null;
   var timeline, schoolSite=false, workSite=site>0&&site===Number(work.work_site_id)&&(work.is_at_work||work.is_working_time);
   if(site>0&&(active.some(function(task){return task.kind!=='homework';})||member.has_career&&!work.has_job)){
    timeline=await reflect(id,'Timeline');
    if(timeline&&timeline.bIsArrivedDestination&&value(timeline.destTargetEntityId)===site){
     var slots=Object.values(timeline.careerTimelineParams||{});
     if(slots.length){
      var loaded=await cli('world.get_loaded_sites'), actual=(loaded.sites||[]).find(function(s){return s.entity_id===site;});
      if(actual){
       schoolSite=slots.some(function(s){return /^School/i.test(s.careerType)&&s.destSiteName===actual.id;});
       workSite=workSite||slots.some(function(s){return !/^School/i.test(s.careerType)&&s.destSiteName===actual.id;});
      }
     }
    }
   }
   var onSite=schoolSite||workSite;
   if(!mayAct)return onSite;
   var queue=snapshot.queue, pending=book.pending;
   if(pending){
    var task=active.find(function(a){return a.key===pending.key;});
    if(task&&(R.actionState(queue,pending)!=='unseen'||pending.paper&&queue.current&&/^Next_Homework/.test(queue.current.interaction_bag_id)||
      R.awaitingStart(Date.now(),minute,pending.at,pending.minute))){
     book.note='게임 과제 결과 확인 중';
     return true;
    }
    if(task)book.skip={bag:pending.bag,target:pending.target,until:minute+25};
    book.pending=null;
   }
   var candidates=active.filter(function(task){return task.kind==='homework'?!onSite&&!work.is_working_time&&!work.is_commute_time:
    task.kind==='school'?schoolSite:workSite;});
   if(!candidates.length||queue.queue_count>0||!L.goalReady(queue,work))return onSite;
   var career=(await reflect(id,'Career')).careerSlots||{}, missions=(await reflect(id,'Mission')).missionMap||{};
   // Earliest deadline first, but three assignments with nothing to do must not hide a later one that can run.
   var from=(book.turn||0)%candidates.length;
   for(var candidate of candidates.slice(from).concat(candidates.slice(0,from)).slice(0,3)){
    if(await attempt(candidate,member,character,career,selected,queue,missions['(Value='+candidate.instance+')'],book,minute,token)){book.turn=0;return true;}
   }
   book.turn=candidates.length>3?from+3:0;
   book.note='기한 과제에 맞는 실행 가능 행동을 찾는 중';
   return onSite;
  }
  return {run:run};
 }
 function archive(people,from,to){
  var result={};
  Object.keys(people||{}).forEach(function(id){
   var days=people[id].duty&&people[id].duty.days;
   Object.keys(days||{}).forEach(function(day){
    if(Number(day)<from||Number(day)>=to)return;
    if(!result[id])result[id]={};
    result[id][day]=tally(days[day]);
   });
  });
  return result;
 }
 var api={create:create,archive:archive,label:label};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.ObserverDuty=api;
})(this);
