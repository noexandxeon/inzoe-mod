(function(root){
 'use strict';
 // 0.6.0 (4) The family as one household instead of separate individuals.
 //  - claims: two members are not sent to the same object at the same time (in game the second request
 //    only waits behind the first or fails as "in use").
 //  - fairness: whoever has completed fewer hopes today than the rest gets the next turn at hopes.
 //  - one host: only one member invites guests or holds a party at a time.
 var TTL=90000;
 function create(clock){
  var now=clock||function(){return Date.now();}, claims={};
  function holder(target){
   var c=claims[String(target)];
   if(c&&now()>=c.until){delete claims[String(target)];c=null;}
   return c?c.by:null;
  }
  function free(target,actor){var by=holder(target);return !by||by===String(actor);}
  function claim(target,actor){
   if(String(target)===String(actor))return true;
   if(!free(target,actor))return false;
   claims[String(target)]={by:String(actor),until:now()+TTL};
   return true;
  }
  function release(actor){Object.keys(claims).forEach(function(k){if(claims[k].by===String(actor))delete claims[k];});}
  return {free:free,claim:claim,release:release,holder:holder,reset:function(){claims={};}};
 }
 // completed: {id: hopes completed today}. Bonus for the hope task of this member, 0..15.
 function fairness(completed,id,target){
  var ids=Object.keys(completed);
  if(ids.length<2)return 0;
  var mine=completed[String(id)]||0;
  var others=ids.filter(function(k){return k!==String(id);});
  var average=others.reduce(function(sum,k){return sum+(completed[k]||0);},0)/others.length;
  var behind=average-mine;
  if(behind<=0)return mine>=target&&others.some(function(k){return (completed[k]||0)<target;})?-6:0;
  return Math.min(15,Math.round(behind*5));
 }
 // True when another member of the same household is already waiting for or receiving guests.
 function hostBusy(people,members,member){
  return members.some(function(m){
   if(String(m.entity_id)===String(member.entity_id)||m.household_id!==member.household_id)return false;
   var g=people[String(m.entity_id)]&&people[String(m.entity_id)].gather;
   return !!(g&&(g.pending||g.hosting));
  });
 }
 var api={create:create,fairness:fairness,hostBusy:hostBusy,TTL:TTL};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.ObserverFamily=api;
})(this);
