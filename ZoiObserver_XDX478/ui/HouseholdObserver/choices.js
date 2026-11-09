(function (root) {
 'use strict';
 var protectedChange=/delete|overwrite|reset|quitgame|exitgame|loadgame|newgame|keybinding|graphics|cashshop|real.money|savegame|삭제|덮어쓰|초기화|게임 종료|새 게임|저장 파일|불러오기|현금 결제/i;
 var commitment=/purchase|loan|mortgage|investment|contract|divorce|movehouse|quitjob|resign|adopt|구매|대출|투자|계약|이혼|이사|퇴사|입양|구독/i;
 var refusal=/^(?:취소|아니오|아니요|거절|나중에|다음에 할래요|괜찮아요|유지하기|기존 일정 유지(?:하기)?|돌아가기|Cancel|No|Decline|Later|Back|Keep(?: existing schedule)?)[.!]?$/i;
 var notice=/^(?:확인|닫기|알겠습니다|알겠어요|OK|Close|Got it)$/i;
 var useful=/(?:help|assist|apolog|honest|truth|report|resolve|work hard|repair|study|research|prepare|encourage|listen|cooperat|safe|도와|돕기|사과|솔직|정직|사실대로|신고|해결|성실|수리|공부|조사|준비|격려|경청|협력|안전)/i;
 var harmful=/cheat|steal|scam|gambl|attack|insult|threat|ignore|hide evidence|lie\b|속이|거짓말|훔치|도박|사기|공격|모욕|위협|무시|증거를 숨/i;
 function clean(s){return String(s||'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();}
 function widgets(nodes){
  return (nodes||[]).reduce(function(all,n){return all.concat(n,widgets(n.children));},[]);
 }
 function usable(n){return n&&n.role==='button'&&n.ref&&!/disabled|dimmed|unreachable/i.test(String(n.state||''));}
 function popup(p,row,context){
  var definitions=row&&row.buttonDetail||[];
  var text=clean(p.title)+' '+clean(p.desc), id=p.popup_id||'';
  var available=(p.buttons||[]).filter(function(b){
   return b.dimmed===false&&(b.list_key&&b.list_key!=='None'||p.buttons.length===1&&Number.isInteger(b.index));
  });
  var ranked=available.map(function(b){
   var title=clean(b.text), def=definitions.find(function(d){return d.listKey===b.list_key;});
   var script=def&&def.scriptId!=='None'?def.scriptId||'':'';
   var kind=title+' '+script;
   if(refusal.test(title))return {button:b,score:protectedChange.test(id+' '+text)||commitment.test(id+' '+text)||context.busy?30:2,why:'기존 상태 유지'};
   if(protectedChange.test(id+' '+text+' '+kind)||harmful.test(kind))return null;
   if(p.buttons.length===1&&/^(?:확인|OK)$/i.test(title)&&
      !commitment.test(script)&&!/(?:예약|출발|이민|book|immigration)/i.test(id+' '+text)&&
      !(commitment.test(id+' '+text)&&/하시겠|정말|would you like|are you sure/i.test(text))){
    return {button:b,score:20,why:'유일한 확인 버튼'};
   }
   if(commitment.test(id+' '+text+' '+kind))return null;
   if(available.length===1&&notice.test(title)&&def&&!script&&
      !/confirm|warning|question|확정|정말|진행하시겠|동의/i.test(id+' '+text)){
    return {button:b,score:12,why:'선택 효과가 없는 안내 확인'};
   }
   if(!context.busy&&useful.test(kind)&&!/(?:[$₩]|§|[0-9]\s*미유|비용|요금|fee|cost)/i.test(text)){
    return {button:b,score:10,why:'상황을 직접 해결하는 선택'};
   }
   if(!context.busy&&/(?:^|_)(?:Invite|Invitation|FriendVisit|VisitFriend|JoinEvent|JoinParty)(?:$|_)|(?:초대|방문 요청|행사 참가)/i.test(id+' '+text)&&
      /^(?:수락|참여하기|참가하기|방문하기|Accept|Join|Attend)$/i.test(title)){
    return {button:b,score:9,why:'일정과 욕구에 여유가 있는 초대 수락'};
   }
   return null;
  }).filter(Boolean).sort(function(a,b){return b.score-a.score;});
  return ranked.length&&(!ranked[1]||ranked[0].score>ranked[1].score)?ranked[0]:null;
 }
 function cardScore(text,outcomes,traits){
  var score=0;
  if(protectedChange.test(text)||commitment.test(text)||harmful.test(text))score-=18;
  if(useful.test(text))score+=8;
  if(/^(?:취소|거절|무시|Decline|Ignore)$/i.test(text))score-=3;
  if(traits.indexOf('Helper')>=0&&/help|assist|도와|돕기/.test(text))score+=2;
  if(traits.indexOf('Intellect')>=0&&/research|logic|조사|분석/.test(text))score+=2;
  var total=0,utility=0;
  (outcomes||[]).forEach(function(o){
   if(!(o.ratio>0)||o.conditionId&&o.conditionId!=='None')return;
   var info=(o.finishScriptIds||[]).join(' ')+' '+o.colorId;
   var v=/Excited|Happy|Calm|Convinced|GG\b|_Success|AddJobExp/i.test(info)?1:
    /Irritated|Uneasy|Worried|Bored|GB\b|BB\b|_Fail|RemoveJobExp/i.test(info)?-1:0;
   total+=o.ratio;utility+=v*o.ratio;
  });
  return score+(total?6*utility/total:0);
 }
 function phoneCardScore(text,outcomes,traits,busy,positive){
  var score=cardScore(text,outcomes,traits);
  var scripts=(outcomes||[]).reduce(function(all,o){return all.concat(o.finishScriptIds||[]);},[]).join(' ');
  if(/Disburse|Purchase|NewLoan|SignContract|Delete|QuitJob/i.test(scripts))return -40;
  if(!busy&&/Call_Positive_Buff|Call_AddRelationShip_\w+_p\d/i.test(scripts))score+=6;
  if(!busy&&positive)score+=2;
  if(busy&&positive&&/Invite|Accept|Party|Meet|Visit|Dinner/i.test(scripts))score-=8;
  if(busy&&!positive&&/바빠|정신없|나중에|busy|later/i.test(text))score+=8;
  return score;
 }
 function preferencePlan(trait,skills,rows,rules,stored,actor,context){
  context=context||{};
  var existing=new Set(Object.keys(stored).map(function(k){return k.toLowerCase();}));
  var signs=Object.create(null);
  var caps=rules.filter(function(r){return trait.indexOf(r.iD.replace(/_Preference$/,''))>=0;});
  caps.forEach(function(rule){(rule.preferenceList||[]).forEach(function(p){
   if(!(p.selectRatio>0)||!Number.isFinite(p.likeRatio))return;
   signs[p.preferenceId]=(signs[p.preferenceId]||0)+4*p.selectRatio*(2*p.likeRatio-1);
  });});
  var matching={
   Drawing:['Art'],AppreciatingArt:['Art'],ArtBook:['Art','Logic'],Photographing:['Filming'],
   Cooking:['Cooking'],Running:['Fitness','Exercise'],Muscular:['Fitness','Exercise'],
   Boxing:['Fitness','Exercise'],BallGame:['Fitness','Exercise'],Swim:['Swimming'],
   Guitar:['Instruments'],Piano:['Instruments'],Drum:['Instruments'],Singing:['Performance'],Dancing:['Performance'],
   Gaming:['Gaming','Programming'],cleaning:['Housework'],Laundry:['Housework'],Repair:['Housework','Repair'],
   SelfDevelopment:['Logic','Research'],DocumentaryMovie:['Logic'],Plant:['Gardening','Farming']
  };
  var related=[
   [/Bookworm|Intellect/,/Novel|SelfDevelopment|ArtBook|HealthBook|DocumentaryMovie/],
   [/Extrovert|Entertainer|Popular/,/Dancing|Singing|BallGame|Photographing|ComicMovie/],
   [/Romantic|Flirt/,/RomanceMovie|Photographing|Novel|Cake/],
   [/Artist|Creative/,/Drawing|AppreciatingArt|Guitar|Piano|Drum|ArtBook/],
   [/Helper|Cooperator|Activist/,/Animal|Plant|Cooking|cleaning/],
   [/Achiever|Adventurer|Energetic/,/Running|Swim|Boxing|SelfDevelopment/],
   [/Clumsy|Riskaverse|Observer/,/Novel|Gaming|Bath|Yoga|DocumentaryMovie/],
   [/Perfectionist|Independent/,/SelfDevelopment|Repair|Laundry|Yoga/]
  ];
  var hopeText=(context.hopes||[]).join(' '), traits=trait.join(' ');
  var pool=rows.filter(function(r){
   return r.iD&&!existing.has(r.iD.toLowerCase())&&
    (!r.ageAvailable||!r.ageAvailable.length||r.ageAvailable.indexOf(context.age)>=0);
  })
   .map(function(r){
    var native=signs[r.iD]||0;
    var level=skills.reduce(function(best,s){return (matching[r.iD]||[]).indexOf(s.id)>=0?Math.max(best,s.level||0):best;},0);
    var evidence=Math.min(4,Math.max(0,level-1)*0.7);
    if(related.some(function(pair){return pair[0].test(traits)&&pair[1].test(r.iD);}))evidence+=2.2;
    if(r.iD.length>3&&hopeText.toLowerCase().indexOf(r.iD.toLowerCase())>=0)evidence+=2.5;
    if(/변호사|연구원|Lawyer|Researcher/i.test(context.job||'')&&/SelfDevelopment|DocumentaryMovie/.test(r.iD))evidence+=0.8;
    var score=native+evidence;
    var hash=String(actor)+':'+r.iD;
    return {id:r.iD,category:r.category,like:score>=0,tag:r.linkedInteractionTag,score:Math.abs(score),
     tie:hash.split('').reduce(function(n,c){return Math.imul(n^c.charCodeAt(0),16777619)>>>0;},2166136261)};
   });
  var used=Object.create(null), result=[];
  rows.forEach(function(r){
   if(r.iD&&existing.has(r.iD.toLowerCase()))used[r.category]=(used[r.category]||0)+1;
  });
  while(pool.length&&result.length<Math.max(0,10-existing.size)){
   pool.sort(function(a,b){
    return (b.score-(used[b.category]||0)*0.5)-(a.score-(used[a.category]||0)*0.5)||a.tie-b.tie;
   });
   var next=pool.shift();
   used[next.category]=(used[next.category]||0)+1;
   result.push(next);
  }
  return result;
 }
 function feedEntries(list){
  return (list&&list.children||[]).filter(function(n){return n.role==='entry'&&n.ref;}).map(function(n){
   var children=widgets(n.children);
   var labels=children.filter(function(c){return c.role==='text';}).map(function(c){return clean(c.text);});
   var action=children.find(function(c){return usable(c)&&/\/BW_Button_Action\/BW_Button$/.test(c.ref);});
   return {title:labels[1]||'',description:clean(n.text),age:labels[2]||'',action:action&&clean(action.text)};
  }).filter(function(item){return item.title||item.description;});
 }
 function events(entries,catalog,city,time){
  var now=time.hour*60+time.minute;
  function minute(hhmm){return Math.floor(hhmm/100)*60+hhmm%100;}
  return catalog.reduce(function(result,event){
   var place=(event.locations||[]).find(function(l){return l.cityId===city;});
   var headline=entries.find(function(x){return x.title===event.title;});
   if(!place||!headline||/어제|며칠|\d+일 전|\bdays? ago\b|yesterday/i.test(headline.age))return result;
   var start=minute(event.displayStartTime),end=minute(event.displayEndTime);
   if(Number.isFinite(start)&&Number.isFinite(end)&&now>=start&&now<end-20){
    result.push({id:event.iD,siteId:place.siteId,title:headline.title,end:time.day*1440+end,rules:event.calendarEventRuleIds});
   }
   return result;
  },[]).sort(function(a,b){return a.end-b.end;});
 }
 function catDonut(need,stat){
  var options={Sleep:{id:'CatDonut01',limit:8},Hunger:{id:'CatDonut02',limit:12},
   Toilet:{id:'CatDonut03',limit:10},Cleanliness:{id:'CatDonut05',limit:5}};
  var option=options[need];
  return option&&stat&&Number.isFinite(stat.pct)&&stat.pct<=option.limit?option.id:null;
 }
 function clockMinute(hhmm){
  return Number.isInteger(hhmm)&&hhmm>=0&&hhmm<=2359&&hhmm%100<60?
   Math.floor(hhmm/100)*60+hhmm%100:null;
 }
 function invitation(context){
  if(context.expired)return {choice:'decline',reason:'초대 응답 기한 지남'};
  if(context.urgent||context.onDuty||context.activeSchedule)return {choice:'decline',reason:'욕구 또는 진행 중 일정과 충돌'};
  if(context.createsSchedule&&context.workingDay){
   var start=clockMinute(context.workHour&&context.workHour.startTime);
   var end=clockMinute(context.workHour&&context.workHour.endTime);
   var from=context.appointmentStart, until=context.appointmentEnd;
   if(start!==null&&end!==null&&from!=null&&until!=null&&from<end&&start<until){
    return {choice:'decline',reason:'약속 시간과 근무 시간이 겹침'};
   }
   if(start===null||end===null||from==null&&context.now<end||from!=null&&until==null&&from<end){
    return {choice:'decline',reason:'근무일에 약속 시간을 확정할 수 없음'};
   }
  }
  return {choice:'accept',reason:'일정과 욕구에 여유 있음'};
 }
 function responseButton(options,words,actions,context){
  function find(action){
   var titles=action.keys.map(function(key){return clean(words[key]);}).filter(Boolean);
   var matches=options.filter(function(n){return titles.indexOf(clean(n.text))>=0;});
   return matches.length===1?matches[0]:null;
  }
  var safe=actions.map(function(a){
   return {kind:a.kind,button:find(a),scripts:(a.scripts||[]).join(' '),answers:a.answers};
  }).filter(function(a){return a.button;});
  var knownRefs=safe.map(function(a){return a.button.ref;});
  safe=safe.filter(function(a){return knownRefs.indexOf(a.button.ref)===knownRefs.lastIndexOf(a.button.ref);});
  function risky(s){return /purchase|buy|loan|borrow|disburse|debt|divorce|contract|delete|reset|quitjob|가입|구매|신청|계약|삭제/i.test(s);}
  function negative(text){
   return refusal.test(text)||/^(?:싫어(?:요)?|별로(?:예요|야)?|됐어(?:요)?|안 갈게(?:요)?|이번엔 (?:어려워요|못 가요)|참여하지 않을게요|관심 없어요|No thanks|Not interested|I can.t(?: make it)?)[.!… ]*$/i.test(text);
  }
  var declined=safe.find(function(a){
   return a.kind==='negative'&&!risky(a.scripts)&&(!context.financial||negative(clean(a.button.text)));
  });
  var refusalButtons=options.filter(function(b){return knownRefs.indexOf(b.ref)<0&&negative(clean(b.text));});
  if(!declined&&refusalButtons.length===1)declined={button:refusalButtons[0],kind:'negative',answers:[]};
  if(context.financial){
   var payments=safe.filter(function(a){
    return /^(?:납부하기|공과금 납부|이자 납부|Pay bill|Pay interest)$/i.test(clean(a.button.text))&&
     !risky(a.scripts)&&
     /(?:Pay|Repay)(?:Utility|Tax|Interest)|(?:Utility|Tax|Interest)(?:Pay|Repay)/i.test(a.scripts);
   });
   if(payments.length===1){payments[0].payment=true;return payments[0];}
   return declined||null;
  }
  if(context.timing){
   if(context.timing.choice==='accept'){
    var accept=safe.find(function(a){return a.kind==='positive'&&!risky(a.scripts);});
    if(accept)return accept;
    var acceptButtons=options.filter(function(b){
     return knownRefs.indexOf(b.ref)<0&&/^(?:좋아(?:요)?|참여(?:할게요|하기)?|참가(?:할게요|하기)?|갈게요|체험해볼래|수락(?:하기)?|Accept|Join|Sure|I.ll come)[.!… ]*$/i.test(clean(b.text));
    });
    if(acceptButtons.length===1)return {button:acceptButtons[0],kind:'positive',answers:[]};
   }
   return declined||null;
  }
  if(context.spam)return declined||null;
  return safe.find(function(a){return a.kind==='normal'&&!a.scripts;})||
   safe.find(function(a){return a.kind==='positive'&&!a.scripts;})||declined||
   (options.length===1&&/^(?:확인|알겠습니다|OK|Got it)[.!]?$/i.test(clean(options[0].text))&&knownRefs.indexOf(options[0].ref)<0?
    {button:options[0],kind:'normal',answers:[]}:null);
 }
 function paymentAmount(nodes){
  var labels=nodes.filter(function(n){return n.role==='text';}).map(function(n){return clean(n.text);});
  var amounts=[];
  labels.forEach(function(line,index){
   var match=line.match(/^(?:납부 금액|청구 금액|이자 금액|Amount due)\s*[:：]?\s*(.*)$/i);
   if(!match)return;
   var text=match[1]||labels[index+1]||'';
   var amount=text.match(/^(?:[₥Ɯ₩§$]\s*)?(\d+|\d{1,3}(?:,\d{3})+)(?:\s*(?:미유|mew))?$/i);
   if(amount)amounts.push(Number(amount[1].replace(/,/g,'')));
   else amounts.push(NaN);
  });
  return amounts.length===1&&Number.isSafeInteger(amounts[0])&&amounts[0]>0?amounts[0]:null;
 }
 function messageKey(thread){return JSON.stringify([thread.key,thread.last.messageId,thread.last.timestamp]);}
 var api={clean:clean,widgets:widgets,usable:usable,popup:popup,cardScore:cardScore,paymentAmount:paymentAmount,messageKey:messageKey,
  preferencePlan:preferencePlan,feedEntries:feedEntries,events:events,catDonut:catDonut,clockMinute:clockMinute,
  invitation:invitation,responseButton:responseButton,phoneCardScore:phoneCardScore};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.ObserverChoices=api;
})(this);
