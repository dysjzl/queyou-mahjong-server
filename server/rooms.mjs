import {randomInt,randomUUID} from 'node:crypto';
import {createGame,exchangeTiles,chooseExchangeIndices,chooseQue,suitOf,discard,respond,selfWin,concealedKong,concealedKongs,bestDiscard,isWinning} from '../dist/engine.js';
const fail=message=>{throw new Error(message);};
const cleanName=name=>Array.from(String(name||'牌友').replace(/[\u0000-\u001f]/g,'').trim()).slice(0,10).join('')||'牌友';
export class RoomService{
  constructor({now=Date.now,rng=()=>randomInt(0,0x100000000)/0x100000000,maxRooms=500,turnMs=25000,claimMs=10000}={}){
    Object.assign(this,{now,rng,maxRooms,turnMs,claimMs});this.rooms=new Map();this.sessions=new Map();this.onChange=()=>{};
  }
  authenticate(token){
    let s=typeof token==='string'?this.sessions.get(token):null;
    if(!s){if(this.sessions.size>=10000)fail('联机服务暂时繁忙，请稍后再试');token=randomUUID()+randomUUID();s={token,room:null,seat:null,connected:false,lastSeen:this.now()};this.sessions.set(token,s);}return s;
  }
  presence(s,connected){s.connected=connected;s.lastSeen=this.now();const r=this.rooms.get(s.room);if(r)this.changed(r);}
  roomFor(s){const r=this.rooms.get(s.room);if(!r)fail('房间已失效，请重新创建或加入');return r;}
  changed(r){r.revision++;r.updatedAt=this.now();this.arm(r);this.onChange(r);}
  arm(r){
    const g=r.game;if(!g||g.phase==='finished'){r.deadline=0;return;}
    const key=`${g.id}:${g.phase}:${g.turn}:${g.current}:${g.pending?.kind==='meld'?g.pending.actor:''}`;
    if(r.deadlineKey!==key){r.deadlineKey=key;r.stageAt=this.now();r.deadline=this.now()+(g.phase==='claim'?this.claimMs:this.turnMs);}
  }
  command(s,m){
    const type=m.type;
    if(type==='room.create'){
      if(s.room)fail('请先离开当前房间');if(this.rooms.size>=this.maxRooms)fail('牌桌暂时已满，请稍后再来');
      let code;do{code=String(randomInt(100000,1000000));}while(this.rooms.has(code));
      const r={code,owner:0,base:[100,200,500].includes(m.base)?m.base:100,seats:Array(4).fill(null),game:null,revision:0,updatedAt:this.now(),deadline:0};
      this.rooms.set(code,r);this.join(s,r,m.name);return;
    }
    if(type==='room.join'){
      const code=String(m.code||'');if(!/^\d{6}$/.test(code))fail('请输入六位房间码');
      const r=this.rooms.get(code);if(!r)fail('没有找到这个房间，请核对房间码');if(s.room===code)return;
      if(s.room)fail('请先离开当前房间');if(r.game)fail('这桌已经开局，暂时不能中途加入');this.join(s,r,m.name);return;
    }
    const r=this.roomFor(s),id=s.seat,seat=r.seats[id],g=r.game;
    if(!seat||seat.token!==s.token)fail('座位凭证已失效');
    if(type==='room.leave'){
      if(g&&g.phase!=='finished')fail('对局中请开启托管并返回大厅，结算后可退出');r.seats[id]=null;s.room=null;s.seat=null;
      const next=r.seats.findIndex(Boolean);if(next<0)this.rooms.delete(r.code);else{if(r.owner===id)r.owner=next;this.changed(r);}return;
    }
    if(type==='room.ready'){if(g)fail('请等待房主返回候场区');seat.ready=!!m.ready;this.changed(r);return;}
    if(type==='room.start'){
      if(r.owner!==id)fail('只有房主可以开始');if(g)fail('本局已经开始');
      if(r.seats.some(p=>!p||!p.ready||!this.sessions.get(p.token)?.connected))fail('需要四位牌友全部在线并准备好');
      r.game=createGame({rng:this.rng,base:r.base,room:`好友房 · ${r.code}`,humanSeats:[0,1,2,3]});r.game.players.forEach((p,i)=>p.name=r.seats[i].name);this.changed(r);return;
    }
    if(type==='room.reset'){
      if(r.owner!==id)fail('请等待房主开始下一局');if(!g||g.phase!=='finished')fail('请先完成当前对局');r.game=null;r.seats.forEach(p=>{if(p){p.ready=false;p.auto=false;}});this.changed(r);return;
    }
    if(!g||g.phase==='finished')fail('当前没有进行中的牌局');
    if(type==='game.auto'){seat.auto=!!m.enabled;this.changed(r);return;}
    if(m.gameId!==g.id)fail('牌局已更新，请等待同步');
    const simultaneous=['game.exchange','game.que'].includes(type)||(type==='game.claim'&&g.pending?.kind==='win');
    if(m.revision!==r.revision&&!simultaneous)fail('牌桌刚刚更新，请重试');
    let ok=false;
    if(type==='game.exchange')ok=exchangeTiles(g,m.indices,id);
    else if(type==='game.que')ok=chooseQue(g,m.suit,id);
    else if(type==='game.claim')ok=respond(g,m.action,id);
    else if(g.current===id){if(type==='game.discard'&&Number.isInteger(m.tile))ok=discard(g,m.tile,id);if(type==='game.hu')ok=selfWin(g);if(type==='game.kong'&&Number.isInteger(m.tile))ok=concealedKong(g,m.tile);}
    if(!ok)fail('当前不能执行此操作，请检查轮次或牌型');this.changed(r);
  }
  join(s,r,name){const id=r.seats.findIndex(p=>!p);if(id<0)fail('房间已满，请换一桌');r.seats[id]={id,token:s.token,name:cleanName(name),ready:false,auto:false};s.room=r.code;s.seat=id;this.changed(r);}
  automatic(r,id){
    const g=r.game,p=g.players[id];if(p.win)return false;
    if(g.phase==='exchange'&&!g.exchangeChoices[id])return exchangeTiles(g,chooseExchangeIndices(p),id);
    if(g.phase==='que'&&p.que<0){const c=[0,1,2].map(s=>p.hand.filter(t=>suitOf(t)===s).length);return chooseQue(g,c.indexOf(Math.min(...c)),id);}
    if(g.phase==='claim'){const q=g.pending;if(q.kind==='win'&&q.wins.includes(id)&&q.answers[id]===undefined)return respond(g,'hu',id);if(q.kind==='meld'&&q.actor===id)return respond(g,q.options.includes('kong')?'kong':'pong',id);}
    if(g.phase==='discard'&&g.current===id){if(isWinning(p.hand,p.melds,p.que))return selfWin(g);const ks=concealedKongs(g);return ks.length?concealedKong(g,ks[0]):discard(g,bestDiscard(p,'smart'),id);}return false;
  }
  tick(){
    for(const r of this.rooms.values()){
      const g=r.game;
      if(g&&g.phase!=='finished'){
        this.arm(r);const expired=this.now()>=r.deadline;
        if(this.now()-r.stageAt>=550)for(let id=0;id<4;id++)if(expired||r.seats[id]?.auto){if(this.automatic(r,id)){if(expired&&!this.sessions.get(r.seats[id].token)?.connected)r.seats[id].auto=true;this.changed(r);break;}}
      }
      if(this.now()-r.updatedAt>7200000&&!r.seats.some(p=>p&&this.sessions.get(p.token)?.connected)){
        for(const p of r.seats)if(p){const s=this.sessions.get(p.token);if(s){s.room=null;s.seat=null;}}this.rooms.delete(r.code);
      }
    }
    for(const [token,s]of this.sessions)if(!s.room&&!s.connected&&this.now()-s.lastSeen>7200000)this.sessions.delete(token);
  }
  view(s){
    const r=this.rooms.get(s.room);if(!r)return null;const id=s.seat,rot=i=>(i-id+4)%4;
    const seats=Array.from({length:4},(_,i)=>{const p=r.seats[(i+id)%4];return p?{id:i,name:p.name,ready:p.ready,auto:p.auto,connected:!!this.sessions.get(p.token)?.connected}:null;});
    const out={code:r.code,revision:r.revision,owner:rot(r.owner),base:r.base,seats,deadline:r.deadline,serverNow:this.now(),game:null};
    const g=r.game;if(!g)return out;let phase=g.phase,pending=null;
    if(phase==='exchange'&&g.exchangeChoices[id])phase='exchange-wait';if(phase==='que'&&g.players[id].que>=0)phase='que-wait';
    if(phase==='claim'){const q=g.pending,eligible=q.kind==='win'?q.wins.includes(id)&&q.answers[id]===undefined:q.actor===id;if(eligible)pending={kind:q.kind,from:rot(q.from),tile:q.tile,options:[...q.options],actor:0};else phase='waiting';}
    const players=Array.from({length:4},(_,i)=>{const p=g.players[(i+id)%4];return {id:i,name:p.name,hand:p.id===id?[...p.hand]:Array(p.hand.length).fill(-1),discards:[...p.discards],score:p.score,que:g.phase==='que'&&p.id!==id?-1:p.que,win:p.win?{...p.win,from:rot(p.win.from)}:null,melds:p.melds.map(m=>({kind:m.kind,from:rot(m.from),tiles:m.kind==='concealed'&&p.id!==id?Array(4).fill(-1):[...m.tiles]}))};});
    out.game={id:g.id,version:g.version,online:true,players,phase,pending,wall:Array(g.wall.length).fill(-1),current:rot(g.current),
      lastDraw:g.current===id?g.lastDraw:null,lastDiscard:g.lastDiscard?{...g.lastDiscard,from:rot(g.lastDiscard.from)}:null,
      turn:g.turn,sequence:g.sequence,exchangeSelection:[],exchangeReceived:g.exchangeReceivedBySeat?.[id]||[],base:g.base,room:g.room,
      startedAt:g.startedAt,endedAt:g.endedAt,reason:g.reason,winners:g.winners.map(rot),drawSettled:!!g.drawSettled,
      settlements:g.settlements.map(x=>({...x,from:rot(x.from),to:rot(x.to)})),readyStatus:g.readyStatus?.map(x=>({...x,id:rot(x.id)}))||[],
      events:g.events.map(e=>({...e,player:e.player===null?null:rot(e.player),...(e.type==='kong'&&e.player!==id?{text:`${g.players[e.player].name}杠牌`,tile:null}:{})}))};return out;
  }
}
