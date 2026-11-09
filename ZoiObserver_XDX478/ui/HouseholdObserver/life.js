(function(root){
 'use strict';

 var adultAge=/^(Youth|YoungAdult|Adult|Old|Elder|Elderly)$/;
 var needActions={
  Hunger:/^Eat_Fridge\d*_Served|^Eat_Served/,
  Sleep:/^Sleep_(?:Bed|Sofa)/,
  Toilet:/^(?:Object_)?Toilet\d+_Use$/,
  Cleanliness:/^Shower\d+$|^Use_Bath\d+$/
 };
 var fixtureIds={
  Hunger:/^Fridge(?!.*Broke)/i,
  Sleep:/^(?:Bed\d|BedAssemble|BunkBed|Sofa\d)/i,
  Toilet:/^Toilet\d/i,
  Cleanliness:/^(?:Shower|Bath\d|Bathtub)/i
 };
 var romanceTalk=/^Co_Romance_R\d+(?:_2)?$/;
 var romanceActions={
  confess:/^Co_Love_Confession_0[123]_ToNPC$/,
  propose:/^Co_Propose_Romance_(?:Low|High)Relationship_[MF]{2}$/,
  marry:/^Co_Marriage_[MF]{2}$/
 };

 function percent(stats,key){
  return stats[key]&&Number.isFinite(stats[key].pct)?stats[key].pct:null;
 }
 function urgentNeed(stats){
  var order=['Toilet','Hunger','Sleep','Cleanliness'];
  return order.map(function(key){return {key:key,pct:percent(stats,key)};})
   .filter(function(n){return n.pct!==null&&n.pct<=(n.key==='Cleanliness'?18:24);})
   .sort(function(a,b){return a.pct-b.pct;})[0]||null;
 }
 function relaxed(queue){
  var bag=queue.current&&queue.current.interaction_bag_id;
  return (queue.queue_count||0)<=1&&(!bag||
    /^(?:Self_Idle_|Use_SmartPhone_|Use_TV_|Self_SmartPhone_|Bookshelf_SitRead_|Self_SLM_(?:Read|Watch)_)/i.test(bag));
 }
 function sleeping(queue,work){
  var bag=queue.current&&queue.current.interaction_bag_id||'';
  return /^(?:Sleep_|Sleeping_|Self_Sleep_|Nap_|Self_Nap_)/i.test(bag)||work&&work.is_sleeping===true;
 }
 function fixtureMatches(need,tableId){return !!fixtureIds[need]&&fixtureIds[need].test(tableId||'');}
 function needChoice(need,available){
  var pattern=needActions[need];
  return pattern&&(available||[]).find(function(a){return a.enabled===true&&pattern.test(a.interaction_bag_id);});
 }

 function relationshipEntry(component,id){
  return component&&component.relationshipMap&&component.relationshipMap['(Value='+id+')']||null;
 }
 function relationshipNames(entry){
  return (entry&&entry.relationshipInfoList||[]).map(function(r){return String(r.iD||r.id||'').toLowerCase();});
 }
 function relationshipStage(a,b,married){
  if(married)return 'married';
  var both=relationshipNames(a).concat(relationshipNames(b));
  if(both.indexOf('engagement')>=0)return 'engaged';
  if(both.some(function(id){return /^(?:youth|highteen)_lover$/.test(id);}))return 'dating';
  return 'single';
 }
 function hasOtherPartner(component,partnerId){
  var map=component&&component.relationshipMap||{};
  return Object.keys(map).some(function(key){
   return key!=='(Value='+partnerId+')'&&relationshipNames(map[key]).some(function(id){return /^(?:engagement|(?:youth|highteen)_lover)$/.test(id);});
  });
 }
 function romanceChoice(ctx,available){
  if(!adultAge.test(ctx.actorAge)||!adultAge.test(ctx.targetAge)||ctx.family||ctx.otherPartner||ctx.recentRejection)return null;
  if(ctx.stage==='married')return null;
  var mutualFriend=Math.min(ctx.aFriend,ctx.bFriend);
  var mutualRomance=Math.min(ctx.aRomance,ctx.bRomance);
  if(!Number.isFinite(mutualFriend)||!Number.isFinite(mutualRomance)||mutualFriend<25||mutualRomance<0)return null;
  var formal=null;
  if(ctx.stage==='engaged'&&ctx.stageMinutes>=2*1440&&mutualRomance>=75&&mutualFriend>=45&&ctx.marriageAllowed)formal='marry';
  if(ctx.stage==='dating'&&ctx.stageMinutes>=3*1440&&mutualRomance>=70&&mutualFriend>=40&&ctx.marriageAllowed)formal='propose';
  if(ctx.stage==='single'&&ctx.stageMinutes>=1440&&mutualRomance>=40&&mutualFriend>=35)formal='confess';
  if(formal){
   var action=(available||[]).find(function(a){return a.enabled===true&&romanceActions[formal].test(a.interaction_bag_id);});
   if(action)return {action:action,kind:formal};
  }
  if(ctx.stage==='engaged'&&ctx.stageMinutes<2*1440)return null;
  var talks=(available||[]).filter(function(a){return a.enabled===true&&romanceTalk.test(a.interaction_bag_id);});
  var talk=talks.find(function(a){return a.interaction_bag_id!==ctx.lastBag;})||talks[0];
  return talk?{action:talk,kind:'courtship'}:null;
 }

 function dayBudget(wallet,count){
  var cash=wallet&&wallet.currencyMap&&wallet.currencyMap.mew;
  if(!Number.isFinite(cash))return null;
  var receipts=wallet.currencyHistoryMap&&wallet.currencyHistoryMap.mew;
  var days=receipts&&receipts.dailyTransactionMap||{};
  var dates=Object.keys(days).sort().slice(-4);
  var records=dates.reduce(function(all,key){return all.concat(days[key].records||[]);},[]);
  var spending=records.reduce(function(total,r){return total+(r.amount<0?-r.amount:0);},0);
  var reserve=Math.max(1600+400*count,Math.ceil(spending/Math.max(1,dates.length))*3);
  return {cash:cash,reserve:reserve,free:Math.max(0,cash-reserve),short:cash<reserve,records:records};
 }
 function entrepreneur(traits,skills){
  function level(key){var s=skills.find(function(x){return x.id===key;});return s?s.level:0;}
  var initiative=traits.filter(function(t){return /^(Independent|Leader|Achiever|Adventurer|Workaholic)$/.test(t);}).length;
  var choices=[
   {type:'음식점',score:level('Cooking')*3+level('BakingPastry')*2+level('CoffeeArt')*2+initiative*3},
   {type:'소매·서비스',score:level('Charisma')*2+level('Speaking')*3+initiative*4},
   {type:'창작·디지털',score:level('Programming')*3+level('Filming')*3+level('Art')*2+initiative*3}
  ];
  choices.sort(function(a,b){return b.score-a.score;});
  return choices[0].score>=10?choices[0]:null;
 }
 function sideJobs(traits,skills){
  function level(key){var s=skills.find(function(x){return x.id===key;});return s?s.level:0;}
  var independent=traits.indexOf('Independent')>=0;
  var choices=[
   {kind:'Writing',score:level('Logic')*2+(traits.indexOf('Bookworm')>=0?4:0),label:'집필'},
   {kind:'Coding',score:level('Programming')*3+(independent?2:0),label:'프로그래밍'},
   {kind:'Video',score:level('Filming')*3,label:'영상 제작'},
   {kind:'Music',score:level('Instruments')*3+(traits.indexOf('Artist')>=0?3:0),label:'작곡'}
  ];
  return choices.sort(function(a,b){return b.score-a.score;});
 }
 function housingChoice(currentArea,candidates,free){
  if(!(currentArea>0)||!(free>0))return null;
  return candidates.filter(function(c){
   return c.selectable===true&&!c.is_empty_land&&c.owner_family_id<=0&&
    Number.isFinite(c.price)&&c.price>0&&c.price<=free&&c.area>=currentArea*1.25;
  }).sort(function(a,b){return a.price-b.price||b.area-a.area;})[0]||null;
 }
 function leisureSite(sites,traits,lastSite){
  var nature=traits.some(function(t){return /^(Adventurer|Active|Energetic)$/.test(t);});
  var artistic=traits.some(function(t){return /^(Artist|Observer|Bookworm)$/.test(t);});
  return sites.filter(function(s){
   return s.entity_id>0&&s.entity_id!==lastSite&&/(?:Park|Beach|Museum|Library|Garden)/i.test(s.id)&&
    !/(?:Wedding|Prison|School|Airport|Private|Residence|Closed|Protect|Parking|Bathroom|Develop|Dev_)/i.test(s.id);
  }).sort(function(a,b){
   function rank(s){
    if(nature&&/Beach|Park/i.test(s.id))return 0;
    if(artistic&&/Museum|Library|Garden/i.test(s.id))return 0;
    return /Park|Garden/i.test(s.id)?1:2;
   }
   return rank(a)-rank(b)||a.entity_id-b.entity_id;
  })[0]||null;
 }
 function noticeAllowed(id){
  return /^(?:NoticeDeathBy[A-Za-z_]+|NoticeCityTravelReturnBy[A-Za-z]+|Ambition_CompleteMission_[A-Za-z0-9_]+|(?:GroupContext|RandomEvent)_[A-Za-z0-9_]+_(?:Success|Fail|Positive|Negative)|[A-Za-z]+DateEnd_(?:Best|Bad)(?:_Lover)?_Popup)$/.test(id||'');
 }
 function hopeDeadline(hope){
  var value=hope&&Number(hope.expire_ticks!=null?hope.expire_ticks:hope.hopeExpireTime);
  return Number.isFinite(value)&&value>0?value:Infinity;
 }
 function expiringFirst(hopes){
  return (hopes||[]).map(function(hope,index){return {hope:hope,index:index,deadline:hopeDeadline(hope)};})
   .sort(function(a,b){return a.deadline===b.deadline?a.index-b.index:a.deadline-b.deadline;})
   .map(function(item){return item.hope;});
 }
 function vacationPlan(previous,day,seasonLength){
  if(!Number.isInteger(day)||!Number.isInteger(seasonLength)||seasonLength<1)return null;
  var length=seasonLength*4;
  var origin=previous&&previous.length===length&&Number.isInteger(previous.start)&&day>=previous.start?previous.start:day;
  var start=origin+Math.floor((day-origin)/length)*length;
  var trips=previous&&previous.start===start&&Array.isArray(previous.trips)?previous.trips:[];
  var last=trips.length?trips[trips.length-1].day:null, minGap=Math.max(1,Math.floor(seasonLength/2));
  var next=trips.length<4?start+trips.length*seasonLength:
   trips.length===4&&length>=5?start+length-Math.max(1,Math.floor(seasonLength/3)):null;
  if(next!==null&&last!==null)next=Math.max(next,last+minGap);
  if(next!==null&&next>=start+length)next=null;
  return {start:start,length:length,trips:trips,next:next,extra:trips.length===4};
 }

 function goalVenueTags(name,condition){
  var clue=name+' '+condition;
  if(/Coffee|Espresso/i.test(clue))return [['Coffee','Orderable']];
  if(/ReadNewspaper|Read.*Book|Book.*Read|StudyAtLibrary/i.test(clue))return [['Hope_Library'],['AR_Library']];
  if(/Painting|Easel|Drawing|LearnArt/i.test(clue))return [['TPO_Site_Activity_Art'],['Hope_Art']];
  return [];
 }

 var api={adultAge:adultAge,urgentNeed:urgentNeed,relaxed:relaxed,fixtureMatches:fixtureMatches,needChoice:needChoice,goalVenueTags:goalVenueTags,
  relationshipEntry:relationshipEntry,relationshipStage:relationshipStage,hasOtherPartner:hasOtherPartner,
  romanceChoice:romanceChoice,dayBudget:dayBudget,entrepreneur:entrepreneur,sideJobs:sideJobs,housingChoice:housingChoice,
  leisureSite:leisureSite,noticeAllowed:noticeAllowed,hopeDeadline:hopeDeadline,expiringFirst:expiringFirst,
  sleeping:sleeping,vacationPlan:vacationPlan};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.ObserverLife=api;
})(this);
