import * as Crypto from 'expo-crypto';
import { supabase } from './client';

export type ScoringScope = { gameId: string; teamId: string; leagueId: string; seasonId: string };
export type ScoringGoal = { event_id: string; event_version: number; team_id: string; scorer_id: string | null; assist1_id: string | null; assist2_id: string | null; entered_at: string; can_edit: boolean; blocked_reason: "legacy_unattributed" | "not_checked_in" | "capture_complete" | "roster_conflict" | null };
export type ScoringRosterPlayer = { player_id: string; full_name: string | null; jersey_number: number | null; position: string | null; source: "regular" | "team_spare" | "accepted_sub" | "credited_only"; checkin_status: "confirmed" | "tentative" | "out" | null; presence_version: number; state: "checked_in" | "scratched" | "tentative" | "waiting" | "credited_not_eligible" | "unavailable"; eligible_for_goal: boolean; has_credited_stats: boolean; availability_state: "none" | "out" | "unknown" | "conflict"; blocking_goal_ids: (string)[] };
export type ScoringSnapshot = { season_id: string; revision: string; server_time: string; complete: true; game: { status: "scheduled" | "in_progress"; scheduled_at: string; game_started_at: string | null; own_team_type: "home" | "away"; home_team_id: string; away_team_id: string; home_team_name: string | null; away_team_name: string | null; home_score: number; away_score: number; timezone: string; home_team_logo_url: string | null; away_team_logo_url: string | null }; permissions: { can_add_goal: boolean; can_correct_goal: boolean; can_manage_roster: boolean; can_comment: boolean; blocked_reason: "future_game" | "stats_locked" | "capture_complete" | "legacy_score_mismatch" | "roster_conflict" | null }; own_goals: (ScoringGoal)[]; roster: (ScoringRosterPlayer)[]; commentary: { text: string; version: number }; counts: { own_goals: number; roster: number } };
export type ScoringResponse = { schema_version: 1; request_id: string; game_id: string; team_id: string; league_id: string; kind: "get_context" | "add_goal" | "update_goal" | "remove_goal" | "scratch" | "reinstate" | "set_commentary"; outcome: "ok" | "applied" | "replayed" | "conflict" | "rejected"; code: "event_version_conflict" | "presence_version_conflict" | "commentary_version_conflict" | "idempotency_conflict" | "event_id_conflict" | "event_removed" | "event_unavailable" | "player_not_eligible" | "credited_stats_conflict" | "future_game" | "lifecycle_unavailable" | "stats_locked" | "capture_complete" | "legacy_score_mismatch" | "row_bound_exceeded" | "text_bound_exceeded" | "response_bound_exceeded" | "invalid_request" | "scope_unavailable" | null; receipt: { applied_revision: string; event_id: string | null; event_version: number | null; player_id: string | null; presence_version: number | null; commentary_version: number | null; transitioned_to_in_progress: boolean } | null; conflict: { entity: "event" | "presence" | "commentary" | "request"; entity_id: string | null; current_version: number | null } | null; snapshot: ScoringSnapshot | null };
export type ScoringCommand = { kind: "add_goal"; event_id: string; expected_version: null; scorer_id: string; assist1_id: string | null; assist2_id: string | null } | { kind: "update_goal"; event_id: string; expected_version: number; scorer_id: string; assist1_id: string | null; assist2_id: string | null } | { kind: "remove_goal"; event_id: string; expected_version: number } | { kind: "scratch"; player_id: string; expected_version: number } | { kind: "reinstate"; player_id: string; expected_version: number } | { kind: "set_commentary"; expected_version: number; text: string };

