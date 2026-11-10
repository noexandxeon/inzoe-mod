(function(root){
 'use strict';
 var ages=/^(Infant|Newborn|Baby|Toddler)$/;
 var needs=[
  {key:'Hunger',limit:45,label:'수유'},
  {key:'Sleep',limit:38,label:'수면'},
  {key:'Toilet',limit:32,label:'기저귀'},
  {key:'Cleanliness',limit:35,label:'씻기기'}
 ];
 var actions={
  infant:{
   Hunger:['Co_Infant_GiveMilk_Talk','Co_Infant_BreastMilk_Talk'],
   Toilet:['Co_Infant_ChangeDiaper_Talk'],
   Cleanliness:['Co_Infant_WipeBody_Talk']
  },
  toddler:{
   Hunger:['Co_Toddler_GiveMilk_Talk','Co_Toddler_GiveSnack_Talk'],
   Sleep:['Co_Toddler_Lull_Talk','Co_Toddler_Lull_Talk_TV'],
   Toilet:['Co_Toddler_ChangeDiaper_Talk'],
   Cleanliness:['Co_Toddler_WipeBody_Talk','Co_toToddler_Shower']
  }
 };
 function dependent(member){return ages.test(member&&member.age_group);}
 function workAge(member,life){return life.adultAge.test(member&&member.age_group);}
 function mayJoin(member,life){return workAge(member,life)&&(member.has_career===true||member.employable===true);}
 function ghost(character){
  return Array.isArray(character&&character.ghostInteractionOnReasons)&&character.ghostInteractionOnReasons.indexOf('Ghost')>=0;
 }
 function pct(stats,key){
  var s=stats&&stats.stats&&stats.stats[key];
  return s&&Number.isFinite(s.pct)?s.pct:null;
 }
 function due(stats){
  return needs.map(function(need){return Object.assign({pct:pct(stats,need.key)},need);})
   .filter(function(need){return need.pct!==null&&need.pct<=need.limit;})
   .sort(function(a,b){return (a.pct-a.limit)-(b.pct-b.limit);});
 }
 function samePlace(a,b){
  return a&&b&&a.locatedCityName===b.locatedCityName&&a.locatedSiteId&&b.locatedSiteId&&
   a.locatedSiteId.value>0&&a.locatedSiteId.value===b.locatedSiteId.value;
 }
 function create(api,life){
  var pollAt={}, sleepRows={};
  function read(name,id){return api.cli(name,{entity_id:String(id)});}
  function book(id){
   var decision=api.state.people[id]||(api.state.people[id]={});
   return decision.childCare||(decision.childCare={});
  }
  function status(child,record,message){
   if(record.status!==message)api.log(child.first_name+' · 돌봄: '+message);
   record.status=message;
  }
  async function observe(child,record,sample,minute){
   var pending=record.pending;
   if(!pending)return false;
   if(minute<pending.minute||sample.character.locatedCityName!==pending.city){
    record.pending=null;
    return false;
   }
   var value=pct(sample.stats,pending.need);
   var asleep=pending.need==='Sleep'&&life.sleeping(sample.queue,{});
   if(value!==null&&value>=pending.before+4||asleep){
    record.pending=null;
    record.lastResult={need:pending.need,minute:minute,before:pending.before,after:value,asleep:asleep};
    record.retryAt=minute+12;
    status(child,record,pending.label+(asleep?' 시작 확인':': '+pending.before+'% → '+value+'%'));
    return false;
   }
   if(Date.now()-pending.at<22000||minute-pending.minute<25)return true;
   var queue=pending.actor===String(child.entity_id)?sample.queue:await read('interaction.get_queue',pending.actor);
   var current=queue.current||{};
   if(current.interaction_bag_id===pending.bag&&String(current.target_entity_id)===String(child.entity_id))return true;
   record.pending=null;
   record.failed={bag:pending.bag,actor:pending.actor,until:minute+35};
   record.retryAt=minute+5;
   status(child,record,pending.label+' 결과 미확인 · 다른 돌봄 행동 확인 예정');
   return false;
  }
  async function request(child,record,actor,need,bag,minute,token,city,front){
   var id=String(child.entity_id), failed=record.failed;
   if(failed&&failed.bag===bag&&failed.actor===actor&&minute<failed.until)return false;
   var fresh=await api.cli('household.get_members',{household_id:String(child.household_id)});
   if(String(fresh.household_id)!==String(child.household_id)||
      !(fresh.members||[]).some(function(m){return String(m.entity_id)===id&&m.age_group===child.age_group;})||
      actor!==id&&!(fresh.members||[]).some(function(m){return String(m.entity_id)===actor&&workAge(m,life);}))return false;
   var args={entity_id:actor,target_entity_id:id,interaction_bag_id:bag};
   if(front)args.insert_front=true;
   try{await api.write('interaction.execute',args,token);}
   catch(e){
    record.failed={bag:bag,actor:actor,until:minute+30};
    status(child,record,need.label+' 요청 보류 / '+e.message);
    return false;
   }
   record.pending={actor:actor,bag:bag,need:need.key,label:need.label,city:city,before:need.pct,minute:minute,at:Date.now()};
   status(child,record,need.label+' 요청 · 실행과 욕구 확인 중');
   return true;
  }
  async function run(child,group,minute,token,sample){
   var id=String(child.entity_id);
   if(!dependent(child)||!api.active(token)||Date.now()-(pollAt[id]||0)<6500)return;
   pollAt[id]=Date.now();
   var record=book(id), city=api.game().map_id;
   if(record.lastMinute>minute){record.failed=null;record.retryAt=0;record.pending=null;}
   record.lastMinute=minute;
   sample=sample||{character:await read('entity.reflect',id),stats:await read('stat.get_all',id),queue:await read('interaction.get_queue',id)};
   if(sample.character.locatedCityName!==city||
      String(sample.character.householdEntityId&&sample.character.householdEntityId.value)!==String(child.household_id)){
    record.pending=null;
    return;
   }
   if(await observe(child,record,sample,minute))return;
   var pendingNeeds=due(sample.stats);
   if(life.sleeping(sample.queue,{})||!pendingNeeds.length||minute<(record.retryAt||0))return;
   var adults=group.filter(function(m){return workAge(m,life)&&String(m.household_id)===String(child.household_id);});
   var actorIds=adults.map(function(m){return String(m.entity_id);});
   var sim=await api.cli('entity.get_simulate_state',{entity_ids:[id].concat(actorIds).join(',')});
   var active=(sim.results||[]).filter(function(s){return s.exists===true&&s.simulated===true;}).map(function(s){return String(s.entity_id);});
   if(active.indexOf(id)<0)return;
   var infant=child.age_group!=='Toddler', table=actions[infant?'infant':'toddler'];
   var carers=[], away=[], childSite=sample.character.locatedSiteId&&sample.character.locatedSiteId.value;
   for(var i=0;i<actorIds.length;i++){
    var actor=actorIds[i];
    if(active.indexOf(actor)<0||reserved(adults[i],group))continue;
    var character=await read('entity.reflect',actor);
    if(ghost(character)||character.locatedCityName!==city||
       String(character.householdEntityId&&character.householdEntityId.value)!==String(child.household_id))continue;
    var local=samePlace(character,sample.character);
    if(!local&&pendingNeeds[0].pct>15)continue;
    var work=await read('career.get_work_status',actor), queue=await read('interaction.get_queue',actor);
    if(work.is_at_work||work.is_in_rabbit_hole||!life.goalReady(queue,work)||queue.queue_count!==0)continue;
    if(!local){
     if(!work.is_working_time&&!work.is_commute_time&&work.home_site_id>0&&
        work.home_site_id===childSite)away.push(adults[i]);
     continue;
    }
    var available=await api.cli('interaction.list_available',{entity_id:actor,target_entity_id:id});
    carers.push({id:actor,available:available.interactions||[],working:work.is_working_time||work.is_commute_time});
   }
   carers.sort(function(a,b){return Number(!!a.working)-Number(!!b.working);});
   for(var n=0;n<pendingNeeds.length;n++){
    var need=pendingNeeds[n];
    for(var c=0;c<carers.length;c++){
     var carer=carers[c];
     if(carer.working&&need.pct>(need.key==='Hunger'?35:24))continue;
     var choices=table[need.key]||[];
     for(var b=0;b<choices.length;b++){
      var bag=choices[b];
      if(carer.available.some(function(a){return a.enabled===true&&a.interaction_bag_id===bag;})&&
         await request(child,record,carer.id,need,bag,minute,token,city,need.pct<=24))return;
     }
    }
    if(need.key==='Sleep'&&sample.queue.queue_count===0&&life.goalReady(sample.queue,{})&&
       !(pct(sample.stats,'Hunger')!==null&&pct(sample.stats,'Hunger')<=18&&need.pct>10)){
     var sleep=infant?'Self_Infant_Sleep':'Self_Toddler_Sleep';
     if(!Object.prototype.hasOwnProperty.call(sleepRows,sleep)){
      var row=await api.cli('data.table_get',{Alias:'InteractionBag',Row:sleep});
      sleepRows[sleep]=!!(row&&row._row_name===sleep&&(row.interactionRewards||[]).some(function(r){return r.statId==='Sleep'&&r.reward>0;}));
     }
     if(sleepRows[sleep]&&await request(child,record,id,need,sleep,minute,token,city,need.pct<=24))return;
    }
   }
   if(away.length&&pendingNeeds[0].pct<=15&&minute>=(record.nextReturn||0)){
    for(var a=0;a<away.length;a++){
     var availableAdult=away[a], adultId=String(availableAdult.entity_id);
     var schedule=await read('schedule.diagnose',adultId);
     if(schedule.has_schedule!==false)continue;
     if(await api.move(availableAdult,childSite,token)){
      record.nextReturn=minute+60;
      record.retryAt=minute+15;
      status(child,record,availableAdult.first_name+' 귀가 요청 · 도착 뒤 돌봄 재확인');
      return;
     }
    }
   }
   record.retryAt=minute+10;
   status(child,record,pendingNeeds[0].label+' 대기 · 같은 장소에서 가능한 보호자와 행동을 다시 확인합니다');
  }
  function reserved(actor,group){
   return group.some(function(child){
    if(!dependent(child)||String(child.household_id)!==String(actor.household_id))return false;
    var record=api.state.people[child.entity_id]&&api.state.people[child.entity_id].childCare;
    return record&&record.pending&&record.pending.actor===String(actor.entity_id);
   });
  }
  return {run:run,reserved:reserved,reset:function(){pollAt={};}};
 }
 var api={dependent:dependent,workAge:workAge,mayJoin:mayJoin,ghost:ghost,create:create};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.ObserverChildCare=api;
})(this);
