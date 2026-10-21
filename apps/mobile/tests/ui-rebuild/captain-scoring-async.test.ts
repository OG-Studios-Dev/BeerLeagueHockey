import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mountScoring, players, React, snapshot, scope, deferred } from './captain-scoring-screen.test';

class ScoringClock {
  now = 0;
  private sequence = 0;
  jobs = new Map<number, { run: () => void; at: number }>();
  set = (run: () => void, delay: number) => {
    const id = ++this.sequence;
    this.jobs.set(id, { run, at: this.now + delay });
    return id;
  };
  clear = (id: number) => { this.jobs.delete(id); };
  async advance(ms: number) {
    const target = this.now + ms;
    let fired = 0;
    for (;;) {
      const next = [...this.jobs].filter(([,job]) => job.at <= target).sort((a,b) => a[1].at-b[1].at || a[0]-b[0])[0];
      if (!next) break;
      assert.ok(++fired < 200, 'bounded product timer delivery');
      this.now = next[1].at;
      this.jobs.delete(next[0]);
      await React.act(async () => next[1].run());
    }
    this.now = target;
  }
}

async function submitGoal(r: Awaited<ReturnType<typeof mountScoring>>) {
  await r.press('scoring-add-goal');
  await r.press(`scoring-player-${players[0].player_id}`);
  await r.press('scoring-continue');
  await r.press(`scoring-player-${players[1].player_id}`);
  await r.press('scoring-continue');
  await r.press(`scoring-player-${players[2].player_id}`);
  await r.press('scoring-save-goal');
}

it('settles a never-ending mutation to unknown at exactly 10000ms in the active wizard without replay', async () => {
  const clock = new ScoringClock();
  const r = await mountScoring({ clock, write: () => new Promise(() => {}) });
  try {
    await submitGoal(r);
    const original = structuredClone(r.calls.writes[0]);
    assert.equal(r.calls.writes.length,1);
    assert.equal(Object.isFrozen(r.calls.writes[0][2]),true);
    assert.deepEqual(original[2], { kind:'add_goal', event_id:'60000000-0000-0000-0000-000000000001', expected_version:null,
      scorer_id:players[0].player_id, assist1_id:players[1].player_id, assist2_id:players[2].player_id });
    await clock.advance(9999);
    assert.equal(r.props.get('scoring-save-goal').disabled,true);
    assert.equal(r.dom.window.document.querySelector('[data-testid="scoring-retry-same-request"]'),null);
    assert.match(r.text(),/Saving…/);
    await clock.advance(1);
    const wizard = r.dom.window.document.querySelector('[data-testid="scoring-wizard"]');
    assert.ok(wizard, 'the original wizard stays open without blur');
    assert.match(wizard.textContent,/Result unknown/, 'deadline must settle pending to unknown');
    assert.ok(wizard.querySelector('[data-testid="scoring-retry-same-request"]'));
    assert.ok(wizard.querySelector('[data-testid="scoring-reconcile"]'));
    assert.doesNotMatch(wizard.textContent,/failed|rolled back|Saved/);
    const reads = r.calls.reads.length;
    await r.press('scoring-reconcile');
    assert.ok(r.calls.reads.length > reads);
    await clock.advance(30000);
    assert.equal(r.calls.writes.length,1, 'deadline, refresh, and polling never replay');
    assert.deepEqual(r.calls.writes[0],original);
    assert.match(wizard.textContent,/Goal: Zoe Full Name · First: Alex First Name/);
    assert.equal(r.props.get(`scoring-player-${players[2].player_id}`).accessibilityState.selected,true);
  } finally { await r.close(); }
});

