(function(root){
 'use strict';
 // 0.5.8: every family member is managed even when the player is not watching.
 // Most commands work for any Zoi. A few things the game only allows for the selected Zoi (turning personal
 // autonomy on, the phone shop, looking at the objects around it in a place nobody has seen yet). When an
 // unselected family member is waiting on one of those, the selection moves to that Zoi for a while.
 var DWELL=90, RETRY=120, REST=1440;
 function book(state){return state.rotation||(state.rotation={on:true,last:-DWELL,fails:0,blockedUntil:0});}
 // info: {selected, autonomyOff, urgent, replies, blind, away, dependent}
 function wants(info){
  if(info.selected||info.away||info.dependent)return null;
  var why=info.autonomyOff?'자율 행동 켜기':info.urgent?'긴급 욕구 해결':info.blind?'주변 물건 확인':info.replies?'휴대폰 답장':null;
  return why;
 }
 function note(decision,why,minute){
  if(!why){decision.wants=null;return;}
  if(!decision.wants||decision.wants.since>minute)decision.wants={why:why,since:minute};
  else decision.wants.why=why;
 }
 // Who the selection should move to now, or null.
 function choose(state,members,selectedId,minute,busy){
  var r=book(state);
  if(r.last>minute){r.last=minute-DWELL;r.blockedUntil=0;}
  if(!r.on||busy||minute<r.blockedUntil||minute-r.last<DWELL)return null;
  var waiting=members.filter(function(m){
   var p=state.people[String(m.entity_id)];
   return String(m.entity_id)!==String(selectedId)&&p&&p.wants&&p.wants.since<=minute;
  }).sort(function(a,b){
   var pa=state.people[String(a.entity_id)].wants, pb=state.people[String(b.entity_id)].wants;
   return (pb.why==='긴급 욕구 해결')-(pa.why==='긴급 욕구 해결')||pa.since-pb.since;
  });
  return waiting.length?String(waiting[0].entity_id):null;
 }
 function moved(state,minute){var r=book(state);r.last=minute;r.fails=0;}
 function failed(state,minute){
  var r=book(state);
  r.fails++;r.last=minute;
  r.blockedUntil=minute+(r.fails>=2?REST:RETRY);
  return r.fails>=2;
 }
 var api={book:book,wants:wants,note:note,choose:choose,moved:moved,failed:failed,DWELL:DWELL};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.ObserverRotation=api;
})(this);
