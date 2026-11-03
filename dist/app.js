import {SUITS,tileName,suitOf,createGame,chooseQue,chooseExchangeIndices,exchangeTiles,legalDiscards,bestDiscard,discard,respond,step,selfWin,concealedKongs,concealedKong,isWinning} from './engine.js';
import {RoomConnection,backendURL} from './network.js';

const $=s=>document.querySelector(s);
const icons={
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  chart:'<path d="M4 20V10m8 10V4m8 16v-7M2 21h20"/>',
  book:'<path d="M12 5v16m0-16C9 2 5 2 2 4v15c4-2 7-1 10 2 3-3 6-4 10-2V4c-3-2-7-2-10 1Z"/>',
  settings:'<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  back:'<path d="m14 6-6 6 6 6"/>',
  sound:'<path d="m11 4-6 5H2v6h3l6 5V4Zm4 4c3 2 3 6 0 8m3-11c5 4 5 10 0 14"/>',
  mute:'<path d="m11 4-6 5H2v6h3l6 5V4Zm5 5 6 6m0-6-6 6"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 3h.01"/>',
  spark:'<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Zm7 0v4m-2-2h4"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  auto:'<path d="M5 8a8 8 0 0 1 14-2l2 3M3 15l2 3a8 8 0 0 0 14-2M21 3v6h-6M3 21v-6h6"/>',
  sort:'<path d="M3 6h13M3 12h9M3 18h5m10-8v11m-4-4 4 4 4-4"/>',
  trophy:'<path d="M8 3h8v6a4 4 0 0 1-8 0V3Zm0 2H4v3c0 3 2 4 5 4m7-7h4v3c0 3-2 4-5 4m-3 1v6m-5 2h10"/>',
  expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>',
  leaf:'<path d="M20 3C9 2 3 6 4 13c1 7 13 9 16-10ZM4 21 15 9"/>'
};
const icon=(name)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.spark}</svg>`;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Math.round(n).toLocaleString('zh-CN');
const signed=n=>(n>0?'+':'')+fmt(n);
let memory={};let storageAvailable=true;
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem('queyou.'+key))??fallback;}catch{return memory[key]??fallback;}};
const write=(key,value)=>{memory[key]=value;try{if(value===null)localStorage.removeItem('queyou.'+key);else localStorage.setItem('queyou.'+key,JSON.stringify(value));}catch{storageAvailable=false;}};
let settings={name:'悠闲牌友',sound:true,speed:'normal',auto:false,...read('settings',{})};
let records=read('records',[]);if(!Array.isArray(records))records=[];
let stats={games:0,wins:0,best:0,points:10000,...read('stats',{})};
let game=read('game',null);
if(game&&(game.version!==2||!Array.isArray(game.players)||game.players.length!==4||!['exchange','que','claim','discard'].includes(game.phase)))game=null;
let view='lobby',filter='all',selected=null,hinted=null,botTimer=null,turnKey='',deadline=0,modalOpen=false,resultShown=null,toastTimer=null,installPrompt=null,audioCtx=null;
const online=new RoomConnection();
let practiceGame=null,onlineBusy=false,onlineChoice=[],onlineError='';
const rooms=[{id:'easy',name:'新手入门场',short:'入门',tag:'轻松上手',desc:'慢慢熟悉，一起打好第一局。',level:'新手友好',base:100,difficulty:'easy',art:['一','二','三']},{id:'normal',name:'休闲练习场',short:'休闲',tag:'人气之选',desc:'不赶时间，享受每一次摸牌。',level:'自在练习',base:200,difficulty:'normal',art:['發','發','發']},{id:'smart',name:'高手切磋场',short:'进阶',tag:'以牌会友',desc:'多想一步，和高手过过招。',level:'进阶挑战',base:500,difficulty:'smart',art:['九','九','九']}];

function tile(t,classes='',button=false,disabled=false,index=-1){
  if(t<0)return '<span class="tile hidden-tile" aria-label="暗牌"></span>';
  const n=t%9+1,suit=suitOf(t);let face='';
  if(suit===1){
    const positions={1:[5],2:[2,8],3:[1,5,9],4:[1,3,7,9],5:[1,3,5,7,9],6:[1,3,4,6,7,9],7:[1,2,3,4,6,7,9],8:[1,2,3,4,6,7,8,9],9:[1,2,3,4,5,6,7,8,9]}[n];
    face='<span class="pips">'+positions.map(pos=>`<i class="pip ${n===1?'big':''} ${[5,6,7,8,9].includes(n)&&pos%3===2?'red':''}" style="grid-column:${(pos-1)%3+1};grid-row:${Math.floor((pos-1)/3)+1}"></i>`).join('')+'</span>';
  }else face=`<span class="num">${['一','二','三','四','五','六','七','八','九'][n-1]}</span><span class="suit-char">${SUITS[suit]}</span>`;
  const tag=button?'button':'span';
  return `<${tag} class="tile ${suit===2?'bamboo':''} ${classes}" ${button?`data-tile="${t}" data-index="${index}" ${disabled?'disabled':''}`:''} aria-label="${tileName(t)}" ${button?'title="'+tileName(t)+'"':''}>${face}</${tag}>`;
}
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2800);}
function sound(kind='tile'){
  if(!settings.sound)return;
  try{audioCtx??=new (window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();const t=audioCtx.currentTime;
    const notes=kind==='win'?[523,659,784,1047]:kind==='start'?[392,523,659]:[kind==='tile'?680:460];
    notes.forEach((freq,i)=>{const o=audioCtx.createOscillator(),gain=audioCtx.createGain();o.connect(gain);gain.connect(audioCtx.destination);o.type='sine';o.frequency.value=freq;gain.gain.setValueAtTime(.0001,t+i*.1);gain.gain.exponentialRampToValueAtTime(.055,t+i*.1+.008);gain.gain.exponentialRampToValueAtTime(.0001,t+i*.1+.12);o.start(t+i*.1);o.stop(t+i*.1+.15);});
  }catch{/* Audio is an enhancement; the game remains usable without it. */}
}
function persistGame(){if(game&&!game.online&&game.phase!=='finished')write('game',game);}
function renderNav(){
  const items=[['lobby','home','游戏大厅'],['online','auto','好友房'],['records','chart','我的战绩'],['rules','book','玩法指南'],['settings','settings','偏好设置']];
  $('#navigation').innerHTML=items.map(([id,i,name])=>`<button class="nav-item ${view===id||(view==='game'&&id==='lobby')?'active':''}" data-view="${id}" ${view===id?'aria-current="page"':''}>${icon(i)}<span>${name}</span></button>`).join('');
  $('#balance').textContent=fmt(stats.points);$('#profile-name').textContent=settings.name;
  $('#sound-button').innerHTML=icon(settings.sound?'sound':'mute');$('#sound-button').setAttribute('aria-pressed',String(settings.sound));
  $('#page-label').textContent={lobby:'游戏大厅',online:'真人好友房',game:'对局中',records:'我的战绩',rules:'玩法指南',settings:'偏好设置'}[view];
  document.body.classList.toggle('in-game',view==='game');
}
function render(){
  clearTimeout(botTimer);renderNav();
  if(view==='lobby')renderLobby();if(view==='online')renderOnline();if(view==='game')renderGame();if(view==='records')renderRecords();if(view==='rules')renderRules();if(view==='settings')renderSettings();
  if(view==='game')schedule();
}
function renderLobby(){
  const date=new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});
  $('#main').innerHTML=`<div class="welcome-row"><div><div class="eyebrow">YOUR LITTLE MOMENT OF JOY</div><h1>开一桌，放松一下。</h1><p>好久不见，${esc(settings.name)}。好牌与好心情，都在这里。</p></div><div class="date-badge"><span class="sun">☼</span>${date}</div></div>
  ${game&&!game.online&&game.phase!=='finished'?'<div class="resume-banner">有一桌牌正在等你，随时接着玩。<button data-action="resume">继续对局 →</button></div>':''}
  <div class="lobby-top"><section class="hero"><div class="hero-copy"><div class="hero-tag"><span>✳</span> 四川麻将 · 血战到底</div><h2>方寸之间，<br>自有好时光。</h2><p>碰一手默契，摸一份惊喜。<br>和三位智能牌友，一起感受麻将的乐趣。</p><button class="primary-button" data-room="normal">快速开局 ${icon('arrow')}</button><span class="hero-meta">无需等待 · 即开即玩</span></div><div class="hero-art" aria-hidden="true"><div class="orbit"></div><span class="orbit-dot"></span><div class="pedestal"></div><div class="art-tile tile-a"><span class="dots-art"><i></i><i></i><i></i><i></i></span></div><div class="art-tile tile-b"><span class="tile-symbol">發</span></div><div class="art-tile tile-c"><span class="tile-symbol">中</span></div><span class="art-spark">✦</span><span class="art-spark small">✧</span></div></section><aside class="quote-card"><div class="quote-head"><span>今日牌语</span><span>DAILY MOMENT</span></div><h3>人生如牌局，<br>好心态就是好牌。</h3><p>输赢不过一时，<br>开心才是长久之计。</p><div class="quote-bottom"><span class="quote-mark">❝</span><span>慢一点，下一手会更好。</span></div></aside></div>
  <section class="online-banner"><div><span class="eyebrow">BETTER TOGETHER</span><h2>和朋友，碰个面。</h2><p>创建六位码好友房，四人一起打麻将。</p></div><button class="primary-button" data-online="room">${online.room?"返回好友房":"真人联机"} ${icon("arrow")}</button></section><div class="section-heading"><div class="section-title"><h2>选一桌，随心玩</h2><small>总有一桌，合你心意</small></div><div class="filters" role="group" aria-label="房间筛选">${[['all','全部房间'],['casual','休闲'],['smart','进阶']].map(([id,name])=>`<button class="filter ${filter===id?'active':''}" data-filter="${id}" aria-pressed="${filter===id}">${name}</button>`).join('')}</div></div>
  <div class="rooms">${rooms.filter(r=>filter==='all'||(filter==='smart'?r.id==='smart':r.id!=='smart')).map((r)=>`<article class="room-card"><div class="room-art room-art-${rooms.indexOf(r)+1}"><span class="room-tag">${r.tag}</span><span class="room-art-label">${r.short}</span><div class="mini-tiles" aria-hidden="true">${r.art.map(s=>`<span class="mini-tile">${s}</span>`).join('')}</div></div><div class="room-info"><div class="room-title-row"><h3>${r.name}</h3><span>${r.level}</span></div><p>${r.desc}</p><div class="room-bottom"><span class="room-stake"><b>${r.base}</b>底分</span><button class="room-enter" data-room="${r.id}">入座开局 ${icon('arrow')}</button></div></div></article>`).join('')}</div>
  <div class="bottom-grid"><section class="compact-panel"><div class="panel-title">${icon('chart')}我的麻将时光<button data-view="records">查看战绩 ↗</button></div><div class="stats-row"><div class="stat"><b>${stats.games}</b><span>累计对局</span></div><div class="stat"><b>${stats.games?Math.round(stats.wins/stats.games*100):0}<small style="font-size:12px">%</small></b><span>胡牌率</span></div><div class="stat"><b>${fmt(stats.best)}</b><span>单局最高积分</span></div></div></section><section class="compact-panel guide-panel"><div class="guide-badge" aria-hidden="true">胡</div><div class="guide-copy"><h3>第一局？我们陪你慢慢来。</h3><p>认识定缺、碰杠胡，三分钟轻松入门。<br>不用着急，每位高手都是从新手开始。</p></div><button data-view="rules" aria-label="查看玩法指南">${icon('arrow')}</button></section></div>`;
}
function playerPanel(p,pos){const seat=game.online?online.room?.seats[p.id]:null;return `<div class="player player-${pos} ${game.current===p.id&&game.phase==='discard'?'active':''}"><span class="avatar ${p.id===0?'avatar-me':'avatar-'+p.id}">${game.online?esc(p.name.slice(0,1)):p.id===0?esc(settings.name.slice(0,1)):['','满','川','米'][p.id]}</span><div class="player-info"><strong>${p.id===0?'你':esc(p.name)}${p.id===0&&!game.online?'<span class="que-badge">庄</span>':''}${p.que>=0?`<span class="que-badge">缺${SUITS[p.que]}</span>`:''}${seat?.auto?'<span class="que-badge">托管</span>':seat&&!seat.connected?'<span class="que-badge">离线</span>':''}</strong><span class="player-score">${signed(p.score)} 分 ${p.win?`<span class="win-badge">${p.win.rank}胡</span>`:''}</span></div></div>`;}
function playerBacks(p,pos){return `<div class="backs backs-${pos}" aria-label="${p.name}剩余${p.hand.length}张暗牌，${p.melds.length}组副露">${p.win?'':Array.from({length:p.hand.length},()=>'<span class="back-tile"></span>').join('')}${p.melds.map(m=>`<span class="opponent-group" title="${m.kind==='concealed'?'暗杠':m.kind==='kong'?'直杠':'碰'}${tileName(m.tiles[0])}">${m.tiles.map(t=>tile(t)).join('')}</span>`).join('')}</div>`;}
function playerDiscards(p,pos){const recent=p.discards.slice(-18);return `<div class="discard-zone discard-${pos}" aria-label="${p.name}的牌河">${recent.map((t,i)=>tile(t,game.lastDiscard?.from===p.id&&game.lastDiscard?.tile===t&&i===recent.length-1?'last-tile':'')).join('')}</div>`;}
function meldDisplay(p,extra=''){return `<div class="${extra||'melds'}" aria-label="副露">${p.melds.map(m=>`<div class="meld" title="${m.kind==='concealed'?'暗杠':m.kind==='kong'?'直杠':'碰牌'}">${m.tiles.map(t=>tile(t)).join('')}</div>`).join('')}</div>`;}
function renderGame(){
  if(!game){view='lobby';render();return;}
  selected=null;
  const g=game,me=g.players[0],myTurn=g.current===0&&g.phase==='discard'&&!me.win;
  const isAuto=g.online?online.room?.seats[0]?.auto:settings.auto;
  const legal=myTurn?legalDiscards(g):[];const canHu=myTurn&&isWinning(me.hand,me.melds,me.que);const kongs=myTurn?concealedKongs(g):[];
  const key=`${g.id}:${g.turn}:${g.phase}:${g.current}:${g.sequence}`;
  if(turnKey!==key){turnKey=key;deadline=Date.now()+25000;selected=null;hinted=null;}
  if(g.online)deadline=(online.receivedAt||Date.now())+Math.max(0,(online.room?.deadline||0)-(online.room?.serverNow||0));
  const status=g.phase==='finished'?'本局已结束':g.phase==='exchange'?'选三张同花色的牌，换一手好牌':g.phase==='exchange-wait'?'已提交换牌，等待其他牌友':g.phase==='que-wait'?'已定缺，等待其他牌友':g.phase==='waiting'?'等待牌友响应碰杠胡':g.phase==='que'?'请选择定缺花色':g.phase==='claim'?`可${g.pending.kind==='win'?'胡牌':'碰杠'}，请选择操作`:me.win?'你已胡牌，观战中':myTurn?'点击选牌，再点一次打出':'牌友思考中…';
  let drawnIndex=-1;if(myTurn&&g.lastDraw!==null)drawnIndex=me.hand.lastIndexOf(g.lastDraw);
  const actions=g.phase==='claim'?`${g.pending.options.map(a=>`<button class="action-button ${a==='hu'?'hu':''}" data-claim="${a}">${{pong:'碰',kong:'杠',hu:'胡'}[a]}</button>`).join('')}<button class="action-button pass" data-claim="pass">过</button>`:`${canHu?'<button class="action-button hu" data-action="hu">胡</button>':''}${kongs.map(t=>`<button class="action-button" data-kong="${t}" title="暗杠${tileName(t)}">杠</button>`).join('')}`;
  $('#main').innerHTML=`<div class="game-toolbar"><div class="game-title"><button class="back-button" data-view="lobby" aria-label="保存并返回大厅">${icon('back')}</button><h1>${g.room}</h1><span class="practice-label" id="connection-status">${g.online?connectionLabel():"单机 · 智能牌友"}</span></div><div class="game-toolbar-right"><span class="room-detail">四川血战 · ${g.base} 底分</span><button data-action="quick-rules">${icon('help')}规则</button><button data-action="fullscreen" aria-label="全屏牌桌">${icon('expand')}</button></div></div>
  <div class="game-layout"><div class="table-wrap"><section class="table" aria-label="四川麻将牌桌"><span class="turn-pill">血战到底 · 第 ${g.turn} 手</span><div class="table-logo"><strong>雀友</strong><small>MAHJONG CLUB</small></div>${playerPanel(g.players[2],'north')}${playerPanel(g.players[1],'east')}${playerPanel(g.players[3],'west')}${playerPanel(me,'south')}${playerBacks(g.players[2],'north')}${playerBacks(g.players[1],'east')}${playerBacks(g.players[3],'west')}${playerDiscards(g.players[2],'north')}${playerDiscards(g.players[1],'east')}${playerDiscards(g.players[3],'west')}${playerDiscards(me,'south')}
  <div class="compass" aria-label="余牌${g.wall.length}张"><span class="north ${g.current===2?'active':''}">西</span><span class="east ${g.current===1?'active':''}">南</span><span class="south ${g.current===0?'active':''}">东</span><span class="west ${g.current===3?'active':''}">北</span><span class="wall-count">${g.wall.length}</span></div><div class="table-watermark">余牌 · ${g.winners.length} / 3 家已胡</div>${meldDisplay(me)}
  <div class="timer-pill">${icon('clock')}<span id="turn-status">${esc(status)}</span>${(myTurn||g.phase==='claim')?'<b id="countdown">25</b>':''}</div>
  <div class="action-bar">${g.phase==='finished'?'<button class="action-button" data-action="result">查看结算</button>':actions}</div>
  <div class="hand-notice">${me.win?`${me.win.labels.join(' · ')} · 恭喜胡牌`:myTurn&&me.hand.some(t=>suitOf(t)===me.que)?`先打完${SUITS[me.que]}子，再安心做牌`:'定缺不吃牌 · 好牌慢慢来'}</div>
  <div class="hand-zone"><div class="hand" aria-label="你的手牌">${me.hand.map((t,i)=>tile(t,`${!legal.includes(t)&&myTurn?'illegal':''} ${suitOf(t)===me.que?'que-tile':''} ${i===drawnIndex?'drawn':''} ${g.phase==='exchange'&&g.exchangeSelection.includes(i)?'selected':''}`,true,!myTurn&&g.phase!=='exchange',i)).join('')}</div></div>
  ${g.phase==='que'?renderQue():g.phase==='exchange'?renderExchange():''}</section><div class="game-controls"><div class="control-group"><button data-action="hint">${icon('spark')}提示</button><button data-action="sort">${icon('sort')}理牌</button><button class="${isAuto?'on':''}" data-action="auto" aria-pressed="${isAuto}">${icon('auto')}托管${isAuto?'中':''}</button></div><span>积分实时结算 · 可随时返回大厅</span></div></div>
  <aside class="game-side"><section class="match-info"><h3>这一桌的时光</h3><div class="match-stat"><span>玩法</span><b>四川 · 血战到底</b></div><div class="match-stat"><span>底分</span><b>${g.base} 分</b></div><div class="match-stat"><span>你的定缺</span><b>${me.que<0?'待选择':SUITS[me.que]+'子'}</b></div><div class="match-stat"><span>已胡牌</span><b>${g.winners.length} / 3 人</b></div><p class="info-note">${g.online?"四位真人同步对局。<br>断线后会自动恢复座位。":"三位牌友均由电脑操作。<br>虚拟积分只记录在当前设备。"}</p></section><section class="log-panel"><h3>牌桌动态</h3>${g.events.slice(0,8).map(e=>`<div class="event ${e.type}">${esc(e.text)}</div>`).join('')}</section></aside></div>`;
  persistGame();
  if(g.phase==='finished'){commitResult();if(resultShown!==g.id){resultShown=g.id;setTimeout(showResult,450);}}
}
function renderExchange(){return `<div class="que-overlay exchange-overlay"><div class="que-dialog"><div class="eyebrow">A FRESH START</div><h2>换三张，换个好手气。</h2><p>点击下方手牌，选择三张同花色的牌。<br>所有玩家按本局随机方向同时交换。</p><div class="exchange-counter"><b id="exchange-count">${game.exchangeSelection.length}</b> / 3 张已选</div><button class="primary-button" data-action="exchange" id="exchange-confirm" ${game.exchangeSelection.length===3?'':'disabled'}>确认换牌 ${icon('arrow')}</button><button class="text-button" data-action="exchange-hint">帮我选三张</button></div></div>`;}
function renderQue(){const me=game.players[0],c=[0,1,2].map(s=>me.hand.filter(t=>suitOf(t)===s).length),min=Math.min(...c);return `<div class="que-overlay"><div class="que-dialog"><div class="eyebrow">A GOOD START</div><h2>先定缺，再出发。</h2><p>选择一种花色，本局优先打完它。<br>建议选择手中数量最少的一门。</p><div class="que-options">${c.map((n,i)=>`<button class="que-option ${n===min?'recommended':''}" data-que="${i}">${tile(i*9+4)}<span>${SUITS[i]}子 · ${n} 张</span><small>${n===min?'推荐选择':''}</small></button>`).join('')}</div><div class="que-hand-preview">下方手牌可查看 · 108 张牌 · 无字牌</div></div></div>`;}
function renderRecords(){
  $('#main').innerHTML=`<div class="page-heading"><div><div class="eyebrow">EVERY HAND TELLS A STORY</div><h1>记下每一局好时光。</h1><p>战绩保存在当前浏览器，记录你的每一次进步。</p></div><button class="secondary-button" data-view="lobby">回大厅</button></div><div class="compact-panel" style="margin-bottom:24px"><div class="stats-row" style="margin:0"><div class="stat"><b>${stats.games}</b><span>累计对局</span></div><div class="stat"><b>${stats.wins}</b><span>胡牌对局</span></div><div class="stat"><b>${stats.games?Math.round(stats.wins/stats.games*100):0}%</b><span>胡牌率</span></div><div class="stat"><b>${fmt(stats.best)}</b><span>最高单局积分</span></div></div></div>${records.length?`<div class="record-list">${records.map(r=>`<article class="record-row"><div class="record-icon">${r.won?'胡':'雀'}</div><div><h3>${esc(r.room)} · ${r.reason==='leave'?'提前结束':r.won?'好牌入手':r.reason==='wall'?'牌墙摸尽':'血战结束'}</h3><p>${new Date(r.at).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})} · ${r.turn} 手 · ${r.duration} 分钟</p></div><span class="record-rank">${r.won?'第 '+r.rank+' 家胡牌':'下局再接再厉'}</span><b class="record-score ${r.score<0?'negative':''}">${signed(r.score)}</b></article>`).join('')}</div><p class="about-note">仅展示最近 50 局。累计数据会持续保留。</p>`:`<div class="empty-state">${icon('trophy')}<h2>第一段故事，等你开局。</h2><p>打完一局，你的战绩就会出现在这里。</p><button class="primary-button" data-room="easy">来一局试试 ${icon('arrow')}</button></div>`}`;
}
function renderRules(){
  $('#main').innerHTML=`<div class="page-heading"><div><div class="eyebrow">A LITTLE GUIDE, A LOT OF FUN</div><h1>好上手，才好玩。</h1><p>雀友练习版 · 四川血战规则</p></div><button class="primary-button" data-room="easy">练习一局 ${icon('arrow')}</button></div><div class="rules-layout"><section class="rules-card"><h2>四步，打好第一局。</h2>${[['换三张，再定缺','共 108 张牌，只有万、筒、条。先选三张同花色牌，按随机方向同时交换，再选择一门定缺。必须先打完缺门牌；缺门未清时不能碰、杠、胡。'],['轮流摸打','你坐庄先出牌，随后按你 → 小满 → 阿川 → 米粒的顺序轮转。点击手牌选中，再点一次打出；25 秒未操作会自动处理。'],['看准碰、杠、胡','两张同牌可以碰，三张同牌可接直杠，四张同牌可暗杠。不吃牌。杠后补一张牌；他家胡牌优先于碰杠，可一炮多响。'],['胡牌后继续血战','通常以四组顺子或刻子加一对将牌胡牌，也支持七对。胡牌玩家退出后续摸打；三家胡牌或牌墙摸尽时结束。流局将查花猪、退还未听牌玩家收取的杠分，再查大叫。']].map(([h,p],i)=>`<div class="rule-step"><span class="step-number">0${i+1}</span><div><h3>${h}</h3><p>${p}</p></div></div>`).join('')}<div class="rule-note">提示按钮会建议保留对子、顺子和搭子。高手场的智能牌友还会评估听牌机会。定缺阶段选择数量最少的一门，通常更容易起手。</div></section><aside class="rules-card"><h2>积分，明明白白。</h2><table class="scoring-table"><tbody><tr><td>平胡</td><td>0 番 · 1 倍底分</td></tr><tr><td>碰碰胡</td><td>+1 番</td></tr><tr><td>七对 / 清一色 / 带幺九</td><td>各 2 番</td></tr><tr><td>将对 / 龙七对</td><td>3 番起</td></tr><tr><td>将七对</td><td>4 番</td></tr><tr><td>金钩钓 / 每一根</td><td>+1 番</td></tr><tr><td>自摸</td><td>+1 番</td></tr><tr><td>暗杠</td><td>每家付 2 倍底分</td></tr><tr><td>直杠</td><td>出牌者付 2 倍底分</td></tr></tbody></table><p>每番翻倍，胡牌最高 5 番（32 倍底分）。点炮由出牌者付分，自摸由尚未胡牌的其他玩家付分。</p><div class="rule-note">查大叫：未听牌且非花猪的玩家，向每位听牌玩家支付其可胡的最高番数，不含自摸加番。查花猪：仍有缺门牌者向每位非花猪玩家付 16 倍底分。未听牌或花猪玩家退还本局收取的杠分。已胡玩家不参与查大叫。积分可为负数，不影响开局。</div><details class="fan-reference"><summary>将对、幺九等牌型怎么判？</summary><p>将对：全部由二、五、八组成的碰碰胡，基础 3 番。带幺九：每组顺刻以及将牌均含一或九，基础 2 番；不会与碰碰胡重复计基础番。七对基础 2 番，每个四张相同牌再加 1 番，称龙七对；全由二五八组成的七对为将七对，基础 4 番。清一色再加 2 番，金钩钓再加 1 番。除七对的龙根外，每组四张同牌算一根加 1 番。</p></details><div class="rule-note">本版采用上述公开计分约定，不含加杠、抢杠、天地胡、海底或杠上花等额外加番。不同地方规则可能不同。</div><p>操作快捷键：Enter 打出选中的牌；Esc 关闭弹窗。大厅可保存并继续未完成的牌局。</p></aside></div>`;
}
function toggleSetting(key){settings[key]=!settings[key];write('settings',settings);render();}
function renderSettings(){
  $('#main').innerHTML=`<div class="page-heading"><div><div class="eyebrow">MAKE YOURSELF AT HOME</div><h1>玩得自在一点。</h1><p>按自己的节奏，调好这一桌。</p></div></div><section class="settings-card"><div class="setting-row"><div><h3>牌桌昵称</h3><p>给自己起个好听的名字，最多 10 个字。</p></div><input class="settings-input" id="nickname" aria-label="牌桌昵称" maxlength="10" value="${esc(settings.name)}"></div><div class="setting-row"><div><h3>牌桌音效</h3><p>出牌、开局与胡牌时的一点小仪式感。</p></div><button class="toggle ${settings.sound?'on':''}" data-setting="sound" aria-label="牌桌音效" role="switch" aria-checked="${settings.sound}"></button></div><div class="setting-row"><div><h3>对局节奏</h3><p>调整电脑牌友的思考时间。</p></div><select class="select-control" id="speed" aria-label="对局节奏">${[['slow','慢慢来'],['normal','刚刚好'],['fast','快一点']].map(([v,t])=>`<option value="${v}" ${settings.speed===v?'selected':''}>${t}</option>`).join('')}</select></div><div class="setting-row"><div><h3>自动托管</h3><p>电脑代你打牌，可在牌桌上随时关闭。</p></div><button class="toggle ${settings.auto?'on':''}" data-setting="auto" aria-label="自动托管" role="switch" aria-checked="${settings.auto}"></button></div><div class="setting-row"><div><h3>安装到主屏幕</h3><p>像 App 一样打开。首次加载完成后可离线练习。</p></div><button class="secondary-button" data-action="install">安装指引 ↗</button></div></section><p class="about-note">雀友 v2.0 · 原创界面与牌面，参考休闲麻将游戏的交互习惯。<br>数据仅存储在当前浏览器，清除浏览器数据后将重置。${storageAvailable?'':'当前浏览器不支持持久保存，数据只在本次打开期间保留。'}</p>`;
}
function openModal(content){modalOpen=true;clearTimeout(botTimer);$('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="雀友提示"><button class="close-modal" data-action="close-modal" aria-label="关闭">×</button>${content}</section></div>`;$('#modal-root button')?.focus();}
function closeModal(){modalOpen=false;$('#modal-root').innerHTML='';deadline=Date.now()+25000;schedule();}
function commitResult(){
  if(!game||records.some(r=>r.id===game.id))return;
  const me=game.players[0];
  const row={id:game.id,at:game.endedAt||Date.now(),room:game.room,score:me.score,won:!!me.win,rank:me.win?.rank||0,turn:game.turn,duration:Math.max(1,Math.round(((game.endedAt||Date.now())-game.startedAt)/60000)),reason:game.reason};
  records.unshift(row);records=records.slice(0,50);stats.games++;if(me.win)stats.wins++;stats.best=Math.max(stats.best,me.score);stats.points+=me.score;
  write('records',records);write('stats',stats);if(!game.online)write('game',null);renderNav();
}
function showResult(){
  if(!game||game.phase!=='finished'||view!=='game')return;
  const me=game.players[0];
  openModal(`<div class="result-title"><div class="eyebrow">ANOTHER MOMENT WELL PLAYED</div><div class="result-emblem">${me.win?'胡':'雀'}</div><h2>${me.win?'好牌，好时光。':'下局，好牌在等你。'}</h2><p>${game.reason==='three'?'三家胡牌，本局血战结束。':'牌墙摸尽，歇一歇再来一局。'}</p><div class="result-total ${me.score<0?'negative':''}">${signed(me.score)}<small style="font-size:11px;margin-left:8px">分</small></div></div><div class="result-list">${[...game.players].sort((a,b)=>b.score-a.score).map((p,i)=>`<div class="result-player"><span>0${i+1}</span><span class="avatar ${p.id===0?'avatar-me':'avatar-'+p.id}">${p.id===0?'你':p.name.slice(0,1)}</span><div>${p.id===0?esc(game.online?p.name:settings.name):esc(p.name)}<small>${p.win?p.win.labels.join(' · ')+' · 第 '+p.win.rank+' 家胡牌':'未胡牌'}</small></div><b class="${p.score<0?'negative':''}">${signed(p.score)}</b></div>`).join('')}</div>${settlementHTML()}<div class="result-footer">虚拟积分已保存至本地战绩</div><div class="modal-actions"><button class="secondary-button" data-action="result-home">回大厅</button>${game.online?'<button class="secondary-button" data-online="leave">离开房间</button>':''}<button class="primary-button" data-action="again">再来一局 ${icon('arrow')}</button></div>`);
}
function settlementHTML(){
  if(!game?.drawSettled)return '';
  return `<div class="settlement-details"><h3>流局检查与结算</h3><div>${game.readyStatus.map(p=>`${game.players[p.id].name}：${p.status}`).join(' · ')}</div>${game.settlements.length?game.settlements.map(s=>`<div class="settlement-line"><span>${s.type} · ${game.players[s.from].name} → ${game.players[s.to].name}${s.fan!==undefined?`<span class="score-label">（${s.fan} 番 · ${s.labels.join(' / ')}）</span>`:''}</span><b>${fmt(s.amount)} 分</b></div>`).join(''):'<div>本局无需查大叫、查花猪或退税赔付。</div>'}</div>`;
}
function startRoom(id,force=false){
  if(online.room){toast('请先完成好友房对局或退出房间，再开始单机练习');openOnline();return;}
  const room=rooms.find(r=>r.id===id)||rooms[1];
  if(game&&game.phase!=='finished'&&!force){
    openModal(`<div class="eyebrow">YOUR TABLE IS WAITING</div><h2>还有一桌未打完。</h2><p>你可以接着玩；开始新局会结算当前牌局已经产生的积分，并记录为提前结束。</p><div class="modal-actions"><button class="secondary-button" data-action="resume">继续对局</button><button class="primary-button" data-new-room="${room.id}">结算并开新局</button></div>`);return;
  }
  if(force&&game&&game.phase!=='finished'){game.reason='leave';game.endedAt=Date.now();commitResult();}
  closeModal();game=createGame({difficulty:room.difficulty,base:room.base,room:room.name});selected=null;hinted=null;view='game';resultShown=null;sound('start');render();window.scrollTo(0,0);
}
function schedule(){
  clearTimeout(botTimer);
  if(view!=='game'||!game||game.online||modalOpen||document.hidden||game.phase==='finished')return;
  const g=game,me=g.players[0];
  const speed={slow:1800,normal:950,fast:280}[settings.speed]||950;
  if(g.phase==='discard'&&g.current!==0)botTimer=setTimeout(()=>{const before=g.winners.length;step(g);sound(g.winners.length>before?'win':'tile');render();},speed);
  else if(settings.auto&&g.phase==='exchange')botTimer=setTimeout(()=>{exchangeTiles(g,chooseExchangeIndices(me));render();},speed);
  else if(settings.auto&&g.phase==='que')botTimer=setTimeout(()=>{const c=[0,1,2].map(s=>me.hand.filter(t=>suitOf(t)===s).length);chooseQue(g,c.indexOf(Math.min(...c)));render();},speed);
  else if(settings.auto&&(g.phase==='claim'||g.current===0&&g.phase==='discard'))botTimer=setTimeout(autoAction,Math.max(600,speed));
}
function autoAction(){
  if(!game||game.online||view!=='game'||modalOpen)return;
  const g=game,before=g.winners.length;
  if(g.phase==='claim')respond(g,g.pending.options.includes('hu')?'hu':g.pending.options.includes('kong')?'kong':'pong');
  else if(g.phase==='discard'&&g.current===0){if(!selfWin(g)){const ks=concealedKongs(g);if(ks.length)concealedKong(g,ks[0]);else discard(g,bestDiscard(g.players[0],g.difficulty));}}
  sound(g.winners.length>before?'win':'tile');render();
}
function playTile(t,el){
  if(game?.phase==='exchange'){
    const i=Number(el.dataset.index),selection=game.exchangeSelection,at=selection.indexOf(i);
    if(at>=0)selection.splice(at,1);
    else if(selection.length>=3){toast('已经选好三张了，可以点击确认换牌');return;}
    else if(selection.length&&suitOf(game.players[0].hand[selection[0]])!==suitOf(t)){toast('换出的三张牌需要是同一种花色');return;}
    else selection.push(i);
    if(game.online)onlineChoice=selection;
    el.classList.toggle('selected',selection.includes(i));$('#exchange-count').textContent=selection.length;$('#exchange-confirm').disabled=selection.length!==3;persistGame();return;
  }
  if(!game||game.phase!=='discard'||game.current!==0)return;
  if(!legalDiscards(game).includes(t)){toast(`请先打完定缺的${SUITS[game.players[0].que]}子`);return;}
  if(selected===t){if(game.online){onlineGame('discard',{tile:t});return;}discard(game,t);sound('tile');render();}
  else{selected=t;$('.hand .selected')?.classList.remove('selected');el.classList.add('selected');$('#turn-status').textContent=`再点一次，打出${tileName(t)}`;}
}
document.addEventListener('click',e=>{
  const el=e.target.closest('button,a');if(!el)return;
  if(el.dataset.online){onlineAction(el.dataset.online);return;}
  if(el.dataset.view==='online'){openOnline();return;}
  if(el.dataset.view){persistGame();closeModal();view=el.dataset.view;render();window.scrollTo(0,0);return;}
  if(el.dataset.room){startRoom(el.dataset.room);return;}
  if(el.dataset.newRoom){startRoom(el.dataset.newRoom,true);return;}
  if(el.dataset.filter){filter=el.dataset.filter;renderLobby();return;}
  if(el.dataset.que!==undefined){if(game.online){onlineGame('que',{suit:Number(el.dataset.que)});return;}chooseQue(game,Number(el.dataset.que));sound('start');render();return;}
  if(el.dataset.tile!==undefined){playTile(Number(el.dataset.tile),el);return;}
  if(el.dataset.claim){if(game.online){onlineGame('claim',{action:el.dataset.claim});return;}const before=game.winners.length;respond(game,el.dataset.claim);sound(game.winners.length>before?'win':'tile');render();return;}
  if(el.dataset.kong!==undefined){if(game.online){onlineGame('kong',{tile:Number(el.dataset.kong)});return;}concealedKong(game,Number(el.dataset.kong));sound('start');render();return;}
  if(el.dataset.setting){toggleSetting(el.dataset.setting);return;}
  const action=el.dataset.action;
  if(action==='sound'){toggleSetting('sound');if(settings.sound)sound();}
  if(action==='profile'){view='settings';render();}
  if(action==='resume'){closeModal();view='game';render();window.scrollTo(0,0);}
  if(action==='exchange-hint'){game.exchangeSelection=chooseExchangeIndices(game.players[0]);if(game.online)onlineChoice=game.exchangeSelection;render();}
  if(action==='exchange'){
    if(game.online){onlineGame('exchange',{indices:[...game.exchangeSelection]});return;}
    if(exchangeTiles(game,game.exchangeSelection)){sound('start');toast('换入了'+game.exchangeReceived.map(tileName).join('、'));render();}
    else toast('请选择三张同花色的牌');
  }
  if(action==='close-modal')closeModal();
  if(action==='hu'){if(game.online){onlineGame('hu');return;}selfWin(game);sound('win');render();}
  if(action==='auto'){if(game.online){onlineGame('auto',{enabled:!online.room.seats[0].auto});return;}settings.auto=!settings.auto;write('settings',settings);render();toast(settings.auto?'已开启托管，牌友替你慢慢打':'已关闭托管，轮到你时亲自出牌');}
  if(action==='hint'){
    if(!game||game.phase!=='discard'||game.current!==0||game.players[0].win){toast('轮到你出牌时，可以使用提示');return;}
    if(isWinning(game.players[0].hand,game.players[0].melds,game.players[0].que)){toast('这手牌可以胡啦！点击「胡」收下好牌。');return;}
    hinted=bestDiscard(game.players[0],'smart');document.querySelectorAll('.hand .tile').forEach(t=>t.classList.toggle('hinted',Number(t.dataset.tile)===hinted));toast(`建议打出${tileName(hinted)}，保留对子和相连的牌`);
  }
  if(action==='sort'){if(game){game.players[0].hand.sort((a,b)=>a-b);if(game.phase==='exchange'){game.exchangeSelection=[];if(game.online)onlineChoice=[];}render();toast('已按万、筒、条整理手牌');}}
  if(action==='fullscreen'){if(!document.fullscreenElement)document.documentElement.requestFullscreen?.().catch(()=>toast('当前浏览器不支持全屏，可横屏体验'));else document.exitFullscreen?.();}
  if(action==='quick-rules')openModal('<div class="eyebrow">SICHUAN MAHJONG</div><h2>这一桌，怎么玩？</h2><div class="inline-rules">① 换三张：选三张同花色牌，同时交换后再定缺。缺门清空才能碰、杠、胡。<br>② 不吃牌，支持碰牌、直杠和暗杠。<br>③ 四组顺刻加一对将，或七对，即可胡牌。<br>④ 一家胡了继续打，三家胡牌或牌墙摸尽结束。<br>⑤ 点击选牌，再点一次打出，25 秒自动处理。</div><p>支持将对、带幺九、龙七对等牌型，以及流局查大叫、查花猪和退税。详细计分可在大厅「玩法指南」中查看。</p><div class="modal-actions"><button class="primary-button" data-action="close-modal">知道了，继续玩</button></div>');
  if(action==='result')showResult();
  if(action==='result-home'){closeModal();view='lobby';render();}
  if(action==='again'){if(game.online){closeModal();onlineAction('reset');return;}const room=rooms.find(r=>r.name===game.room)||rooms[1];startRoom(room.id);}
  if(action==='install')install();
});
document.addEventListener('change',e=>{
  if(e.target.id==='speed'){settings.speed=e.target.value;write('settings',settings);toast('对局节奏已保存');}
  if(e.target.id==='nickname'){settings.name=e.target.value.trim().slice(0,10)||'悠闲牌友';write('settings',settings);renderNav();toast('新昵称已保存');}
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&modalOpen)closeModal();
  if(e.key==='Enter'&&!modalOpen&&!['INPUT','SELECT','TEXTAREA','BUTTON','A'].includes(document.activeElement.tagName)&&selected!==null&&view==='game'){e.preventDefault();if(game.online)onlineGame('discard',{tile:selected});else{discard(game,selected);sound();render();}}
  if(e.key==='Tab'&&modalOpen){const all=[...document.querySelectorAll('.modal button,.modal input,.modal select,.modal a')];const first=all[0],last=all.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
});
setInterval(()=>{
  if(view!=='game'||!game||modalOpen||document.hidden)return;
  if(game.phase==='claim'||game.phase==='discard'&&game.current===0){
    const left=Math.max(0,Math.ceil((deadline-Date.now())/1000));if($('#countdown'))$('#countdown').textContent=left;
    if(!left&&!game.online)autoAction();
  }
},300);
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(botTimer);persistGame();}else{deadline=Date.now()+25000;schedule();}});
window.addEventListener('pagehide',persistGame);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('#install-button').hidden=false;});
$('#install-button').addEventListener('click',install);
async function install(){
  if(installPrompt){await installPrompt.prompt();installPrompt=null;return;}
  openModal('<div class="eyebrow">YOUR OWN LITTLE MAHJONG CLUB</div><h2>把雀友，带在身边。</h2><p>在手机浏览器打开本站后：</p><div class="inline-rules"><b>iPhone / iPad</b><br>使用 Safari，点击分享 → 添加到主屏幕。<br><br><b>Android / 电脑</b><br>使用 Chrome 或 Edge，打开浏览器菜单 → 安装应用 / 添加到主屏幕。</div><p>首次完整加载后可离线练习。安装入口由浏览器决定；若当前内嵌浏览器未提供，请在系统浏览器中打开。</p>');
}
function connectionLabel(){return {idle:'未连接',connecting:'连接中，首次唤醒可能稍慢',connected:'实时连接正常',reconnecting:'连接中断，正在恢复',displaced:'此座位已在其他页面打开'}[online.status]||'连接中';}
function openOnline(){
  closeModal();view='online';render();online.connect().catch(e=>{onlineError=e.message;render();});
}
function renderOnline(){
  const r=online.room;
  if(r?.game){game=r.game;game.exchangeSelection=onlineChoice;view='game';render();return;}
  const header=`<div class="page-heading"><div><div class="eyebrow">GOOD FRIENDS, ONE TABLE</div><h1>人到齐，就开一桌。</h1><p>四位真人 · 换三张 · 四川血战 · 只玩虚拟积分</p></div><span class="connection-status" id="connection-status">${esc(connectionLabel())}</span></div>`;
  if(!r){
    const invited=new URLSearchParams(location.hash.slice(1)).get('room')||'';
    $('#main').innerHTML=header+`<div class="online-entry"><section class="rules-card"><span class="eyebrow">HOST A TABLE</span><h2>创建好友房</h2><p>开一张牌桌，把六位房间码发给朋友。四人准备后，由房主开始。</p><label class="online-label">牌桌昵称<input id="online-name" class="settings-input" maxlength="10" value="${esc(settings.name)}"></label><label class="online-label">练习底分<select id="online-base" class="select-control"><option value="100">100 分 · 轻松一局</option><option value="200">200 分 · 自在切磋</option><option value="500">500 分 · 高手过招</option></select></label><button class="primary-button" data-online="create" ${onlineBusy?'disabled':''}>${onlineBusy?'请稍候…':'创建房间'} ${icon('arrow')}</button></section><section class="rules-card join-card"><span class="eyebrow">JOIN YOUR FRIENDS</span><h2>朋友在等你</h2><p>输入朋友分享的六位房间码，入座就能见面。</p><label class="online-label">房间码<input id="online-code" class="settings-input room-code-input" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" value="${esc(invited.replace(/\D/g,'').slice(0,6))}" placeholder="输入六位数字"></label><button class="secondary-button" data-online="join" ${onlineBusy?'disabled':''}>加入房间 ${icon('arrow')}</button></section></div><p class="about-note">${esc(onlineError||(!backendURL?'联机服务尚未部署，当前可继续使用单机练习。':'房间不需要注册。刷新页面或短暂断线后，会自动恢复当前座位；同一浏览器的多个页面共用一个座位。'))}</p>`;return;
  }
  const ready=r.seats.filter(s=>s?.ready).length,me=r.seats[0],canStart=r.seats.every(s=>s?.ready&&s.connected);
  $('#main').innerHTML=header+`<section class="waiting-room"><div class="waiting-heading"><div><span class="eyebrow">YOUR PRIVATE TABLE</span><h2>好友房 <span id="room-code">${r.code}</span></h2><p>${r.base} 底分 · 已准备 ${ready} / 4 人</p></div><button class="secondary-button" data-online="invite">复制邀请链接 ↗</button></div><div class="seat-grid">${r.seats.map((s,i)=>`<div class="waiting-seat ${s?'occupied':''}"><span class="avatar avatar-${i===0?'me':i}">${s?esc(s.name.slice(0,1)):'＋'}</span><h3>${s?esc(s.name)+(i===0?'（你）':''):'等一位牌友'}</h3><p>${s?(s.connected?s.ready?'已准备':'等待准备':'暂时离线'):'分享房间码，一起入座'}</p>${s&&r.owner===i?'<span class="host-tag">房主</span>':''}</div>`).join('')}</div><div class="waiting-actions"><button class="text-button" data-online="leave">离开房间</button><button class="secondary-button" data-online="ready" ${onlineBusy?'disabled':''}>${me?.ready?'取消准备':'我准备好了'}</button>${r.owner===0?`<button class="primary-button" data-online="start" ${!canStart||onlineBusy?'disabled':''}>开始对局 ${icon('arrow')}</button>`:''}</div><div class="rule-note">四位牌友全部在线并准备后，房主即可开局。对局中离线或操作超时会自动出牌，也可主动托管。服务重启会使当前房间失效。</div></section>`;
}
async function onlineAction(action){
  if(action==='room'){openOnline();return;}
  if(action==='invite'){
    const url=new URL(location.href);url.hash='room='+online.room.code;
    try{await navigator.clipboard.writeText(url.href);toast('邀请链接已复制，发给朋友即可加入');}catch{openModal(`<h2>邀请朋友入座</h2><p>房间码：${online.room.code}</p><input class="settings-input" style="width:100%" readonly value="${esc(url.href)}" aria-label="邀请链接">`);}return;
  }
  if(onlineBusy)return;onlineBusy=true;onlineError='';
  const payload={name:$('#online-name')?.value||settings.name};
  if(action==='create')payload.base=Number($('#online-base')?.value)||100;
  if(action==='join')payload.code=$('#online-code')?.value.trim();
  if(action==='ready')payload.ready=!online.room.seats[0].ready;
  try{await online.request('room.'+action,payload);if(action==='leave'){closeModal();game=practiceGame||read('game',null);practiceGame=null;view='online';}if(action==='reset')view='online';}
  catch(e){onlineError=e.message;toast(e.message);}finally{onlineBusy=false;render();}
}
async function onlineGame(action,payload={}){
  if(onlineBusy)return;onlineBusy=true;
  try{await online.request('game.'+action,payload);sound(action==='hu'?'win':'tile');}
  catch(e){toast(e.message);}finally{onlineBusy=false;}
}
online.addEventListener('state',e=>{
  const r=e.detail,wasOnline=!!game?.online;
  if(r?.game){
    if(!wasOnline){persistGame();practiceGame=game;}
    if(game?.id!==r.game.id||r.game.phase!=='exchange')onlineChoice=[];
    game=r.game;game.exchangeSelection=onlineChoice;
    if(view==='online'||view==='game'&&wasOnline)view='game';
  }else if(wasOnline){game=practiceGame||read('game',null);practiceGame=null;if(view==='game')view='online';}
  if(['online','game','lobby'].includes(view))render();
});
online.addEventListener('status',()=>{if($('#connection-status'))$('#connection-status').textContent=connectionLabel();});
online.addEventListener('notice',e=>toast(e.detail));
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{/* File previews may not support service workers. */});
render();
if(new URLSearchParams(location.hash.slice(1)).has('room')||online.remembered)openOnline();