type Row = Record<string, unknown>;
type WireSchema = { $ref?: string; const?: unknown; enum?: unknown[]; anyOf?: WireSchema[]; type?: string; properties?: Record<string, WireSchema>; items?: WireSchema; minimum?: number; maximum?: number; maxItems?: number; maxLength?: number; x_max_utf8_bytes?: number; pattern?: string; format?: string };
// Frozen v2 contract (schema_version remains 1). Objects require every declared key and reject all extra keys.
const definitions: Record<string, WireSchema> = {
  "scope": {
    "type": "object",
    "properties": {
      "schema_version": {
        "const": 1
      },
      "request_id": {
        "type": "string",
        "pattern": "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
      },
      "game_id": {
        "type": "string",
        "pattern": "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
      },
      "team_id": {
        "type": "string",
        "pattern": "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
      },
      "league_id": {
        "type": "string",
        "pattern": "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
      }
    }
  },
  "goal": {
    "type": "object",
    "properties": {
      "event_id": {
        "type": "string",
        "pattern": "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
      },
      "event_version": {
        "type": "integer",
        "minimum": 1,
        "maximum": 2147483647
      },
      "team_id": {
        "type": "string",
        "pattern": "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
      },
      "scorer_id": {
        "anyOf": [
          {
            "type": "string",
            "pattern": "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
          },
          {
            "type": "null"
          }
        ]
      },
      "assist1_id": {
        "anyOf": [
          {
            "type": "string",
            "pattern": "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
          },
          {
            "type": "null"
          }
        ]
      },
      "assist2_id": {
        "anyOf": [
          {
            "type": "string",
            "pattern": "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
          },
          {
            "type": "null"
          }
        ]
      },
      "entered_at": {
        "type": "string",
        "format": "date-time"
      },
      "can_edit": {
        "type": "boolean"
      },
      "blocked_reason": {
        "anyOf": [
          {
            "enum": [
              "legacy_unattributed",
              "not_checked_in",
              "capture_complete",
              "roster_conflict"
            ]
          },
          {
            "type": "null"
          }
        ]
      }
    }
  },
  "roster_player": {
    "type": "object",
    "properties": {
      "player_id": {
        "type": "string",
        "pattern": "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
      },
      "full_name": {
        "anyOf": [
          {
            "type": "string",
            "maxLength": 160,
            "x_max_utf8_bytes": 640
          },
          {
            "type": "null"
          }
        ]
      },
      "jersey_number": {
        "anyOf": [
          {
            "type": "integer"
          },
          {
            "type": "null"
          }
        ]
      },
      "position": {
        "anyOf": [
          {
            "type": "string",
            "maxLength": 128,
            "x_max_utf8_bytes": 512
          },
          {
            "type": "null"
          }
        ]
      },
      "source": {
        "enum": [
          "regular",
          "team_spare",
          "accepted_sub",
          "credited_only"
        ]
      },
      "checkin_status": {
        "anyOf": [
          {
            "enum": [
              "confirmed",
              "tentative",
              "out"
            ]
          },
          {
            "type": "null"
          }
        ]
      },
      "presence_version": {
        "type": "integer",
        "minimum": 0,
        "maximum": 2147483647
      },
      "state": {
        "enum": [
          "checked_in",
          "scratched",
          "tentative",
          "waiting",
          "credited_not_eligible",
          "unavailable"
        ]
      },
      "eligible_for_goal": {
        "type": "boolean"
      },
      "has_credited_stats": {
        "type": "boolean"
      },
      "availability_state": {
        "enum": [
          "none",
          "out",
          "unknown",
          "conflict"
        ]
      },
      "blocking_goal_ids": {
        "type": "array",
        "items": {
          "type": "string",
          "pattern": "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
        },
        "maxItems": 1000
      }
    }
  },
  "snapshot": {
    "type": "object",
    "properties": {
      "season_id": {
        "type": "string",
        "pattern": "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
      },
      "revision": {
        "type": "string",
        "pattern": "^[0-9]{1,19}$"
      },
      "server_time": {
        "type": "string",
        "format": "date-time"
      },
      "complete": {
        "const": true
      },
      "game": {
        "type": "object",
        "properties": {
          "status": {
            "enum": [
              "scheduled",
              "in_progress"
            ]
          },
          "scheduled_at": {
            "type": "string",
            "format": "date-time"
          },
          "game_started_at": {
            "anyOf": [
              {
                "type": "string",
                "format": "date-time"
              },
              {
                "type": "null"
              }
            ]
          },
          "own_team_type": {
            "enum": [
              "home",
              "away"
            ]
          },
          "home_team_id": {
            "type": "string",
            "pattern": "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
          },
          "away_team_id": {
            "type": "string",
            "pattern": "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
          },
          "home_team_name": {
            "anyOf": [
              {
                "type": "string",
                "maxLength": 160,
                "x_max_utf8_bytes": 640
              },
              {
                "type": "null"
              }
            ]
          },
          "away_team_name": {
            "anyOf": [
              {
                "type": "string",
                "maxLength": 160,
                "x_max_utf8_bytes": 640
              },
              {
                "type": "null"
              }
            ]
          },
          "home_score": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000
          },
          "away_score": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000
          },
          "timezone": {
            "type": "string",
            "maxLength": 128,
            "x_max_utf8_bytes": 128
          },
          "home_team_logo_url": {
            "anyOf": [
              {
                "type": "string",
                "maxLength": 2048,
                "x_max_utf8_bytes": 2048
              },
              {
                "type": "null"
              }
            ]
          },
          "away_team_logo_url": {
            "anyOf": [
              {
                "type": "string",
                "maxLength": 2048,
                "x_max_utf8_bytes": 2048
              },
              {
                "type": "null"
              }
            ]
          }
        }
      },
      "permissions": {
        "type": "object",
        "properties": {
          "can_add_goal": {
            "type": "boolean"
          },
          "can_correct_goal": {
            "type": "boolean"
          },
          "can_manage_roster": {
            "type": "boolean"
          },
          "can_comment": {
            "type": "boolean"
          },
          "blocked_reason": {
            "anyOf": [
              {
                "enum": [
                  "future_game",
                  "stats_locked",
                  "capture_complete",
                  "legacy_score_mismatch",
                  "roster_conflict"
                ]
              },
              {
                "type": "null"
              }
            ]
          }
        }
      },
      "own_goals": {
        "type": "array",
        "items": {
          "$ref": "#/$defs/goal"
        },
        "maxItems": 1000
      },
      "roster": {
        "type": "array",
        "items": {
          "$ref": "#/$defs/roster_player"
        },
        "maxItems": 200
      },
      "commentary": {
        "type": "object",
        "properties": {
          "text": {
            "type": "string",
            "maxLength": 2000,
            "x_max_utf8_bytes": 8000
          },
          "version": {
            "type": "integer",
            "minimum": 0,
            "maximum": 2147483647
          }
        }
      },
      "counts": {
        "type": "object",
        "properties": {
          "own_goals": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000
          },
          "roster": {
            "type": "integer",
            "minimum": 0,
            "maximum": 200
          }
        }
      }
    }
  },
  "response": {
    "type": "object",
    "properties": {
      "schema_version": {
        "const": 1
      },
      "request_id": {
        "type": "string",
        "pattern": "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
      },
      "game_id": {
        "type": "string",
        "pattern": "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
      },
      "team_id": {
        "type": "string",
        "pattern": "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
      },
      "league_id": {
        "type": "string",
        "pattern": "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
      },
      "kind": {
        "enum": [
          "get_context",
          "add_goal",
          "update_goal",
          "remove_goal",
          "scratch",
          "reinstate",
          "set_commentary"
        ]
      },
      "outcome": {
        "enum": [
          "ok",
          "applied",
          "replayed",
          "conflict",
          "rejected"
        ]
      },
      "code": {
        "anyOf": [
          {
            "enum": [
              "event_version_conflict",
              "presence_version_conflict",
              "commentary_version_conflict",
              "idempotency_conflict",
              "event_id_conflict",
              "event_removed",
              "event_unavailable",
              "player_not_eligible",
              "credited_stats_conflict",
              "future_game",
              "lifecycle_unavailable",
              "stats_locked",
              "capture_complete",
              "legacy_score_mismatch",
              "row_bound_exceeded",
              "text_bound_exceeded",
              "response_bound_exceeded",
              "invalid_request",
              "scope_unavailable"
            ]
          },
          {
            "type": "null"
          }
        ]
      },
      "receipt": {
        "anyOf": [
          {
            "type": "object",
            "properties": {
              "applied_revision": {
                "type": "string",
                "pattern": "^[0-9]{1,19}$"
              },
              "event_id": {
                "anyOf": [
                  {
                    "type": "string",
                    "pattern": "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "event_version": {
                "anyOf": [
                  {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 2147483647
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "player_id": {
                "anyOf": [
                  {
                    "type": "string",
                    "pattern": "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "presence_version": {
                "anyOf": [
                  {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 2147483647
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "commentary_version": {
                "anyOf": [
                  {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 2147483647
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "transitioned_to_in_progress": {
                "type": "boolean"
              }
            }
          },
          {
            "type": "null"
          }
        ]
      },
      "conflict": {
        "anyOf": [
          {
            "type": "object",
            "properties": {
              "entity": {
                "enum": [
                  "event",
                  "presence",
                  "commentary",
                  "request"
                ]
              },
              "entity_id": {
                "anyOf": [
                  {
                    "type": "string",
                    "pattern": "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "current_version": {
                "anyOf": [
                  {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 2147483647
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          },
          {
            "type": "null"
          }
        ]
      },
      "snapshot": {
        "anyOf": [
          {
            "$ref": "#/$defs/snapshot"
          },
          {
            "type": "null"
          }
        ]
      }
    }
  }
};
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const nullableSame = (a: string | null, b: unknown) => a === null ? b === null : typeof b === 'string' && same(a,b);
const isRow = (v: unknown): v is Row => v !== null && typeof v === 'object' && !Array.isArray(v);
function utf8(value: string): number {
  let bytes = 0;
  for (const c of value) { const n = c.codePointAt(0)!; if (n === 0 || n >= 0xd800 && n <= 0xdfff) return Infinity; bytes += n <= 0x7f ? 1 : n <= 0x7ff ? 2 : n <= 0xffff ? 3 : 4; }
  return bytes;
}
function dateTime(value: string): boolean {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:Z|([+-])(\d\d):(\d\d))$/.exec(value);
  if (!m || !Number.isFinite(Date.parse(value))) return false;
  const [, y, mo, day, h, mi, sec, , oh, om] = m;
  return +mo >= 1 && +mo <= 12 && +day >= 1 && +day <= new Date(Date.UTC(+y, +mo, 0)).getUTCDate() && +h < 24 && +mi < 60 && +sec < 60 && (!oh || +oh < 24 && +om < 60);
}
function valid(v: unknown, s: WireSchema): boolean {
  if (s.$ref) return valid(v, definitions[s.$ref.split('/').pop()!]);
  if ('const' in s) return v === s.const;
  if (s.enum) return s.enum.includes(v);
  if (s.anyOf) return s.anyOf.some(x => valid(v, x));
  switch (s.type) {
    case 'null': return v === null;
    case 'boolean': return typeof v === 'boolean';
    case 'integer': return typeof v === 'number' && Number.isSafeInteger(v) && (s.minimum === undefined || v >= s.minimum) && (s.maximum === undefined || v <= s.maximum);
    case 'string': return typeof v === 'string' && utf8(v) !== Infinity && (s.maxLength === undefined || [...v].length <= s.maxLength) && (s.x_max_utf8_bytes === undefined || utf8(v) <= s.x_max_utf8_bytes) && (!s.pattern || new RegExp(s.pattern).test(v)) && (s.format !== 'date-time' || dateTime(v));
    case 'array': return Array.isArray(v) && (s.maxItems === undefined || v.length <= s.maxItems) && v.every(x => valid(x, s.items!));
    case 'object': return isRow(v) && Object.keys(v).length === Object.keys(s.properties!).length && Object.entries(s.properties!).every(([key, schema]) => Object.hasOwn(v, key) && valid(v[key], schema));
    default: return false;
  }
}
function fail(): never { throw new CaptainScoringRpcError('unknown', 'invalid_response', 'Scoring returned an invalid response. Refresh to reconcile; if saving, retain this request and use Retry same request.'); }
export class CaptainScoringRpcError extends Error {
  constructor(public readonly kind: 'rejected' | 'unknown' | 'backend_update_required', public readonly code: string, message: string) { super(message); this.name = 'CaptainScoringRpcError'; }
}
export function createScoringRequestId(): string { return Crypto.randomUUID(); }
export function createScoringEventId(): string { return Crypto.randomUUID(); }
function envelope(scope: ScoringScope, requestId: string): Row {
  if (!scope || ![scope.gameId, scope.teamId, scope.leagueId, scope.seasonId, requestId].every(uuid)) throw new CaptainScoringRpcError('rejected', 'invalid_request', 'Invalid scoring scope or request ID. Refresh and check captain access.');
  return { schema_version: 1, request_id: requestId, game_id: scope.gameId, team_id: scope.teamId, league_id: scope.leagueId };
}
/** Request-bound, lossless, complete decoding; never return a partial snapshot. */
export function decodeScoringResponse(raw: unknown, request: Record<string, unknown>, expectedSeasonId: string): ScoringResponse {
  try { const serialized = JSON.stringify(raw); if (typeof serialized !== 'string' || utf8(serialized) > 1048576) return fail(); } catch { return fail(); }
  if (!valid(raw, definitions.response) || !uuid(expectedSeasonId)) return fail();
  const r = raw as ScoringResponse;
  for (const key of ['schema_version', 'request_id', 'game_id', 'team_id', 'league_id'] as const) if (r[key] !== request[key]) return fail();
  if (r.kind !== (request.kind ?? 'get_context')) return fail();
  if (r.outcome === 'ok' && (r.kind !== 'get_context' || r.code !== null || r.receipt !== null || r.conflict !== null || !r.snapshot)) return fail();
  if (r.snapshot) {
    const s = r.snapshot;
    const g = s.game, p = s.permissions;
    if (!same(g[g.own_team_type + '_team_id' as 'home_team_id' | 'away_team_id'], r.team_id) || same(g.home_team_id, g.away_team_id)) return fail();
    try { if (!g.timezone) return fail(); new Intl.DateTimeFormat('en', { timeZone: g.timezone }).format(); } catch { return fail(); }
    const future = g.status === 'scheduled' && Date.parse(g.scheduled_at) > Date.parse(s.server_time);
    if (future && (p.blocked_reason !== 'future_game' || p.can_add_goal || p.can_correct_goal || p.can_manage_roster || p.can_comment) || !future && p.blocked_reason === 'future_game') return fail();
    if (p.blocked_reason === 'stats_locked' && (p.can_add_goal || p.can_correct_goal || p.can_manage_roster || p.can_comment)) return fail();
    if (p.blocked_reason === 'capture_complete' && (p.can_add_goal || p.can_correct_goal)) return fail();
    const players = new Map(s.roster.map(x => [x.player_id.toLowerCase(), x]));
    const goals = new Map(s.own_goals.map(x => [x.event_id.toLowerCase(), x]));
    if (players.size !== s.roster.length || goals.size !== s.own_goals.length) return fail();
    for (const goal of s.own_goals) {
      const ids = [goal.scorer_id, goal.assist1_id, goal.assist2_id].filter((x): x is string => x !== null);
      if (!same(goal.team_id, r.team_id) || goal.assist2_id !== null && goal.assist1_id === null || new Set(ids.map(x => x.toLowerCase())).size !== ids.length || ids.some(id => !players.has(id.toLowerCase()))) return fail();
      if (goal.can_edit && (!p.can_correct_goal || goal.blocked_reason !== null || goal.scorer_id === null || ids.some(id => !players.get(id.toLowerCase())!.eligible_for_goal))) return fail();
      // SQL leaves the per-goal reason null for eligible attributed history under these game-wide blocks.
      const globallyReadOnly = !p.can_add_goal && !p.can_correct_goal && !p.can_manage_roster && !p.can_comment && ['future_game', 'stats_locked', 'legacy_score_mismatch'].includes(p.blocked_reason ?? '');
      const eligibleAttributed = goal.scorer_id !== null && ids.every(id => players.get(id.toLowerCase())!.eligible_for_goal);
      if (!goal.can_edit && goal.blocked_reason === null && !(globallyReadOnly && eligibleAttributed) || goal.scorer_id === null && (goal.can_edit || goal.blocked_reason !== 'legacy_unattributed')) return fail();
    }
    for (const player of s.roster) {
      const eligible = player.checkin_status === 'confirmed' && player.availability_state === 'none' && player.source !== 'credited_only';
      const expectedState = eligible ? 'checked_in' : player.has_credited_stats ? 'credited_not_eligible' : player.checkin_status === 'out' ? 'scratched' : player.checkin_status === 'tentative' ? 'tentative' : player.checkin_status === null ? 'waiting' : player.availability_state !== 'none' ? 'unavailable' : null;
      if (player.eligible_for_goal !== eligible || player.state !== expectedState || player.source === 'credited_only' && !player.has_credited_stats) return fail();
      const expected = s.own_goals.filter(goal => [goal.scorer_id, goal.assist1_id, goal.assist2_id].some(id => id !== null && same(id, player.player_id))).map(goal => goal.event_id.toLowerCase());
      const blocking = player.blocking_goal_ids.map(id => id.toLowerCase());
      if (new Set(blocking).size !== blocking.length || blocking.length !== expected.length || blocking.some(id => !expected.includes(id)) || blocking.length > 0 && !player.has_credited_stats) return fail();
    }
    if (!same(s.season_id, expectedSeasonId) || BigInt(s.revision) > 9223372036854775807n || s.counts.own_goals !== s.own_goals.length || s.counts.roster !== s.roster.length || s.game[s.game.own_team_type + '_score' as 'home_score' | 'away_score'] !== s.own_goals.length) return fail();
  }
  if (request.kind ? !validCommand(request) : !valid(request, definitions.scope)) return fail();
  if (r.outcome === 'applied' || r.outcome === 'replayed') {
    const receipt = r.receipt;
    if (r.kind === 'get_context' || !receipt || !r.snapshot || r.code !== null || r.conflict !== null || BigInt(receipt.applied_revision) > BigInt(r.snapshot.revision) || BigInt(receipt.applied_revision) > 9223372036854775807n) return fail();
    if (r.kind.endsWith('_goal')) {
      if (!receipt.event_id || !same(receipt.event_id, request.event_id as string) || receipt.event_version !== (r.kind === 'add_goal' ? 1 : (request.expected_version as number) + 1) || receipt.player_id !== null || receipt.presence_version !== null || receipt.commentary_version !== null) return fail();
    } else if (r.kind === 'scratch' || r.kind === 'reinstate') {
      if (!receipt.player_id || !same(receipt.player_id, request.player_id as string) || receipt.presence_version === null || ![request.expected_version, (request.expected_version as number) + 1].includes(receipt.presence_version) || receipt.event_id !== null || receipt.event_version !== null || receipt.commentary_version !== null) return fail();
    } else if (receipt.commentary_version === null || ![request.expected_version, (request.expected_version as number) + 1].includes(receipt.commentary_version) || receipt.event_id !== null || receipt.event_version !== null || receipt.player_id !== null || receipt.presence_version !== null) return fail();
    if (receipt.transitioned_to_in_progress && r.kind !== 'add_goal') return fail();
    if (r.outcome === 'applied') {
      if (BigInt(receipt.applied_revision) !== BigInt(r.snapshot.revision)) return fail();
      if (r.kind === 'add_goal' || r.kind === 'update_goal' || r.kind === 'remove_goal') {
        const goal = r.snapshot.own_goals.find(g => same(g.event_id,request.event_id as string));
        if (r.kind === 'remove_goal' ? goal !== undefined : !goal || goal.event_version !== receipt.event_version || !goal.scorer_id || !same(goal.scorer_id,request.scorer_id as string) || !nullableSame(goal.assist1_id,request.assist1_id) || !nullableSame(goal.assist2_id,request.assist2_id)) return fail();
        if (r.kind === 'add_goal' && r.snapshot.game.status !== 'in_progress') return fail();
      } else if (r.kind === 'scratch' || r.kind === 'reinstate') {
        const player = r.snapshot.roster.find(p => same(p.player_id,request.player_id as string));
        if (!player || player.presence_version !== receipt.presence_version || player.checkin_status !== (r.kind === 'scratch' ? 'out' : 'confirmed') || (r.kind === 'scratch' ? player.eligible_for_goal : !player.eligible_for_goal)) return fail();
      } else if (r.snapshot.commentary.version !== receipt.commentary_version || r.snapshot.commentary.text !== request.text) return fail();
      if (receipt.transitioned_to_in_progress && (r.snapshot.game.status !== 'in_progress' || r.snapshot.game.game_started_at === null)) return fail();
    }
    // A replay receipt is historical: never demand it equals the current event or presence.
  } else if (r.outcome === 'conflict' || r.outcome === 'rejected') {
    const conflictCodes = ['event_version_conflict','presence_version_conflict','commentary_version_conflict','idempotency_conflict','event_id_conflict','event_removed','player_not_eligible','credited_stats_conflict','legacy_score_mismatch'];
    if (r.code === null || r.receipt !== null || (r.outcome === 'conflict' ? !conflictCodes.includes(r.code) : conflictCodes.includes(r.code)) || r.outcome === 'rejected' && r.conflict !== null) return fail();
    const entities: Record<string,string> = {event_version_conflict:'event',presence_version_conflict:'presence',commentary_version_conflict:'commentary'};
    const entity = entities[r.code];
    if (entity) {
      if (!r.conflict || r.conflict.entity !== entity || r.conflict.current_version === null) return fail();
      const id = entity === 'event' ? request.event_id : entity === 'presence' ? request.player_id : request.team_id;
      if (id === null ? r.conflict.entity_id !== null : typeof id !== 'string' || !r.conflict.entity_id || !same(r.conflict.entity_id,id)) return fail();
      const current = entity === 'event' ? r.snapshot?.own_goals.find(g => same(g.event_id,id as string))?.event_version : entity === 'presence' ? r.snapshot?.roster.find(p => same(p.player_id,id as string))?.presence_version : r.snapshot?.commentary.version;
      if (current !== undefined && current !== r.conflict.current_version) return fail();
    } else if (r.conflict !== null && !(r.code === 'idempotency_conflict' && r.conflict.entity === 'request' && r.conflict.entity_id !== null && same(r.conflict.entity_id,r.request_id) && r.conflict.current_version === null)) return fail();
  } else if (r.kind !== 'get_context') return fail();
  return r;
}
export async function getScoringContext(scope: ScoringScope, requestId = createScoringRequestId(), signal?: AbortSignal): Promise<ScoringResponse> {
  const request = envelope(scope, requestId);
  try {
    let query = supabase.rpc('captain_get_game_scoring_context' as never, { p_request: request } as never);
    if (signal) query = query.abortSignal(signal);
    const { data, error, status } = await query;
    if (error) throw transportError(error,status);
    return decodeScoringResponse(data, request, scope.seasonId);
  } catch (error) { if (error instanceof CaptainScoringRpcError) throw error; throw new CaptainScoringRpcError('unknown', 'transport_error', 'Scoring could not be loaded. Refresh and check your connection.'); }
}

const commandDefinitions: Record<string, WireSchema> = {
  add_goal: { type: 'object', properties: { ...definitions.scope.properties, "kind": {"const":"add_goal"}, "event_id": {"type":"string","pattern":"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"}, "expected_version": {"type":"null"}, "scorer_id": {"type":"string","pattern":"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"}, "assist1_id": {"anyOf":[{"type":"string","pattern":"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"},{"type":"null"}]}, "assist2_id": {"anyOf":[{"type":"string","pattern":"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"},{"type":"null"}]} } },
  update_goal: { type: 'object', properties: { ...definitions.scope.properties, "kind": {"const":"update_goal"}, "event_id": {"type":"string","pattern":"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"}, "expected_version": {"type":"integer","minimum":1,"maximum":2147483646}, "scorer_id": {"type":"string","pattern":"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"}, "assist1_id": {"anyOf":[{"type":"string","pattern":"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"},{"type":"null"}]}, "assist2_id": {"anyOf":[{"type":"string","pattern":"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"},{"type":"null"}]} } },
  remove_goal: { type: 'object', properties: { ...definitions.scope.properties, "kind": {"const":"remove_goal"}, "event_id": {"type":"string","pattern":"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"}, "expected_version": {"type":"integer","minimum":1,"maximum":2147483646} } },
  scratch: { type: 'object', properties: { ...definitions.scope.properties, "kind": {"const":"scratch"}, "player_id": {"type":"string","pattern":"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"}, "expected_version": {"type":"integer","minimum":0,"maximum":2147483647} } },
  reinstate: { type: 'object', properties: { ...definitions.scope.properties, "kind": {"const":"reinstate"}, "player_id": {"type":"string","pattern":"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"}, "expected_version": {"type":"integer","minimum":0,"maximum":2147483647} } },
  set_commentary: { type: 'object', properties: { ...definitions.scope.properties, "kind": {"const":"set_commentary"}, "expected_version": {"type":"integer","minimum":0,"maximum":2147483647}, "text": {"type":"string","maxLength":2000,"x_max_utf8_bytes":8000} } }
};
function validCommand(request: Row): boolean {
 const schema = typeof request.kind === 'string' ? commandDefinitions[request.kind] : null;
 if (!schema || !valid(request, schema)) return false;
 const ids = [request.scorer_id, request.assist1_id, request.assist2_id].filter((x): x is string => typeof x === 'string');
 return !(request.assist2_id != null && request.assist1_id == null) && new Set(ids.map(x => x.toLowerCase())).size === ids.length && utf8(JSON.stringify(request)) <= 16384;
}
function transportError(error: unknown, status = 0): CaptainScoringRpcError {
 const code = isRow(error) && typeof error.code === 'string' ? error.code : 'transport_error';
 if (status < 500 && ['PGRST202', '42883'].includes(code)) return new CaptainScoringRpcError('backend_update_required', code, 'Scoring requires a backend update. Ask an administrator to update the backend.');
 if (status < 500 && ['22023', '28000', '42501'].includes(code)) return new CaptainScoringRpcError('rejected', code, 'Scoring was not saved. Refresh and check your captain access, game and selected players before correcting the request.');
 return new CaptainScoringRpcError('unknown', code, 'Save outcome is unknown. Refresh to reconcile. Retain the same request ID and unchanged selections, then explicitly Retry same request if needed.');
}
/** Exactly one RPC. No automatic replay, including timeouts, deadlocks or malformed success. */
export async function manageScoring(scope: ScoringScope, requestId: string, command: ScoringCommand, signal?: AbortSignal): Promise<ScoringResponse> {
 const scopeRequest = envelope(scope, requestId);
 if (!command || !validCommand({ ...scopeRequest, ...command }) || Object.keys(command).some(key => Object.hasOwn(scopeRequest, key))) throw new CaptainScoringRpcError('rejected', 'invalid_request', 'Invalid scoring command. Check the selected players and fields.');
 // Explicit command envelopes; never forward caller-supplied extra keys or actor/season values.
 let request: Row;
 switch (command.kind) {
  case 'add_goal': case 'update_goal': request = {...scopeRequest,kind:command.kind,event_id:command.event_id,expected_version:command.expected_version,scorer_id:command.scorer_id,assist1_id:command.assist1_id,assist2_id:command.assist2_id}; break;
  case 'remove_goal': request = {...scopeRequest,kind:command.kind,event_id:command.event_id,expected_version:command.expected_version}; break;
  case 'scratch': case 'reinstate': request = {...scopeRequest,kind:command.kind,player_id:command.player_id,expected_version:command.expected_version}; break;
  case 'set_commentary': request = {...scopeRequest,kind:command.kind,expected_version:command.expected_version,text:command.text}; break;
 }
 try {
  let query = supabase.rpc('captain_manage_game_scoring' as never, {p_request:request} as never);
  if (signal) query = query.abortSignal(signal);
  const {data,error,status} = await query;
  if (error) throw transportError(error,status);
  return decodeScoringResponse(data,request,scope.seasonId);
 } catch(error) { if (error instanceof CaptainScoringRpcError) throw error; throw transportError(null,500); }
}

const compareIdentity = (a: string, b: string) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
function discoveryFailure(): never { throw new CaptainScoringRpcError('unknown', 'target_unavailable', 'Current scoring game could not be verified. Refresh and check your captain access.'); }
function boundedRows(data: unknown, error: unknown, cap: number): Row[] {
 if (error || !Array.isArray(data) || data.length > cap || !data.every(isRow)) return discoveryFailure();
 return data;
}
/** Independent scoring discovery; never changes attendance's future nextGame selection. */
export async function getScoringTarget(actorId: string, leagueId: string): Promise<ScoringScope | null> {
 if (!uuid(actorId) || !uuid(leagueId)) return discoveryFailure();
 const seasonsReply = await supabase.from('seasons').select('id,league_id,status,start_date,created_at').eq('league_id',leagueId).in('status',['active','playoffs']).order('start_date',{ascending:false}).order('created_at',{ascending:false,nullsFirst:false}).order('id',{ascending:true}).limit(257);
 const seasons = boundedRows(seasonsReply.data,seasonsReply.error,256).filter(r => uuid(r.id) && uuid(r.league_id) && same(r.league_id,leagueId) && ['active','playoffs'].includes(r.status as string));
 const descendingNullable = (a: unknown,b: unknown) => a === b ? 0 : a == null ? 1 : b == null ? -1 : String(a) > String(b) ? -1 : 1;
 seasons.sort((a,b) => Number(a.status !== 'active') - Number(b.status !== 'active') || descendingNullable(a.start_date,b.start_date) || descendingNullable(a.created_at,b.created_at) || compareIdentity(a.id as string,b.id as string));
 if (!seasons.length) return null;
 const seasonId = seasons[0].id as string;
 const rolesReply = await supabase.from('team_rosters').select('team_id,league_id,season_id,player_id,status,end_date,player_type,leadership_role').eq('player_id',actorId).eq('league_id',leagueId).eq('season_id',seasonId).eq('status','active').eq('player_type','regular').is('end_date',null).in('leadership_role',['captain','alternate_captain']).limit(1001);
 const roles = boundedRows(rolesReply.data,rolesReply.error,1000).filter(r => uuid(r.team_id) && uuid(r.league_id) && same(r.league_id,leagueId) && uuid(r.season_id) && same(r.season_id,seasonId) && uuid(r.player_id) && same(r.player_id,actorId) && r.status === 'active' && r.end_date === null && r.player_type === 'regular' && ['captain','alternate_captain'].includes(r.leadership_role as string));
 const teams = [...new Map(roles.map(r => [(r.team_id as string).toLowerCase(),r.team_id as string])).values()].sort(compareIdentity);
 if (!teams.length) return null;
 const list = teams.join(',');
 const gamesReply = await supabase.from('games').select('id,league_id,season_id,home_team_id,away_team_id,status,scheduled_at').eq('league_id',leagueId).eq('season_id',seasonId).in('status',['in_progress','scheduled']).or(`home_team_id.in.(${list}),away_team_id.in.(${list})`).order('scheduled_at',{ascending:true}).order('id',{ascending:true}).limit(1001);
 const rows = boundedRows(gamesReply.data,gamesReply.error,1000);
 const candidates: {scope:ScoringScope;status:string;scheduledAt:string}[] = [];
 for (const row of rows) {
  if (!uuid(row.id) || !uuid(row.league_id) || !same(row.league_id,leagueId) || !uuid(row.season_id) || !same(row.season_id,seasonId) || !uuid(row.home_team_id) || !uuid(row.away_team_id) || !['in_progress','scheduled'].includes(row.status as string)) continue;
  const participating = teams.filter(teamId => same(teamId,row.home_team_id as string) || same(teamId,row.away_team_id as string));
  if (!participating.length) continue;
  if (typeof row.scheduled_at !== 'string' || !dateTime(row.scheduled_at) || same(row.home_team_id,row.away_team_id)) return discoveryFailure();
  for (const teamId of participating) candidates.push({scope:{gameId:row.id,teamId,leagueId,seasonId},status:row.status as string,scheduledAt:row.scheduled_at});
 }
 const stable = (a:typeof candidates[number],b:typeof candidates[number]) => compareIdentity(a.scope.teamId,b.scope.teamId) || compareIdentity(a.scope.gameId,b.scope.gameId);
 const ongoing = candidates.filter(c => c.status === 'in_progress').sort((a,b) => Date.parse(a.scheduledAt)-Date.parse(b.scheduledAt) || stable(a,b));
 if (ongoing.length) return ongoing[0].scope;
 const scheduled = candidates.filter(c => c.status === 'scheduled').sort((a,b) => Date.parse(a.scheduledAt)-Date.parse(b.scheduledAt) || stable(a,b));
 if (!scheduled.length) return null;
 // One authorized read supplies the clock, including when the probe is a future game.
 const context = await getScoringContext(scheduled[0].scope);
 if (context.outcome !== 'ok' || !context.snapshot) return discoveryFailure();
 const serverTime = Date.parse(context.snapshot.server_time);
 const due = scheduled.filter(c => Date.parse(c.scheduledAt) <= serverTime).sort((a,b) => Date.parse(b.scheduledAt)-Date.parse(a.scheduledAt) || stable(a,b));
 return due[0]?.scope ?? null;
}