it('rejects an expired original completion while the identical explicit retry owns pending and unknown state', async () => {
  const clock = new ScoringClock();
  const original = deferred(), retry = deferred();
  let attempts = 0;
  const r = await mountScoring({ clock, write: () => ++attempts === 1 ? original.promise : retry.promise });
  try {
    await r.edit('scoring-commentary','Unsaved local note');
    await submitGoal(r);
    const request = structuredClone(r.calls.writes[0]);
    await clock.advance(10000);
    await r.press('scoring-retry-same-request');
    assert.equal(r.calls.writes.length,2);
    assert.deepEqual(r.calls.writes[1],request, 'retry keeps the entire original UUID, scope and command');
    assert.equal(r.calls.writes[1][2],r.calls.writes[0][2], 'retry reuses the frozen command object');
    await clock.advance(9999);
    const late = snapshot(); late.revision='999'; late.game.home_score=99;
    late.commentary={text:'Obsolete response',version:99};
    await React.act(async () => original.resolve({outcome:'applied',snapshot:late}));
    assert.ok(r.dom.window.document.querySelector('[data-testid="scoring-wizard"]'), 'expired attempt must not close the current wizard');
    assert.doesNotMatch(r.text(),/Saved/, 'expired attempt must not report success');
    assert.equal(r.props.get('scoring-save-goal').disabled,true);
    assert.equal(r.dom.window.document.querySelector('[data-testid="scoring-retry-same-request"]'),null);
    assert.equal(r.props.get('scoring-score-own').children,0);
    assert.equal(r.props.get('scoring-commentary').value,'Unsaved local note');
    assert.equal(r.props.get(`scoring-player-${players[2].player_id}`).accessibilityState.selected,true);
    await clock.advance(1);
    assert.match(r.text(),/Result unknown/, 'old completion cannot clear the retry deadline');
    assert.ok(r.dom.window.document.querySelector('[data-testid="scoring-wizard"] [data-testid="scoring-retry-same-request"]'));
    assert.equal(r.calls.writes.length,2);
  } finally { await r.close(); }
});

for (const outcome of ['applied','replayed','rejected','conflict','rejected-error','unknown-error']) {
  it(`clears the mutation UI deadline on fast ${outcome} settlement without an automatic retry`, async () => {
    const clock = new ScoringClock(), held = deferred();
    const r = await mountScoring({ clock, write: () => held.promise });
    try {
      await r.edit('scoring-commentary','My immutable note');
      const before = new Set(clock.jobs.keys());
      await r.press('scoring-save-commentary');
      const deadlineIds = [...clock.jobs.keys()].filter(id => !before.has(id));
      assert.equal(deadlineIds.length,1);
      assert.equal(clock.jobs.get(deadlineIds[0])?.at,10000);
      await clock.advance(250);
      const canonical = snapshot(); canonical.revision='2'; canonical.commentary={text:'My immutable note',version:2};
      await React.act(async () => {
        if (outcome.endsWith('-error')) held.reject(new r.RpcError(outcome === 'unknown-error' ? 'unknown' : 'rejected','Explicit helper rejection'));
        else held.resolve({outcome,code:'commentary_version_conflict',snapshot:canonical});
      });
      assert.equal(clock.jobs.has(deadlineIds[0]),false, 'settled attempt clears its owned deadline');
      if (outcome === 'applied' || outcome === 'replayed') assert.match(r.text(),/Saved/);
      else if (outcome === 'unknown-error') assert.match(r.text(),/Result unknown/);
      else assert.match(r.text(),/Not saved|Explicit helper rejection/);
      await clock.advance(20000);
      assert.equal(r.calls.writes.length,1);
      assert.equal(r.props.get('scoring-commentary').value,'My immutable note');
      if (outcome !== 'unknown-error') assert.equal(r.dom.window.document.querySelector('[data-testid="scoring-retry-same-request"]'),null);
    } finally { await r.close(); }
    assert.equal(clock.jobs.size,0);
  });
}

