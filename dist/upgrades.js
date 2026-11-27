import {tileName,SUITS,discardWaits} from './engine.js';

export const modeName=rules=>rules?.mode==='flow'?'血流成河':'血战到底';
export const rulesLabel=rules=>[
  modeName(rules),rules?.exchange===false?'直接定缺':'换三张',
  `${rules?.cap??5} 番封顶`,rules?.selfDraw==='base'?'自摸加底':'自摸加番',
  rules?.kong==='light'?'杠分 1/1/1':'杠分 2/2/1'
].join(' · ');
const select=(id,label,options)=>`<label class="online-label">${label}<select id="${id}" class="select-control">${options.map(([value,text])=>`<option value="${value}">${text}</option>`).join('')}</select></label>`;
export function roomOptions(){
  return `<div class="room-options">${select('room-mode','玩法',[['battle','血战到底'],['flow','血流成河']])}
  ${select('room-rounds','局数',[[4,'4 局'],[1,'1 局'],[8,'8 局']])}</div>
  <details class="room-settings"><summary>更多房规</summary><div class="room-options">
  ${select('room-exchange','开局',[['yes','换三张'],['no','直接定缺']])}
  ${select('room-cap','封顶',[[5,'5 番'],[4,'4 番'],[3,'3 番']])}
  ${select('room-self-draw','自摸',[['fan','加一番'],['base','加一份底分']])}
  ${select('room-kong','杠分（暗／直／补）',[['classic','2／2／1'],['light','1／1／1']])}
  </div></details>`;
}
export function getRoomOptions(){
  const value=id=>document.getElementById(id)?.value;
  return {rounds:Number(value('room-rounds'))||4,rules:{mode:value('room-mode'),cap:Number(value('room-cap')),
    exchange:value('room-exchange')!=='no',selfDraw:value('room-self-draw'),kong:value('room-kong')}};
}
export function tableGuide(rules){
  const opening=rules?.exchange===false?'开局直接定缺。':'选三张同花色的牌换出去，再选择定缺。';
  const finish=rules?.mode==='flow'
    ?'首次胡牌后手牌锁定，只能打出新摸的牌。可以多次胡牌，直到牌墙摸尽。'
    :'胡牌后观战。三家胡牌或牌墙摸尽时结算。';
  return `<h2>本桌规则</h2><p>${rulesLabel(rules)}</p><ul class="inline-rules">
    <li>${opening}缺门牌打完后才能碰、杠、胡。</li>
    <li>可碰、直杠、暗杠和补杠。补杠时其他玩家可以抢杠胡。</li>
    <li>${finish}流局查大叫、查花猪和退还符合条件的杠分。</li>
    <li>同一张牌点两次可打出，出牌限 25 秒。</li></ul>
    <div class="modal-actions"><button class="primary-button" data-action="close-modal">返回牌桌</button></div>`;
}
export function waitsPanel(game,tile){
  const waits=discardWaits(game);
  if(!waits.length)return '<h2>听牌提示</h2><p>当前没有打出一张就能听牌的选择。</p>';
  waits.sort((a,b)=>b.waits.reduce((n,x)=>n+x.left,0)-a.waits.reduce((n,x)=>n+x.left,0));
  return '<h2>听牌提示</h2><p>剩余张数按你能看到的牌估算。</p>'+waits.map(choice=>
    `<div class="wait-row">${tile(choice.tile)}<span>打出</span><div>${choice.waits.map(w=>`<div>${tile(w.tile)}<small>${w.left} 张</small></div>`).join('')}</div></div>`).join('');
}
export function replayPanel(replay,index,esc,tile){
  const frame=replay.frames[index];
  if(!frame)return '<h2>暂无牌谱</h2><p>旧版本的战绩只保留了比分。</p>';
  const last=replay.frames.length-1;
  const keyStep=(direction)=>{
    for(let i=index+direction;i>=0&&i<=last;i+=direction)if(['win','settlement','kong','added','discard'].includes(replay.frames[i].event.type))return i;
    return -1;
  };
  const button=(at,label)=>`<button class="secondary-button" data-replay-step="${at}" ${at<0||at>last?'disabled':''}>${label}</button>`;
  return `<h2>牌谱 · ${index+1} / ${last+1}</h2><p>${esc(frame.event.text)} · 余牌 ${frame.wall}</p>
    <input class="replay-range" id="replay-position" type="range" min="0" max="${last}" value="${index}" aria-label="牌谱回合">
    <div class="replay-controls">${button(0,'开局')}${button(index-1,'上一手')}${button(index+1,'下一手')}${button(keyStep(1),'下个关键动作')}${button(last,'结算')}</div>
    <div class="replay-players">${frame.players.map((p,i)=>`<section class="replay-player">
      <b>${esc(p.name)} · ${p.score} 分${i===frame.current?' · 当前行动':''}${p.que>=0?' · 缺'+SUITS[p.que]:''}</b>
      <div class="replay-tiles">${p.hand.map(t=>tile(t)).join('')}</div>
      ${p.melds.length?`<div class="replay-tiles"><small>副露</small>${p.melds.flat().map(t=>tile(t)).join('')}</div>`:''}
      ${p.river.length?`<div class="replay-tiles replay-river"><small>牌河</small>${p.river.map(t=>tile(t)).join('')}</div>`:''}</section>`).join('')}</div>`;
}
export function roundDetails(game,room,esc,signed){
  const wins=game.wins||[];
  const heading=room?`<p class="round-total">第 ${room.round} / ${room.rounds} 局 · 累计 ${signed(room.totals[0])} 分</p>`:'';
  const totals=room?`<div class="score-lines">${room.seats.map((p,i)=>p?`<span>${esc(p.name)} <b>${signed(room.totals[i])}</b></span>`:'').join('')}</div>`:'';
  const winList=wins.map(w=>`<div class="settlement-line"><span>${esc(game.players[w.id].name)} · ${w.selfDraw?'自摸':esc(game.players[w.from].name)+(w.labels.includes('抢杠胡')?'被抢杠':'点炮')} ${w.tile==null?'':tileName(w.tile)} · ${w.fan} 番 · ${esc(w.labels.join('、'))}</span><b>+${w.amount}</b></div>`).join('');
  const ledger=(game.ledger||[]).filter(e=>['win','kong'].includes(e.kind)).map(e=>`<div class="settlement-line"><span>${esc(game.players[e.from].name)} → ${esc(game.players[e.to].name)} · ${e.kind==='kong'?'杠分':'胡牌'}</span><b>${e.amount}</b></div>`).join('');
  return heading+totals+(winList||ledger?`<details class="settlement-details"><summary>胡牌与付分明细</summary>${winList}${ledger}</details>`:'');
}
export const rankName=rating=>rating<1000?'青铜':rating<1100?'白银':rating<1250?'黄金':'玉雀';
