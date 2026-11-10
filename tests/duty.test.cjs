const test=require('node:test');
const assert=require('node:assert/strict');
const {create,archive}=require('../ZoiObserver_XDX478/ui/HouseholdObserver/duty.js');
const L=require('../ZoiObserver_XDX478/ui/HouseholdObserver/life.js');
const R=require('../ZoiObserver_XDX478/ui/HouseholdObserver/recovery.js');

const ticks=minute=>minute*600000000;
function fixture(tasks,kind='school'){
 const day=1002, minute=day*1440+600, id='20522', site=kind==='homework'?639:845;
 const starts=minute-(kind==='homework'?660:15);
 const quest=kind==='homework'?'Dowon_AfterSchool':'School_Schedule';
 const tip={school:'Quest_School_Work_ToolTip',homework:'AfterSchoolMission_Reward_Tooltip',work:'JobMission_Reward_Tooltip'}[kind];
 const member={entity_id:Number(id),has_career:true};
 const character={locatedSiteId:{value:site}};
 const snapshot={queue:{queue_count:0,entries:[]},work:kind==='work'?{has_job:true,work_site_id:site,is_working_time:true}:{}};
 const running={}, history={}, decision={}, writes=[];
 for(const [i,[mission,tag,bag,target,expires,type='InteractionBagCount']] of tasks.entries()){
  running[mission]={questInfo:{questId:quest,startTick:ticks(starts),endTick:ticks(minute+expires),questTask:{missionDtId:mission}},missionId:{value:i+100}};
  history[mission.toLowerCase()]={endTick:ticks(minute+expires),isActive:true,isSuccess:false};
 }
 const definition=Object.fromEntries(tasks.map(([mission,tag,bag,target,expires,type])=>
  [mission,{conditions:[{conditionType:type||'InteractionBagCount',conditionId1:tag}]}]));
 const controller=create({row:async (table,key)=>{
  if(table==='Quest')return {questCategoryId:'Category'};
  if(table==='QuestCategory')return {missionToolTipId:tip};
  if(table==='Mission')return definition[key];
  if(table==='InteractionBag')return {interactionSequence:[{mainInteractionId:'Persistent_ComputerUse'}]};
  return null;
 },cli:async(name,args={})=>{
  if(name==='world.get_loaded_sites')return {sites:[{id:'School',entity_id:site}]};
  if(name==='interaction.search')return {results:tasks.filter(([mission,tag,, , ,type])=>type!=='ActionTime'&&(tag===args.Keyword||mission===args.Keyword))
   .map(([,tag,bag])=>({interaction_bag_id:bag,tags:[tag,args.Keyword]}))};
  if(name==='build.scan_objects')return {objects:[{entity_id:200,table_id:'ChalkBoard01'}]};
  if(name==='entity.scan_objects')return {objects:[{entity_id:300,table_id:'Computer01'}]};
  if(name==='interaction.list_available')return {interactions:tasks.filter(t=>String(t[3])===args.target_entity_id)
   .map(t=>({interaction_bag_id:t[2],enabled:true}))};
  if(name==='entity.reflect'){
   if(args.entity_id==='887')return {classSections:[{teacherId:{value:19186},studentIds:[{value:Number(id)}]}],
    studentHomeworkMap:{'(Value=20522)':{homeworkObjectId:{value:24161}}}};
   if(args.Component==='Quest')return {executingQuestMap:running,todayQuestHistoryData:{[quest]:{historyElementMap:history}}};
   if(args.Component==='Timeline')return {bIsArrivedDestination:true,destTargetEntityId:{value:site},
    careerTimelineParams:kind==='school'?{school:{careerType:'School',destSiteName:'School'}}:{}};
   if(args.Component==='Career')return {careerSlots:{school:{careerEntityId:{value:887}}}};
   if(args.Component==='Mission')return {missionMap:{}};
   return character;
  }
  throw Error('Unexpected '+name);
 },write:async (name,args)=>writes.push(args)},L,R);
 return {writes,decision,day,minute,snapshot,character,
  run:(mayAct=true,when=minute)=>controller.run(member,character,decision,snapshot,when,1,true,mayAct),
  complete(name){history[name.toLowerCase()].isSuccess=true;delete running[name];},
  fail(name){history[name.toLowerCase()].isFail=true;delete running[name];}};
}

test('school deadlines win and only native completion counts toward half',async()=>{
 const h=fixture([['Listen','Mission_School_Listen','ListenBag',200,60],['Question','Mission_School_Question','QuestionBag',19186,30]]);
 await h.run();
 assert.deepEqual(h.writes.map(x=>x.target_entity_id),['19186']);
 assert.deepEqual(h.decision.duty.summary,{total:2,done:0,failed:0,target:1,percent:0});
 await h.run();
 assert.equal(h.writes.length,1);
 h.complete('Question');
 await h.run();
 assert.equal(h.decision.duty.summary.percent,50);
 assert.equal(h.writes[1].target_entity_id,'200');
 assert.equal(archive({'20522':h.decision},h.day,h.day+1)['20522'][h.day].done,1);
});

test('arriving at school without an executable assignment leaves time for local hopes',async()=>{
 const h=fixture([]);
 assert.equal(await h.run(),false);
 assert.equal(h.decision.duty.schoolSite,845);
 assert.equal(h.writes.length,0);
});

test('the assigned paper homework is attempted away from school and counts once on its issue day',async()=>{
 const h=fixture([['Homework','EntityTag_School_PaperHomework_Complete','Homework_Do',24161,65,'AddEntityTagCount']],'homework');
 await h.run(false);
 assert.equal(h.writes.length,0);
 await h.run();
 assert.equal(h.writes[0].target_entity_id,'24161');
 h.complete('Homework');
 await h.run();
 assert.equal(h.decision.duty.summary.total,0);
 assert.deepEqual(archive({student:h.decision},h.day-1,h.day).student[h.day-1],
  {total:1,done:1,failed:0,target:1,percent:100});
});

test('a timed workplace action uses the native action sequence and waits for confirmed progress',async()=>{
 const h=fixture([['DeskWork','Persistent_ComputerUse','Use_WorkComputer',300,90,'ActionTime']],'work');
 await h.run();
 assert.equal(h.writes[0].interaction_bag_id,'Use_WorkComputer');
 h.snapshot.queue.current={interaction_bag_id:'Use_WorkComputer',target_entity_id:300,state:'Playing'};
 await h.run(true,h.minute+30);
 assert.equal(h.writes.length,1);
 h.fail('DeskWork');
 await h.run();
 assert.equal(h.decision.duty.summary.failed,1);
 assert.equal(h.decision.duty.summary.done,0);
});

test('an expired or off-site assignment is not dispatched',async()=>{
 const h=fixture([['Question','Mission_School_Question','QuestionBag',19186,20]]);
 await h.run(false);
 h.character.locatedSiteId.value=500;
 await h.run();
 await h.run(true,h.minute+30);
 assert.equal(h.writes.length,0);
 assert.equal(h.decision.duty.summary.done,0);
});

test('reading homework selects the exact assigned title from the game bookshelf actions',async()=>{
 const h=fixture([
  ['ReadProgramming','H_Programming_Book','Bookshelf_SitRead_H_Programming_Book',300,45,'ReadBook'],
  ['OtherBook','H_Programming_Book','Bookshelf_SitRead_M_Programming_Book',300,50,'ReadBook']
 ],'homework');
 await h.run();
 assert.equal(h.writes[0].interaction_bag_id,'Bookshelf_SitRead_H_Programming_Book');
});