for (const outcome of ['replayed','rejected','rejected-error','unknown-error']) {
  it(`ignores late original ${outcome} and late retry settlement without clearing the current recovery journal`, async () => {
    const clock = new ScoringClock(), original = deferred(), retry = deferred();
    let n = 0;
    const r = await mountScoring({clock,write:() => ++n === 1 ? original.promise : n === 2 ? retry.promise : {outcome:'replayed',snapshot:null}});
    try {
      await r.edit('scoring-commentary','Retain this local draft');
      await r.press('scoring-save-commentary');
      const request = structuredClone(r.calls.writes[0]);
      await clock.advance(10000);
      const explicitRetry = r.props.get('scoring-retry-same-request').onPress;
      await r.press('scoring-retry-same-request');
      await React.act(async () => explicitRetry());
      assert.equal(r.calls.writes.length,2, 'saved retry callbacks cannot double-send while pending');
      assert.deepEqual(r.calls.writes[1],request);
      await React.act(async () => {
        if (outcome.endsWith('-error')) original.reject(new r.RpcError(outcome === 'unknown-error' ? 'unknown' : 'rejected','Obsolete rejection'));
        else {
          const late = snapshot(); late.revision='999'; late.game.home_score=99; late.commentary={text:'Obsolete text',version:99};
          original.resolve({outcome,code:'obsolete',snapshot:late});
        }
      });
      assert.equal(r.props.get('scoring-save-commentary').disabled,true);
      assert.match(r.text(),/Saving…/);
      assert.doesNotMatch(r.text(),/Saved|Not saved|Obsolete rejection|Result unknown/);
      assert.equal(r.props.get('scoring-score-own').children,0);
      assert.equal(r.props.get('scoring-commentary').value,'Retain this local draft');
      await clock.advance(10000);
      assert.match(r.text(),/Result unknown/);
      await React.act(async () => retry.reject(new Error('late retry transport rejection')));
      assert.match(r.text(),/Result unknown/);
      assert.ok(r.dom.window.document.querySelector('[data-testid="scoring-retry-same-request"]'));
      assert.equal(r.calls.writes.length,2);
      await r.press('scoring-retry-same-request');
      assert.equal(r.calls.writes.length,3);
      assert.deepEqual(r.calls.writes[2],request);
      assert.match(r.text(),/Saved/);
    } finally { await r.close(); }
    assert.equal(clock.jobs.size,0);
  });
}

it('ignores an original success that arrives while the timed-out request remains unknown before any retry', async () => {
  const clock = new ScoringClock(), held = deferred();
  const r = await mountScoring({clock,write:() => held.promise});
  try {
    await r.edit('scoring-commentary','Local draft survives late success');
    await r.press('scoring-save-commentary');
    await clock.advance(10000);
    const late = snapshot(); late.revision='999'; late.commentary={text:'Obsolete',version:99};
    await React.act(async () => held.resolve({outcome:'applied',snapshot:late}));
    assert.match(r.text(),/Result unknown/);
    assert.doesNotMatch(r.text(),/Saved/);
    assert.equal(r.props.get('scoring-commentary').value,'Local draft survives late success');
    assert.ok(r.dom.window.document.querySelector('[data-testid="scoring-retry-same-request"]'));
    await clock.advance(20000);
    assert.equal(r.calls.writes.length,1);
  } finally { await r.close(); }
  assert.equal(clock.jobs.size,0);
});

for (const mode of ['blur','background','actor-ABA','scope-ABA','unmount']) {
  it(`revokes the pending mutation attempt and clears its deadline across ${mode}`, async () => {
    const clock = new ScoringClock(), held = deferred();
    const r = await mountScoring({clock,write:() => held.promise});
    let closed = false;
    try {
      await r.edit('scoring-commentary','Retained request');
      const before = new Set(clock.jobs.keys());
      await r.press('scoring-save-commentary');
      const deadlineId = [...clock.jobs.keys()].find(id => !before.has(id))!;
      const request = structuredClone(r.calls.writes[0]);
      await clock.advance(4000);
      if (mode === 'unmount') { await r.close(); closed=true; }
      else if (mode === 'blur') await r.focus(false);
      else if (mode === 'background') await React.act(async () => r.calls.appState('background'));
      else if (mode === 'actor-ABA') { await r.actor('captain-b'); await r.actor('captain-a'); }
      else { await r.route({...scope,gameId:'30000000-0000-0000-0000-000000000002'}); await r.route(scope); }
      assert.equal(clock.jobs.has(deadlineId),false);
      if (mode === 'blur' || mode === 'background' || mode === 'unmount') assert.equal(clock.jobs.size,0);
      await clock.advance(20000);
      assert.equal(r.calls.writes.length,1);
      if (mode === 'blur') await r.focus(true);
      else if (mode === 'background') await React.act(async () => r.calls.appState('active'));
      const late = snapshot(); late.revision='999'; late.game.home_score=99;
      await React.act(async () => held.resolve({outcome:'applied',snapshot:late}));
      if (!closed) {
        assert.equal(r.props.get('scoring-score-own').children,0);
        assert.doesNotMatch(r.text(),/Saved/);
        assert.ok(r.dom.window.document.querySelector('[data-testid="scoring-retry-same-request"]'));
        await r.press('scoring-retry-same-request');
        assert.equal(r.calls.writes.length,2);
        assert.deepEqual(r.calls.writes[1],request);
      } else assert.equal(clock.jobs.size,0);
    } finally { if (!closed) await r.close(); }
    assert.equal(clock.jobs.size,0);
  });
}

