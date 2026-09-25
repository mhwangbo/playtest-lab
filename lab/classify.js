/*
 * classify.js — free, local, keyword-based feedback classifier (default engine).
 * Swap in a model-based classifier here for multilingual or calibrated results.
 */
'use strict';

const RULES = [
  ['crash', /\b(crash|froze|freeze|hang|stuck forever|white screen|exception|error in console)\b/i],
  ['softlock', /\b(soft ?lock|can'?t (continue|progress|restart)|no way to)\b/i],
  ['bug', /\b(bug|broken|glitch|wrong|doesn'?t work|not working|clips?|overlap(s|ping)? (text|ui))\b/i],
  ['perf', /\b(lag|laggy|stutter|fps|slow(down)?|jank)\b/i],
  ['audio', /\b(audio|sound|music|sfx|volume|loud|quiet|mute)\b/i],
  ['accessibility', /\b(colou?r ?blind|contrast|hard to read|tiny text|font size|readab)/i],
  ['clarity', /\b(confus|unclear|didn'?t (know|understand|get)|no idea|what (does|do|is)|can'?t tell|hard to tell|tutorial)\b/i],
  ['balance', /\b(too (hard|easy|many|few|fast|slow|long|short)|unfair|difficult|difficulty|grind|punish)\b/i],
  ['ux', /\b(button|menu|control|input|touch|click|tap|ui|hud)\b/i],
  ['feel', /\b(fun|boring|satisf|juic|feel|feels|relax|tense|beautiful|love|hate|annoy)\b/i],
];
const NEG = /\b(not|no|never|hate|annoy|frustrat|confus|boring|unfair|hard|broken|bad|worse|ugly|stuck|can'?t|too)\b/gi;
const POS = /\b(love|like|fun|great|nice|satisf|beautiful|clear|good|enjoy|cool|calm|relax)\b/gi;

function classifyText(text) {
  const t = String(text || '');
  const hit = RULES.find(([, re]) => re.test(t));
  const neg = (t.match(NEG) || []).length; const pos = (t.match(POS) || []).length;
  return { category: hit ? hit[0] : 'other', sentiment: neg > pos ? 'negative' : pos > neg ? 'positive' : 'neutral' };
}

module.exports = { classifyText };
