(function(root){
 'use strict';
 var ageSteps=['Infant','Toddler','Child','LowTeen','HighTeen','Youth','Adult','Old','Elderly'];
 var limit=8;
 function compare(actual,op,expected){
  if(op==='Equal')return actual===expected;
  if(op==='NotEqual')return actual!==expected;
  if(typeof actual!=='number'||typeof expected!=='number')return null;
  if(op==='GreaterOrEqual')return actual>=expected;
  if(op==='Greater')return actual>expected;
  if(op==='LessOrEqual')return actual<=expected;
  if(op==='Less')return actual<expected;
  return null;
 }
 function clock(value){
  return ('0'+Math.floor(value/100)).slice(-2)+':'+('0'+value%100).slice(-2);
 }
 function checks(rule,ctx){
  var id=rule.s1, op=rule.compareType, result=null, blocker=null;
  if(rule.baseObject!=='Self')return {known:false};
  switch(rule.command){
  case 'Skill':
   var level=ctx.skills&&ctx.skills[id];
   if(!Number.isFinite(level)||!Number.isFinite(rule.f1))break;
   result=compare(level,op,rule.f1);
   if(op==='GreaterOrEqual'||op==='Greater'){
    var minimum=op==='Greater'?Math.floor(rule.f1)+1:Math.ceil(rule.f1);
    blocker={kind:'skill',id:id,have:level,need:minimum,label:id+' Lv.'+level+' → '+minimum};
   }
   break;
  case 'GrowthStep':
   var actual=ageSteps.indexOf(ctx.age), expected=ageSteps.indexOf(id);
   if(actual<0||expected<0)break;
   result=compare(actual,op,expected);
   blocker={kind:'fixed',label:'나이 조건 '+id+' / 현재 '+ctx.age};
   break;
  case 'Gender':
   if(!/^(Male|Female)$/.test(id)||!/^(Male|Female)$/.test(ctx.gender))break;
   result=compare(ctx.gender,op,id);
   blocker={kind:'fixed',label:'성별 조건 / 현재 조이에게 열리지 않음'};
   break;
  case 'City':
   if(!ctx.city||!id||id==='None')break;
   result=compare(ctx.city,op,id);
   blocker={kind:'fixed',label:'현재 도시에서 이용할 수 없는 행동'};
   break;
  case 'DayOfTheWeek':
   if(!ctx.weekday||!id||id==='None')break;
   result=compare(ctx.weekday,op,id);
   blocker={kind:'timed',label:'요일 조건 '+id+' / 현재 '+ctx.weekday};
   break;
  case 'Weather':
   if(!ctx.weather||!id||id==='None'||rule.s2&&rule.s2!=='None')break;
   result=compare(ctx.weather,op,id);
   blocker={kind:'timed',label:'날씨 조건 '+id+' / 현재 '+ctx.weather};
   break;
  case 'Time':
   if(!Number.isFinite(ctx.hour)||!Number.isFinite(rule.f1))break;
   result=compare(ctx.hour,op,rule.f1);
   blocker={kind:'timed',label:'시간 조건 '+rule.f1+'시 / 현재 '+ctx.hour+'시'};
   break;
  case 'TimeRange':
   if(!Number.isFinite(ctx.hhmm)||!Number.isInteger(rule.f1)||!Number.isInteger(rule.f2))break;
   var inside=rule.f1<=rule.f2?ctx.hhmm>=rule.f1&&ctx.hhmm<=rule.f2:ctx.hhmm>=rule.f1||ctx.hhmm<=rule.f2;
   if(op==='Equal'||op==='NotEqual')result=op==='Equal'?inside:!inside;
   blocker={kind:'timed',label:'시간대 조건 '+clock(rule.f1)+'~'+clock(rule.f2)};
   break;
  case 'EnteredSiteHasTag':
   if(!Array.isArray(ctx.siteTags)||op!=='Equal'||!id||id==='None')break;
   result=ctx.siteTags.indexOf(id)>=0;
   blocker={kind:'site',id:id,label:'현재 장소에 시설 조건 '+id+' 없음'};
   break;
  case 'IsSiteHasObjectTemplateTag':
   if(typeof ctx.hasSiteObjectTag!=='function'||op!=='Equal'||!id||id==='None')break;
   result=ctx.hasSiteObjectTag(id);
   blocker={kind:'object',id:id,label:'현재 장소에 물건 조건 '+id+' 없음'};
   break;
  }
  return {known:result!==null,blocker:result===false?(blocker||{kind:'other',label:rule.command+' 조건 불충족'}):null};
 }
 function group(rules,ctx){
  var result={blocks:[],unknown:0};
  (rules||[]).forEach(function(rule){
   var item=checks(rule,ctx);
   if(!item.known)result.unknown++;
   if(item.blocker)result.blocks.push(item.blocker);
  });
  return result;
 }
 function cost(item){
  return item.blocks.reduce(function(n,b){
   if(b.kind==='fixed')return n+1000;
   if(b.kind==='other')return n+300;
   if(b.kind==='skill')return n+20+Math.max(0,b.need-b.have);
   return n+12;
  },0)+Math.min(item.unknown,9);
 }
 function choose(paths){
  // A branch that may already work takes precedence over changing the Zoi or buying anything.
  return paths.slice().sort(function(a,b){
   return Number(a.blocks.length>0)-Number(b.blocks.length>0)||cost(a)-cost(b);
  })[0];
 }
 function evaluate(conditions,context){
  var result={blocks:[],unknown:0};
  conditions.forEach(function(row){
   if(!row){result.unknown++;return;}
   var andRules=(row.andConditionsList||[]).reduce(function(out,g){return out.concat(g.conditions||[]);},[]);
   var required=group(andRules,context);
   var options=(row.orConditionsList||[]).map(function(g){return group(g.conditions,context);});
   var optional=options.length?choose(options):{blocks:[],unknown:0};
   result.blocks=result.blocks.concat(required.blocks,optional.blocks);
   result.unknown+=required.unknown+optional.unknown;
  });
  return result;
 }
 function conditionIds(bag){
  var sequences=bag.interactionSequence||[];
  var ids=[].concat(bag.interactionEnableConditionIds||[],bag.interactionVisibleConditionIds||[],bag.enqueueConditionIds||[],
   sequences.length===1?[sequences[0].enableConditionId]:[]);
  return Array.from(new Set(ids.filter(function(id){return typeof id==='string'&&id!=='None'&&id;})));
 }
 function careerAgeAllowed(organization,age){
  if(!organization||organization.bRecruitable===false||organization.hiddenFromUI===true)return false;
  var ranks=organization.rankList||[];
  var entry=ranks.find(function(rank){return rank.rank===1;});
  var shift=entry&&entry.shift;
  if(!shift)return true;
  var current=ageSteps.indexOf(age);
  var min=ageSteps.indexOf(shift.minGrowthStep), max=ageSteps.indexOf(shift.maxGrowthStep);
  return current>=0&&(min<0||current>=min)&&(max<0||current<=max);
 }
 function create(cli){
  var rows=Object.create(null), counted=Object.create(null), bags=Object.create(null);
  var tables=null, catalogAttempt=0;
  async function catalog(){
   if(tables||Date.now()-catalogAttempt<30000)return tables;
   catalogAttempt=Date.now();
   try{
    var result=await cli('data.list_tables');
    var list=Array.isArray(result)?result:result&&result.tables;
    if(Array.isArray(list)&&list.length)tables=list.filter(function(t){return t&&typeof t.alias==='string'&&Number.isFinite(t.row_count);});
   }catch(_){}
   return tables;
  }
  async function row(alias,id){
   var key=alias+':'+id;
   if(!rows[key]){
    rows[key]=Promise.resolve().then(function(){return cli('data.table_get',{Alias:alias,Row:id});})
     .then(function(value){
      if(!value||typeof value!=='object'||Array.isArray(value))throw Error('게임 데이터 응답 형식 확인 필요 / '+key);
      counted[alias]=(counted[alias]||0)+1;
      return value;
     }).catch(function(error){delete rows[key];throw error;});
   }
   return rows[key];
  }
  async function rules(id){
   var cached=bags[id];
   if(cached&&(cached.complete||Date.now()-cached.at<60000))return cached.conditions;
   var ids, conditions=[];
   try{ids=conditionIds(await row('InteractionBag',id));}
   catch(_){ids=[];conditions.push(null);}
   for(var i=0;i<ids.length;i++){
    try{conditions.push(await row('Condition',ids[i]));}
    catch(_){conditions.push(null);}
   }
   bags[id]={conditions:conditions,complete:conditions.every(Boolean),at:Date.now()};
   return conditions;
  }
  async function diagnose(ids,context,environment){
   var all=Array.from(new Set(ids)), candidates=[], budget=limit;
   for(var i=0;i<all.length;i++){
    var id=all[i], cached=bags[id];
    if(!cached||!cached.complete&&Date.now()-cached.at>=60000){
     if(!budget){
      if(cached)candidates.push({id:id,rules:cached.conditions});
      continue;
     }
     budget--;
    }
    candidates.push({id:id,rules:await rules(id)});
   }
   if(!candidates.length)return null;
   if(environment&&candidates.some(function(c){
    return c.rules.some(function(r){return r&&[r.andConditionsList,r.orConditionsList].some(function(groups){
     return (groups||[]).some(function(g){return (g.conditions||[]).some(function(x){return x.command==='Weather'||x.command==='DayOfTheWeek';});});
    });});
   })){
    try{
     var weather=await environment();
     context=Object.assign({},context,{weekday:weather.day_of_week,weather:weather.weather});
    }catch(_){}
   }
   var best=choose(candidates.map(function(c){return Object.assign({bag:c.id},evaluate(c.rules,context));}));
   // When a goal has more alternatives than this pass inspected, preserve their chance to work.
   if(candidates.length<all.length)return {bag:best.bag,blocks:[],unknown:best.unknown,partial:true};
   return best;
  }
  function summary(){
   return {tableCount:tables&&tables.length||0,rowCount:tables&&tables.reduce(function(n,t){return n+t.row_count;},0)||0,
    queried:Object.assign({},counted)};
  }
  return {catalog:catalog,row:row,diagnose:diagnose,summary:summary};
 }
 var api={create:create,careerAgeAllowed:careerAgeAllowed};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.ObserverGameData=api;
})(this);
