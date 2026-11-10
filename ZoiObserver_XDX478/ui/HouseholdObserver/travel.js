(function(root){
 'use strict';
 var cities={Cahaya_Map:['차하야','Cahaya'],Gangnam_Map:['도원','Dowon'],RedCity_Map:['블리스베이','블리스 베이','Bliss Bay']};
 var weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
 var nextSuffix='/BW_WBP_Button_Right/BW_Button';
 var notices=[
  '여행에 함께 오지 않은 가족은 조작할 수 없습니다.',
  '가족 구성원이 아닌 조이와는 그룹 기능을 이용해 함께 다닐 수 있습니다.',
  '진행 중이거나, 예정된 이벤트는 즉시 취소됩니다.',
  '미션은 유지되지만 조건에 따라 달성이 불가할 수 있습니다.',
  '여행 기간 동안 직장은 무급 휴가로, 학교는 인정 결석으로 처리됩니다.',
  '다른 도시에서는 기존 도시에 있는 가족의 정보가 즉시 갱신되지 않을 수 있음을 확인했습니다.'
 ];
 function text(n){return String(n&&n.text||'').trim();}
 function nodes(n){return (n&&n.children||n&&n.nodes||[]).reduce(function(a,x){return a.concat(x,nodes(x));},[]);}
 function labels(n){return nodes(n).filter(function(x){return x.role==='text';}).map(text);}
 function number(s){
  var match=String(s||'').trim().match(/^(?:[₥Ɯ₩§]\s*)?([\d,]+)(?:\s*명)?$/);
  return match?Number(match[1].replace(/,/g,'')):NaN;
 }
 function afterLabel(tree,label){
  var all=labels(tree), i=all.indexOf(label);
  return i>=0?all[i+1]:undefined;
 }
 function value(tree,label){return number(afterLabel(tree,label));}
 function enabled(n){return n&&n.ref&&!/dimmed|disabled|unreachable/i.test(String(n.state||''));}
 function find(tree,test){return nodes(tree).filter(test);}
 function unique(items){return items.length===1?items[0]:null;}
 function button(tree,suffix,title){
  return unique(find(tree,function(n){
   return n.role==='button'&&enabled(n)&&n.ref.endsWith(suffix)&&(!title||text(n)===title);
  }));
 }
 function next(tree){
  var outer=button(tree,'/BW_WBP_Button_Right','다음');
  return outer&&button(tree,nextSuffix,'다음');
 }
 function listAt(tree,suffix){
  return unique(find(tree,function(n){return n.role==='list'&&n.ref&&n.ref.endsWith(suffix);}));
 }
 function entries(tree,suffix){
  var list=listAt(tree,suffix);
  return (list&&list.children||[]).filter(function(n){return n.role==='entry'&&enabled(n);});
 }
 function currentCity(tree){
  var names=labels(tree), cityKeys=Object.keys(cities), result=cityKeys.filter(function(map){
   return cities[map].some(function(name){return names.indexOf(name)>=0;});
  });
  if(result.length===1)return result[0];
  var summary=find(tree,function(n){return n.role==='scroll'&&n.ref&&n.ref.indexOf('/BW_WBP_SelectCity/')>=0;});
  var match=result.filter(function(map){
   return summary.some(function(n){return cities[map].some(function(name){return text(n).startsWith(name);});});
  });
  return match.length===1?match[0]:null;
 }
 function travelOverlay(block){
  return block.popup_count===1&&block.primary_detail==='None'&&(block.pause_reasons||[]).indexOf('CityMoveMainPopup')>=0;
 }
 function checkInTags(character){
  if(!character||!Array.isArray(character.entityTags))return null;
  return character.entityTags.filter(function(tag){return tag.value==='Stay_CheckIn'&&typeof tag.expire==='string';})
   .map(function(tag){return tag.expire;});
 }
 function checkInEvidence(character,trip){
  if(!Array.isArray(trip.checkInBefore)||!character||character.locatedCityName!==trip.destination)return null;
  var tags=checkInTags(character)||[];
  var fresh=tags.find(function(expiry){return trip.checkInBefore.indexOf(expiry)<0;});
  return fresh?{tag:'Stay_CheckIn',expiry:fresh,site:character.locatedSiteId&&character.locatedSiteId.value}:null;
 }
 function roomOptions(tree,party,nights,limit){
  if(!(party>=1&&party<=8&&nights===1&&limit>0))return [];
  return entries(tree,'/BW_HotelList').map(function(n){
   var room=labels(n), title=room[0];
   var capacity=room.map(function(s){return s.match(/^권장\s*(\d+)명$/);}).find(Boolean);
   var rate=room.lastIndexOf('박'), price=rate>1&&room[rate-1]==='/'?number(room[rate-2]):NaN;
   return {ref:n.ref,rect:n.rect,title:title,capacity:capacity?Number(capacity[1]):0,price:price};
  }).filter(function(room){return room.title&&/\d+\s*호/.test(room.title)&&room.capacity>=party&&room.price>0&&room.price<=limit;})
   .sort(function(a,b){return a.price-b.price||a.capacity-b.capacity||a.title.localeCompare(b.title);});
 }
 function weekdayAfter(day){var i=weekdays.indexOf(day);return i<0?null:weekdays[(i+1)%7];}
 function offTomorrow(work,timeline,day){
  var tomorrow=weekdayAfter(day);
  if(!tomorrow)return false;
  var slots=Object.values(timeline.careerTimelineParams||{}).filter(function(s){return s&&s.timelineId&&s.timelineId!=='None';});
  var overrides=timeline.overrideTimelines, override=Array.isArray(overrides)&&overrides[weekdays.indexOf(tomorrow)];
  if(!override||override.name!=='None')return false;
  if(work.has_job===false&&!slots.length)return true;
  return slots.length>0&&slots.every(function(s){return Array.isArray(s.workDays)&&s.workDays.indexOf(tomorrow)<0;});
 }
 function companionCount(tripCount,eligible,traits){
  if(!eligible)return 0;
  var turn=(tripCount+(traits.indexOf('Social')>=0?1:0))%3;
  return turn===0?0:turn===1?1:Math.min(eligible,7);
 }
 function entryPoint(room,list,vertical){
  if(!Array.isArray(room.rect)||!Array.isArray(list.rect))return null;
  var r=room.rect,l=list.rect, x=Math.max(r[0],l[0]), y=Math.max(r[1],l[1]);
  var right=Math.min(r[0]+r[2],l[0]+l[2]), bottom=Math.min(r[1]+r[3],l[1]+l[3]);
  return right-x>32&&bottom-y>36?{X:(x+right)/2,Y:y+(bottom-y)*vertical,Force:false,hold_ticks:2}:null;
 }
 function bookingReview(screen,trip){
  var city=cities[trip.destination]||[];
  if(labels(screen).indexOf('내 여행 정보')<0||city.indexOf(afterLabel(screen,'여행 도시'))<0||
     afterLabel(screen,'숙소')!==trip.room||afterLabel(screen,'여행 기간')!=='1박'||
     value(screen,'총 여행 비용')!==trip.price||trip.roomParty!==trip.party||labels(screen).indexOf('여행 인원')<0)return null;
  var checks=find(screen,function(n){
   return n.role==='toggle'&&enabled(n)&&/\/BW_WBP_Confirm\/BW_DynamicEntryBox_CheckBox\/[^/]+\/BW_CheckBox$/.test(n.ref);
  });
  if(checks.length!==notices.length||notices.some(function(line){
   return checks.filter(function(n){return text(n)===line&&n.state&&(n.state.indexOf('on')>=0||n.state.indexOf('off')>=0);}).length!==1;
  }))return null;
  var pending=checks.find(function(n){return n.state.indexOf('off')>=0;});
  var ready=button(screen,'/BW_WBP_Button_Ready','여행 떠나기');
  return {pending:pending,confirm:!pending&&ready&&button(screen,'/BW_WBP_Button_Ready/BW_Button','여행 떠나기')};
 }
 function create(api,L,P){
  var cli=api.cli,write=api.write,state=api.state;
  async function tree(name,hitTest){
   try{return await cli('ui.get_tree',{Window:name,max_nodes:620,verify_hit:!!hitTest});}
   catch(e){if(/not found|not open|찾을 수 없|no widget|no window/i.test(e.message))return {};throw e;}
  }
  function describe(trip,note){
   var p=state.people[trip.actor];if(p)p.vacationNote=note;
  }
  function forget(trip,note){
   describe(trip,note);state.travel=null;
   var p=state.people[trip.actor];if(p)p.nextVacation=trip.day*1440+1440;
   api.log(note);
  }
  async function click(ref,trip,token,direct,popup){
   var args={ref:ref,Force:direct};
   if(!direct)args.hold_ticks=2;
   await write('ui.click',args,token,popup||':travel',trip.actor);
  }
  var travelWindow={type:'TravelPopup',key:'window',close:'/BW_Button_Close'};
  var purposeWindow={type:'TravelCityMovePopup',key:'purposeWindow',close:'/BW_WBP_Title/BW_Button_Back'};
  var phoneWindow={type:'Smartphone',key:'phoneWindow',close:'/WBP_Mobile/WBP_Common_CloseButton/BW_Button'};
  var preparationWindows=[travelWindow,purposeWindow,phoneWindow];
  function windowsOf(opened,type){return (opened.windows||[]).filter(function(w){return w.ui_type===type;});}
  async function rememberOpened(trip,surface){
   try{
    var window=unique(windowsOf(await cli('ui.list_windows'),surface.type));
    if(window&&window.window)trip[surface.key]=window.window;
   }catch(_){}
  }
  function preparing(trip){return state.travel===trip&&trip.stage!=='submitted'&&trip.stage!=='unconfirmed';}
  function preparationEndReason(trip,time){
   if(state.background)return '다른 작업 모드 · 미제출 여행 준비 종료';
   if(time.day!==trip.day||Date.now()-trip.started>110000)return '여행 준비 종료 · 확인되지 않은 예약 단계';
  }
  async function closePreparation(trip,game,token){
   var modal=game.blocking||{};
   if(modal.popup_count&&!travelOverlay(modal))return false;
   var attempted=[];
   while(preparing(trip)&&api.active(token)){
    var opened=await cli('ui.list_windows');
    var surface=preparationWindows.find(function(s){return windowsOf(opened,s.type).length>0;});
    if(!surface)return true;
    var window=unique(windowsOf(opened,surface.type));
    if(!window||!window.window||window.window!==trip[surface.key]||attempted.indexOf(surface.type)>=0)return false;
    var screen=await tree(window.window);
    var close=screen.window===window.window&&button(screen,window.window+surface.close);
    if(!close||!preparing(trip)||!api.active(token))return false;
    attempted.push(surface.type);
    await click(close.ref,trip,token,true);
   }
   return false;
  }
  async function stopPreparation(trip,game,token,note){
   // Travel preparation may own a modal that pauses the game. Release the plan even when it cannot safely close that modal.
   var closed=false;
   try{closed=await closePreparation(trip,game,token);}catch(_){}
   if(preparing(trip))forget(trip,note+(closed?'':' · 게임 화면 확인 필요'));
   return false;
  }
  async function available(id,day,minimum){
   var args={entity_id:String(id)};
   var work=await cli('career.get_work_status',args);
   if(work.is_at_work||work.is_working_time||work.is_commute_time||work.is_working_day!==false)return false;
   var schedule=await cli('schedule.diagnose',args);
   if(schedule.has_schedule!==false)return false;
   var stats=await cli('stat.get_all',args);
   if(!stats.stats||L.urgentNeed(stats.stats)||!['Hunger','Sleep','Toilet'].every(function(k){return stats.stats[k]&&stats.stats[k].pct>=minimum;}))return false;
   return offTomorrow(work,await cli('entity.reflect',{entity_id:String(id),Component:'Timeline'}),day);
  }
  async function funds(trip){
   return L.dayBudget(await cli('entity.reflect',{entity_id:trip.household,Component:'Currency'}),trip.familySize);
  }
  async function observeStay(trip,minute){
   if(!trip||trip.checkIn==='confirmed'||minute<(trip.nextCheckIn||0))return;
   trip.nextCheckIn=minute+20;
   var character;
   try{character=await cli('entity.reflect',{entity_id:trip.arrivedActor});}catch(_){return;}
   var evidence=checkInEvidence(character,trip);
   if(evidence){
    trip.checkIn='confirmed';trip.checkInEvidence=evidence;
    describe(trip,'도시 도착 및 실제 숙소 체크인 확인');
    api.log('숙소 체크인 확인 · '+trip.room);
   }
  }
  async function start(member,decision,snapshot,time,token){
   var game=api.game(), actor=String(member.entity_id), household=String(member.household_id);
   if(state.background||state.travel||state.awayTravel||actor!==String(game.possessed_entity_id)||!cities[game.map_id])return false;
   var env=await cli('environment.get_state');
   if(env.day!==time.day||env.is_disaster||!await available(actor,env.day_of_week,42)){
    decision.vacationNote='1박 동안 비는 일정 확인 대기';return false;
   }
   var family=await cli('household.get_members');
   if(String(family.household_id)!==household)return false;
   var trip={actor:actor,household:household,familySize:family.members.length,origin:game.map_id,day:time.day,
    actorName:member.last_name+' '+member.first_name,weekday:env.day_of_week,
    started:Date.now(),stage:'phone',tried:[],party:1,companions:[],eligible:[]};
   var wallet=await funds(trip);
   if(!wallet||wallet.free<40||(decision.vacation.extra&&wallet.free<600)){
    decision.vacationNote='생활비 확보 후 도시 여행';return false;
   }
   var open=await cli('ui.list_windows');
   var block=game.blocking||{};
   var safeHud=Array.isArray(open.windows)&&open.windows.every(function(w){
    return /^(?:Hud|Tooltip|SpeechBubble|InteractionMarkerCanvas|WaypointIndicator|CommonCatAlert|MsgBox|CursorActorInfo|HopeOverHeadAlert)$/.test(w.ui_type)||
     w.ui_type==='RelationshipEffect'&&w.counts&&w.counts.interactive===0;
   });
   if(!safeHud||block.loading||block.coach_mark||block.cat_talk||block.level_sequence||block.popup_count||
      block.blocked&&block.primary_kind!=='modal_ui')return false;
   var other=family.members.filter(function(m){return String(m.entity_id)!==actor;});
   for(var i=0;i<other.length;i++){
    var person=other[i], info=await cli('entity.reflect',{entity_id:String(person.entity_id)});
    if(info.locatedCityName===trip.origin&&await available(person.entity_id,trip.weekday,45))
     trip.eligible.push({id:String(person.entity_id),name:person.last_name+' '+person.first_name});
   }
   var count=companionCount(decision.vacation.trips.length,trip.eligible.length,P.traits(snapshot.trait));
   var rotation=trip.eligible.length?(decision.vacation.trips.length+trip.day)%trip.eligible.length:0;
   trip.eligible=trip.eligible.slice(rotation).concat(trip.eligible.slice(0,rotation)).slice(0,count);
   trip.previous=state.lastTravelCity&&state.lastTravelCity[household];
   var phone=button(await tree('Hud',block.blocked),'/WBP_PlayerInfo/BW_Button_SmartPhone');
   if(!phone||state.background||!api.active(token))return false;
   await click(phone.ref,trip,token,true);
   state.travel=trip;
   await rememberOpened(trip,phoneWindow);
   describe(trip,'도시 간 1박 여행 준비 중');
   return true;
  }
  async function advance(game,time,token){
   var trip=state.travel;
   if(!trip||!api.active(token))return false;
   if(trip.stage==='submitted'||trip.stage==='unconfirmed'){
    if(game.map_id===trip.destination&&game.map_id!==trip.origin){
     var family=await cli('household.get_members');
     var member=(family.members||[]).find(function(m){return String(m.entity_id)===trip.actor||
      m.last_name+' '+m.first_name===trip.actorName;});
     if(!member)return true;
     var p=state.people[trip.actor];
     if(p&&p.vacation&&!p.vacation.trips.some(function(t){return t.day===trip.day;}))
      p.vacation.trips.push({day:trip.day,city:trip.destination,room:trip.room,party:trip.party});
     state.lastTravelCity=state.lastTravelCity||{};
     state.lastTravelCity[trip.household]=trip.destination;
     var wallet, balance, debit;
     try{
      wallet=await cli('entity.reflect',{entity_id:String(family.household_id),Component:'Currency'});
      balance=wallet.currencyMap&&wallet.currencyMap.mew;
      debit=L.matchingDebit(wallet,trip.ledgerBefore,member.entity_id,trip.price,'ExpenseBuy');
     }
     catch(_){}
     var paid=Number.isFinite(trip.balanceBefore)&&Number.isFinite(balance)&&trip.balanceBefore-balance===trip.price;
     var joined=[];
     for(var j=0;j<(trip.companions||[]).length;j++){
      var person=trip.companions[j], matches=(family.members||[]).filter(function(m){
       return String(m.entity_id)===person.id||m.last_name+' '+m.first_name===person.name;
      }), present=null;
      if(matches.length===1){
       try{
        var city=(await cli('entity.reflect',{entity_id:String(matches[0].entity_id)})).locatedCityName;
        if(typeof city==='string'&&city)present=city===trip.destination;
       }
       catch(_){}
      }
      joined.push({name:person.name,present:present});
     }
     state.awayTravel={household:trip.household,awayHousehold:String(family.household_id),actor:trip.actor,
      actorName:trip.actorName,origin:trip.origin,destination:trip.destination,room:trip.room,price:trip.price,
      arrivedActor:String(member.entity_id),balanceBefore:trip.balanceBefore,balanceAfter:balance,
      paymentEvidence:debit&&paid?'matching-ledger-and-balance':paid?'matching-balance-change':'unconfirmed',
      ledgerEntry:debit||null,companions:joined,checkInBefore:trip.checkInBefore,checkIn:'unconfirmed'};
     describe(trip,'도시 도착 확인 · '+(debit&&paid?'예약액과 거래 원장 일치':paid?'예약액과 잔액 차이 일치':'결제 확인 대기')+' · 체크인 확인 필요');
     await observeStay(state.awayTravel,time.day*1440+time.hour*60+time.minute);
     api.log('도시 여행 도착 확인 · '+trip.room+' · '+trip.party+'명');
     state.travel=null;return false;
    }
    if(trip.stage==='submitted'&&Date.now()-trip.submitted>120000){
     trip.stage='unconfirmed';
     describe(trip,'여행 요청 결과 미확인 · 같은 예약 재요청 보류');
     api.log('여행 요청 결과 미확인 · 생활 관찰을 이어가며 도시 도착 재확인');
    }
    return trip.stage!=='unconfirmed';
   }
   if(String(game.possessed_entity_id)!==trip.actor||game.map_id!==trip.origin){forget(trip,'여행 준비 중 조이가 변경됨');return false;}
   var endReason=preparationEndReason(trip,time);
   if(endReason)return stopPreparation(trip,game,token,endReason);
   var modal=game.blocking||{};
   var overlay=travelOverlay(modal);
   if(modal.popup_count&&!overlay&&trip.stage!=='review')return true;
   var opened=await cli('ui.list_windows');
   function windowFor(name){return (opened.windows||[]).find(function(w){return w.ui_type===name;});}
   var travel=windowFor('TravelPopup'), purpose=windowFor('TravelCityMovePopup'), phone=windowFor('Smartphone');
   if(trip.stage==='phone'&&phone&&!purpose&&!travel){
    if(trip.phoneWindow&&trip.phoneWindow!==phone.window){forget(trip,'다른 휴대폰 화면이 열려 여행 준비를 종료');return false;}
    trip.phoneWindow=phone.window;
    var open=button(await tree(phone.window),'/BW_WBP_MoveCity/BW_Button');
    if(open){
     await click(open.ref,trip,token,true);trip.stage='purpose';
     await rememberOpened(trip,purposeWindow);
    }
    return true;
   }
   if(trip.stage==='purpose'&&purpose){
    if(trip.purposeWindow&&trip.purposeWindow!==purpose.window){forget(trip,'다른 도시 이동 화면이 열려 여행 준비를 종료');return false;}
    trip.purposeWindow=purpose.window;
    var go=button(await tree(purpose.window),'/BW_Button_Travel/BW_Button','여행 가기');
    if(go){
     await click(go.ref,trip,token,true);trip.stage='city';
     if(!travel)await rememberOpened(trip,travelWindow);
    }
    return true;
   }
   if(modal.popup_count&&!overlay)return true;
   if(!travel){
    if(trip.window){forget(trip,'도시 여행 창이 닫혀 예약 준비를 종료');return false;}
    return true;
   }
   if(trip.window&&trip.window!==travel.window){forget(trip,'다른 여행 화면이 열려 예약 준비를 종료');return false;}
   trip.window=travel.window;
   var screen=await tree(travel.window), words=labels(screen), forward=next(screen);
   if(trip.stage==='city'&&words.indexOf('도시 선택')>=0){
    var selected=currentCity(screen);
    if(selected&&selected!==trip.origin&&(selected!==trip.previous||trip.tried.length>=2)&&forward){
     await click(forward.ref,trip,token,true);trip.destination=selected;trip.stage='party';return true;
    }
    var options=entries(screen,'/BW_ListView_SelectCity').filter(function(n){
     return text(n)!=='거주 도시'&&labels(n).indexOf('거주 도시')<0&&trip.tried.indexOf(n.ref)<0;
    });
    if(!trip.tried.length&&options.length>1&&(trip.day+trip.actor.length)%2)options.reverse();
    if(options.length){
     await click(options[0].ref,trip,token,false);trip.tried.push(options[0].ref);
    }
    return true;
   }
   if(trip.stage==='party'){
    var countLabel=words.map(function(s){return s.match(/^([1-8])\/8$/);}).find(Boolean);
    if(!countLabel)return true;
    var actual=Number(countLabel[1]);
    var picker=words.indexOf('함께 할 조이 선택하기')>=0;
    if(picker&&trip.partyPicker){
     var chosen=trip.pickerSelected||(trip.pickerSelected=[]);
     var pickerCount=words.map(function(s){return s.match(/^([1-8])\s+\/\s+8$/);}).find(Boolean);
     if(!pickerCount)return true;
     var selectedCount=Number(pickerCount[1]);
     if(trip.awaitingCompanion&&selectedCount===trip.party+chosen.length+1){
      chosen.push(trip.awaitingCompanion);trip.awaitingCompanion=null;
     }
     if(selectedCount!==trip.party+chosen.length||trip.awaitingCompanion)return true;
     if(!trip.homeFilter){
      var homeTab=button(screen,'/BW_WBP_SelectZoiPanel/BW_WBPSortButton_Home/BW_Button_Sort');
      if(!homeTab)return true;
      await click(homeTab.ref,trip,token,true);trip.homeFilter=true;return true;
     }
     var target=trip.eligible[chosen.length], list=listAt(screen,'/BW_WBP_SelectZoiPanel/BW_TileView_Zoi');
     var candidate=target&&unique(entries(screen,'/BW_WBP_SelectZoiPanel/BW_TileView_Zoi').filter(function(n){
      return text(n)===target.name;
     }));
     var position=candidate&&list&&entryPoint(candidate,list,0.28);
     if(position){
      await write('ui.click',position,token,':travel',trip.actor);
      trip.awaitingCompanion=target;return true;
     }
     var addConfirmed=button(screen,'/BW_WBP_SelectZoiPanel/BW_WBP_ButtonOK/BW_Button','확인');
     if(addConfirmed){
      await click(addConfirmed.ref,trip,token,true);trip.partyConfirm=true;
     }
     return true;
    }
    if(trip.partyConfirm){
     var confirmed=trip.pickerSelected||[];
     if(actual!==trip.party+confirmed.length||!confirmed.every(function(person){return words.indexOf(person.name)>=0;}))return true;
     trip.companions=confirmed;trip.party=actual;trip.partyPicker=false;trip.partyConfirm=false;
     trip.eligible=confirmed;
    }
    if(actual!==trip.party||picker)return true;
    if(trip.companions.length<trip.eligible.length){
     var add=button(screen,'/BW_WBP_SelectZoi/BW_Button_AddZoi');
     if(add&&!trip.partyPicker){await click(add.ref,trip,token,true);trip.partyPicker=true;return true;}
     if(trip.partyPicker)return true;
    }
    if(forward){await click(forward.ref,trip,token,true);trip.stage='room';}
    return true;
   }
   if(trip.stage==='room'&&words.indexOf('숙소 선택')>=0){
    var party=value(screen,'숙박 인원'), cash=value(screen,'소지금'), total=value(screen,'총 숙박 요금');
    var nights=unique(find(screen,function(n){return n.role==='stepper'&&n.ref&&n.ref.endsWith('/BW_WBP_NightStepper');}));
    var wallet=await funds(trip);
    if(!wallet||party!==trip.party||!nights||number(text(nights))!==1)return true;
    var limit=Math.min(wallet.free,cash-wallet.reserve,180*party);
    var hotels=listAt(screen,'/BW_HotelList');
    if(!hotels)return true;
    if(!trip.room){
     var room=roomOptions(screen,party,1,limit)[0];
     if((!room||room.capacity!==party)&&hotels.scroll&&!hotels.scroll.at_end&&!trip.scrolledHotels){
      await write('ui.scroll',{ref:hotels.ref,To:'end'},token,':travel',trip.actor);
      trip.firstRoom=room;trip.scrolledHotels=true;return true;
     }
     if(trip.firstRoom&&(!room||trip.firstRoom.price<room.price)&&hotels.scroll&&!hotels.scroll.at_start){
      await write('ui.scroll',{ref:hotels.ref,To:'start'},token,':travel',trip.actor);
      trip.firstRoom=null;return true;
     }
     var point=room&&entryPoint(room,hotels,0.5);
     if(point){
      await write('ui.click',point,token,':travel',trip.actor);
      trip.room=room.title;trip.price=room.price;
     }
     else describe(trip,'인원과 예산이 맞는 숙소 확인 대기');
     return true;
    }
    if(total===trip.price&&total>0&&total<=limit&&forward){
     await click(forward.ref,trip,token,true);trip.roomParty=party;trip.stage='review';
     describe(trip,'숙소 선택 확인 · '+trip.room+' · '+total+'미유');
    }
    return true;
   }
   if(trip.stage==='review'){
    var review=bookingReview(screen,trip);
    if(!review||!review.pending&&!review.confirm){
     trip.review={labels:words.slice(0,30),buttons:find(screen,function(n){
      return n.role==='button'&&enabled(n);
     }).map(function(n){return text(n);}).filter(Boolean).slice(0,12)};
     describe(trip,'숙소 선택 완료 · 최종 예약 정보 확인 대기');return true;
    }
    if(!trip.scheduleVerified||review.confirm){
     var bookingFunds=await funds(trip);
     if(!bookingFunds||bookingFunds.free<trip.price||!await available(trip.actor,trip.weekday,42)){
      describe(trip,'최종 예약 전 일정·생활비 다시 확인');return true;
     }
     for(var c=0;c<trip.companions.length;c++){
      if(!await available(trip.companions[c].id,trip.weekday,45)){
       describe(trip,'동반인 일정이 변경되어 예약 대기');return true;
      }
     }
     trip.scheduleVerified=true;
    }
    if(review.pending){
     await click(review.pending.ref,trip,token,false);
     describe(trip,'출발 안내 확인 중');return true;
    }
    var originalWallet=await cli('entity.reflect',{entity_id:trip.household,Component:'Currency'});
    var originalCharacter=await cli('entity.reflect',{entity_id:trip.actor});
    var finalBudget=L.dayBudget(originalWallet,trip.familySize);
    if(!finalBudget||finalBudget.free<trip.price)return true;
    var latestReview=bookingReview(await tree(travel.window),trip);
    if(!latestReview||!latestReview.confirm||latestReview.confirm.ref!==review.confirm.ref)return true;
    endReason=preparationEndReason(trip,time);
    if(endReason)return stopPreparation(trip,game,token,endReason);
    if(!preparing(trip)||!api.active(token))return false;
    trip.balanceBefore=finalBudget.cash;
    trip.ledgerBefore=L.ledgerCheckpoint(originalWallet);
    trip.checkInBefore=checkInTags(originalCharacter);
    trip.stage='submitted';trip.submitted=Date.now();
    await click(review.confirm.ref,trip,token,false);
    describe(trip,'숙소 예약 요청 · 도시 이동 확인 대기');
    return true;
   }
   return true;
  }
  return {start:start,advance:advance,observeStay:observeStay};
 }
 var api={create:create,currentCity:currentCity,roomOptions:roomOptions,offTomorrow:offTomorrow,companionCount:companionCount,
  bookingReview:bookingReview,travelOverlay:travelOverlay,entryPoint:entryPoint,checkInEvidence:checkInEvidence};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.ObserverTravel=api;
})(this);
