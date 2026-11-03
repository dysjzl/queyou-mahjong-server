import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {WebSocketServer,WebSocket} from 'ws';
import {RoomService} from './server/rooms.mjs';
const root=path.resolve(fileURLToPath(new URL('./dist/',import.meta.url)));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
export function createAppServer({rooms=new RoomService(),allowedOrigins=[]}={}){
  const extra=new Set([...allowedOrigins,...(process.env.ALLOWED_ORIGINS||'https://dysjzl.github.io').split(',').map(s=>s.trim())]);
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/healthz'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({ok:true,version:'2.0.0'}));return;}
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
    try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname),target=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!target.startsWith(root+path.sep)){res.writeHead(403).end();return;}
      const data=await readFile(target);res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}).end(req.method==='HEAD'?undefined:data);
    }catch{res.writeHead(404).end('Not found');}
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:8192,perMessageDeflate:false}),connections=new Map();
  const send=(ws,data)=>{if(ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<262144)ws.send(JSON.stringify(data));};
  rooms.onChange=r=>{for(const p of r.seats)if(p){const ws=connections.get(p.token),s=rooms.sessions.get(p.token);if(ws&&s)send(ws,{type:'state',room:rooms.view(s)});}};
  server.on('upgrade',(req,socket,head)=>{
    const origin=req.headers.origin,own=`${req.headers['x-forwarded-proto']==='https'?'https':'http'}://${req.headers.host}`,local=origin&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    if(wss.clients.size>=2000){socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');return;}
    if(req.url!=='/ws'||!origin||(!extra.has(origin)&&origin!==own&&!local)){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  });
  wss.on('connection',ws=>{
    let session=null,requests=0,windowAt=Date.now(),alive=true;
    const helloTimeout=setTimeout(()=>{if(!session)ws.close(4000,'Authentication required');},10000);
    ws.on('pong',()=>{alive=true;});ws.isAlive=()=>alive;ws.markDead=()=>{alive=false;};
    ws.on('message',raw=>{
      let m;try{m=JSON.parse(raw.toString());}catch{send(ws,{type:'error',error:'消息格式不正确'});return;}
      if(!m||typeof m!=='object'||typeof m.type!=='string')return;
      if(Date.now()-windowAt>60000){windowAt=Date.now();requests=0;}if(++requests>150){ws.close(4008,'Too many requests');return;}
      if(m.type==='hello'&&!session){try{session=rooms.authenticate(m.token);}catch{ws.close(4008,'Service busy');return;}clearTimeout(helloTimeout);const old=connections.get(session.token);connections.set(session.token,ws);if(old&&old!==ws)old.close(4001,'Another tab resumed this seat');send(ws,{type:'hello',token:session.token});rooms.presence(session,true);send(ws,{type:'state',room:rooms.view(session)});return;}
      if(!session){send(ws,{type:'error',error:'请等待连接完成'});return;}
      if(m.type==='ping'){session.lastSeen=Date.now();send(ws,{type:'pong',serverNow:Date.now()});return;}
      try{rooms.command(session,m);send(ws,{type:'ack',requestId:m.requestId,ok:true});if(m.type==='room.leave')send(ws,{type:'state',room:null});}catch(e){send(ws,{type:'ack',requestId:m.requestId,ok:false,error:e.message});}
    });
    ws.on('close',()=>{clearTimeout(helloTimeout);if(session&&connections.get(session.token)===ws){connections.delete(session.token);rooms.presence(session,false);}});ws.on('error',()=>{});
  });
  const tick=setInterval(()=>rooms.tick(),250),heartbeat=setInterval(()=>{for(const ws of wss.clients){if(!ws.isAlive()){ws.terminate();continue;}ws.markDead();ws.ping();}},30000);tick.unref();heartbeat.unref();
  return {server,rooms,async close(){clearInterval(tick);clearInterval(heartbeat);for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=createAppServer(),port=Number(process.env.PORT)||4173;app.server.listen(port,'0.0.0.0',()=>console.log(`Local: http://127.0.0.1:${port} · WebSocket rooms ready`));
  for(const event of ['SIGTERM','SIGINT'])process.on(event,()=>app.close().then(()=>process.exit(0)));
}
