/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mountScoring, scope, React } from './captain-scoring-screen.test';
it('opens the independent native scoring target even when there is no future attendance game',async()=>{
 const r=await mountScoring({dashboard:true});try{assert.match(r.text(),/No upcoming game/);await r.press('captain-score-game');assert.deepEqual(r.calls.nav.at(-1),['Scoreboard',scope]);const old=r.props.get('captain-score-game').onPress;await r.actor('captain-b');await React.act(async()=>old());assert.equal(r.calls.nav.length,1);}finally{await r.close();}
});
it('uses the real native header Back to close a sheet first and the dashboard fallback only for a cold sole route',async()=>{
 const r=await mountScoring({canGoBack:false});try{assert.ok(r.calls.header,'screen installs the shared native header');await r.press('scoring-add-goal');await React.act(async()=>r.calls.header().props.onBack());assert.equal(r.calls.nav.length,0);await React.act(async()=>r.calls.header().props.onBack());assert.deepEqual(r.calls.nav.at(-1),['CaptainDashboard']);}finally{await r.close();}
});

it('registers the exact four-ID native Captain route in every route inventory',()=>{
 const read=(p:string)=>readFileSync(fileURLToPath(new URL(`../../src/${p}`,import.meta.url).href),'utf8');
 assert.match(read('navigation/types.ts'),/Scoreboard:.*gameId: string.*teamId: string.*leagueId: string.*seasonId: string/);
 assert.match(read('navigation/index.tsx'),/CaptainStack.Screen name="Scoreboard" component={ScoreboardScreen}/);
 assert.match(read('navigation/screenRegistry.ts'),/'Scoreboard'/);assert.match(read('components/cutIceTitleModel.ts'),/Scoreboard: 'Scoreboard'/);
 const manifest=JSON.parse(read('rebuild/screen-manifest.json'));assert.ok(manifest.routes.find((r:any)=>r.navigator==='CaptainStack'&&r.name==='Scoreboard'));assert.equal(manifest.screens.find((r:any)=>r.id==='scoreboard').evidence.browserReviewed,false);
});
