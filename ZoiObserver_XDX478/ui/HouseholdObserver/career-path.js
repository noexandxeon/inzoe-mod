(function(root){
 'use strict';
 // 0.5.7: a working life that changes over the years, the way a person's does.
 // Each Zoi gets a path from temperament + ambition (직장인 / 창업 / 자유직), and at each look the path,
 // age, savings and the job at hand give one next step: look for work, stay, prepare a business, start it,
 // leave the job once the business carries the household, retire, and what to do after retiring.
 // Only career.join is a confirmed game command. Resigning and opening a business are searched for in the
 // game's own action lists and counted only when the game's data shows the change.
 var PATHS={employee:'직장인',founder:'창업 지향',freelancer:'자유직'};
 var STEPS={seek_job:'구직',keep_job:'재직',prepare_business:'재직하며 창업 준비',start_business:'창업',run_business:'사업 운영',
  resign:'퇴사',retire:'은퇴',freelance:'자유 작업',rest:'은퇴 생활'};
 var VENTURE=/^(?:Independent|Leader|Achiever|Adventurer|Ambitious|Charismatic|Confident)$/;
 var STEADY=/^(?:Risk-averse|Faithful|Workaholic|Cooperator|Perfectionist|Diligent|Helper|CleanFreak)$/;
 var CREATIVE=/^(?:Artist|Romantic|Introvert|Observer|Entertainer|Bookworm|Individualist)$/;
 var CREATIVE_SKILLS=['Art','Instruments','Filming','Programming','Performance'];
 var SKILLS=['Logic','Programming','Art','Instruments','Filming','Charisma','Speaking','Performance','Cooking','Housework','Exercise',
  'Swimming','Fishing','HandCraft','CoffeeArt','BakingPastry','BeverageCraft','Gardening','Photography'];
 function level(skills,id){var s=(skills||[]).find(function(x){return x.id===id;});return s?s.level||0:0;}
 // Two Zois with the same traits still differ: a fixed number per individual (0..1), never re-rolled.
 function quirk(id,salt){
  var text=String(id)+':'+(salt||'bold'), h=2166136261;
  for(var i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
  return (h%1000)/999;
 }
 function senior(age){return /^(?:Elder|Elderly)$/.test(age||'');}
 // What the ambition is about, read from its id/name and the conditions of its current missions.
 function ambitionFocus(ambition){
  if(!ambition)return {skills:[],wealth:false,career:false,creative:false,key:''};
  var text=(ambition.id||'')+' '+(ambition.name||'')+' '+JSON.stringify((ambition.plans||[]).map(function(p){return [p.name,p.conditions];}));
  var skills=SKILLS.filter(function(s){return new RegExp('(?:^|[^A-Za-z])'+s+'(?![a-z])').test(text);});
  return {skills:skills,key:ambition.id||'',
   wealth:/Rich|Wealth|Money|Tycoon|Millionaire|Business|Entrepreneur|CEO|부자|재벌|사업|갑부/i.test(text),
   career:/Career|Promotion|Job|Workaholic|Success|Expert|Master|승진|직장|성공|전문가/i.test(text),
   creative:/Artist|Music|Creator|Writer|Painter|Star|Idol|Celebrity|예술|음악|작가|스타|창작/i.test(text)||
    skills.some(function(s){return CREATIVE_SKILLS.indexOf(s)>=0;})};
 }
 function temperament(traits,skills,focus){
  traits=traits||[];
  var venture=traits.filter(function(t){return VENTURE.test(t);}).length+(focus.wealth?2:0);
  var steady=traits.filter(function(t){return STEADY.test(t);}).length+(focus.career?2:0);
  var craft=Math.max.apply(null,CREATIVE_SKILLS.map(function(s){return level(skills,s);}));
  var creative=traits.filter(function(t){return CREATIVE.test(t);}).length+(focus.creative?2:0)+(craft>=4?1:0);
  return {venture:venture,steady:steady,creative:creative};
 }
 function choosePath(traits,skills,ambition,id){
  var f=ambitionFocus(ambition), t=temperament(traits,skills,f), bold=quirk(id);
  // Evenly split temperaments are settled by the individual's own boldness, so siblings need not match.
  var path=t.creative>=2&&t.creative>t.venture&&(t.creative>t.steady||t.creative===t.steady&&quirk(id,'craft')>0.5)?'freelancer':
   t.venture>=1&&(t.venture>t.steady||t.venture===t.steady&&bold>0.5)?'founder':'employee';
  var why=path==='freelancer'?'창작 기질'+(f.creative?'과 야망':''):path==='founder'?'독립·도전 기질'+(f.wealth?'과 야망':''):
   t.steady?'안정 기질'+(f.career?'과 야망':''):'뚜렷한 창업·창작 성향 없음';
  return {path:path,why:why,temper:t,focus:f.key};
 }
 // Extra points for a job whose skills the current ambition needs.
 function ambitionBonus(desired,ambition){
  var f=ambitionFocus(ambition), points=0, reasons=[];
  (desired||[]).forEach(function(s){if(f.skills.indexOf(s)>=0){points+=10;reasons.push('야망 / '+s);}});
  return {score:points,reasons:reasons};
 }
 // Remembered per Zoi in decision.careerPath; the path is kept for 14 game days unless the ambition changes.
 function plan(book,ctx){
  var ambitionKey=ctx.ambition&&ctx.ambition.id||'';
  if(!book.path||book.day>ctx.day||ctx.day-(book.chosenDay||0)>=14||book.focus!==ambitionKey&&ambitionKey){
   var c=choosePath(ctx.traits,ctx.skills,ctx.ambition,ctx.id);
   if(book.path!==c.path)book.changed=ctx.day;
   book.path=c.path;book.pathWhy=c.why;book.focus=ambitionKey;book.chosenDay=ctx.day;
  }
  book.day=ctx.day;
  if(ctx.employed){book.retired=false;if(book.jobless!==undefined)book.jobless=undefined;}
  else if(book.jobless===undefined)book.jobless=ctx.day;
  if(ctx.short){if(book.shortSince===undefined||book.shortSince>ctx.day)book.shortSince=ctx.day;}else book.shortSince=undefined;
  var step=decide(book,ctx);
  book.step=step.step;book.why=step.why;
  return book;
 }
 function decide(book,ctx){
  // Bold individuals start with less saved and sooner; cautious ones wait longer and keep a bigger cushion.
  var bold=quirk(ctx.id), old=senior(ctx.age);
  var seed=Math.round(ctx.reserve*(2.6-1.2*bold)+3000), cushion=Math.round(ctx.reserve*(4-1.5*bold)), tenure=4+Math.round(8*(1-bold));
  var shortDays=book.shortSince===undefined?0:ctx.day-book.shortSince;
  var solo=book.solo&&book.solo.since<=ctx.day?ctx.day-book.solo.since:0;
  var ready=!!ctx.business, days=ctx.daysInJob||0;
  function s(step,why){return {step:step,why:why};}
  if(ctx.ownsBusiness){
   if(ctx.employed&&ctx.bizOperating&&ctx.bizProfit>0&&!ctx.short)return s('resign','사업 수익이 생활비를 감당함');
   return s('run_business',ctx.employed?'직장과 사업 병행':'사업 운영');
  }
  if(old&&ctx.employed){
   if(ctx.cash>=cushion)return s('retire','노년 · 노후 자금 확보');
   return s('keep_job','노년이지만 저축이 부족해 계속 근무');
  }
  if(old||book.retired){
   if(!old&&ctx.short&&shortDays>=2)return s('seek_job','생활비 부족으로 다시 구직');
   if(old)book.retired=true;
   if(book.path!=='employee'||ready){
    if(ready&&ctx.cash>=seed&&!book.foundingBlocked)return s('start_business','은퇴 후 '+ctx.business.type+' 창업');
    return s('freelance','은퇴 후 소일거리(1인 작업)');
   }
   return s('rest','은퇴 생활');
  }
  if(book.path==='founder'){
   if(ready&&ctx.cash>=seed&&(!ctx.employed||days>=tenure)){
    if(!book.foundingBlocked)return s('start_business',(ctx.employed?'재직 중 ':'')+ctx.business.type+' 창업 · 종잣돈 확보');
    if(ctx.employed&&solo>=3&&!ctx.short&&ctx.cash>=cushion)return s('resign','1인 사업이 자리 잡아 전업');
    return s('freelance','사업장 창업 경로가 없어 1인 사업으로 진행');
   }
   if(ctx.employed)return s('prepare_business',ready?'종잣돈 '+Math.max(0,seed-ctx.cash)+' 더 모으는 중':'창업에 쓸 역량을 쌓는 중');
   return s('seek_job','창업 종잣돈을 모으기 위한 취업');
  }
  if(book.path==='freelancer'){
   if(ctx.employed){
    if(solo>=5&&!ctx.short&&ctx.cash>=cushion&&days>=5)return s('resign','자유 작업으로 생활 가능');
    return s('freelance','직장을 다니며 자유 작업 병행');
   }
   if(ctx.short&&shortDays>=2)return s('seek_job','생활비 부족이 이어져 취업');
   return s('freelance','자유 작업으로 생활');
  }
  // A steady employee with a bold streak may still leave for a shop of their own in mid-life.
  if(ctx.employed&&bold>=0.6&&ready&&!book.foundingBlocked&&/^(?:Adult|Old)$/.test(ctx.age||'')&&days>=14&&ctx.cash>=Math.round(seed*1.5))
   return s('start_business','오래 다닌 직장을 떠나 '+ctx.business.type+' 창업');
  return ctx.employed?s('keep_job','적성에 맞는 직장에서 경력 쌓기'):s('seek_job','적성에 맞는 일자리 찾기');
 }
 function mayApply(book,employed){
  if(!book||!book.step)return true;
  if(book.step==='seek_job')return true;
  // Changing to a better-fitting job is still allowed while employed; leaving or retiring is not undone by a new job.
  return employed&&/^(?:keep_job|prepare_business|freelance)$/.test(book.step);
 }
 function worksAlone(book){return !!book&&/^(?:freelance)$/.test(book.step||'');}
 function describe(book){
  if(!book||!book.path)return null;
  return PATHS[book.path]+' ('+book.pathWhy+') · '+(STEPS[book.step]||book.step)+' — '+book.why+(book.note?' · '+book.note:'');
 }
 var LEAVE=/(?:Career|Job|Work|Company)[A-Za-z_]*(?:Quit|Resign|Retire)|(?:Quit|Resign|Retire)[A-Za-z_]*(?:Career|Job|Work|Company)|퇴사|사직|은퇴|일 그만두/i;
 var FOUND=/(?:Start|Open|Found|Establish|Register|Buy|Purchase)[A-Za-z_]*(?:Biz|Business|Shop|Store)|(?:Biz|Business|Shop|Store)[A-Za-z_]*(?:Start|Found|Establish|Register|Purchase)|창업|사업 시작|사업 등록|가게 차리/i;
 var OPEN=/(?:Biz|Business|Shop|Store)[A-Za-z_]*(?:Open|StartDay|Start_Day|Begin)|(?:Open|StartDay|Begin)[A-Za-z_]*(?:Biz|Business|Shop|Store)|영업 시작|가게 열|개점/i;
 var NOT=/Cancel|Close|EndDay|End_Day|Fail|Feedback|_Sub_|Cheat|Debug|Vacation|취소|종료|마감/i;
 function matches(pattern,action){
  var text=(action.interaction_bag_id||'')+' '+(action.display_name||'');
  return pattern.test(text)&&!NOT.test(text);
 }
 // Carries out the steps that need a game action. api: cli, write, log, computers(member,character),
 // objects(member,character), act(member,objects,choose,token,offers), move(member,site,token), score(e).
 function create(api){
  var cli=api.cli, log=api.log, found={};
  async function searchBags(keys,pattern){
   var cacheKey=keys.join('|');
   if(found[cacheKey])return found[cacheKey];
   var bags={};
   for(var i=0;i<keys.length;i++){
    try{
     var res=await cli('interaction.search',{Keyword:keys[i],max_results:60});
     (res.results||[]).forEach(function(a){if(matches(pattern,a))bags[a.interaction_bag_id]=a;});
    }catch(_){}
   }
   return found[cacheKey]=Object.keys(bags).map(function(k){return bags[k];});
  }
  function attemptState(book,key){
   var all=book.tries||(book.tries={});
   return all[key]||(all[key]={count:0});
  }
  function open(book,key,minute){var t=attemptState(book,key);return t.count<2||minute>=(t.retry||0);}
  function missed(book,key,minute,name,note){
   var t=attemptState(book,key);
   t.count++;t.retry=minute+7*1440;
   book.pending=null;
   book.note=note;
   log(name+': '+note);
  }
  // One request through the home computer, or as a Self_ action found in game data.
  async function request(member,character,pattern,keys,token){
   var id=String(member.entity_id);
   var action=await api.act(member,await api.computers(member,character),function(items){
    return items.find(function(a){return a.enabled===true&&matches(pattern,a);});
   },token);
   if(action)return action;
   var self=(await searchBags(keys,pattern)).filter(function(a){return /^(?:Self_|Phone|SmartPhone)/i.test(a.interaction_bag_id);});
   if(!self.length)return null;
   var offers={};offers[id]={interactions:self.map(function(a){return Object.assign({enabled:true},a);})};
   return await api.act(member,[{entity_id:id}],function(items){return items[0];},token,offers);
  }
  async function employed(id){
   var c=await cli('entity.reflect',{entity_id:id,Component:'Career'});
   return !!(c.careerSlots&&c.careerSlots.business);
  }
  async function owned(id){
   var c=await cli('entity.reflect',{entity_id:id});
   return (c.householdBizProfile&&c.householdBizProfile.managedHouseholdBizIdList||[]).some(function(x){return (x&&x.value)>0;});
  }
  // Settle what was asked last time by what the game shows now.
  async function review(member,decision,minute){
   var book=decision.careerPath, id=String(member.entity_id), name=member.first_name||id;
   if(!book||!book.pending)return null;
   var p=book.pending;
   if(p.at>minute){book.pending=null;return null;}
   if(p.kind==='leave'){
    if(!await employed(id)){
     book.pending=null;book.note=null;book.tries&&delete book.tries.leave;
     if(p.step==='retire')book.retired=true;
     book.leftJob={minute:minute,step:p.step};
     log(name+': '+(p.step==='retire'?'은퇴':'퇴사')+' 확인 ('+p.why+')');
     if(api.score)api.score({minute:minute,zoi:id,kind:'offered',name:p.step==='retire'?'은퇴':'퇴사'});
     return 'left';
    }
    if(minute-p.at<180)return 'waiting';
    missed(book,'leave',minute,name,(p.step==='retire'?'은퇴':'퇴사')+' 요청이 게임에 반영되지 않음 · 직장 유지');
    return 'missed';
   }
   if(p.kind==='found'){
    if(await owned(id)){
     book.pending=null;book.note=null;
     log(name+': 사업장 보유 확인 · 창업 완료');
     return 'founded';
    }
    if(minute-p.at<240)return 'waiting';
    missed(book,'found',minute,name,'창업 요청이 게임에 반영되지 않음');
    if(attemptState(book,'found').count>=2)book.foundingBlocked=true;
    return 'missed';
   }
   if(p.kind==='open'){
    var info=await cli('household_biz.get_info',{household_biz_id:String(p.biz)});
    if(info.is_operating===true){book.pending=null;book.note=null;book.tries&&delete book.tries.open;log(name+': 영업 시작 확인');return 'open';}
    if(minute-p.at<180)return 'waiting';
    missed(book,'open',minute,name,'영업 시작 요청이 게임에 반영되지 않음');
    return 'missed';
   }
   book.pending=null;
   return null;
  }
  async function leave(member,character,decision,minute,token){
   var book=decision.careerPath, name=member.first_name||String(member.entity_id);
   if(book.pending||!open(book,'leave',minute))return false;
   var action=await request(member,character,LEAVE,['Quit','Resign','Retire','Career'],token);
   if(!action){missed(book,'leave',minute,name,'게임이 제공하는 퇴사·은퇴 행동을 찾지 못함 · 직장 유지');return false;}
   book.pending={kind:'leave',step:book.step,why:book.why,at:minute,bag:action.interaction_bag_id};
   log(name+': '+(book.step==='retire'?'은퇴':'퇴사')+' 결정 — '+book.why+' ('+(action.display_name||action.interaction_bag_id)+')');
   return true;
  }
  async function start(member,character,decision,minute,token){
   var book=decision.careerPath, name=member.first_name||String(member.entity_id);
   if(book.pending||book.foundingBlocked)return false;
   if(!open(book,'found',minute)){book.foundingBlocked=true;return false;}
   var action=await request(member,character,FOUND,['Business','Biz','Shop'],token);
   if(!action){
    attemptState(book,'found').count=2;book.foundingBlocked=true;
    book.note='사업장 창업 행동을 찾지 못함 · 1인 사업으로 전환';
    log(name+': '+book.note);
    return false;
   }
   book.pending={kind:'found',at:minute,bag:action.interaction_bag_id};
   log(name+': 창업 결정 — '+book.why+' ('+(action.display_name||action.interaction_bag_id)+')');
   return true;
  }
  // An owned business that is closed: go there during the day and open it.
  async function run(member,character,decision,biz,time,minute,token){
   var book=decision.careerPath, name=member.first_name||String(member.entity_id);
   if(book.pending||!biz||biz.operating||time.hour<8||time.hour>=18||!open(book,'open',minute))return false;
   try{
    var can=await cli('household_biz.can_start_day_business',{household_biz_id:String(biz.id)});
    if(can&&(can.can_start===false||can.result===false))return false;
   }catch(_){}
   var here=character.locatedSiteId&&character.locatedSiteId.value;
   if(biz.site>0&&here!==biz.site){
    if(minute<(book.nextVisit||0))return false;
    book.nextVisit=minute+240;
    if(!await api.move(member,biz.site,token))return false;
    log(name+': 영업 준비를 위해 사업장으로 이동');
    return true;
   }
   var action=await api.act(member,await api.objects(member,character),function(items){
    return items.find(function(a){return a.enabled===true&&matches(OPEN,a);});
   },token);
   if(!action)action=await request(member,character,OPEN,['Business','Biz','Open'],token);
   if(!action){missed(book,'open',minute,name,'영업 시작 행동을 찾지 못함');return false;}
   book.pending={kind:'open',biz:biz.id,at:minute,bag:action.interaction_bag_id};
   log(name+': 영업 시작 요청 ('+(action.display_name||action.interaction_bag_id)+')');
   return true;
  }
  return {review:review,leave:leave,start:start,run:run,reset:function(){found={};}};
 }
 var api={quirk:quirk,PATHS:PATHS,STEPS:STEPS,ambitionFocus:ambitionFocus,temperament:temperament,choosePath:choosePath,ambitionBonus:ambitionBonus,
  plan:plan,decide:decide,mayApply:mayApply,worksAlone:worksAlone,describe:describe,senior:senior,matches:matches,LEAVE:LEAVE,FOUND:FOUND,OPEN:OPEN,create:create};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.ObserverCareerPath=api;
})(this);
