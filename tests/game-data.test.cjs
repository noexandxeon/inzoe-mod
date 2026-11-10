const {test}=require('node:test');
const assert=require('node:assert/strict');
const Data=require('../ZoiObserver_XDX478/ui/HouseholdObserver/game-data.js');

const rule=(command,s1,compareType='Equal',f1=0,f2=0,baseObject='Self')=>({command,s1,compareType,f1,f2,baseObject});
const condition=(and,or=[])=>({andConditionsList:[{conditions:and}],orConditionsList:or.map(conditions=>({conditions}))});
function setup(rows){
 const calls=[];
 const data=Data.create(async(name,args)=>{
  calls.push([name,args]);
  if(name==='data.list_tables')return [{alias:'Condition',row_count:Object.keys(rows).length}];
  if(args.Alias==='InteractionBag')return {interactionEnableConditionIds:[args.Row+'-rule']};
  if(args.Alias==='Condition')return rows[args.Row.replace(/-rule$/,'')];
  throw Error('Unexpected read');
 });
 return {data,calls};
}
test('a native option without a blocker wins over a different action that needs training',async()=>{
 const {data,calls}=setup({
  Heavy:condition([rule('Skill','Exercise','GreaterOrEqual',7)]),
  Easy:condition([rule('Skill','Exercise','GreaterOrEqual',2),rule('GrowthStep','Youth','GreaterOrEqual')])
 });
 const actor={age:'Adult',skills:{Exercise:4}};
 const first=await data.diagnose(['Heavy','Easy'],actor);
 assert.deepEqual(first,{bag:'Easy',blocks:[],unknown:0});
 const next=await data.diagnose(['Heavy','Easy'],{...actor,skills:{Exercise:1}});
 assert.equal(next.blocks[0].need,2);
 assert.equal(calls.length,4,'static rows are cached while the live state is evaluated again');
});
test('a satisfied OR branch bypasses a different skill gate and target skill is never a self training step',async()=>{
 const {data}=setup({
  Talk:condition([rule('Skill','Logic','GreaterOrEqual',8,0,'Target')],[
   [rule('Skill','Speaking','GreaterOrEqual',7)],[rule('GrowthStep','Adult')]
  ])
 });
 const result=await data.diagnose(['Talk'],{age:'Adult',skills:{Logic:1,Speaking:1}});
 assert.deepEqual(result.blocks,[]);
 assert.equal(result.unknown,1);
});
test('midnight windows, live weekdays and location tags identify the specific reason to wait or relocate',async()=>{
 const {data}=setup({Night:condition([
  rule('TimeRange','None','Equal',2300,400),rule('DayOfTheWeek','Sunday'),rule('EnteredSiteHasTag','Hospital')
 ])});
 const environment=async()=>({day_of_week:'Sunday',weather:'Sun'});
 assert.deepEqual((await data.diagnose(['Night'],{hhmm:145,siteTags:[]},environment)).blocks.map(b=>b.kind),['site']);
 assert.deepEqual((await data.diagnose(['Night'],{hhmm:2100,siteTags:['Hospital']},environment)).blocks.map(b=>b.kind),['timed']);
});
test('an unfinished scan does not block an uninspected candidate and later calls advance the scan',async()=>{
 const rows=Object.fromEntries(Array.from({length:9},(_,i)=>['Action'+i,
  condition(i===8?[]:[rule('Skill','Exercise','GreaterOrEqual',7)])
 ]));
 const {data}=setup(rows), ids=Object.keys(rows), actor={skills:{Exercise:4}};
 assert.equal((await data.diagnose(ids,actor)).partial,true);
 const second=await data.diagnose(ids,actor);
 assert.equal(second.bag,'Action8');
 assert.deepEqual(second.blocks,[]);
});

test('a vacancy does not override the native entry rank age range',()=>{
 const job={bRecruitable:true,rankList:[{rank:1,shift:{minGrowthStep:'Youth',maxGrowthStep:'Adult'}}]};
 assert.equal(Data.careerAgeAllowed(job,'Adult'),true);
 assert.equal(Data.careerAgeAllowed(job,'Elderly'),false);
 assert.equal(Data.careerAgeAllowed(job,'Toddler'),false);
});