for (const kind of ['update_goal','remove_goal','scratch','reinstate','set_commentary']) {
  it(`keeps the full immutable ${kind} command for explicit deadline recovery in its active surface`, async () => {
    const clock = new ScoringClock();
    const goal = {event_id:'60000000-0000-0000-0000-000000000009',event_version:4,team_id:scope.teamId,scorer_id:players[0].player_id,assist1_id:null,assist2_id:null,entered_at:'2026-10-20T23:00:00Z',can_edit:true,blocked_reason:null};
    const current = {...snapshot(),own_goals:[goal]};
    if (kind === 'reinstate') { current.roster[0].state='scratched'; current.roster[0].eligible_for_goal=false; }
    const r = await mountScoring({clock,snapshot:current,write:() => new Promise(() => {})});
    try {
      let surface = 'scoring-body';
      if (kind === 'set_commentary') { await r.edit('scoring-commentary','Exact full note'); await r.press('scoring-save-commentary'); }
      else if (kind === 'scratch' || kind === 'reinstate') {
        await r.press('scoring-checked-in'); await r.press(`scoring-${kind}-${players[0].player_id}`); surface='scoring-roster';
      } else {
        await r.press(`scoring-actions-${goal.event_id}`);
        if (kind === 'remove_goal') { await r.press('scoring-remove-goal'); await r.press('scoring-confirm-remove'); surface='scoring-remove-confirmation'; }
        else { await r.press('scoring-edit-goal'); await r.press('scoring-continue'); await r.press('scoring-save-goal'); surface='scoring-wizard'; }
      }
      assert.equal(r.calls.writes.length,1);
      const request = structuredClone(r.calls.writes[0]);
      assert.equal(request[2].kind,kind);
      assert.equal(Object.isFrozen(r.calls.writes[0][2]),true);
      await clock.advance(9999);
      assert.equal(r.dom.window.document.querySelector('[data-testid="scoring-retry-same-request"]'),null);
      await clock.advance(1);
      const active = r.dom.window.document.querySelector(`[data-testid="${surface}"]`);
      assert.ok(active?.querySelector('[data-testid="scoring-retry-same-request"]'));
      assert.ok(active?.querySelector('[data-testid="scoring-reconcile"]'));
      assert.match(active.textContent,/Result unknown/);
      await r.press('scoring-reconcile');
      assert.equal(r.calls.writes.length,1);
      await r.press('scoring-retry-same-request');
      assert.equal(r.calls.writes.length,2);
      assert.deepEqual(r.calls.writes[1],request);
      assert.equal(r.calls.writes[1][2],r.calls.writes[0][2]);
    } finally { await r.close(); }
    assert.equal(clock.jobs.size,0);
  });
}

it('revokes saved wizard callbacks on close even when the same draft is reopened',async()=>{
 const r=await mountScoring();try{await r.press('scoring-add-goal');await r.press(`scoring-player-${players[0].player_id}`);await r.press('scoring-continue');await r.press('scoring-unassisted');const saved=r.props.get('scoring-save-goal').onPress;await React.act(async()=>r.dom.window.document.querySelector('[aria-label="Close goal entry"]').click());await r.press('scoring-add-goal');await React.act(async()=>saved());assert.equal(r.calls.writes.length,0);}finally{await r.close();}
});
it('keeps an obsolete pending operation unknown after blur while a later same-request retry owns completion',async()=>{
 let finish: (v:unknown)=>void=()=>{};const held=new Promise(resolve=>{finish=resolve;});let n=0;
 const r=await mountScoring({write:async()=>++n===1?held:{outcome:'rejected',code:'player_not_eligible',snapshot:null}});try{
 await r.press('scoring-add-goal');await r.press(`scoring-player-${players[0].player_id}`);await r.press('scoring-continue');await r.press('scoring-unassisted');await r.press('scoring-save-goal');await r.focus(false);await r.focus(true);
 assert.ok(r.dom.window.document.querySelector('[data-testid="scoring-retry-same-request"]'));await r.press('scoring-retry-same-request');assert.equal(r.calls.writes.length,2);await React.act(async()=>finish({outcome:'applied',snapshot:null}));assert.match(r.text(),/Not saved/);assert.equal(r.calls.writes[0][1],r.calls.writes[1][1]);
 }finally{await r.close();}
});

