// A deterministic, UI-independent 108-tile Sichuan practice rules engine.
export const SUITS = ['万', '筒', '条'];
export const tileName = t => t<0?'暗牌':`${['一','二','三','四','五','六','七','八','九'][t % 9]}${SUITS[Math.floor(t / 9)]}`;
export const suitOf = t => Math.floor(t / 9);
const sorted = a => a.sort((a,b)=>a-b);
const counts = hand => {const c=Array(27).fill(0);for(const t of hand)c[t]++;return c;};
function meldable(c, tripletsOnly=false,terminalsOnly=false) {
  const i=c.findIndex(n=>n>0);
  if(i<0)return true;
  if(c[i]>=3&&(!terminalsOnly||i%9===0||i%9===8)){c[i]-=3;if(meldable(c,tripletsOnly,terminalsOnly)){c[i]+=3;return true;}c[i]+=3;}
  if(!tripletsOnly&&i%9<=6&&c[i+1]&&c[i+2]&&(!terminalsOnly||i%9===0||i%9===6)){
    c[i]--;c[i+1]--;c[i+2]--;
    const ok=meldable(c,tripletsOnly,terminalsOnly);c[i]++;c[i+1]++;c[i+2]++;
    if(ok)return true;
  }
  return false;
}
export function isWinning(hand, melds=[], que=-1) {
  if(hand.length!==14-melds.length*3||hand.some(t=>suitOf(t)===que))return false;
  if(counts([...hand,...melds.flatMap(m=>m.tiles)]).some(n=>n>4))return false;
  const c=counts(hand);
  if(!melds.length&&c.every(n=>n%2===0))return true;
  for(let i=0;i<27;i++)if(c[i]>=2){c[i]-=2;const ok=meldable(c);c[i]+=2;if(ok)return true;}
  return false;
}
export function winValue(hand,melds=[],selfDraw=false,base=100) {
  const c=counts(hand), labels=[],all=[...hand,...melds.flatMap(m=>m.tiles)];let fan=0;
  const pairs=!melds.length&&c.every(n=>n%2===0);
  const jiang=all.every(t=>[1,4,7].includes(t%9)),roots=counts(all).filter(n=>n===4).length;
  if(pairs){
    fan=jiang?4:2;fan+=roots;
    labels.push(jiang?'将七对':roots===0?'七对':roots===1?'龙七对':roots===2?'双龙七对':'三龙七对');
    if(jiang&&roots)labels.push(`龙根×${roots}`);
  }else{
    let triplets=false,terminals=false;
    for(let i=0;i<27;i++)if(c[i]>=2){
      c[i]-=2;if(meldable(c,true))triplets=true;
      if((i%9===0||i%9===8)&&meldable(c,false,true)&&melds.every(m=>m.tiles.every(t=>t%9===0||t%9===8)))terminals=true;
      c[i]+=2;
    }
    if(jiang&&triplets){fan=3;labels.push('将对');}
    else if(terminals){fan=2;labels.push('带幺九');}
    else if(triplets){fan=1;labels.push('碰碰胡');}
    if(melds.length===4){fan++;labels.push('金钩钓');}
    if(!labels.length)labels.push('平胡');
    if(roots){fan+=roots;labels.push(`根×${roots}`);}
  }
  if(new Set(all.map(suitOf)).size===1){fan+=2;if(labels[0]==='平胡')labels.shift();labels.push('清一色');}
  if(!labels.length)labels.push('平胡');
  if(selfDraw){fan++;labels.push('自摸');}
  return {fan:Math.min(fan,5),rawFan:fan,labels,value:base*2**Math.min(fan,5)};
}
export function bestDiscard(player,difficulty='normal') {
  const hand=player.hand, c=counts(hand);
  const missing=hand.filter(t=>suitOf(t)===player.que);
  const candidates=[...new Set(missing.length?missing:hand)];
  let best=candidates[0], bestScore=-Infinity;
  for(const t of candidates){
    c[t]--;
    // Keep complete sets, pairs and connected tiles. A legal winning hand wins immediately.
    let quality=0;
    for(let i=0;i<27;i++){
      if(difficulty==='easy'){
        if(c[i]>=2)quality+=3;
        if(c[i]&&i%9<8&&c[i+1])quality+=1;
        continue;
      }
      if(c[i]>=3)quality+=10;
      else if(c[i]===2)quality+=5;
      if(c[i]&&i%9<8&&c[i+1])quality+=3;
      if(c[i]&&i%9<7&&c[i+2])quality+=1.5;
    }
    if(difficulty==='smart'&&!missing.length){
      let outs=0;for(let d=0;d<27;d++)if(suitOf(d)!==player.que&&c[d]<4&&isWinning([...hand.filter((_,i)=>i!==hand.indexOf(t)),d],player.melds,player.que))outs+=4-c[d];
      quality+=outs*12;
    }
    quality+=Math.abs(t%9-4)*0.03;
    if(quality>bestScore){bestScore=quality;best=t;}
    c[t]++;
  }
  return best;
}
function log(g,text,type='turn',player=null,tile=null){g.events.unshift({seq:++g.sequence,text,type,player,tile});g.events=g.events.slice(0,60);}
export function createGame({rng=Math.random,difficulty='normal',base=100,room='休闲练习场',humanSeats=[0]}={}) {
  const wall=Array.from({length:108},(_,i)=>Math.floor(i/4));
  for(let i=107;i>0;i--){const j=Math.floor(rng()*(i+1));[wall[i],wall[j]]=[wall[j],wall[i]];}
  const players=['你','小满','阿川','米粒'].map((name,i)=>({id:i,name,hand:[],melds:[],discards:[],que:-1,score:0,win:null}));
  for(let round=0;round<13;round++)for(const p of players)p.hand.push(wall.pop());
  players[0].hand.push(wall.pop());players.forEach(p=>sorted(p.hand));
  const g={version:2,id:globalThis.crypto?.randomUUID?.()||String(Date.now())+rng(),humanSeats:[...humanSeats],players,wall,current:0,phase:'exchange',exchangeDirection:1+Math.floor(rng()*3),exchangeSelection:[],exchangeChoices:{},pending:null,lastDiscard:null,lastDraw:null,turn:1,sequence:0,events:[],ledger:[],settlements:[],winners:[],difficulty,base,room,startedAt:Date.now(),endedAt:null,reason:null};
  log(g,'牌已发好，请选三张同花色的牌交换','system');return g;
}
export function chooseExchangeIndices(p){
  const suits=[0,1,2].map(s=>({s,tiles:p.hand.map((t,i)=>({t,i})).filter(x=>suitOf(x.t)===s)})).filter(x=>x.tiles.length>=3).sort((a,b)=>a.tiles.length-b.tiles.length);
  return suits[0].tiles.slice(-3).map(x=>x.i);
}
export function exchangeTiles(g,indices,id=0){
  const humans=g.humanSeats||[0],p=g.players[id];
  if(!p||!humans.includes(id)||g.phase!=='exchange'||!Array.isArray(indices)||indices.length!==3||new Set(indices).size!==3||indices.some(i=>!Number.isInteger(i)||i<0||i>=p.hand.length))return false;
  if(new Set(indices.map(i=>suitOf(p.hand[i]))).size!==1)return false;
  g.exchangeChoices??={};if(g.exchangeChoices[id])return false;
  g.exchangeChoices[id]=[...indices];
  if(!humans.every(i=>g.exchangeChoices[i]))return true;
  const selections=g.players.map((p,i)=>humans.includes(i)?g.exchangeChoices[i]:chooseExchangeIndices(p));
  const outgoing=g.players.map((p,i)=>selections[i].map(at=>p.hand[at]));
  for(const p of g.players){for(const at of [...selections[p.id]].sort((a,b)=>b-a))p.hand.splice(at,1);}
  for(const p of g.players){p.hand.push(...outgoing[(p.id-g.exchangeDirection+4)%4]);sorted(p.hand);}
  g.exchangeReceivedBySeat=g.players.map(p=>outgoing[(p.id-g.exchangeDirection+4)%4]);
  g.exchangeReceived=g.exchangeReceivedBySeat[0];g.exchangeSelection=[];
  for(const p of g.players.filter(p=>!humans.includes(p.id)))p.que=[0,1,2].sort((a,b)=>p.hand.filter(t=>suitOf(t)===a).length-p.hand.filter(t=>suitOf(t)===b).length)[0];
  g.phase='que';log(g,`换三张完成 · ${['','换给下家','对家互换','换给上家'][g.exchangeDirection]}`,'system');return true;
}
export function chooseQue(g,suit,id=0) {
  if(g.phase!=='que'||!(g.humanSeats||[0]).includes(id)||g.players[id].que>=0||![0,1,2].includes(suit))return false;
  g.players[id].que=suit;
  if((g.humanSeats||[0]).every(i=>g.players[i].que>=0)){
    g.phase='discard';log(g,'定缺完成，请先打完缺门牌','system');
  }
  return true;
}
export function legalDiscards(g,id=g.current) {
  const p=g.players[id],q=p.hand.filter(t=>suitOf(t)===p.que);
  return [...new Set(q.length?q:p.hand)];
}
function remove(p,t,n=1){for(let i=0;i<n;i++){const at=p.hand.indexOf(t);if(at<0)throw Error('Tile missing');p.hand.splice(at,1);}}
function finish(g,reason){if(reason==='wall')settleDraw(g);g.phase='finished';g.pending=null;g.reason=reason;g.endedAt=Date.now();log(g,reason==='three'?'三家胡牌，本局结束':'牌墙摸尽，已完成查大叫结算','system');}
function nextActive(g,from){for(let n=1;n<=4;n++){const i=(from+n)%4;if(!g.players[i].win)return i;}return -1;}
function draw(g,id) {
  if(g.winners.length>=3){finish(g,'three');return;}
  if(!g.wall.length){finish(g,'wall');return;}
  g.current=id;g.pending=null;g.phase='discard';g.turn++;
  const t=g.wall.pop();g.players[id].hand.push(t);sorted(g.players[id].hand);g.lastDraw=t;
  log(g,`${g.players[id].name}摸牌`,'draw',id);
}
function pay(g,from,to,amount,kind='win'){g.players[from].score-=amount;g.players[to].score+=amount;g.ledger.push({from,to,amount,kind});}
export function settleDraw(g){
  if(g.drawSettled)return;g.drawSettled=true;
  const active=g.players.filter(p=>!p.win),pigs=active.filter(p=>p.hand.some(t=>suitOf(t)===p.que));
  const nonPig=active.filter(p=>!pigs.includes(p));
  const ready=nonPig.map(p=>({p,waits:waitingTiles(p)})).filter(x=>x.waits.length);
  const unready=nonPig.filter(p=>!ready.some(r=>r.p===p));
  const refundIds=new Set([...pigs,...unready].map(p=>p.id));
  for(const entry of [...g.ledger])if(entry.kind==='kong'&&refundIds.has(entry.to)){
    pay(g,entry.to,entry.from,entry.amount,'refund');
    g.settlements.push({type:'杠分退税',from:entry.to,to:entry.from,amount:entry.amount});
  }
  for(const p of pigs)for(const q of g.players)if(!pigs.includes(q)){
    const amount=g.base*16;pay(g,p.id,q.id,amount,'pig');g.settlements.push({type:'查花猪',from:p.id,to:q.id,amount});
  }
  for(const {p,waits} of ready){
    const best=waits.map(t=>winValue([...p.hand,t],p.melds,false,g.base)).sort((a,b)=>b.value-a.value)[0];
    for(const q of unready){pay(g,q.id,p.id,best.value,'ready');g.settlements.push({type:'查大叫',from:q.id,to:p.id,amount:best.value,fan:best.fan,labels:best.labels});}
  }
  for(const s of g.settlements)log(g,`${s.type} · ${g.players[s.from].name} → ${g.players[s.to].name} ${s.amount} 分`,'settlement');
  g.readyStatus=active.map(p=>({id:p.id,status:pigs.includes(p)?'花猪':ready.some(r=>r.p===p)?'已听牌':'未听牌'}));
}
function recordWin(g,id,from,tile,selfDraw) {
  const p=g.players[id],hand=selfDraw?p.hand:[...p.hand,tile];
  const val=winValue(hand,p.melds,selfDraw,g.base);let amount=0;
  if(selfDraw){for(const other of g.players)if(other.id!==id&&!other.win){pay(g,other.id,id,val.value);amount+=val.value;}}
  else {pay(g,from,id,val.value);amount=val.value;}
  p.win={...val,selfDraw,from,tile,amount,rank:g.winners.length+1};g.winners.push(id);
  log(g,`${p.name}${selfDraw?'自摸':'胡牌'} · ${val.labels.join(' / ')} +${amount}`,'win',id,tile);
}
function resolveWins(g,ids,from,tile) {
  for(const id of ids)recordWin(g,id,from,tile,false);
  g.pending=null;
  if(g.winners.length>=3)finish(g,'three');else draw(g,nextActive(g,from));
}
export function selfWin(g) {
  const p=g.players[g.current];
  if(g.phase!=='discard'||!isWinning(p.hand,p.melds,p.que))return false;
  recordWin(g,g.current,g.current,g.lastDraw,true);
  if(g.winners.length>=3)finish(g,'three');else draw(g,nextActive(g,g.current));return true;
}
export function concealedKongs(g,id=g.current) {
  const p=g.players[id];if(g.phase!=='discard'||g.current!==id||!g.wall.length||p.hand.some(t=>suitOf(t)===p.que))return [];
  return counts(p.hand).flatMap((n,t)=>n===4?[t]:[]);
}
export function concealedKong(g,tile) {
  if(!concealedKongs(g).includes(tile))return false;
  const p=g.players[g.current];remove(p,tile,4);p.melds.push({kind:'concealed',tiles:Array(4).fill(tile),from:p.id});
  for(const other of g.players)if(other.id!==p.id&&!other.win)pay(g,other.id,p.id,g.base*2,'kong');
  log(g,`${p.name}暗杠${tileName(tile)}`,'kong',p.id,tile);draw(g,p.id);return true;
}
function claimMeld(g,id,kind) {
  const {from,tile}=g.pending,p=g.players[id];
  g.players[from].discards.pop();remove(p,tile,kind==='kong'?3:2);
  p.melds.push({kind,tiles:Array(kind==='kong'?4:3).fill(tile),from});
  g.current=id;g.pending=null;g.lastDraw=null;
  log(g,`${p.name}${kind==='kong'?'杠':'碰'}${tileName(tile)}`,kind,id,tile);
  if(kind==='kong'){pay(g,from,id,g.base*2,'kong');draw(g,id);}else g.phase='discard';
}
function processMelds(g,from,tile,skipped=[]) {
  for(let offset=1;offset<=3;offset++){
    const id=(from+offset)%4,p=g.players[id];
    if(p.win||suitOf(tile)===p.que||p.hand.some(t=>suitOf(t)===p.que))continue;
    const n=p.hand.filter(t=>t===tile).length;
    if(n<2||skipped.includes(id))continue;
    const options=['pong',...(n>=3&&g.wall.length?['kong']:[])];
    g.pending={kind:'meld',from,tile,options,actor:id,skipped};
    if((g.humanSeats||[0]).includes(id)){g.phase='claim';return;}
    claimMeld(g,id,options.includes('kong')?'kong':'pong');return;
  }
  g.pending=null;draw(g,nextActive(g,from));
}
export function discard(g,tile,actor=g.current) {
  if(g.phase!=='discard'||actor!==g.current||!legalDiscards(g).includes(tile))return false;
  const from=g.current,p=g.players[from];remove(p,tile);p.discards.push(tile);
  g.lastDiscard={from,tile,turn:g.turn};g.lastDraw=null;
  log(g,`${p.name}打出${tileName(tile)}`,'discard',from,tile);
  const wins=[];
  for(let offset=1;offset<=3;offset++){const id=(from+offset)%4,q=g.players[id];if(!q.win&&isWinning([...q.hand,tile],q.melds,q.que))wins.push(id);}
  const humans=wins.filter(i=>(g.humanSeats||[0]).includes(i));
  if(humans.length){g.phase='claim';g.pending={kind:'win',from,tile,options:['hu'],wins,answers:{},actor:humans[0]};}
  else if(wins.length)resolveWins(g,wins,from,tile);
  else processMelds(g,from,tile);
  return true;
}
export function respond(g,action,id=g.pending?.actor??0) {
  if(g.phase!=='claim'||(action!=='pass'&&!g.pending.options.includes(action)))return false;
  const p=g.pending;
  if(p.kind==='win'){
    const humans=p.wins.filter(i=>(g.humanSeats||[0]).includes(i));
    p.answers??={};if(!humans.includes(id)||p.answers[id]!==undefined)return false;
    p.answers[id]=action==='hu';
    const waiting=humans.filter(i=>p.answers[i]===undefined);
    if(waiting.length){p.actor=waiting[0];return true;}
    const wins=p.wins.filter(i=>!humans.includes(i)||p.answers[i]);
    if(wins.length)resolveWins(g,wins,p.from,p.tile);
    else processMelds(g,p.from,p.tile,humans);
  }else{
    if(id!==(p.actor??0))return false;
    if(action==='pass')processMelds(g,p.from,p.tile,[...(p.skipped||[]),id]);
    else claimMeld(g,id,action);
  }
  return true;
}
export function step(g) {
  if(g.phase!=='discard'||(g.humanSeats||[0]).includes(g.current))return false;
  if(selfWin(g))return true;
  const kongs=concealedKongs(g);if(kongs.length)return concealedKong(g,kongs[0]);
  return discard(g,bestDiscard(g.players[g.current],g.difficulty));
}
export function waitingTiles(player) {
  if(player.hand.length!==13-player.melds.length*3)return [];
  return Array.from({length:27},(_,i)=>i).filter(t=>isWinning([...player.hand,t],player.melds,player.que));
}
