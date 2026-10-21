/* eslint-disable supabase-test-quality/no-unscoped-service-test -- node:assert verifies exact league/team/game predicates; this rule recognizes only Jest expect. */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileCommonJs } from './component-harness.ts';
import type * as Observer from '../../src/lib/supabase/captainScoringObserver';
const scope={gameId:'30000000-0000-0000-0000-000000000001',teamId:'40000000-0000-0000-0000-000000000001',leagueId:'10000000-0000-0000-0000-000000000001',seasonId:'20000000-0000-0000-0000-000000000001'};
it('invalidates canonical channels and subscribe/reconnect acks, disposing exactly its own channel',()=>{
 const url=new URL('../../src/lib/supabase/captainScoringObserver.ts',import.meta.url);assert.ok(existsSync(fileURLToPath(url.toString())),'scoring invalidation observer must exist');
 const registrations:{type:string;filter:Record<string,unknown>;callback:()=>void}[]=[];let statusCallback:(s:string)=>void=()=>{};let invalidations=0;const statuses:string[]=[];const removed:unknown[]=[];
 const channel={on(type:string,filter:Record<string,unknown>,callback:()=>void){registrations.push({type,filter,callback});return this;},subscribe(cb:(s:string)=>void){statusCallback=cb;return this;}};
 const api=compileCommonJs<typeof Observer>(url,{'./client':{supabase:{channel:()=>channel,removeChannel:(c:unknown)=>{removed.push(c);return Promise.resolve('ok');}}}});
 const dispose=api.watchCaptainScoring(scope,()=>{invalidations++;},s=>statuses.push(s));
 assert.deepEqual(registrations.map(x=>x.filter),[{event:'*',schema:'public',table:'games',filter:'id=eq.'+scope.gameId},{event:'*',schema:'public',table:'game_events',filter:'game_id=eq.'+scope.gameId},{event:'*',schema:'public',table:'game_checkins',filter:'game_id=eq.'+scope.gameId}]);
 registrations.forEach(x=>x.callback());assert.equal(invalidations,3);
 statusCallback('SUBSCRIBED');statusCallback('CHANNEL_ERROR');statusCallback('SUBSCRIBED');assert.equal(invalidations,5);assert.deepEqual(statuses,['SUBSCRIBED','CHANNEL_ERROR','SUBSCRIBED']);
 dispose();dispose();assert.deepEqual(removed,[channel]);registrations[0].callback();statusCallback('SUBSCRIBED');assert.equal(invalidations,5);
});

it('cleans the actual installed realtime channel without backend sockets or removing another owner',async()=>{
 const {createClient}=await import('@supabase/supabase-js');
 const client=createClient('https://scoring-offline.invalid','offline-public-placeholder',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:()=>{throw Error('Network forbidden');}}});
 const unrelated=client.channel('unrelated');const create=client.channel.bind(client);
 client.channel=((...args:Parameters<typeof create>)=>{const channel=create(...args);channel.subscribe=(()=>channel) as typeof channel.subscribe;return channel;}) as typeof client.channel;
 const api=compileCommonJs<typeof Observer>(new URL('../../src/lib/supabase/captainScoringObserver.ts',import.meta.url),{'./client':{supabase:client}});
 const stop=api.watchCaptainScoring(scope,()=>{});assert.equal(client.getChannels().length,2);stop();await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(client.getChannels(),[unrelated]);await client.removeChannel(unrelated);
});