it('queues repeated invalidations behind one read and rejects actor ABA callbacks',async()=>{const held=deferred();let n=0;const r=await mountScoring({read:async()=>++n===2?held.promise:{outcome:'ok',snapshot:snapshot()}});try{await r.press('scoring-add-goal');await r.press(`scoring-player-${players[0].player_id}`);await r.press('scoring-continue');await r.press('scoring-unassisted');const save=r.props.get('scoring-save-goal').onPress;await r.update(snapshot());await r.update(snapshot());await r.update(snapshot());assert.equal(r.calls.reads.length,2);await React.act(async()=>held.resolve({outcome:'ok',snapshot:snapshot()}));assert.equal(r.calls.reads.length,3);await r.actor('captain-b');await r.actor('captain-a');await React.act(async()=>save());assert.equal(r.calls.writes.length,0);await r.route({...scope,gameId:'30000000-0000-0000-0000-000000000002'});await r.route(scope);await React.act(async()=>save());assert.equal(r.calls.writes.length,0);}finally{await r.close();}});

it('renders unknown-result retry inside the visible wizard rather than behind the native modal',async()=>{const r=await mountScoring({write:async()=>{throw new Error('unknown');}});try{await r.press('scoring-add-goal');await r.press(`scoring-player-${players[0].player_id}`);await r.press('scoring-continue');await r.press('scoring-unassisted');await r.press('scoring-save-goal');assert.ok(r.dom.window.document.querySelector('[data-testid="scoring-wizard"] [data-testid="scoring-retry-same-request"]'));assert.equal(r.dom.window.document.querySelectorAll('[data-testid="scoring-retry-same-request"]').length,1);}finally{await r.close();}});

it('offers authoritative reconcile within an unknown-result wizard without replaying its mutation',async()=>{const r=await mountScoring({write:async()=>{throw new Error('unknown');}});try{await r.press('scoring-add-goal');await r.press(`scoring-player-${players[0].player_id}`);await r.press('scoring-continue');await r.press('scoring-unassisted');await r.press('scoring-save-goal');assert.ok(r.dom.window.document.querySelector('[data-testid="scoring-wizard"] [data-testid="scoring-reconcile"]'));const reads=r.calls.reads.length;await r.press('scoring-reconcile');assert.equal(r.calls.writes.length,1);assert.ok(r.calls.reads.length>reads);}finally{await r.close();}});

it('revokes editable controls after authoritative scope rejection while retaining the last confirmed score',async()=>{let n=0;const r=await mountScoring({read:async()=>++n===1?{outcome:'ok',snapshot:snapshot()}:{outcome:'rejected',code:'scope_unavailable',snapshot:null}});try{const open=r.props.get('scoring-add-goal').onPress;await r.update(snapshot());assert.equal(r.props.get('scoring-add-goal').disabled,true);await React.act(async()=>open());assert.equal(r.dom.window.document.querySelector('[data-testid="scoring-wizard"]'),null);assert.equal(r.props.get('scoring-score-opponent').children,2);}finally{await r.close();}});

it('retains an unknown immutable goal request across close and retries only on explicit same-request action', async () => {
  const r = await mountScoring({ write: async () => { throw new Error('unknown transport'); } }); try {
    await r.press('scoring-add-goal'); await r.press(`scoring-player-${players[0].player_id}`); await r.press('scoring-continue'); await r.press('scoring-unassisted'); await r.press('scoring-save-goal');
    assert.equal(r.calls.writes.length,1); const original = structuredClone(r.calls.writes[0]);
    await r.press('scoring-wizard-back'); await r.press('scoring-wizard-back');
    await r.press('scoring-add-goal'); assert.equal(r.calls.writes.length,1);
    await r.press('scoring-retry-same-request'); assert.equal(r.calls.writes.length,2); assert.deepEqual(r.calls.writes[1],original);
    const stale=r.props.get('scoring-save-goal')?.onPress; await r.focus(false); if(stale) await React.act(async()=>stale()); assert.equal(r.calls.writes.length,2);
  } finally { await r.close(); }
});
