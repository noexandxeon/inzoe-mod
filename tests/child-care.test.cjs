const assert=require('node:assert/strict');
const {test}=require('node:test');
const ChildCare=require('../ZoiObserver_XDX478/ui/HouseholdObserver/child-care.js');
const Life=require('../ZoiObserver_XDX478/ui/HouseholdObserver/life.js');

const adult={entity_id:2,household_id:10,age_group:'Elderly',first_name:'보호자'};
const outsider={entity_id:3,household_id:20,age_group:'Adult',first_name:'다른 가구'};
const city='Cahaya_Map';

function fixture(age,values,offers){
 const child={entity_id:1,household_id:10,age_group:age,first_name:'아기',employable:true};
 const group=[child,adult,outsider], writes=[], moves=[], state={people:{}};
 const childQueue={queue_count:0}, adultQueue={queue_count:0};
 const place={locatedCityName:city,locatedSiteId:{value:42},householdEntityId:{value:10}};
 const adultPlace={...place};
 const work={home_site_id:42};
 const childSample={character:place,queue:childQueue,stats:{stats:Object.fromEntries(
  Object.entries(values).map(([key,pct])=>[key,{pct}])
 )}};
 let queuedOf=null;
 const care=ChildCare.create({
  state,game:()=>({map_id:city}),active:()=>true,log(){},
  async queued(id){return queuedOf?queuedOf(id):null;},
  async cli(name,args){
   if(name==='entity.get_simulate_state')return {results:args.entity_ids.split(',').map(entity_id=>({entity_id,exists:true,simulated:true}))};
   if(name==='household.get_members')return {household_id:10,members:[child,adult]};
   if(name==='entity.reflect')return args.entity_id==='2'?adultPlace:place;
   if(name==='career.get_work_status')return work;
   if(name==='schedule.diagnose')return {has_schedule:false};
   if(name==='interaction.get_queue')return args.entity_id==='1'?childQueue:adultQueue;
   if(name==='interaction.list_available'){
    assert.equal(args.entity_id,'2');
    assert.equal(args.target_entity_id,'1');
    return {interactions:offers};
   }
   if(name==='data.table_get')return {_row_name:args.Row,interactionRewards:[{statId:'Sleep',reward:5}]};
   throw Error('Unexpected command '+name);
  },
  async write(name,args){writes.push({name,...args});},
  async move(member,site){moves.push([member.entity_id,site]);return true;}
 },Life);
 return {care,state,writes,moves,work,adultPlace,adultQueue,childSample,childQueue,
  queued:fn=>{queuedOf=fn;},
  run:minute=>care.run(child,group,minute,1,childSample),
  reserved:()=>care.reserved(adult,group)};
}

test('native milk action uses the available same-household caregiver and waits for a measured result',async t=>{
 let now=100000;
 t.mock.method(Date,'now',()=>now);
 const h=fixture('Infant',{Hunger:0,Sleep:70},[
  {interaction_bag_id:'Co_Infant_GiveMilk_Talk',enabled:true},
  {interaction_bag_id:'Co_Toddler_GiveMilk_Talk',enabled:true}
 ]);
 await h.run(200);
 assert.deepEqual(h.writes,[{name:'interaction.execute',entity_id:'2',target_entity_id:'1',
  interaction_bag_id:'Co_Infant_GiveMilk_Talk',insert_front:true}]);
 assert.equal(h.reserved(),true);
 now+=10000;
 await h.run(210);
 assert.equal(h.writes.length,1);
 h.childSample.stats.stats.Hunger.pct=63;
 now+=10000;
 await h.run(220);
 assert.equal(h.reserved(),false);
 assert.equal(h.state.people['1'].childCare.lastResult.after,63);
});

test('a child dangerously hungry at home brings back an available guardian without interrupting a shift',async t=>{
 let now=100000;
 t.mock.method(Date,'now',()=>now);
 const h=fixture('Toddler',{Hunger:4,Sleep:70},[]);
 h.adultPlace.locatedSiteId={value:85};
 h.work.is_at_work=true;
 await h.run(200);
 assert.deepEqual(h.moves,[]);
 now+=10000;
 h.work.is_at_work=false;
 await h.run(215);
 assert.deepEqual(h.moves,[[2,42]]);
 assert.equal(h.writes.length,0);
});

test('toddler sleep uses the native age-specific nap and recognises the resulting sleep action',async t=>{
 let now=100000;
 t.mock.method(Date,'now',()=>now);
 const h=fixture('Toddler',{Hunger:70,Sleep:16},[
  {interaction_bag_id:'Co_Toddler_Lull_Talk',enabled:false}
 ]);
 await h.run(100);
 assert.equal(h.writes[0].interaction_bag_id,'Self_Toddler_Sleep');
 assert.equal(h.writes[0].entity_id,'1');
 h.childQueue.current={interaction_bag_id:'Self_Toddler_Sleep',target_entity_id:1};
 now+=10000;
 await h.run(112);
 assert.equal(h.writes.length,1);
 assert.equal(h.state.people['1'].childCare.lastResult.asleep,true);
});

test('care still queued behind the caregiver\'s own action keeps its reservation; no second request is made',async t=>{
 let now=100000, queued=[{bag:'Co_Infant_GiveMilk_Talk',target:'1'}];
 t.mock.method(Date,'now',()=>now);
 const h=fixture('Infant',{Hunger:35,Sleep:70},[{interaction_bag_id:'Co_Infant_GiveMilk_Talk',enabled:true}]);
 await h.run(200);
 const first=h.writes.length;
 assert.ok(first>=1);
 // The caregiver keeps painting; the milk request waits in the queue and hunger has not moved.
 h.adultQueue.queue_count=1;h.adultQueue.current={interaction_bag_id:'Art_Easel_Drawing',target_entity_id:99};
 h.queued(()=>queued);
 now+=30000;
 await h.run(230);
 assert.equal(h.writes.length,first,'no repeated care request while the first is queued');
 assert.equal(h.reserved(),true);
 // Once it is no longer queued and nothing changed, the result is unknown and care is looked at again.
 queued=[];
 now+=30000;
 await h.run(240);
 assert.equal(h.reserved(),false);
});
