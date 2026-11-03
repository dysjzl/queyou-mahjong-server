import {ONLINE_URL} from './online-config.js';
const local=/^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const backendHost=location.hostname.endsWith('.onrender.com');
export const backendURL=ONLINE_URL||(local||backendHost?location.origin:'');
const get=k=>{try{return localStorage.getItem(k);}catch{return null;}};
const set=(k,v)=>{try{if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v);}catch{}};
export class RoomConnection extends EventTarget{
  constructor(){super();this.room=null;this.status='idle';this.ws=null;this.pending=new Map();this.retry=0;this.stopped=false;this.key='queyou.online.'+backendURL;this.remembered=!!get(this.key+'.joined');}
  emit(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
  connect(){
    if(this.status==='connected')return Promise.resolve();if(this.ready)return this.ready;
    if(!backendURL)return Promise.reject(new Error('联机服务尚未上线，当前可继续单机练习'));
    this.stopped=false;this.status='connecting';this.emit('status',this.status);
    this.ready=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;});
    if(!this.reconnect&&(!this.ws||this.ws.readyState>1))this.open();return this.ready;
  }
  open(){
    if(this.stopped)return;const url=new URL('/ws',backendURL);url.protocol=url.protocol==='https:'?'wss:':'ws:';
    const ws=new WebSocket(url);this.ws=ws;
    ws.addEventListener('open',()=>ws.send(JSON.stringify({type:'hello',token:get(this.key+'.token')})));
    ws.addEventListener('message',event=>{
      let m;try{m=JSON.parse(event.data);}catch{return;}
      if(m.type==='hello'){
        set(this.key+'.token',m.token);this.status='connected';this.retry=0;this.resolveReady?.();this.ready=null;this.emit('status',this.status);
        clearInterval(this.heartbeat);this.heartbeat=setInterval(()=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'ping'}));},20000);
      }
      if(m.type==='state'){
        if(m.room&&this.room?.code===m.room.code&&this.room.revision>=m.room.revision)return;
        const lost=(this.room||this.remembered)&&!m.room;this.room=m.room;this.receivedAt=Date.now();this.remembered=!!m.room;set(this.key+'.joined',m.room?'1':null);this.emit('state',m.room);
        if(lost)this.emit('notice','已离开房间，或服务器重启后房间已失效');
      }
      if(m.type==='ack'){
        const p=this.pending.get(m.requestId);if(!p)return;clearTimeout(p.timer);this.pending.delete(m.requestId);m.ok?p.resolve():p.reject(new Error(m.error||'操作未成功'));
      }
      if(m.type==='error')this.emit('notice',m.error);
    });
    ws.addEventListener('close',event=>{
      clearInterval(this.heartbeat);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('连接已中断，正在重新同步'));}this.pending.clear();
      if(this.stopped)return;
      if(event.code===4001){this.stopped=true;this.status='displaced';this.rejectReady?.(new Error('此座位已在另一个页面打开'));this.ready=null;this.emit('status',this.status);this.emit('notice','此座位已在另一个页面打开，请关闭重复页面');return;}
      this.status='reconnecting';this.emit('status',this.status);this.retry++;
      this.reconnect=setTimeout(()=>{this.reconnect=null;this.open();},Math.min(1000*2**Math.min(this.retry,4),15000));
    });
    ws.addEventListener('error',()=>{});
  }
  async request(type,payload={}){
    await this.connect();if(this.ws?.readyState!==WebSocket.OPEN)throw new Error('正在恢复连接，请稍后再试');
    const requestId=crypto.randomUUID(),g=this.room?.game;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(requestId);reject(new Error('服务器响应超时，请等待同步后再试'));},15000);
      this.pending.set(requestId,{resolve,reject,timer});this.ws.send(JSON.stringify({type,requestId,gameId:g?.id,revision:this.room?.revision,...payload}));
    });
  }
  close(){this.stopped=true;clearTimeout(this.reconnect);clearInterval(this.heartbeat);this.ws?.close();this.status='idle';this.ready=null;}
}
