import {randomInt,randomUUID} from 'node:crypto';
import {createGame,tableRules,exchangeTiles,chooseExchangeIndices,chooseQue,suitOf,discard,respond,selfWin,concealedKong,concealedKongs,addedKong,addedKongs,bestDiscard,step} from '../dist/engine.js';
import {playerProfile,recordRound,createTransferCode} from './records.mjs';

const fail=message=>{throw new Error(message);};
const cleanName=name=>Array.from(String(name||'牌友').replace(/[\u0000-\u001f]/g,'').trim()).slice(0,10).join('')||'牌友';
const twoHours=7200000;

export class RoomService{
  constructor({now=Date.now,rng=()=>randomInt(0,0x100000000)/0x100000000,maxRooms=500,turnMs=25000,claimMs=10000,checkpoints}={}){
    Object.assign(this,{now,rng,maxRooms,turnMs,claimMs,checkpoints});
    this.rooms=new Map();this.sessions=new Map();this.replays=new Map();
    this.queue=new Map();this.codes=new Map();this.onChange=()=>{};
    for(const [key,value] of checkpoints?.storage.entries||[]){
      const [type,id]=key.split(':');
      if(type==='room'){
        if(value.deadline)value.restoreTimer=true;
        this.rooms.set(id,value);
      }
      if(type==='session')this.sessions.set(id,{...value,connected:false});
      if(type==='replay')this.replays.set(id,value);
    }
  }
  saveSession(session){this.checkpoints?.update('session:'+session.token,session);}
  flush(){return this.checkpoints?.flush();}
  archiveReplay(id,replay){
    this.replays.set(id,replay);this.checkpoints?.update('replay:'+id,replay);
    if(this.replays.size>300){
      const [oldId]=[...this.replays].sort((a,b)=>a[1].finishedAt-b[1].finishedAt)[0];
      this.replays.delete(oldId);this.checkpoints?.update('replay:'+oldId,null);
    }
  }
  authenticate(token){
    let session=typeof token==='string'?this.sessions.get(token):null;
    if(!session){
      if(this.sessions.size>=10000)fail('联机服务暂时繁忙，请稍后再试');
      token=randomUUID()+randomUUID();
      session={token,room:null,seat:null,connected:false,lastSeen:this.now()};
      this.sessions.set(token,session);
    }
    return session;
  }
  presence(session,connected){
    session.connected=connected;session.lastSeen=this.now();
    if(!connected)this.queue.delete(session.token);
    const room=this.rooms.get(session.room);
    if(room){
      if(connected&&room.restoreTimer){room.deadlineKey=null;delete room.restoreTimer;}
      this.saveSession(session);this.changed(room);
    }
  }
  roomFor(session){
    const room=this.rooms.get(session.room);
    if(!room)fail('房间已失效，请重新创建或加入');
    return room;
  }
  changed(room){
    room.revision++;room.updatedAt=this.now();this.arm(room);
    if(room.game?.phase==='finished')recordRound(this,room);
    this.checkpoints?.update('room:'+room.code,room);this.onChange(room);
  }
  arm(room){
    const game=room.game;
    if(!game||game.phase==='finished'){room.deadline=0;return;}
    const key=[game.id,game.phase,game.turn,game.current,game.sequence,game.pending?.kind==='meld'?game.pending.actor:''].join(':');
    if(room.deadlineKey===key)return;
    room.deadlineKey=key;room.actionKey=randomUUID();room.stageAt=this.now();
    room.deadline=room.stageAt+(game.phase==='claim'?this.claimMs:this.turnMs);
  }
  newRoom(options){
    if(this.rooms.size>=this.maxRooms)fail('牌桌暂时已满，请稍后再来');
    let code;do{code=String(randomInt(100000,1000000));}while(this.rooms.has(code));
    const room={code,owner:0,base:[100,200,500].includes(options.base)?options.base:100,
      ranked:options.ranked===true,rounds:[1,4,8].includes(options.rounds)?options.rounds:4,
      rules:tableRules(options.rules),round:0,dealer:0,totals:[0,0,0,0],
      seats:Array(4).fill(null),game:null,revision:0,updatedAt:this.now(),deadline:0};
    this.rooms.set(code,room);return room;
  }
  start(room){
    if(room.lineupChanged)this.resetSeries(room);
    room.round++;
    const name=room.ranked?'真人排位':'好友房 · '+room.code;
    room.game=createGame({rng:this.rng,base:room.base,room:name,now:this.now(),rules:room.rules,
      difficulty:'smart',dealer:room.dealer,humanSeats:room.seats.filter(p=>!p.bot).map(p=>p.id),names:room.seats.map(p=>p.name)});
    this.changed(room);
  }
  join(session,room,name,notify=true){
    let id=room.seats.findIndex(p=>!p);
    if(id<0)id=room.seats.findIndex(p=>p?.bot);
    if(id<0)fail('房间已满，请换一桌');
    if(room.round)room.lineupChanged=true;
    this.queue.delete(session.token);
    room.seats[id]={id,token:session.token,name:cleanName(name),ready:room.ranked,auto:false};
    session.room=room.code;session.seat=id;this.saveSession(session);if(notify)this.changed(room);
  }
  resetSeries(room){
    room.round=0;room.totals=[0,0,0,0];room.dealer=room.owner;room.lineupChanged=false;
  }
  match(session,name){
    if(session.room)fail('请先离开当前房间');
    this.queue.set(session.token,{session,name:cleanName(name)});
    const queued=[...this.queue.values()].filter(entry=>entry.session.connected&&!entry.session.room);
    if(queued.length>=4){
      const room=this.newRoom({ranked:true,rounds:1});
      for(const entry of queued.slice(0,4))this.join(entry.session,room,entry.name,false);
      this.start(room);
    }
    return {waiting:session.room?0:this.queue.size};
  }
  redeem(session,code){
    if(session.room||session.profile?.games)fail('请在未开过联机牌局的新设备上恢复账号');
    const key=String(code||'').trim().toUpperCase(),entry=this.codes.get(key);
    const account=this.sessions.get(entry?.token);
    if(!entry||entry.expiresAt<=this.now()||!account)fail('转移码无效或已过期');
    if(account===session)fail('当前设备已是该账号');
    const previousToken=account.token,newToken=randomUUID()+randomUUID();
    this.codes.delete(key);
    for(const token of [session.token,previousToken]){
      this.queue.delete(token);this.sessions.delete(token);this.checkpoints?.update('session:'+token,null);
    }
    account.token=newToken;this.sessions.set(newToken,account);this.saveSession(account);
    const room=this.rooms.get(account.room);
    if(room){room.seats[account.seat].token=newToken;this.changed(room);}
    return {account,previousToken};
  }
  command(session,message){
    const type=message.type;
    if(type==='profile.get')return playerProfile(session);
    if(type==='profile.code'){
      this.saveSession(session);
      return {code:createTransferCode(this.codes,session,this.now())};
    }
    if(type==='replay.get'){
      if(!playerProfile(session).records.some(record=>record.id===message.id))fail('找不到这份牌谱');
      const replay=this.replays.get(message.id);
      if(!replay)fail('这份牌谱保存期限已过');
      return replay;
    }
    if(type==='queue.leave'){this.queue.delete(session.token);return {waiting:0};}
    if(type==='queue.join')return this.match(session,message.name);
    if(type==='room.create'){
      if(session.room)fail('请先离开当前房间');
      this.join(session,this.newRoom({...message,ranked:false}),message.name);return;
    }
    if(type==='room.join'){
      const code=String(message.code||'');
      if(!/^\d{6}$/.test(code))fail('请输入六位房间码');
      const room=this.rooms.get(code);
      if(!room)fail('没有找到这个房间，请核对房间码');
      if(session.room===code)return;
      if(room.ranked)fail('这桌是公开匹配牌局');
      if(session.room)fail('请先离开当前房间');
      if(room.game)fail('这桌已经开局，暂时不能中途加入');
      this.join(session,room,message.name);return;
    }
    const room=this.roomFor(session),id=session.seat,seat=room.seats[id],game=room.game;
    if(!seat||seat.token!==session.token)fail('座位凭证已失效');
    if(type==='room.leave'){
      if(game&&game.phase!=='finished')fail('对局中请开启托管并返回大厅，结算后可退出');
      room.seats[id]=null;session.room=null;session.seat=null;this.saveSession(session);
      if(room.round)room.lineupChanged=true;
      const next=room.seats.findIndex(p=>p&&!p.bot);
      if(next<0)this.removeRoom(room);
      else{if(room.owner===id)room.owner=next;this.changed(room);}
      return;
    }
    if(type==='room.bots'){
      if(room.owner!==id||game||room.ranked)fail('候场时由房主调整电脑座位');
      if(room.round&&room.seats.some(p=>message.enabled?!p:p?.bot))room.lineupChanged=true;
      for(let i=0;i<4;i++){
        if(message.enabled&&!room.seats[i])room.seats[i]={id:i,bot:true,name:'电脑 '+(i+1),ready:true,auto:true};
        if(!message.enabled&&room.seats[i]?.bot)room.seats[i]=null;
      }
      this.changed(room);return;
    }
    if(type==='room.ready'){
      if(game)fail('请等待房主返回候场区');
      seat.ready=!!message.ready;this.changed(room);return;
    }
    if(type==='room.start'){
      if(room.owner!==id)fail('只有房主可以开始');
      if(game)fail('本局已经开始');
      if(room.seats.some(p=>!p||!p.ready||(!p.bot&&!this.sessions.get(p.token)?.connected)))
        fail('需要四个座位齐全，真人全部在线并准备好');
      this.start(room);return;
    }
    if(type==='room.reset'){
      if(room.owner!==id)fail('请等待房主开始下一局');
      if(!game||game.phase!=='finished')fail('请先完成当前对局');
      if(room.ranked)fail('排位已结束，请返回匹配入口');
      if(room.round>=room.rounds||room.lineupChanged)this.resetSeries(room);
      room.game=null;
      for(const p of room.seats)if(p){p.ready=!!p.bot;p.auto=!!p.bot;}
      this.changed(room);return;
    }
    if(!game||game.phase==='finished')fail('当前没有进行中的牌局');
    if(type==='game.auto'){seat.auto=!!message.enabled;this.changed(room);return;}
    if(message.gameId!==game.id)fail('牌局已更新，请等待同步');
    const simultaneous=['game.exchange','game.que'].includes(type)||(type==='game.claim'&&game.pending?.kind==='win');
    const stale=message.actionKey!==undefined?message.actionKey!==room.actionKey:message.revision!==room.revision&&!simultaneous;
    if(stale)fail('牌桌刚刚更新，请重试');
    let ok=false;
    if(type==='game.exchange')ok=exchangeTiles(game,message.indices,id);
    else if(type==='game.que')ok=chooseQue(game,message.suit,id);
    else if(type==='game.claim')ok=respond(game,message.action,id);
    else if(game.current===id){
      if(type==='game.discard'&&Number.isInteger(message.tile))ok=discard(game,message.tile,id);
      if(type==='game.hu')ok=selfWin(game);
      if(type==='game.kong'&&Number.isInteger(message.tile))ok=concealedKong(game,message.tile);
      if(type==='game.added'&&Number.isInteger(message.tile))ok=addedKong(game,message.tile);
    }
    if(!ok)fail('当前不能执行此操作，请检查轮次或牌型');
    this.changed(room);
  }
  automatic(room,id){
    const game=room.game,p=game.players[id];
    if(p.win&&game.rules?.mode!=='flow')return false;
    if(game.phase==='exchange'&&!game.exchangeChoices[id])return exchangeTiles(game,chooseExchangeIndices(p),id);
    if(game.phase==='que'&&p.que<0){
      const counts=[0,1,2].map(suit=>p.hand.filter(t=>suitOf(t)===suit).length);
      return chooseQue(game,counts.indexOf(Math.min(...counts)),id);
    }
    if(game.phase==='claim'){
      const pending=game.pending;
      if(pending.kind==='win'&&pending.wins.includes(id)&&pending.answers[id]===undefined)return respond(game,'hu',id);
      if(pending.kind==='meld'&&pending.actor===id)return respond(game,pending.options.includes('kong')?'kong':'pong',id);
    }
    if(game.phase==='discard'&&game.current===id){
      if(room.seats[id].bot)return step(game);
      if(selfWin(game))return true;
      const kongs=concealedKongs(game);if(kongs.length)return concealedKong(game,kongs[0]);
      const additions=addedKongs(game);if(additions.length)return addedKong(game,additions[0]);
      return discard(game,p.win?game.lastDraw:bestDiscard(p,'smart'),id);
    }
    return false;
  }
  removeRoom(room){
    for(const seat of room.seats){
      const session=this.sessions.get(seat?.token);
      if(session){session.room=null;session.seat=null;this.saveSession(session);}
    }
    this.rooms.delete(room.code);this.checkpoints?.update('room:'+room.code,null);
  }
  tick(){
    const now=this.now();
    for(const room of this.rooms.values()){
      const game=room.game;
      if(game&&game.phase!=='finished'&&!room.restoreTimer){
        this.arm(room);
        const expired=now>=room.deadline;
        if(now-room.stageAt>=550){
          for(const seat of room.seats){
            if(!expired&&!seat.auto)continue;
            if(!this.automatic(room,seat.id))continue;
            if(expired&&!this.sessions.get(seat.token)?.connected)seat.auto=true;
            this.changed(room);break;
          }
        }
      }
      const connected=room.seats.filter(p=>p&&!p.bot&&this.sessions.get(p.token)?.connected);
      if(now-room.updatedAt>twoHours&&!connected.length){this.removeRoom(room);continue;}
      const host=this.sessions.get(room.seats[room.owner]?.token);
      if((!game||game.phase==='finished')&&connected.length&&!host?.connected&&now-(host?.lastSeen??room.updatedAt)>30000){
        room.owner=connected[0].id;this.changed(room);
      }
    }
    for(const [token,session] of this.sessions)if(!session.room&&!session.connected&&!session.profile?.games&&now-session.lastSeen>twoHours){
      this.sessions.delete(token);this.checkpoints?.update('session:'+token,null);
    }
    for(const [code,entry] of this.codes)if(entry.expiresAt<=now)this.codes.delete(code);
  }
  view(session){
    const room=this.rooms.get(session.room);if(!room)return null;
    const id=session.seat,rotate=i=>(i-id+4)%4,order=fn=>Array.from({length:4},(_,i)=>fn((i+id)%4,i));
    const seats=order((seat,i)=>{
      const p=room.seats[seat];
      return p?{id:i,name:p.name,ready:p.ready,auto:p.auto,bot:!!p.bot,connected:!!p.bot||!!this.sessions.get(p.token)?.connected}:null;
    });
    const out={code:room.code,revision:room.revision,actionKey:room.actionKey,owner:rotate(room.owner),base:room.base,seats,
      deadline:room.deadline,serverNow:this.now(),game:null,rules:room.rules,round:room.round,rounds:room.rounds,
      totals:order(i=>room.totals[i]),ranked:room.ranked,dealer:rotate(room.dealer),lineupChanged:!!room.lineupChanged};
    const game=room.game;if(!game)return out;
    let phase=game.phase,pending=null;
    if(phase==='exchange'&&game.exchangeChoices[id])phase='exchange-wait';
    if(phase==='que'&&game.players[id].que>=0)phase='que-wait';
    if(phase==='claim'){
      const p=game.pending;
      const canRespond=p.kind==='win'?p.wins.includes(id)&&p.answers[id]===undefined:p.actor===id;
      if(canRespond)pending={kind:p.kind,from:rotate(p.from),tile:p.tile,options:[...p.options],actor:0,rob:!!p.context?.rob};
      else phase='waiting';
    }
    const players=order((seat,i)=>{
      const p=game.players[seat];
      return {id:i,name:p.name,hand:seat===id?[...p.hand]:Array(p.hand.length).fill(-1),discards:[...p.discards],score:p.score,
        que:game.phase==='que'&&seat!==id?-1:p.que,win:p.win?{...p.win,from:rotate(p.win.from)}:null,
        melds:p.melds.map(m=>({kind:m.kind,from:rotate(m.from),tiles:m.kind==='concealed'&&seat!==id?Array(4).fill(-1):[...m.tiles]}))};
    });
    const events=game.events.map(e=>{
      const event={...e,player:e.player===null?null:rotate(e.player)};
      if(e.player!==id&&e.type==='draw')event.tile=null;
      if(e.player!==id&&e.type==='kong'){event.text=game.players[e.player].name+'杠牌';event.tile=null;}
      return event;
    });
    out.game={id:game.id,version:game.version,online:true,players,phase,pending,wall:Array(game.wall.length).fill(-1),current:rotate(game.current),
      lastDraw:game.current===id?game.lastDraw:null,lastDiscard:game.lastDiscard?{...game.lastDiscard,from:rotate(game.lastDiscard.from)}:null,
      turn:game.turn,sequence:game.sequence,exchangeSelection:[],exchangeReceived:game.exchangeReceivedBySeat?.[id]||[],base:game.base,room:game.room,
      rules:game.rules,dealer:rotate(game.dealer),justClaimed:game.justClaimed,startedAt:game.startedAt,endedAt:game.endedAt,
      reason:game.reason,winners:game.winners.map(rotate),drawSettled:!!game.drawSettled,events,
      settlements:game.settlements.map(x=>({...x,from:rotate(x.from),to:rotate(x.to)})),
      readyStatus:game.readyStatus?.map(x=>({...x,id:rotate(x.id)}))||[]};
    if(phase==='finished'){
      out.game.wins=game.wins.map(w=>({...w,id:rotate(w.id),from:rotate(w.from)}));
      out.game.ledger=game.ledger.map(l=>({...l,from:rotate(l.from),to:rotate(l.to)}));
    }
    return out;
  }
}
