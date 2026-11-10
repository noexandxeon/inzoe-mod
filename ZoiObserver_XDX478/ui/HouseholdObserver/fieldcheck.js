(function(root){
 'use strict';
 // 0.5.9: things that could only be guessed without the game are looked up by the mod itself the first
 // time it runs in the game, one read-only question per turn, and kept in the report
 // (saved/observer-report.cfg → fieldCheck). Nothing here changes the game.
 var SEARCH=['Invite','Party','Quit','Resign','Retire','Business','Biz','Shop','Open','Career','Phone'];
 var COMMANDS=['character.possess','entity.possess','relationships.list','relationships.get_value','contacts.get_all',
  'site.get_visitors','social_event.debug','event.list','event.describe','household_biz.can_start_day_business','game.list_saves'];
 var SHAPES=[
  {key:'relationships.list',args:function(c){return {owner_id:c.selected};}},
  {key:'contacts.get_all',args:function(c){return {entity_id:c.selected};}},
  {key:'site.get_visitors',args:function(c){return c.home>0?{site_entity_id:String(c.home)}:null;}},
  {key:'event.list',args:function(){return {};}}
 ];
 function steps(){
  return SEARCH.map(function(k){return {id:'search:'+k,kind:'search',key:k};})
   .concat(COMMANDS.map(function(k){return {id:'command:'+k,kind:'command',key:k};}))
   .concat(SHAPES.map(function(s){return {id:'shape:'+s.key,kind:'shape',key:s.key,args:s.args};}));
 }
 // Names and types only, never the data itself.
 function shape(value,depth){
  depth=depth===undefined?2:depth;
  if(Array.isArray(value))return {array:value.length,of:value.length&&depth>0?shape(value[0],depth-1):null};
  if(value&&typeof value==='object'){
   if(depth<=0)return 'object';
   var out={};
   Object.keys(value).slice(0,14).forEach(function(k){out[k]=shape(value[k],depth-1);});
   return out;
  }
  return value===null?'null':typeof value;
 }
 function book(state,version){
  var f=state.fieldCheck;
  if(!f||f.version!==version)f=state.fieldCheck={version:version,results:{},done:false};
  return f;
 }
 function next(state,version){
  var f=book(state,version);
  var todo=steps().filter(function(s){return !f.results[s.id];});
  if(!todo.length)f.done=true;
  return todo[0]||null;
 }
 // classify(action) → label or null, supplied by the app (invite / party / leave / found / open).
 async function run(state,version,context,cli,classify){
  var step=next(state,version), f=book(state,version);
  if(!step)return null;
  var result={at:context.minute};
  try{
   if(step.kind==='search'){
    var res=await cli('interaction.search',{Keyword:step.key,max_results:100}), list=res.results||[];
    var known=[], other=[];
    list.forEach(function(a){
     var label=classify(a);
     if(label)known.push({id:a.interaction_bag_id,name:a.display_name||null,as:label});
     else if(other.length<12)other.push(a.interaction_bag_id);
    });
    result.total=list.length;result.known=known.slice(0,20);result.other=other;
   }else if(step.kind==='command'){
    var h=await cli('cli.help',{command:step.key});
    if(typeof h==='string'){var at=h.indexOf('{');h=at>=0?JSON.parse(h.slice(at)):{text:h.slice(0,200)};}
    result.access=h&&h.access||null;
    result.help=JSON.stringify(h).slice(0,400);
   }else{
    var args=step.args(context);
    if(!args){result.skipped='조건 없음';}
    else result.shape=shape(await cli(step.key,args));
   }
   result.ok=true;
  }catch(e){result.ok=false;result.error=String(e&&e.message||e).slice(0,160);}
  f.results[step.id]=result;
  if(!next(state,version))f.done=true;
  return step.id;
 }
 function line(state){
  var f=state.fieldCheck;
  if(!f)return '';
  var total=steps().length, count=Object.keys(f.results).length;
  var found={};
  Object.keys(f.results).forEach(function(k){(f.results[k].known||[]).forEach(function(a){found[a.as]=(found[a.as]||0)+1;});});
  var labels={invite:'초대',party:'파티',leave:'퇴사·은퇴',found:'창업',open:'영업 시작'};
  var text='현장 점검 '+count+'/'+total;
  if(f.done)text+=' 완료 · 찾은 행동: '+(Object.keys(labels).map(function(k){return labels[k]+' '+(found[k]||0);}).join(', '));
  return text;
 }
 var api={steps:steps,shape:shape,book:book,next:next,run:run,line:line};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.ObserverFieldCheck=api;
})(this);
