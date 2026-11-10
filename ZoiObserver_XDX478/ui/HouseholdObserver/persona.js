(function(root){
 'use strict';
 // 0.5.7: no two Zois keep the same day. Temperament, ambition and a fixed personal leaning shift how much
 // each free-time activity matters to this individual. Needs, safety and trips already under way are untouched.
 var LEAN={
  Extrovert:{social:12,gather:14,event:8,outing:6},Popular:{social:10,gather:12,event:6},Entertainer:{social:8,gather:10,event:10},
  Flirt:{social:10,gather:6},Romantic:{social:8,gather:4,outing:4},Leader:{career:8,ambition:6,social:4},
  Introvert:{social:-10,gather:-14,event:-8,side:6,hope:4},Independent:{side:8,career:4,gather:-4},Observer:{outing:6,social:-4},
  Workaholic:{career:12,side:10,ambition:8,vacation:-12,outing:-8},Achiever:{ambition:12,career:8,hope:4},Ambitious:{ambition:12,career:8},
  Perfectionist:{clean:8,ambition:6,furnish:4},CleanFreak:{clean:14,furnish:4},Helper:{clean:6,social:6,gather:4},
  Cooperator:{social:6,gather:6},Adventurer:{outing:14,vacation:12,event:8,clean:-4},Active:{outing:10,event:4},Energetic:{outing:8,hope:4},
  Artist:{side:10,hope:6,career:-4},Bookworm:{hope:6,side:6,outing:-6,gather:-4},Intellect:{ambition:6,side:4},Genius:{ambition:8,side:6},
  'Risk-averse':{vacation:-6,outing:-4,career:4,furnish:4},Faithful:{social:4,career:4}
 };
 var KEYS=['social','gather','event','outing','vacation','hope','ambition','career','side','clean','furnish'];
 function hash(id,salt){
  var text=String(id)+':'+salt, h=2166136261;
  for(var i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
  return (h%1000)/999;
 }
 function clamp(v){return Math.max(-18,Math.min(18,Math.round(v)));}
 // focus: ObserverCareerPath.ambitionFocus(ambition)
 function weights(traits,focus,id){
  var w={};
  KEYS.forEach(function(k){w[k]=(hash(id,k)-0.5)*10;});
  (traits||[]).forEach(function(t){var lean=LEAN[t];if(lean)Object.keys(lean).forEach(function(k){w[k]+=lean[k];});});
  if(focus){
   if(focus.wealth){w.side+=6;w.career+=6;}
   if(focus.career){w.career+=8;w.ambition+=4;}
   if(focus.creative){w.side+=6;w.hope+=4;}
  }
  KEYS.forEach(function(k){w[k]=clamp(w[k]);});
  return w;
 }
 function apply(tasks,w){
  if(!w)return tasks;
  tasks.forEach(function(task){if(Number.isFinite(w[task.key]))task.base+=w[task.key];});
  return tasks;
 }
 var LABEL={social:'대화',gather:'초대·파티',event:'행사',outing:'외출',vacation:'휴가',hope:'소망',ambition:'야망',career:'직장',side:'개인 작업',clean:'집 정돈',furnish:'집 꾸미기'};
 // Two or three words for the window: what this Zoi leans toward and away from.
 function describe(w){
  if(!w)return null;
  var order=KEYS.slice().sort(function(a,b){return w[b]-w[a];});
  var likes=order.filter(function(k){return w[k]>=5;}).slice(0,3).map(function(k){return LABEL[k];});
  var avoids=order.reverse().filter(function(k){return w[k]<=-5;}).slice(0,2).map(function(k){return LABEL[k];});
  if(!likes.length&&!avoids.length)return '고른 생활';
  return (likes.length?likes.join('·')+' 중시':'')+(likes.length&&avoids.length?' / ':'')+(avoids.length?avoids.join('·')+' 덜 함':'');
 }
 var api={weights:weights,apply:apply,describe:describe,KEYS:KEYS};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.ObserverPersona=api;
})(this);
