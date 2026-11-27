import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';

export async function openStorage({databaseURL,file}){
  if(databaseURL){
    const {Pool}=await import('pg');
    const pool=new Pool({connectionString:databaseURL,max:3,connectionTimeoutMillis:8000});
    pool.on('error',error=>console.error('Database connection interrupted:',error.code||error.name));
    await pool.query('CREATE TABLE IF NOT EXISTS queyou_state (key TEXT PRIMARY KEY, body JSONB NOT NULL)');
    const {rows}=await pool.query('SELECT key, body FROM queyou_state');
    return {entries:rows.map(r=>[r.key,r.body]),async save(changes){
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        for(const [key,body] of changes){
          if(body===null)await client.query('DELETE FROM queyou_state WHERE key=$1',[key]);
          else await client.query('INSERT INTO queyou_state(key,body) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET body=EXCLUDED.body',[key,body]);
        }
        await client.query('COMMIT');
      }catch(error){await client.query('ROLLBACK');throw error;}
      finally{client.release();}
    },close:()=>pool.end()};
  }
  const target=resolve(file),temp=target+'.tmp';
  await mkdir(dirname(target),{recursive:true});
  let entries=[];
  try{entries=JSON.parse(await readFile(target,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const state=new Map(entries);
  return {entries,async save(changes){
    for(const [key,body] of changes){if(body===null)state.delete(key);else state.set(key,JSON.parse(body));}
    await writeFile(temp,JSON.stringify([...state]),{mode:0o600});
    await rename(temp,target);
  },async close(){}};
}

export class Checkpoints{
  constructor(storage){
    this.storage=storage;this.pending=new Map();this.inFlight=null;
  }
  update(key,value){
    this.pending.set(key,value);
  }
  async flush(){
    while(this.inFlight)await this.inFlight;
    if(!this.pending.size)return;
    const changes=[...this.pending].map(([key,value])=>[key,value===null?null:JSON.stringify(value)]);
    this.pending.clear();
    this.inFlight=this.storage.save(changes);
    try{await this.inFlight;}
    catch(error){
      for(const [key,json] of changes)if(!this.pending.has(key))this.pending.set(key,json===null?null:JSON.parse(json));
      throw error;
    }finally{this.inFlight=null;}
  }
}
