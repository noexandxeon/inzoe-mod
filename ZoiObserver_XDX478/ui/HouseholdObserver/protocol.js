(function (root) {
 'use strict';

 function decode(value) {
  for (var depth = 0; depth < 8; depth++) {
   if (value && (value.success === false || value.isError)) {
    throw Error(value.message || JSON.stringify(value));
   }
   if (value && value.structuredContent) {
    value = value.structuredContent;
   } else if (value && Array.isArray(value.content)) {
    value = value.content.filter(function (item) { return item.type === 'text'; })
     .map(function (item) { return item.text; }).join('\n');
   } else if (value && value.data != null) {
    value = value.data;
   } else if (value && value.success === true && typeof value.message === 'string') {
    value = value.message;
   } else if (typeof value === 'string') {
    // This build sometimes emits \\' inside a JSON string.
    var json = value.replace(/(^|[^\\])((?:\\\\)*)\\'/g, "$1$2'");
    try { value = JSON.parse(json); }
    catch (_) {
     // CLI help can prefix the JSON with a human-readable usage block.
     var start = json.search(/\n[\[{]/);
     if (start < 0) return value;
     try { value = JSON.parse(json.slice(start)); }
     catch (_) { return value; }
    }
   } else {
    return value;
   }
  }
  throw Error('게임 응답이 너무 많이 중첩되어 있습니다.');
 }

 function popupChoice(popup, row, allowed) {
  if (!popup || allowed.indexOf(popup.popup_id) < 0 || !row) return null;
  var definitions = row.buttonDetail || [];
  var candidates = (popup.buttons || []).filter(function (button) {
   return button.dimmed === false && button.list_key && definitions.some(function (definition) {
    return definition.listKey === button.list_key && definition.buttonType === 'Primary';
   });
  });
  return candidates.length === 1 ? candidates[0] : null;
 }

 function popupArgs(popup,button) {
  if (!popup || !button) return null;
  var args={};
  if (button.list_key && button.list_key !== 'None') args.list_key=button.list_key;
  else if (popup.buttons.length===1 && Number.isInteger(button.index) && button.index>=0) args.Index=button.index;
  else return null;
  if (popup.popup_id && popup.popup_id !== 'None') args.popup_id=popup.popup_id;
  return args;
 }

 function commuteBag(row, slot) {
  var organization = (row.organizations || []).filter(function (item) {
   return item.jobId === slot.jobDtId;
  })[0];
  var bag = organization && organization.rabbitholeEnterInteractionBagId;
  return bag && bag !== 'None' ? bag : null;
 }

 function backgroundInputAllowed(name, args) {
  args = args || {};
  var hasRef = typeof args.ref === 'string' && args.ref.trim().length > 0;
  if (name === 'ui.click') return hasRef && args.Force === true && args.force === undefined &&
   args.X == null && args.Y == null && args.x == null && args.y == null;
  if (name === 'ui.scroll') return hasRef && args.Wheel === undefined && (args.wheel === undefined || args.wheel === false);
  if (/^(?:input\.|mouse\.|keyboard\.|uimod\.focus$|character\.possess$|entity\.possess$)/i.test(name)) return false;
  if (/^ui\./i.test(name)) return ['ui.find','ui.get_node','ui.get_tree','ui.list_windows','ui.get_blocking','ui.click_popup_button'].indexOf(name) >= 0;
  return true;
 }

 var api = {decode: decode, popupChoice: popupChoice, popupArgs:popupArgs, commuteBag: commuteBag, backgroundInputAllowed: backgroundInputAllowed};
 if (typeof module !== 'undefined' && module.exports) module.exports = api;
 else root.ObserverProtocol = api;
})(this);
