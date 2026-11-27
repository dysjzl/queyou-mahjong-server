import {randomBytes} from 'node:crypto';

export function playerProfile(session){
  session.profile??={rating:1000,games:0,wins:0,records:[]};
  return session.profile;
}

export function recordRound(service,room){
  const game=room.game;
  if(game.phase!=='finished'||room.settledId===game.id)return;
  room.settledId=game.id;
  const rated=room.ranked&&room.seats.every(s=>s&&!s.bot);
  const ratings=room.seats.map(s=>playerProfile(service.sessions.get(s.token)||{}).rating);
  room.totals=room.totals.map((score,id)=>score+game.players[id].score);
  for(const seat of room.seats){
    const session=service.sessions.get(seat.token);
    if(!session)continue;
    const profile=playerProfile(session),p=game.players[seat.id];
    if(rated){
      let delta=0;
      for(const other of game.players){
        if(other.id===p.id)continue;
        const actual=p.score===other.score?0.5:p.score>other.score?1:0;
        const expected=1/(1+10**((ratings[other.id]-ratings[p.id])/400));
        delta+=actual-expected;
      }
      profile.rating=Math.max(0,profile.rating+Math.round(12*delta));
    }
    profile.games++;if(p.win)profile.wins++;
    profile.records.unshift({id:game.id,name:game.room,mode:game.rules?.mode,at:game.endedAt,
      score:p.score,won:!!p.win,ranked:rated,round:room.round,rating:profile.rating});
    profile.records.length=Math.min(profile.records.length,30);
    service.saveSession(session);
  }
  service.archiveReplay(game.id,{
    frames:game.replay||[],totals:[...room.totals],wins:game.wins||[],ledger:game.ledger,finishedAt:service.now()
  });
  room.dealer=game.winners[0]??(game.dealer+1)%4;
}

export function createTransferCode(codes,session,now){
  let code;
  do{code=randomBytes(6).toString('hex').toUpperCase();}while(codes.has(code));
  for(const [key,value] of codes)if(value.token===session.token||value.expiresAt<=now)codes.delete(key);
  codes.set(code,{token:session.token,expiresAt:now+300000});
  return code;
}
