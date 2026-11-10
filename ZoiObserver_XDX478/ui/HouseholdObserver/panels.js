(function (root) {
 'use strict';
 var C=root.ObserverChoices, P=root.ObserverPolicy, L=root.ObserverLife;
 function create(api){
  var cli=api.cli, write=api.write, log=api.log, game=api.game, background=api.background||function(){return false;};
  var rows={}, tables={}, news=null, nextNews=0, orders={}, choiceAt=0, phoneReturn=null, phonePanel=null, lastCall=null;
  var callTitles=null;
  function wait(ms){return new Promise(function(resolve){setTimeout(resolve,ms||180);});}
  function row(alias,id){
   var key=alias+':'+id;
   if(!rows[key])rows[key]=cli('data.table_get',{Alias:alias,Row:id}).catch(function(){delete rows[key];return {};});
   return rows[key];
  }
  async function table(alias){
   if(!tables[alias]){
    var list=await cli('data.table_get_all',{Alias:alias});
    if(!Array.isArray(list))throw Error(alias+' 데이터 응답 형식 변경');
    tables[alias]=list;
   }
   return tables[alias];
  }
  async function tree(window,offscreen){
   try{return await cli('ui.get_tree',{Window:window,max_nodes:450,include_offscreen:!!offscreen});}
   catch(_){return {};}
  }
  function nodes(t){return C.widgets(t.nodes);}
  function button(list,suffix){return list.find(function(n){return C.usable(n)&&n.ref.endsWith(suffix);});}
  function profileButton(list){
   var buttons=list.filter(function(n){
    return n.role==='button'&&n.ref&&/\/WBP_PlayerProfile\/MenuEntryBox\/WBP_HUD_PlayerProfile_Button_C_\d+\/Button(?:_Disable)?$/.test(n.ref);
   }).sort(function(a,b){return a.rect[0]-b.rect[0];});
   return buttons.length===7&&C.usable(buttons[5])?buttons[5]:null;
  }
  function label(n,text){return C.clean(n.text)===text;}
  async function click(n,token,actor,force){
   if(!n||!n.ref)return false;
   await write('ui.click',{ref:n.ref,Force:force!==false,hold_ticks:2},token,null,String(actor));
   if(force===false)await wait();
   return true;
  }
  async function scroll(n,args,token,actor){
   await write('ui.scroll',Object.assign({ref:n.ref},args),token,null,String(actor));
   await wait();
  }
  async function closePhone(suffix,token,actor,normal){
   var node=button(nodes(await tree('Smartphone')),suffix);
   if(!node)return;
   await click(node,token,actor,normal&&!background()?false:true);
   if(background())await wait(350);
  }
  async function l10n(keys){
   keys=Array.from(new Set(keys.filter(Boolean)));
   return keys.length?await cli('l10n.get',{Keys:JSON.stringify(keys)}):{};
  }
  function reflect(id,component){return cli('entity.reflect',{entity_id:String(id),Component:component});}
  async function freeHud(){
   var windows=await cli('ui.list_windows');
   var block=windows.blocking||{};
   return Array.isArray(windows.windows)&&!block.popup_count&&!block.coach_mark&&!block.cat_talk&&!block.level_sequence&&
    !windows.windows.some(function(w){return !/^(?:Hud|Tooltip|SpeechBubble|InteractionMarkerCanvas|WaypointIndicator|CommonCatAlert|MsgBox)$/.test(w.ui_type);});
  }
  function sameMap(a,b){
   if(!a||!b)return false;
   var keys=Object.keys(b), normalized=Object.create(null);
   keys.forEach(function(k){normalized[k.toLowerCase()]=b[k];});
   return Object.keys(a).length===keys.length&&Object.keys(a).every(function(k){return a[k]===normalized[k.toLowerCase()];});
  }
  function profileName(list){
   var labels=list.filter(function(n){return n.role==='text';}).map(function(n){return C.clean(n.text);});
   var index=labels.findIndex(function(t){return /^(?:이름|Name)$/i.test(t);});
   return index>=0?labels[index+1]:null;
  }
  async function preference(member,snapshot,skills,decision,minute,token){
   if(minute<(decision.nextTaste||0))return;
   decision.nextTaste=minute+30;
   var actor=String(game().possessed_entity_id), id=String(member.entity_id);
   var family=await cli('household.get_members');
   var current=family.members||[];
   var definition=await table('Preference'), rules=await table('PreferenceRelatedTrait');
   var data=await reflect(id,'Preference'), stored=data.preferenceMap;
   if(!stored||typeof stored!=='object')return;
   var wanted=C.preferencePlan(P.traits(snapshot.trait),skills,definition,rules,stored,id,{
    age:member.age_group,job:member.job_name,hopes:snapshot.hope.selected.map(function(h){return h.hope_id;})
   });
   decision.preferences={saved:stored,pending:wanted.map(function(x){return x.id;})};
   if(!wanted.length){decision.nextTaste=minute+360;return;}
   if(background())return ObserverAgenda.result('waiting','화면 입력 대기',minute+30);
   if(!current.some(function(x){return String(x.entity_id)===id;})||!await freeHud())return;
   var profileIcon=profileButton(nodes(await tree('Hud')));
   if(!profileIcon)return;
   var panel,editor;
   try{
    await click(profileIcon,token,actor);
    await wait();
    panel=await tree('CatOperator');
    if(panel.ui_type!=='CatOperator')return;
    var targetNames=[C.clean(member.last_name+' '+member.first_name),C.clean(member.first_name+' '+member.last_name)];
    if(current.filter(function(m){return targetNames.indexOf(C.clean(m.last_name+' '+m.first_name))>=0;}).length!==1)return;
    var card=nodes(panel);
    var profile=card.find(function(n){return n.role==='entry'&&n.ref&&/\/BW_ListView_Tab\//.test(n.ref)&&/^(?:프로필|Profile)$/i.test(C.clean(n.text));});
    if(!profile)return;
    if(!profileName(card)){await click(profile,token,actor,false);card=nodes(await tree('CatOperator'));}
    if(targetNames.indexOf(profileName(card))<0){
     var portraits=card.filter(function(n){return C.usable(n)&&/WBP_CatOperator_PlayerPortrait.*\/BW_Button_Portrait$/.test(n.ref);});
     for(var i=0;i<portraits.length;i++){
      await click(portraits[i],token,actor);
      card=nodes(await tree('CatOperator'));
      if(targetNames.indexOf(profileName(card))>=0)break;
     }
    }
    if(targetNames.indexOf(profileName(card))<0)return;
    var tab=card.find(function(n){return n.role==='entry'&&n.ref&&/\/BW_ListView_Tab\//.test(n.ref)&&/^(?:취향|Preferences?)$/i.test(C.clean(n.text));});
    if(!await click(tab,token,actor,false))return;
    if(!await click(button(nodes(await tree('CatOperator')),'/BW_WBP_Preference/BW_Button_Change/BW_Button'),token,actor))return;
    await wait();
    editor=await tree('PreferenceSelect',true);
    if(editor.ui_type!=='PreferenceSelect')return;
    var startView=nodes(editor).find(function(n){return n.role==='scroll'&&n.ref&&n.ref.endsWith('/BW_ScrollBox');});
    if(startView&&startView.scroll&&!startView.scroll.at_start){
     await scroll(startView,{To:'start'},token,actor);
     editor=await tree('PreferenceSelect',true);
    }
    var categories=Array.from(new Set(definition.map(function(r){return r.category;})));
    var groups=Object.create(null), visible=Object.create(null);
    for(var page=0;page<3;page++){
     var all=nodes(editor);
     var view=all.find(function(n){return n.role==='scroll'&&n.ref&&n.ref.endsWith('/BW_ScrollBox');});
     if(!view||!view.rect||!view.scroll)return;
     var buttons=all.filter(function(n){
      return C.usable(n)&&/\/WBP_CatOperator_CategoryChangeListEntry_C_\d+\/BW_DynamicEntryBox\/WBP_CatOperator_PreferenceListEntry_C_\d+\/BW_Button$/.test(n.ref);
     });
     buttons.forEach(function(b){
      var ids=b.ref.match(/CategoryChangeListEntry_C_(\d+)\/.*PreferenceListEntry_C_(\d+)\//);
      var group=groups[ids[1]]||(groups[ids[1]]=Object.create(null));
      var y=b.rect[1]+b.rect[3]/2;
      var onScreen=y>=view.rect[1]&&y<view.rect[1]+view.rect[3];
      if(onScreen||!group[ids[2]])group[ids[2]]={option:b,offset:view.scroll.offset};
     });
     if(page<2){
      await scroll(view,page===0?{To:'offset',Offset:Math.round(view.scroll.max/2)}:{To:'end'},token,actor);
      editor=await tree('PreferenceSelect',true);
     }
    }
    function creationOrder(a,b){return Number(b)-Number(a);}
    var orderedGroups=Object.keys(groups).sort(creationOrder);
    if(orderedGroups.length!==categories.length)return;
    orderedGroups.forEach(function(groupId,index){
     var group=groups[groupId], options=Object.keys(group).sort(creationOrder);
     var category=definition.filter(function(r){return r.category===categories[index];});
     if(options.length!==category.length)return;
     options.forEach(function(option,i){visible[category[i].iD]=group[option];});
    });
    var changed=[];
    decision.nextTaste=minute+90;
    for(var k=0;k<wanted.length;k++){
     var taste=wanted[k], place=visible[taste.id];
     if(!place)continue;
     var start=await reflect(id,'Preference'), key=taste.id.toLowerCase();
     if(!sameMap(stored,start.preferenceMap))break;
     var scrollBox=nodes(editor).find(function(n){return n.role==='scroll'&&n.ref&&n.ref.endsWith('/BW_ScrollBox');});
     if(!scrollBox)break;
     if(Math.abs(scrollBox.scroll.offset-place.offset)>1)await scroll(scrollBox,{To:'offset',Offset:place.offset},token,actor);
     editor=await tree('PreferenceSelect',true);
     var option=nodes(editor).find(function(n){return C.usable(n)&&n.ref===place.option.ref;});
     if(!option)continue;
     await click(option,token,actor);
     var after=(await reflect(id,'Preference')).preferenceMap;
     var expected=Object.assign({},stored);expected[key]=true;
     if(sameMap(after,expected)&&!taste.like){
      await click(option,token,actor);
      after=(await reflect(id,'Preference')).preferenceMap;expected[key]=false;
     }
     if(!sameMap(after,expected)){
      for(var undo=0;undo<2&&!sameMap(after,stored);undo++){
       await click(option,token,actor);after=(await reflect(id,'Preference')).preferenceMap;
      }
      if(!sameMap(after,stored))log(member.first_name+': 취향 변경 상태 확인 필요');
      break;
     }
     stored=after;changed.push(taste.id+' '+(taste.like?'좋아함':'싫어함'));
    }
    var chosen=Object.keys(stored).map(function(k){return k.toLowerCase();});
    decision.preferences={saved:stored,pending:wanted.filter(function(x){return chosen.indexOf(x.id.toLowerCase())<0;}).map(function(x){return x.id;})};
    if(changed.length){
     log(member.first_name+': 취향 자동 반영 확인 / '+changed.join(', '));
     return ObserverAgenda.result('verified',changed.length+'개 취향 반영');
    }
   }finally{
    if(editor&&editor.ui_type==='PreferenceSelect')await click(button(nodes(editor),'/BW_Button_Close'),token,actor);
    if(panel&&panel.ui_type==='CatOperator')await click(nodes(await tree('CatOperator')).find(function(n){return C.usable(n)&&n.ref===panel.window+'/BW_Button_Close';}),token,actor);
   }
  }
  async function eventCatalog(){
   if(tables.events)return tables.events;
   var calendar=await table('CalendarEvent'), feed=await table('ActivityFeed');
   var catalog=calendar.filter(function(e){return e.bShowTeleportButton&&e.notifyActivityFeedSchedules;}).map(function(e){
    return Object.assign({},e,{feedId:e.notifyActivityFeedSchedules.todayActivityFeedId});
   });
   catalog.push({iD:'FullHaul',feedId:'RegionalFestival_FullHaul_Today',locations:[{cityId:'Cahaya_Map',siteId:'Cahaya_Public_Pier1'}],
    displayStartTime:1500,displayEndTime:1900,calendarEventRuleIds:[],tags:['Event_Fishing']});
   var ids=catalog.map(function(e){return feed.find(function(f){return f.iD===e.feedId;});});
   var words=await l10n(ids.map(function(f){return f&&f.titleTextId;}));
   tables.events=catalog.map(function(e,i){return Object.assign(e,{title:C.clean(ids[i]&&words[ids[i].titleTextId])});}).filter(function(e){return e.title;});
   return tables.events;
  }
  async function readNews(time,token){
   var actor=String(game().possessed_entity_id);
   if(!api.active(token)||!(Number(actor)>0)||Date.now()<nextNews)return news;
   nextNews=Date.now()+45000;
   var h=await tree('Hud'), all=nodes(h);
   function feedList(list){return list.find(function(n){return n.role==='list'&&n.ref&&n.ref.endsWith('/BW_WBP_ActivityFeed/BW_ListView_Feed');});}
   var list=feedList(all), opened=false, entries=[];
   try{
    if(!list){
     if(!await freeHud())return news;
     opened=await click(button(all,'/WBP_PlayerChangeWidget/BW_Button_ActivityFeed'),token,actor);
     if(!opened)return news;
     await wait();h=await tree('Hud');all=nodes(h);list=feedList(all);
    }
    if(!list)return news;
    for(var page=0;page<8;page++){
     C.feedEntries(list).forEach(function(x){
      if(!entries.some(function(y){return y.title===x.title&&y.description===x.description;}))entries.push(x);
     });
     if(!opened||!list.list||!Array.isArray(list.list.shown)||list.scroll&&list.scroll.at_end)break;
     var next=list.list.shown[1]+1;
     if(next>=list.list.total)break;
     await scroll(list,{To:'index',Index:next},token,actor);
     var after=await tree('Hud');all=nodes(after);
     list=feedList(all);
     if(!list||!list.list||list.list.shown[1]<next)break;
    }
    var catalog=await eventCatalog();
    var events=C.events(entries,catalog,game().map_id,time).map(function(e){
     var native=catalog.find(function(x){return x.iD===e.id;});
     return Object.assign(e,{tags:native.tags||[]});
    });
    news={map:game().map_id,day:time.day,entries:entries,events:events};
    return news;
   }finally{
    if(opened)await click(button(nodes(await tree('Hud')),'/BW_WBP_ActivityFeed/BW_Button_Close/BW_Button'),token,actor);
   }
  }
  function mail(data){
   var threads=[];
   [data.messageList,data.messageListBySystem].forEach(function(group,index){
    Object.keys(group&&group.mobileMessageListMap||{}).forEach(function(key){
     var history=group.mobileMessageListMap[key].mobileMessageList||[];
     var messages=history.filter(function(m){return !m.bIsSend&&!m.bIsIgnored;});
     var unread=messages.filter(function(m){return m.bIsRead===false;});
     var lastSent=history.map(function(m){return m.bIsSend;}).lastIndexOf(true);
     var pending=history.slice(lastSent+1).filter(function(m){return !m.bIsIgnored&&!m.bIsSend&&m.bNeedResponse;}).pop();
     var latest=pending||messages[messages.length-1];
     if(unread.length||pending)threads.push({key:key,system:index===1,unread:unread.length,last:latest,needsReply:!!pending,
      history:history,custom:group.mobileMessageListMap[key].customResponse});
    });
   });
   return threads.sort(function(a,b){
    function priority(t){return /Utility|Tax|Interest|Overdue|Loan/i.test(t.last.messageId||'')?3:t.needsReply?2:t.unread?1:0;}
    function deadline(t){return t.last.positiveAnswerDeadlineTicks>0?t.last.positiveAnswerDeadlineTicks:Number.MAX_SAFE_INTEGER;}
    return priority(b)-priority(a)||deadline(a)-deadline(b)||b.unread-a.unread;
   });
  }
  function updatePhone(decision,threads){
   decision.pendingReplies=threads.filter(function(t){return t.needsReply;}).length;
   decision.phone={unread:threads.reduce(function(n,t){return n+t.unread;},0),items:threads.filter(function(t){return t.unread>0;})
    .slice(0,10).map(function(t){return {id:t.last.messageId,kind:t.needsReply?'답장 필요':t.system?'시스템':'일반'};})};
  }
  function messageHistory(data,item){
   var group=item.system?data.messageListBySystem:data.messageList;
   return (group&&group.mobileMessageListMap&&group.mobileMessageListMap[item.thread]||{}).mobileMessageList||[];
  }
  function responseEvidence(history,item){
   var index=history.findIndex(function(m){return !m.bIsSend&&m.timestamp===item.timestamp&&m.messageId===item.messageId;});
   if(index<0)return null;
   var following=history.slice(index+1).find(function(m){return m.bIsSend||!m.bIsIgnored&&m.bNeedResponse;});
   if(following&&following.bIsSend)return 'outgoing';
   return history[index].bNeedResponse===false?'response-confirmed':null;
  }
  async function reconcileReplies(member,decision,data,minute){
   var replies=decision.replyRequests||{}, payments=decision.payments||{};
   var wallet, checkedWallet=false;
   for(var key of Object.keys(replies)){
    var item=replies[key], payment=payments[key];
    if(item.phase==='requested'){
     var evidence=responseEvidence(messageHistory(data,item),item);
     if(evidence){
      item.phase=evidence;item.confirmedAt=minute;
      if(decision.replyPending)delete decision.replyPending[item.thread];
      log(member.first_name+': '+item.sender+(evidence==='outgoing'?' 답장 발송 확인 / ':' 응답 상태 반영 / ')+item.choice);
     }
    }
    if(payment&&!payment.ledgerEntry&&minute>=(payment.nextCheck||0)){
     payment.nextCheck=minute+30;
     if(!checkedWallet){
      try{wallet=await reflect(member.household_id,'Currency');}catch(_){}
      checkedWallet=true;
     }
     if(wallet){
      payment.balanceAfter=wallet.currencyMap&&wallet.currencyMap.mew;
      payment.matchingBalanceChange=Number.isFinite(payment.balanceAfter)&&payment.balanceBefore-payment.balanceAfter===payment.amount;
      payment.ledgerEntry=L.matchingDebit(wallet,payment.checkpoint,member.entity_id,payment.amount,payment.ledgerReason);
      if(payment.ledgerEntry)log(member.first_name+': 납부 거래 원장 일치 / '+payment.amount+'미유');
     }
     payment.responseConfirmed=item.phase!=='requested';
     payment.phase=payment.ledgerEntry?'ledger-matched':payment.responseConfirmed?'response-confirmed':'unconfirmed';
    }
   }
   // Keep unresolved requests and the newest confirmed ordinary replies.
   Object.keys(replies).filter(function(key){return !payments[key]&&replies[key].phase!=='requested';})
    .sort(function(a,b){return replies[b].confirmedAt-replies[a].confirmedAt;}).slice(32)
    .forEach(function(key){delete replies[key];});
  }
  async function sender(thread){
   if(thread.system){
    var parts=thread.key.split(';'), definitions=(await row('MobileMessageSystem',parts[0])).systems||[];
    var localized=definitions.find(function(s){return s.mapId===parts[1];})||definitions.find(function(s){return s.mapId==='Default';});
    var key=localized&&localized.displayNameTextId;
    return C.clean((await l10n([key]))[key]);
   }
   var id=thread.key.match(/^\(Value=(\d+)\)$/);
   if(!id)return '';
   try{
    var person=await cli('entity.get_character_info',{entity_id:id[1]});
    return C.clean(person.display_name||person.name||((person.last_name||'')+' '+(person.first_name||'')));
   }catch(_){return '';}
  }
  async function restorePhoneActor(token){
   if(!api.active(token))return;
   if(phonePanel&&!await finishPhone(token))return;
   if(!phoneReturn||background())return;
   var active=await cli('entity.get_possessed'), selected=String(active.entity_id);
   if(selected!==phoneReturn.actor){phoneReturn=null;return;}
   var from=phoneReturn.actor, to=phoneReturn.origin;
   await write('character.possess',{character_id:to},token,null,from);
   await wait();
   var verified=await cli('entity.get_possessed');
   if(String(verified.entity_id)!==from){phoneReturn=null;return true;}
  }
  async function finishPhone(token){
   if(!phonePanel)return true;
   var p=phonePanel, open=await tree('Smartphone');
   if(open.window!==p.window){phonePanel=null;return true;}
   var fresh=await cli('game.get_state');
   if(fresh.possessed_entity_id!=null&&String(fresh.possessed_entity_id)!==p.actor){
    phonePanel=null;return false;
   }
   if(fresh.blocking&&fresh.blocking.popup_count)return false;
   var endings=['/WBP_Mobile_Message_Popup/BW_Button_Close','/WBP_Mobile_Message/BW_Button_Close','/WBP_Common_CloseButton/BW_Button'];
   for(var i=0;i<endings.length;i++){
    if(!await click(button(nodes(open),endings[i]),token,p.actor))continue;
    await wait(350);
    open=await tree('Smartphone');
    if(open.window!==p.window){phonePanel=null;return true;}
   }
   return false;
  }
  async function inviteDecision(id,message,reply,snapshot,minute,expired){
   var scheduled=!!(reply.bIsCreateScheduleOnReply||message.customResponse&&message.customResponse.bHasOverrideSchedule);
   var work=snapshot.work, active=false, hours=null;
   var appointment=message.sendResponse&&message.sendResponse.appointmentData||{};
   var start=appointment.startTime>0?C.clockMinute(appointment.startTime):null;
   var end=appointment.endTime>0?C.clockMinute(appointment.endTime):null;
   if(!expired){
    try{
     work=await cli('career.get_work_status',{entity_id:id});
     var schedule=await cli('schedule.diagnose',{entity_id:id});
     active=schedule.has_schedule===true;
     if(scheduled&&work.is_working_day){
      var timeline=await reflect(id,'Timeline'), params=timeline.careerTimelineParams||{};
      var slots=Object.keys(params).map(function(k){return params[k];}).filter(function(s){return s&&s.workHour;});
      if(slots.length===1)hours=slots[0].workHour;
     }
    }catch(_){return {choice:'decline',reason:'현재 일정을 확인할 수 없음'};}
   }
   return C.invitation({expired:expired,urgent:!!L.urgentNeed(snapshot.stats.stats),onDuty:work.is_working_time||work.is_commute_time||work.is_at_work,
    activeSchedule:active,workingDay:work.is_working_day,createsSchedule:scheduled,workHour:hours,now:minute%1440,
    appointmentStart:start,appointmentEnd:end});
  }
  function expiredReply(message,minute){
   if(message.positiveAnswerDeadlineTicks>0)return minute*600000000>=message.positiveAnswerDeadlineTicks;
   if(!(message.responseTimeout>0)||!message.bSetResponseTimer)return false;
   var t=String(message.timestamp||'').match(/^(\d{4})\.(\d\d)\.(\d\d)-(\d\d)\.(\d\d)\.(\d\d)$/);
   if(!t)return false;
   var sent=Date.parse(t[1]+'-'+t[2]+'-'+t[3]+'T'+t[4]+':'+t[5]+':'+t[6]+'Z');
   var elapsed=(sent-Date.parse('0001-01-01T00:00:00Z'))/60000;
   return Number.isFinite(elapsed)&&minute>=elapsed+message.responseTimeout;
  }
  async function phone(member,decision,snapshot,minute,token){
   var id=String(member.entity_id), origin=String(game().possessed_entity_id);
   var canReply=!phonePanel&&(!background()||id===origin)&&!phoneReturn&&
    !L.sleeping(snapshot.queue,snapshot.work)&&!snapshot.work.is_at_work&&!snapshot.work.is_working_time&&!snapshot.work.is_commute_time;
   if(minute<(canReply?decision.nextPhoneAction||0:decision.nextPhone||0))return;
   decision.nextPhone=minute+60;
   decision.nextPhoneAction=minute+10;
   var mobile=await reflect(id,'MobileMessage');
   await reconcileReplies(member,decision,mobile,minute);
   var threads=mail(mobile);
   updatePhone(decision,threads);
   if(!canReply)return;
   if(!threads.length){decision.nextPhoneAction=minute+20;return;}
   var attempts=decision.phoneAttempts||(decision.phoneAttempts={});
   threads=threads.filter(function(t){
    return (t.unread||!(decision.replyRequests&&decision.replyRequests[C.messageKey(t)]))&&
     !(attempts[t.key]&&attempts[t.key].stamp===t.last.timestamp&&attempts[t.key].until>minute);
   });
   if(!threads.length||!await freeHud())return;
   var opened=false, phoneTree, switched=false;
   try{
    if(id!==origin){
     var family=await cli('household.get_members');
     if(String(family.household_id)!==String(member.household_id)||!family.members.some(function(m){return String(m.entity_id)===id;}))return;
     await write('character.possess',{character_id:id},token,null,origin);
     await wait();
     var active=await cli('entity.get_possessed');
     if(String(active.entity_id)!==id)return;
     switched=true;
     phoneReturn={origin:origin,actor:id};
    }
    var hud=await tree('Hud');
    opened=await click(button(nodes(hud),'/WBP_PlayerInfo/BW_Button_SmartPhone'),token,id);
    if(!opened)return;
    await wait();phoneTree=await tree('Smartphone');
    if(phoneTree.window)phonePanel={window:phoneTree.window,actor:id};
    if(!await click(button(nodes(phoneTree),'/WBP_Mobile_AppIcon_Message/BW_Button'),token,id))return;
    await wait();
    var inspected=0, processed=false;
    for(var i=0;i<threads.length&&inspected<4;i++){
     var item=threads[i], name=await sender(item);
     attempts[item.key]={stamp:item.last.timestamp,until:minute+90};
     if(!name)continue;
     var candidate;
     for(var page=0;page<5;page++){
      var current=nodes(await tree('Smartphone'));
      var view=current.find(function(n){return n.role==='list'&&n.ref&&n.ref.endsWith('/WBP_Mobile_Message/TileView_list');});
      if(!view)break;
      var matches=(view.children||[]).filter(function(n){return n.role==='entry'&&label(n,name);});
      if(matches.length===1){candidate=button(nodes({nodes:matches[0].children}),'/BW_Button');break;}
      if(page===0&&view.list&&Array.isArray(view.list.shown)&&view.list.shown[0]>0){
       await scroll(view,{To:'index',Index:0},token,id);continue;
      }
      if(!view.list||!Array.isArray(view.list.shown)||view.scroll&&view.scroll.at_end)break;
      var index=view.list.shown[1]+1;
      if(index>=view.list.total)break;
      await scroll(view,{To:'index',Index:index},token,id);
     }
     if(!candidate)continue;
     await click(candidate,token,id);
     inspected++;
     await wait();
     try{
      var thread=nodes(await tree('Smartphone'));
      if(!thread.some(function(n){return n.role==='text'&&label(n,name);}))continue;
      var message=item.last, custom=message.customResponse||{}, dtId=custom.dtId;
      if((!dtId||dtId==='None')&&item.custom&&item.custom.dtId!=='None')dtId=item.custom.dtId;
      var reply=item.needsReply&&dtId&&dtId!=='None'?await row('CustomMobileMessage',dtId):{};
      var choices=thread.filter(function(n){return C.usable(n)&&/\/WBP_Mobile_Message_Popup\/BW_Choice_Slot\d+\/Button$/.test(n.ref);});
      var best=null, timing=null, sent=false, key=C.messageKey(item);
      var replyRequests=decision.replyRequests||(decision.replyRequests={});
      if(item.needsReply&&choices.length&&!replyRequests[key]&&message.timestamp&&message.messageId){
       var currentTime=await cli('environment.get_time'), now=currentTime.day*1440+currentTime.hour*60+currentTime.minute;
       if(!Number.isFinite(now))now=minute;
       var info=[dtId,message.messageId,message.messageText].join(' ');
       var invite=reply.bIsCreateScheduleOnReply||custom.bHasOverrideSchedule||
        /Invite|Festival|Party|Dinner|Gathering|GymGroup|Meetup|Appointment|초대|참여/i.test(info);
       timing=invite?await inviteDecision(id,message,reply,snapshot,now,expiredReply(message,now)):null;
       var data=reply.messageData||{};
       var actions=['positive','normal','negative'].map(function(kind){
        var answers=[data[kind+'AnswerStrId'],custom[kind+'AnswerStrId']].filter(Boolean);
        return {kind:kind,keys:[reply[kind+'AnswerButtonStrId']].concat(answers).filter(Boolean),
         scripts:reply[kind+'AnswerScriptIds']||[],answers:answers};
       });
       var terms=await l10n(actions.reduce(function(all,a){return all.concat(a.keys);},[]));
       best=C.responseButton(choices,terms,actions,{timing:timing,financial:/Utility|Tax|Loan|Interest|Overdue|Insurance|공과금|이자|연체|대출/i.test(info),
        spam:/Spam|Marketing|Advertising/i.test(info)});
      }
      if(best&&best.payment){
       var wallet=await reflect(member.household_id,'Currency'), amount=C.paymentAmount(thread,best.paymentKind);
       var balance=wallet.currencyMap&&wallet.currencyMap.mew;
       var payments=decision.payments||(decision.payments={});
       var prior=Object.values(payments).some(function(p){
        return p.kind===best.paymentKind&&p.amount===amount&&
         (!p.responseConfirmed&&!p.ledgerEntry||Math.floor(p.minute/1440)===Math.floor(minute/1440));
       });
       if(payments[key]||prior||!(amount>0)||!Number.isFinite(balance)||balance<amount)best=null;
       else{
        payments[key]={thread:item.key,messageId:message.messageId,timestamp:message.timestamp,
         amount:amount,kind:best.paymentKind,balanceBefore:balance,checkpoint:L.ledgerCheckpoint(wallet),ledgerReason:best.ledgerReason,
         phase:'requested',minute:minute};
       }
      }
      if(best){
       replyRequests[key]={thread:item.key,system:item.system,messageId:message.messageId,timestamp:message.timestamp,
        phase:'requested',sender:name,choice:C.clean(best.button.text),minute:minute};
       sent=await click(best.button,token,id);
       if(sent)await wait(350);
       else{
        delete replyRequests[key];
        if(best.payment)delete decision.payments[key];
       }
      }
      var refreshed=await reflect(id,'MobileMessage');
      var remaining=mail(refreshed), after=remaining.find(function(t){return t.key===item.key;});
      await reconcileReplies(member,decision,refreshed,minute);
      updatePhone(decision,remaining);
      var read=item.unread-(after&&after.unread||0);
      if(read>0){processed=true;log(member.first_name+': '+name+' 메시지 '+read+'건 읽음 확인');}
      if(sent&&replyRequests[key]&&replyRequests[key].phase!=='requested'){
       processed=true;
      }else if(item.needsReply){
       var pending=decision.replyPending||(decision.replyPending={});
       var priorPayment=decision.payments&&decision.payments[key];
       var reason=priorPayment?'납부 요청 결과 확인 대기 · 중복 요청 보류':
        replyRequests[key]?'발송 기록 확인 대기 · 중복 응답 보류':choices.length?'선택 가능한 답장 확인 대기':'답장 버튼이 아직 없음';
       attempts[item.key].until=minute+20;
       if(pending[item.key]!==reason){pending[item.key]=reason;log(member.first_name+': '+name+' / '+reason);}
      }
     }finally{
      var block=(await cli('game.get_state')).blocking||{};
      if(!block.popup_count)await closePhone('/WBP_Mobile_Message_Popup/BW_Button_Close',token,id,false);
     }
     if(((await cli('game.get_state')).blocking||{}).popup_count)break;
    }
    return processed;
   }finally{
    if(switched)await restorePhoneActor(token);
    else if(opened)await finishPhone(token);
   }
  }
  async function market(member,decision,snapshot,minute,token,need){
   if(!need)return false;
   // 0.4.7: home services are ordered in 다른 작업 모드 too, with internal (Force) clicks that never move the mouse.
   // Before, cleaning waited forever there even past the 8-dust limit (seen in game: 19-21 dust, no order).
   if(!await freeHud()){
    decision.marketStatus=(need.kind==='clean'?'먼지 '+need.dust+'곳 · 청소 도우미':need.kind==='repair'?'수리 기사':'음식')+' 주문 대기 · 다른 창이 열려 있음';
    return false;
   }
   var id=String(member.entity_id), household=String(member.household_id), key=household+':'+need.kind;
   var history=api.state?(api.state.marketOrders||(api.state.marketOrders={})):orders;
   if(history[key]>minute){decision.marketStatus='최근 같은 종류 주문 확인';return false;}
   decision.nextMarket=minute+90;
   var opened=false, app=false;
   try{
    var hud=nodes(await tree('Hud'));
    opened=await click(button(hud,'/WBP_PlayerInfo/BW_Button_SmartPhone'),token,id);
    if(!opened)return false;
    await wait();
    app=await click(button(nodes(await tree('Smartphone')),'/BW_WBP_PocketMarket/BW_Button'),token,id);
    if(!app)return false;
    await wait();
    var service=need.kind!=='food', list=nodes(await tree('Smartphone'));
    if(service){
     if(!await click(button(list,'/BW_WBP_Button_HomeService/BW_Button_Tab'),token,id))return false;
     await wait();
     list=nodes(await tree('Smartphone'));
     var category=need.kind==='repair'?/^(?:수리 기사|Repair(?:man| Service)?)$/i:/^(?:청소 도우미|Clean(?:er|ing Service)?)$/i;
     var entry=list.find(function(n){return n.role==='entry'&&n.ref&&/\/BW_ListView_Category\//.test(n.ref)&&category.test(C.clean(n.text));});
     if(!await click(entry,token,id,background()?true:false))return false;
     if(background())await wait(350);
     list=nodes(await tree('Smartphone'));
     if(!list.some(function(n){return n.role==='entry'&&n.ref===entry.ref&&String(n.state||'').indexOf('selected')>=0;})){
      await wait(250);
      list=nodes(await tree('Smartphone'));
      if(!list.some(function(n){return n.role==='entry'&&n.ref===entry.ref&&String(n.state||'').indexOf('selected')>=0;})){
       decision.marketStatus='홈서비스 종류 선택 확인 대기';
       return false;
      }
     }
    }
    var view=list.find(function(n){return n.role==='list'&&n.ref&&n.ref.endsWith('/BW_TileView_Shopping');});
    var catalog=(view&&view.children||[]).map(function(n){
     var children=C.widgets(n.children);
     var words=children.filter(function(x){return x.role==='text';}).map(function(x){return C.clean(x.text);});
     var price=words.find(function(x){return /^\d[\d,]*$/.test(x);});
     var title=words.find(function(x){return service?/서비스|service/i.test(x):/만두|구이|수프|샌드위치|Dumpling|Soup|Sandwich|Grilled/i.test(x);});
     var buy=button(children,'/BW_Button_Buy');
     return {price:price?Number(price.replace(/,/g,'')):NaN,title:title,buy:buy};
    }).filter(function(o){return o.title&&o.buy&&o.price>0&&o.price<=need.limit;}).sort(function(a,b){return a.price-b.price;});
    var item=catalog[0];
    if(!item){decision.marketStatus='구매 가능한 상품 대기';return false;}
    var wallet=await reflect(household,'Currency'), balance=wallet.currencyMap&&wallet.currencyMap.mew;
    if(!Number.isFinite(balance)||balance-need.reserve<item.price){decision.marketStatus='생활비 여유 확인 대기';return false;}
    if(need.kind==='clean'){
     var dust=await cli('build.scan_objects',{table_id_prefix:'DEV_DustDecal',Limit:0});
     if(!Number.isFinite(dust.total)||dust.total<=8){decision.marketStatus='먼지 재확인 · 주문 기준 이하';return false;}
    }
    history[key]=minute+(service?1440:180);
    await click(item.buy,token,id);
    await wait();
    var after=await reflect(household,'Currency'), remaining=after.currencyMap&&after.currencyMap.mew;
    decision.marketStatus=(balance-remaining===item.price?'주문·결제 확인':'주문 결과 확인 대기')+' · '+item.title+' '+item.price;
    log(member.first_name+': 포켓마켓 '+decision.marketStatus);
    return true;
   }finally{
    if(app)await closePhone('/WBP_Mobile_PocketMarket/BW_Button_Close',token,id,true);
    if(opened)await closePhone('/WBP_Common_CloseButton/BW_Button',token,id,false);
   }
  }
  async function catShop(member,decision,snapshot,minute,token){
   // 0.4.7: emergency only. A donut is used when a need stays critical (normal fix failed, or 45 game
   // minutes without recovery), at most once per need and twice in total per game day.
   var actor=String(member.entity_id), stats=snapshot.stats.stats, day=Math.floor(minute/1440);
   if(String(game().possessed_entity_id)!==actor||L.sleeping(snapshot.queue,snapshot.work)||minute<(decision.nextCatShop||0))return false;
   var uses=decision.catUses&&decision.catUses.day===day?decision.catUses:(decision.catUses={day:day,count:0,needs:{}});
   if(uses.count>=2)return false;
   var low=decision.catLow||(decision.catLow={}), fallback=null;
   ['Toilet','Hunger','Sleep','Cleanliness'].forEach(function(key){
    if(!C.catDonut(key,stats[key])){delete low[key];return;}
    if(low[key]==null||low[key]>minute)low[key]=minute;
    var stuck=decision.needFallback&&decision.needFallback.key===key&&minute<=decision.needFallback.until;
    if(!fallback&&!uses.needs[key]&&(stuck||minute-low[key]>=45))fallback={key:key};
   });
   if(!fallback||!await freeHud())return false;
   var itemId=C.catDonut(fallback.key,stats[fallback.key]);
   if(!itemId)return false;
   decision.nextCatShop=minute+60;
   var item=await row('CatShop',itemId);
   if(!(item.price>0)||item.price>80)return false;
   var words=await l10n([item.nameTextId,item.effectTextId]), title=C.clean(words[item.nameTextId]);
   var effect=C.clean(words[item.effectTextId]);
   if(!title||!/완전히 충족|fully satisfied|fully replenished|completely fulfilled/i.test(effect))return false;
   var profile=profileButton(nodes(await tree('Hud'))), panel, opened=false;
   if(!profile)return false;
   function balance(t){
    var n=t.nodes||[];
    return n.length>1&&/^(?:냥스토어|Meow Store|Cat Shop)$/i.test(C.clean(n[0].text))&&/^\d[\d,]*$/.test(C.clean(n[1].text))?
     Number(C.clean(n[1].text).replace(/,/g,'')):NaN;
   }
   try{
    await click(profile,token,actor);await wait();
    panel=await tree('CatOperator');
    if(panel.ui_type!=='CatOperator')return false;
    opened=await click(button(nodes(panel),'/WBP_CatShop_Button/BW_Button'),token,actor);
    if(!opened)return false;
    await wait();panel=await tree('CatOperator');
    var oldBalance=balance(panel);
    if(!Number.isFinite(oldBalance)||oldBalance-item.price<Math.max(5,Math.floor(oldBalance*0.10)))return false;
    var view=nodes(panel).find(function(n){return n.role==='scroll'&&n.ref&&n.ref.endsWith('/BW_WBP_CatShop/BW_ScrollBox');});
    if(!view)return false;
    if(view.scroll&&!view.scroll.at_start){await scroll(view,{To:'start'},token,actor);panel=await tree('CatOperator');}
    var products=nodes(panel).filter(function(n){
     return C.usable(n)&&/\/BW_WBP_CatShop\/ProductList\/WBP_CatShop_Entry_C_\d+\/Button_Click$/.test(n.ref)&&label(n,title);
    });
    if(products.length!==1)return false;
    var fresh=await cli('stat.get_all',{entity_id:actor});
    var before=fresh.stats&&fresh.stats[fallback.key];
    if(C.catDonut(fallback.key,before)!==itemId||balance(panel)!==oldBalance)return false;
    await click(products[0],token,actor);await wait(400);
    // 0.4.7: the product opens a purchase confirmation (CatShopBuy). In game it stayed open, the mod's
    // general popup handler then pressed 취소. Confirm it here with the positive button (btn0).
    var confirm=await cli('ui.get_blocking');
    var buy=(confirm.popups||[]).find(function(p){return p.popup_id==='CatShopBuy';});
    if(buy){
     var yes=(buy.buttons||[]).find(function(b){return b.list_key==='btn0'&&b.dimmed===false;});
     if(!yes){log(member.first_name+': 냥스토어 구매 확인 버튼을 찾지 못함');return false;}
     await write('ui.click_popup_button',{popup_id:'CatShopBuy',list_key:'btn0'},token,'CatShopBuy',actor);
     await wait(900);
    }
    var after=await cli('stat.get_all',{entity_id:actor}), newBalance=balance(await tree('CatOperator'));
    var stat=after.stats&&after.stats[fallback.key];
    if(stat&&stat.pct>=before.pct+30&&oldBalance-newBalance===item.price){
     decision.needFallback=null;decision.nextCatShop=minute+240;
     uses.count++;uses.needs[fallback.key]=true;delete low[fallback.key];
     log(member.first_name+': 냥스토어 긴급 사용 확인 / '+title+' ('+item.price+'냥코인, 오늘 '+uses.count+'/2)');
     return true;
    }
    if(oldBalance-newBalance===item.price){
     decision.nextCatShop=minute+240;uses.count++;uses.needs[fallback.key]=true;
     log(member.first_name+': 냥스토어 결제 확인, 효과 적용 확인 대기 / '+title);
     return true;
    }
    log(member.first_name+': 냥스토어 구매 결과 미확인 / '+title);
    return false;
   }finally{
    if(opened)await click(button(nodes(await tree('CatOperator')),'/BW_WBP_CatShop/BW_Button_Close'),token,actor);
    if(panel&&panel.ui_type==='CatOperator')await click(nodes(await tree('CatOperator')).find(function(n){
     return C.usable(n)&&n.ref===panel.window+'/BW_Button_Close';
    }),token,actor);
   }
  }
  async function choiceCard(actor,snapshot,token){
   var card=await tree('ChoiceCardPopup'), all=nodes(card);
   if(card.ui_type!=='ChoiceCardPopup')return '';
   var buttons=all.filter(function(n){
    return C.usable(n)&&n.text&&n.ref.indexOf(card.window+'/')===0&&!C.widgets(n.children).some(C.usable)&&
     !/^(?:확인|닫기|취소|OK|Close|Cancel)$/i.test(C.clean(n.text));
   });
   if(buttons.length!==2)return '';
   if(!callTitles){
    var catalogue=await table('MobileCall');
    var ids=Array.from(new Set(catalogue.map(function(c){return c.choiceCardId;}).filter(function(id){return id&&id!=='None';})));
    var titles=Object.create(null);
    for(var c=0;c<ids.length;c+=55){
     var batch=ids.slice(c,c+55);
     var names=await l10n(batch.map(function(id){return 'ChoiceCard_'+id+'_TitleStrId';}));
     batch.forEach(function(id){
      var title=C.clean(names['ChoiceCard_'+id+'_TitleStrId']);
      if(title)(titles[title]||(titles[title]=[])).push(id);
     });
    }
    callTitles=titles;
   }
   var phoneIds=all.filter(function(n){return n.role==='text';}).reduce(function(a,n){
    return a.concat(callTitles[C.clean(n.text)]||[]);
   },[]);
   phoneIds=Array.from(new Set(phoneIds));
   var candidates=phoneIds;
   if(!candidates.length){
    var hole=await reflect(actor,'RabbitHole'), id=hole.currentRabbitHoleId;
    var native=id&&id!=='None'?await row('RabbitHole',id):{};
    for(var i=0;i<(native.choiceCardList||[]).length&&candidates.length<12;i++){
     var group=await row('ChoiceCardGroup',native.choiceCardList[i].iD);
     candidates=candidates.concat((group.choiceCards||[]).map(function(r){return r.choiceCardId;}));
    }
   }
   var options=await Promise.all(Array.from(new Set(candidates.slice(0,12))).map(function(id){return row('ChoiceCard',id);}));
   var words=await l10n(options.reduce(function(a,o){return a.concat(o.positiveAnswerStrId,o.negativeTitleStrId);},[]));
   var texts=buttons.map(function(b){return C.clean(b.text);});
   var matching=options.filter(function(o){
    return texts.indexOf(C.clean(words[o.positiveAnswerStrId]))>=0&&texts.indexOf(C.clean(words[o.negativeTitleStrId]))>=0;
   });
   var nativeCard=matching.length===1?matching[0]:null;
   var trait=snapshot?P.traits(snapshot.trait):[];
   var busy=snapshot&&!!(L.urgentNeed(snapshot.stats.stats)||snapshot.work.is_at_work||snapshot.work.is_working_time||
    snapshot.work.is_commute_time||L.sleeping(snapshot.queue,snapshot.work));
   var ranked=buttons.map(function(n,index){
    var text=texts[index], positive=nativeCard&&text===C.clean(words[nativeCard.positiveAnswerStrId]);
    var outcomes=nativeCard&&(positive?
     nativeCard.positiveChoiceCardAnswers:nativeCard.negativeChoiceCardAnswers);
    return {button:n,score:nativeCard&&nativeCard.choiceCardType==='MobileCall'?
     C.phoneCardScore(text,outcomes,trait,busy,positive):C.cardScore(text,outcomes,trait)};
   }).sort(function(a,b){return b.score-a.score;});
   if(ranked[0].score-ranked[1].score<1||!nativeCard&&ranked[0].score<=0)return '';
   var chosen=ranked[0].button;
   var fresh=await tree('ChoiceCardPopup');
   if(!nodes(fresh).some(function(n){return C.usable(n)&&n.ref===chosen.ref&&n.text===chosen.text;}))return '';
   await write('ui.click',{ref:chosen.ref,Force:true},token,'Choice_Card',String(actor));
   return C.clean(chosen.text);
  }
  async function answerCall(actor,token){
   var alert=await tree('MobileCallAlert');
   if(alert.ui_type!=='MobileCallAlert'){lastCall=null;return false;}
   var buttons=nodes(alert).filter(function(n){
    return C.usable(n)&&n.ref.indexOf(alert.window+'/')===0&&!C.widgets(n.children).some(C.usable);
   });
   var accept=buttons.filter(function(n){
    return /^(?:전화 받기|받기|수신|응답|Answer(?: call)?|Pick up)$/i.test(C.clean(n.text))||
     /\/(?:BW_)?Button_(?:Accept|Receive|Answer|Pickup|AcceptCall|ReceiveCall)(?:\/BW_Button)?$/i.test(n.ref);
   });
   if(accept.length!==1)return false;
   var id=String(actor), key=alert.window+':'+(alert.label||'')+':'+accept[0].ref;
   if(lastCall&&lastCall.key===key&&Date.now()-lastCall.at<4000)return false;
   var queue=await cli('interaction.get_queue',{entity_id:id}), work=await cli('career.get_work_status',{entity_id:id});
   if(L.sleeping(queue,work)||work.is_at_work)return false;
   var stats=await cli('stat.get_all',{entity_id:id});
   var urgent=L.urgentNeed(stats.stats||{});
   if(urgent&&urgent.pct<10)return false;
   var fresh=await tree('MobileCallAlert');
   if(fresh.window!==alert.window||!nodes(fresh).some(function(n){return C.usable(n)&&n.ref===accept[0].ref;}))return false;
   lastCall={key:key,at:Date.now()};
   await write('ui.click',{ref:accept[0].ref,Force:true},token,':call',id);
   var after=await tree('MobileCallAlert');
   log(after.window===alert.window?'전화 수신 요청 · 게임 응답 대기':'전화 수신 확인');
   return true;
  }
  async function relationshipChoice(actor,token){
   if(Date.now()<choiceAt)return;
   choiceAt=Date.now()+4000;
   var id=String(actor), talk=await reflect(id,'Talk'), instance=talk.talkInstanceId&&talk.talkInstanceId.value;
   if(!(instance>0))return;
   var q=await cli('interaction.get_queue',{entity_id:id}), target=q.current&&String(q.current.target_entity_id);
   if(!(Number(target)>0)||target===id)return;
   var other=await reflect(target,'Talk');
   if(!other.talkInstanceId||other.talkInstanceId.value!==instance)return;
   var treeNow=await tree('top'), choices=nodes(treeNow).filter(function(n){
    return C.usable(n)&&/TalkSelection|RelationshipFocus|TalkChoice/i.test(n.ref)&&n.text&&
     !C.widgets(n.children).some(C.usable);
   });
   if(!choices.length)return;
   var a=await cli('relationships.get_value_between',{owner_id:id,target_id:target});
   var b=await cli('relationships.get_value_between',{owner_id:target,target_id:id});
   var pair=[a.stats||{},b.stats||{}], friendship=pair.every(function(s){return s.Friendship&&s.Friendship.value>=60;});
   var romance=pair.every(function(s){return s.Romance&&s.Romance.value>=65&&(!s.Family||s.Family.value<=0);});
   var ranked=choices.map(function(n){
    var title=C.clean(n.text);
    var score=romance&&/^(?:연인 되기|사귀기|고백 받아들이기|Accept confession|Become partners)$/i.test(title)?12:
     friendship&&/^(?:친구 되기|절친 되기|친구로 지내기|Become (?:best )?friends)$/i.test(title)?10:
     /^(?:다정하게 답하기|친절하게 답하기|긍정적으로 답하기|Respond kindly|Respond positively)$/i.test(title)?5:0;
    return {button:n,score:score};
   }).sort(function(x,y){return y.score-x.score;});
   if(!ranked[0].score||ranked[1]&&ranked[0].score===ranked[1].score)return;
   var chosen=ranked[0].button;
   await write('ui.click',{ref:chosen.ref,Force:background(),hold_ticks:2},token,':talk',id);
   log('관계 선택 대화 응답 요청 / '+C.clean(chosen.text));
  }
  function reset(){news=null;nextNews=0;orders={};choiceAt=0;phoneReturn=null;phonePanel=null;lastCall=null;}
  return {reset:reset,preference:preference,phone:phone,restorePhoneActor:restorePhoneActor,market:market,catShop:catShop,choiceCard:choiceCard,answerCall:answerCall,relationshipChoice:relationshipChoice,
   readNews:readNews,latestNews:function(){return news;}};
 }
 root.ObserverPanels={create:create};
})(this);
