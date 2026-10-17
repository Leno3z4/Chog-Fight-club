import test from "node:test";
import assert from "node:assert/strict";
import { startDiscordOAuth, finishDiscordOAuth } from "./discordAuth.js";
import { handlePlayerDirectoryRequest, PlayerDirectoryError } from "./players.js";

const origin = "https://arena.example";
const env = {
  DISCORD_CLIENT_ID: "client-id",
  DISCORD_CLIENT_SECRET: "client-secret",
  DISCORD_GUILD_ID: "1253481714710220810",
  DISCORD_HOLDER_ROLE_ID: "1545507860455096460",
  DISCORD_REDIRECT_URI: "https://arena.example/api/discord/callback",
  SESSION_SECRET: "player-directory-test-secret-long-enough",
};
const ownerId = "1304031867162595361";
const otherId = "234567890123456789";

function cookiePair(value) { return String(value).split(";")[0]; }
function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

class MockStatement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.values = []; }
  bind(...values) { this.values = values; return this; }
  first() { return this.db.first(this.sql, this.values); }
  all() { return this.db.all(this.sql, this.values); }
  run() { return this.db.run(this.sql, this.values); }
}
class MockD1 {
  constructor() { this.players = new Map(); }
  prepare(sql) { return new MockStatement(this, sql); }
  async first() { return null; }
  async all(sql, values) {
    const q = sql.replace(/\s+/g, " ").trim();
    assert.match(q, /FROM chog_players/);
    const prefix = String(values[1]).slice(0, -1).toLowerCase();
    const rows = [...this.players.values()].filter((row) =>
      row.discord_id !== values[0]
      && (row.username.toLowerCase().startsWith(prefix) || row.display_name.toLowerCase().startsWith(prefix))
    ).sort((a,b)=>b.last_seen.localeCompare(a.last_seen)).slice(0,10);
    return { results: rows.map((row)=>({...row})) };
  }
  async run(sql, values) {
    const q=sql.replace(/\s+/g," ").trim();
    assert.match(q,/INSERT INTO chog_players/);
    const [discord_id,username,display_name,avatar_url,wallet_address,last_seen,created_at]=values;
    const previous=this.players.get(discord_id);
    this.players.set(discord_id,{discord_id,username,display_name,avatar_url,wallet_address,last_seen,created_at:previous?.created_at||created_at});
    return {success:true};
  }
}

async function sessionCookie({ discordId = ownerId, username = "arena_owner", displayName = "Arena Owner", envOverride = env } = {}) {
  const start = await startDiscordOAuth({ origin, env: envOverride, secure: true });
  const state = new URL(start.location).searchParams.get("state");
  const result = await finishDiscordOAuth({
    requestUrl: `${origin}/api/discord/callback?code=test&state=${state}`,
    cookieHeader: cookiePair(start.cookies[0]),
    env: envOverride,
    secure: true,
    fetchImpl: async (url) => {
      const target=String(url);
      if(target.endsWith("/oauth2/token")) return response({access_token:"test-access"});
      if(target.endsWith("/users/@me")) return response({id:discordId,username,global_name:displayName,avatar:null});
      if(target.endsWith(`/users/@me/guilds/${envOverride.DISCORD_GUILD_ID}/member`)) return response({roles:[envOverride.DISCORD_HOLDER_ROLE_ID]});
      throw new Error("Unexpected Discord endpoint: "+target);
    },
  });
  assert.equal(result.status,302);
  return cookiePair(result.cookies.find((value)=>value.startsWith("chog_session=")));
}

test("upserts the authenticated Discord player identity, not a client-submitted identity", async () => {
  env.CHOG_DB=new MockD1();
  const cookieHeader=await sessionCookie({discordId:ownerId,username:"real_handle",displayName:"Real Display"});
  const result=await handlePlayerDirectoryRequest({method:"POST",url:"/api/players",cookieHeader,env});
  assert.equal(result.status,200);
  const row=env.CHOG_DB.players.get(ownerId);
  assert.equal(row.discord_id,ownerId);
  assert.equal(row.username,"real_handle");
  assert.equal(row.display_name,"Real Display");
});

test("search returns username/display-name matches but never returns the searching player", async () => {
  env.CHOG_DB=new MockD1();
  env.CHOG_DB.players.set(ownerId,{discord_id:ownerId,username:"arena_owner",display_name:"Arena Owner",avatar_url:null,last_seen:"2026-10-17T20:00:00.000Z"});
  env.CHOG_DB.players.set(otherId,{discord_id:otherId,username:"rival_handle",display_name:"Rival Player",avatar_url:null,last_seen:"2026-10-17T20:00:00.000Z"});
  const cookieHeader=await sessionCookie({discordId:ownerId,username:"arena_owner",displayName:"Arena Owner"});
  const result=await handlePlayerDirectoryRequest({method:"GET",url:"/api/players?q=ri",cookieHeader,env});
  assert.equal(result.status,200);
  assert.equal(result.body.players.length,1);
  assert.equal(result.body.players[0].discordId,otherId);
  assert.equal(result.body.players[0].username,"rival_handle");
  assert.equal(result.body.players[0].displayName,"Rival Player");
});

test("search requires at least two characters", async () => {
  env.CHOG_DB=new MockD1();
  const cookieHeader=await sessionCookie();
  const result=await handlePlayerDirectoryRequest({method:"GET",url:"/api/players?q=r",cookieHeader,env});
  assert.deepEqual(result.body.players,[]);
  assert.equal(result.body.queryTooShort,true);
});

test("directory rejects unauthenticated users and missing D1 binding", async () => {
  env.CHOG_DB=new MockD1();
  await assert.rejects(
    handlePlayerDirectoryRequest({method:"GET",url:"/api/players?q=ri",cookieHeader:"",env}),
    (error)=>error instanceof PlayerDirectoryError && error.code==="DISCORD_SESSION_REQUIRED"
  );
  const cookieHeader=await sessionCookie();
  delete env.CHOG_DB;
  await assert.rejects(
    handlePlayerDirectoryRequest({method:"POST",url:"/api/players",cookieHeader,env}),
    (error)=>error instanceof PlayerDirectoryError && error.code==="D1_NOT_CONFIGURED"
  );
});
