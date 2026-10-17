import { createPublicClient, createWalletClient, defineChain, http, keccak256, parseEventLogs, recoverTypedDataAddress, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readDiscordSession } from "./discordAuth.js";

const CHOG_CONTRACT = "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763";
const DEFAULT_RPC = "https://rpc.monad.xyz";
const ACCEPTED_FOR_PACT = ["TERMS_ACCEPTED", "READY", "IN_BATTLE", "RESULT_PENDING", "SETTLED", "CONDITION_PENDING", "CONDITION_FULFILLED"];
const PACT_TYPES = {
  PactAgreement: [
    { name: "inviteKey", type: "bytes32" },
    { name: "challenger", type: "address" },
    { name: "opponent", type: "address" },
    { name: "challengerChogId", type: "uint256" },
    { name: "opponentChogId", type: "uint256" },
    { name: "termsHash", type: "bytes32" },
    { name: "termsURIHash", type: "bytes32" },
    { name: "expiresAt", type: "uint64" },
  ],
};
const PACT_ABI = [
  { type: "event", name: "PactMinted", anonymous: false, inputs: [
    { indexed: true, name: "pactId", type: "uint256" },
    { indexed: true, name: "inviteKey", type: "bytes32" },
    { indexed: true, name: "challenger", type: "address" },
    { indexed: false, name: "opponent", type: "address" },
    { indexed: false, name: "challengerReceiptId", type: "uint256" },
    { indexed: false, name: "opponentReceiptId", type: "uint256" },
    { indexed: false, name: "termsHash", type: "bytes32" },
  ]},
  { type: "event", name: "MatchSettled", anonymous: false, inputs: [
    { indexed: true, name: "pactId", type: "uint256" },
    { indexed: true, name: "winner", type: "address" },
    { indexed: false, name: "winnerReceiptId", type: "uint256" },
    { indexed: false, name: "loserReceiptId", type: "uint256" },
  ]},
  { type: "event", name: "ConditionFulfilled", anonymous: false, inputs: [
    { indexed: true, name: "pactId", type: "uint256" },
    { indexed: true, name: "winner", type: "address" },
    { indexed: true, name: "loser", type: "address" },
    { indexed: false, name: "loserReceiptId", type: "uint256" },
  ]},
  { type: "function", name: "matchResolver", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "settleMatch", stateMutability: "nonpayable", inputs: [
    { name: "pactId", type: "uint256" }, { name: "winner", type: "address" }
  ], outputs: [] },
];
export class PactApiError extends Error {
  constructor(message, { status = 500, code = "PACT_ERROR" } = {}) {
    super(message); this.name = "PactApiError"; this.status = status; this.code = code;
  }
}
function getDb(env) {
  if (!env?.CHOG_DB || typeof env.CHOG_DB.prepare !== "function") {
    throw new PactApiError("Cloudflare D1 is not configured. Apply migrations 0001 through 0004.", { status: 503, code: "D1_NOT_CONFIGURED" });
  }
  return env.CHOG_DB;
}
function validId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function factoryAddress(env) {
  const value = String(env?.PACT_FACTORY_ADDRESS || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) return "";
  return value.toLowerCase();
}
function chainId(env) {
  const value = Number(env?.PACT_CHAIN_ID || 143);
  return Number.isSafeInteger(value) && value > 0 ? value : 143;
}
function pactDomain(env, address) {
  return { name: "Chog Battle Arena Pact", version: "1", chainId: chainId(env), verifyingContract: address };
}
function pactTerms(row) {
  const challengerDemand = String(row.condition_text || "").trim();
  const opponentDemand = String(row.opponent_demand_text || "").trim();
  if (challengerDemand.length < 5 || opponentDemand.length < 5) {
    throw new PactApiError("Both players must save their own demand before signing the Pact.", { status: 409, code: "BILATERAL_TERMS_INCOMPLETE" });
  }
  return `Challenger demand: ${challengerDemand}\nOpponent demand: ${opponentDemand}`;
}
function typedDataFor(row, env, address) {
  const expiry = Number(row.pact_expires_at);
  const inviteKey = keccak256(toBytes(row.id));
  const termsHash = keccak256(toBytes(pactTerms(row)));
  const termsURI = "";
  return {
    domain: pactDomain(env, address),
    types: PACT_TYPES,
    primaryType: "PactAgreement",
    message: {
      inviteKey,
      challenger: row.challenger_wallet.toLowerCase(),
      opponent: row.opponent_wallet.toLowerCase(),
      challengerChogId: BigInt(row.challenger_token_id),
      opponentChogId: BigInt(row.opponent_token_id),
      termsHash,
      termsURIHash: keccak256(toBytes(termsURI)),
      expiresAt: BigInt(expiry),
    },
  };
}
function jsonSafeTypedData(typedData) {
  return {
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: Object.fromEntries(Object.entries(typedData.message).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value])),
  };
}
async function getParticipant({ db, id, user }) {
  const row = await db.prepare("SELECT * FROM chog_challenge_invites WHERE id = ?1 LIMIT 1").bind(id).first();
  if (!row) throw new PactApiError("Challenge not found.", { status: 404, code: "INVITE_NOT_FOUND" });
  const isChallenger = row.challenger_discord_id === user.discordId;
  const isOpponent = row.opponent_discord_id === user.discordId;
  if (!isChallenger && !isOpponent) throw new PactApiError("This pact belongs to another Discord account.", { status: 403, code: "PACT_FORBIDDEN" });
  const wallet = isChallenger ? row.challenger_wallet : row.opponent_wallet;
  if (!user.walletAddress || !wallet || user.walletAddress.toLowerCase() !== wallet.toLowerCase()) {
    throw new PactApiError("Connect the wallet linked to this challenge.", { status: 403, code: "PACT_WALLET_MISMATCH" });
  }
  if (!row.opponent_wallet || !row.opponent_token_id || !ACCEPTED_FOR_PACT.includes(row.status)) {
    throw new PactApiError("Join the lobby and select both Chogs before loading the Pact agreement.", { status: 409, code: "PACT_NOT_READY" });
  }
  return { row, isChallenger };
}
function publicPact(row, address, env, isChallenger) {
  const configured = Boolean(address);
  const termsReady = String(row.condition_text || "").trim().length >= 5
    && String(row.opponent_demand_text || "").trim().length >= 5;
  if (!configured) return {
    configured: false, minted: false, termsReady,
    reason: "Pact factory address is not configured on the Cloudflare backend.",
  };
  const typedData = termsReady ? typedDataFor(row, env, address) : null;
  return {
    configured: true,
    termsReady,
    minted: Boolean(row.pact_id && row.pact_tx_hash),
    pactId: row.pact_id == null ? null : String(row.pact_id),
    transactionHash: row.pact_tx_hash || null,
    contractAddress: row.pact_contract_address || address,
    challengerReceiptId: row.challenger_receipt_id || null,
    opponentReceiptId: row.opponent_receipt_id || null,
    expiresAt: row.pact_expires_at == null ? null : Number(row.pact_expires_at),
    challengerSigned: Boolean(row.challenger_pact_signature),
    opponentSigned: Boolean(row.opponent_pact_signature),
    yourSignatureStored: Boolean(isChallenger ? row.challenger_pact_signature : row.opponent_pact_signature),
    challengerSignature: row.challenger_pact_signature || null,
    opponentSignature: row.opponent_pact_signature || null,
    typedData: typedData ? jsonSafeTypedData(typedData) : null,
    termsHash: typedData?.message?.termsHash || null,
    settlementTxHash: /^0x[0-9a-fA-F]{64}$/.test(String(row.pact_settlement_tx_hash || "")) ? row.pact_settlement_tx_hash : null,
    settledOnchain: /^0x[0-9a-fA-F]{64}$/.test(String(row.pact_settlement_tx_hash || "")),
    settlementPending: row.pact_settlement_tx_hash === "SUBMITTING",
    fulfillmentTxHash: row.pact_fulfillment_tx_hash || null,
    fulfilledOnchain: Boolean(row.pact_fulfillment_tx_hash),
    agreement: typedData ? {
      inviteKey: typedData.message.inviteKey,
      challenger: row.challenger_wallet.toLowerCase(),
      opponent: row.opponent_wallet.toLowerCase(),
      challengerChogId: String(row.challenger_token_id),
      opponentChogId: String(row.opponent_token_id),
      condition: pactTerms(row),
      challengerDemand: row.condition_text,
      opponentDemand: row.opponent_demand_text || "",
      termsURI: "",
      expiresAt: Number(row.pact_expires_at),
    } : null,
  };
}
function makeChain(env) {
  const id = chainId(env);
  const rpc = String(env?.MONAD_RPC_URL || DEFAULT_RPC);
  return defineChain({
    id,
    name: id === 143 ? "Monad" : "Monad network",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
}
function makePublicClient(env) {
  const rpc = String(env?.MONAD_RPC_URL || DEFAULT_RPC);
  return createPublicClient({ chain: makeChain(env), transport: http(rpc) });
}
function resolverWallet(env) {
  const privateKey = String(env?.PACT_RESOLVER_PRIVATE_KEY || "");
  const expected = String(env?.PACT_RESOLVER_ADDRESS || "").toLowerCase();
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey) || !/^0x[0-9a-f]{40}$/.test(expected)) {
    throw new PactApiError("Configure PACT_RESOLVER_ADDRESS and PACT_RESOLVER_PRIVATE_KEY as Cloudflare secrets before on-chain settlement.", { status: 503, code: "PACT_RESOLVER_NOT_CONFIGURED" });
  }
  const account = privateKeyToAccount(privateKey);
  if (account.address.toLowerCase() !== expected) {
    throw new PactApiError("The Pact resolver key does not match PACT_RESOLVER_ADDRESS.", { status: 503, code: "PACT_RESOLVER_KEY_MISMATCH" });
  }
  return account;
}
async function submitSettlement(env, pactId, winner) {
  const address = factoryAddress(env);
  if (!address) throw new PactApiError("Pact factory address is not configured.", { status: 503, code: "PACT_FACTORY_NOT_CONFIGURED" });
  const account = resolverWallet(env);
  if (!/^0x[0-9a-fA-F]{40}$/.test(winner)) throw new PactApiError("Winner wallet is invalid.", { status: 400, code: "WINNER_WALLET_INVALID" });
  const rpc = String(env?.MONAD_RPC_URL || DEFAULT_RPC);
  const publicClient = makePublicClient(env);
  const onchainResolver = await publicClient.readContract({ address, abi: PACT_ABI, functionName: "matchResolver" });
  if (String(onchainResolver).toLowerCase() !== account.address.toLowerCase()) {
    throw new PactApiError("The configured resolver wallet does not match the factory's immutable resolver.", { status: 503, code: "PACT_RESOLVER_MISMATCH" });
  }
  const client = createWalletClient({ account, chain: makeChain(env), transport: http(rpc) });
  const hash = await client.writeContract({ address, abi: PACT_ABI, functionName: "settleMatch", args: [BigInt(pactId), winner] });
  const receipt = await publicClient.getTransactionReceipt({ hash });
  if (receipt.status !== "success" || receipt.to?.toLowerCase() !== address) {
    throw new PactApiError("The resolver settlement transaction failed.", { status: 502, code: "PACT_SETTLEMENT_FAILED" });
  }
  const event = parseEventLogs({ abi: PACT_ABI, logs: receipt.logs, eventName: "MatchSettled", strict: false })
    .find((item) => String(item.address || "").toLowerCase() === address
      && String(item.args.pactId) === String(pactId)
      && String(item.args.winner).toLowerCase() === winner.toLowerCase());
  if (!event) throw new PactApiError("The resolver transaction did not emit the expected settlement event.", { status: 502, code: "PACT_SETTLEMENT_EVENT_MISSING" });
  return hash;
}

export async function handlePactRequest({ method, url, cookieHeader, env, body = {} }) {
  const session = await readDiscordSession({ cookieHeader, env });
  if (!session.authenticated) throw new PactApiError("Connect Discord before signing the pact.", { status: 401, code: "DISCORD_SESSION_REQUIRED" });
  const user = session.user;
  const requestUrl = new URL(url, "https://arena.invalid");
  const id = requestUrl.searchParams.get("id") || body.id;
  if (!validId(id)) throw new PactApiError("A valid challenge ID is required.", { status: 400, code: "INVITE_ID_INVALID" });
  const db = getDb(env);
  let { row, isChallenger } = await getParticipant({ db, id, user });
  const address = factoryAddress(env);
  if (!address) {
    if (method === "GET") return { status: 200, body: { pact: publicPact(row, "", env, isChallenger) } };
    throw new PactApiError("Pact factory address is not configured. Deploy the factory only after integration is ready, then set PACT_FACTORY_ADDRESS.", { status: 503, code: "PACT_FACTORY_NOT_CONFIGURED" });
  }

  if (method === "GET") {
    if (!row.pact_expires_at && !row.pact_id) {
      const expiry = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
      await db.prepare("UPDATE chog_challenge_invites SET pact_expires_at = ?1 WHERE id = ?2 AND pact_expires_at IS NULL AND pact_id IS NULL")
        .bind(expiry, id).run();
      row = await db.prepare("SELECT * FROM chog_challenge_invites WHERE id = ?1 LIMIT 1").bind(id).first();
    }
    return { status: 200, body: { pact: publicPact(row, address, env, isChallenger) } };
  }
  if (method !== "POST") throw new PactApiError("Method not allowed.", { status: 405, code: "METHOD_NOT_ALLOWED" });
  if (row.pact_id && !["confirmMint", "settle", "recordFulfillment"].includes(body.action)) throw new PactApiError("The Pact NFT has already been minted for this challenge.", { status: 409, code: "PACT_ALREADY_MINTED" });

  if (body.action === "sign") {
    if (row.status !== "READY" || !row.challenger_terms_accepted || !row.opponent_terms_accepted) {
      throw new PactApiError("Both players must accept the written demands before signing the Pact NFT.", { status: 409, code: "TERMS_NOT_ACCEPTED" });
    }
    if (!row.pact_expires_at) throw new PactApiError("Refresh the lobby to initialize the shared signing deadline.", { status: 409, code: "PACT_EXPIRY_MISSING" });
    if (Number(row.pact_expires_at) <= Math.floor(Date.now() / 1000)) {
      throw new PactApiError("This agreement signing window expired. Cancel the challenge and create a fresh one.", { status: 409, code: "PACT_EXPIRED" });
    }
    const typedData = typedDataFor(row, env, address);
    let recovered;
    try {
      recovered = await recoverTypedDataAddress({
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
        signature: body.signature,
      });
    } catch {
      throw new PactApiError("The wallet signature does not match the agreement.", { status: 400, code: "PACT_SIGNATURE_INVALID" });
    }
    if (recovered.toLowerCase() !== user.walletAddress.toLowerCase()) {
      throw new PactApiError("This signature came from a different wallet.", { status: 403, code: "PACT_SIGNER_MISMATCH" });
    }
    const column = isChallenger ? "challenger_pact_signature" : "opponent_pact_signature";
    const saved = await db.prepare(`UPDATE chog_challenge_invites SET ${column} = ?1, updated_at = ?2
      WHERE id = ?3 AND pact_id IS NULL AND pact_tx_hash IS NULL AND status = 'READY'
        AND challenger_terms_accepted = 1 AND opponent_terms_accepted = 1
        AND terms_hash = ?4`)
      .bind(body.signature, new Date().toISOString(), id, row.terms_hash).run();
    if (!saved.meta || saved.meta.changes !== 1) {
      throw new PactApiError("The agreement changed while you were signing. Refresh the lobby and review the current demands.", { status: 409, code: "PACT_TERMS_CHANGED" });
    }
    row = await db.prepare("SELECT * FROM chog_challenge_invites WHERE id = ?1 LIMIT 1").bind(id).first();
    return { status: 200, body: { pact: publicPact(row, address, env, isChallenger) } };
  }

  if (body.action === "confirmMint") {
    const txHash = String(body.transactionHash || "");
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new PactApiError("A valid transaction hash is required.", { status: 400, code: "TX_HASH_INVALID" });
    if (row.pact_id && row.pact_tx_hash?.toLowerCase() === txHash.toLowerCase()) {
      return { status: 200, body: { pact: publicPact(row, address, env, isChallenger) } };
    }
    if (row.pact_id) {
      throw new PactApiError("A different Pact mint is already recorded for this challenge.", { status: 409, code: "PACT_ALREADY_MINTED" });
    }
    if (!row.challenger_pact_signature || !row.opponent_pact_signature) {
      throw new PactApiError("Both players must sign before the Pact NFT can be minted.", { status: 409, code: "PACT_SIGNATURES_MISSING" });
    }
    const client = makePublicClient(env);
    let receipt;
    try { receipt = await client.getTransactionReceipt({ hash: txHash }); }
    catch { throw new PactApiError("The mint transaction is not confirmed yet. Wait for confirmation and retry.", { status: 409, code: "TX_NOT_CONFIRMED" }); }
    if (receipt.status !== "success" || !receipt.to || receipt.to.toLowerCase() !== address) {
      throw new PactApiError("That transaction did not successfully call the configured Pact factory.", { status: 400, code: "PACT_TX_INVALID" });
    }
    const inviteKey = keccak256(toBytes(row.id));
    const expectedTermsHash = keccak256(toBytes(pactTerms(row)));
    const events = parseEventLogs({ abi: PACT_ABI, logs: receipt.logs, eventName: "PactMinted", strict: false })
      .filter((event) => String(event.address || "").toLowerCase() === address);
    const event = events.find((item) =>
      String(item.args.inviteKey).toLowerCase() === inviteKey.toLowerCase()
      && String(item.args.challenger).toLowerCase() === row.challenger_wallet.toLowerCase()
      && String(item.args.opponent).toLowerCase() === row.opponent_wallet.toLowerCase()
      && String(item.args.termsHash).toLowerCase() === expectedTermsHash.toLowerCase()
    );
    if (!event) throw new PactApiError("The confirmed transaction does not contain the expected Pact mint event.", { status: 400, code: "PACT_EVENT_MISMATCH" });
    const now = new Date().toISOString();
    await db.prepare(`UPDATE chog_challenge_invites SET pact_id = ?1, pact_tx_hash = ?2, pact_contract_address = ?3,
      challenger_receipt_id = ?4, opponent_receipt_id = ?5, pact_minted_at = ?6, updated_at = ?6
      WHERE id = ?7 AND pact_id IS NULL`)
      .bind(String(event.args.pactId), txHash, address, String(event.args.challengerReceiptId),
        String(event.args.opponentReceiptId), now, id).run();
    row = await db.prepare("SELECT * FROM chog_challenge_invites WHERE id = ?1 LIMIT 1").bind(id).first();
    return { status: 200, body: { pact: publicPact(row, address, env, isChallenger) } };
  }
  if (body.action === "settle") {
    if (!row.pact_id || !row.pact_tx_hash) throw new PactApiError("Mint the Pact NFT before settling a match.", { status: 409, code: "PACT_NOT_MINTED" });
    const battle = await db.prepare("SELECT status, winner_discord_id FROM chog_battles WHERE invite_id = ?1 LIMIT 1").bind(id).first();
    if (battle?.status !== "FINISHED" || !battle.winner_discord_id) throw new PactApiError("The server has not recorded a finished match yet.", { status: 409, code: "MATCH_NOT_FINISHED" });
    if (battle.winner_discord_id !== user.discordId) throw new PactApiError("Only the recorded winner can trigger on-chain settlement.", { status: 403, code: "NOT_MATCH_WINNER" });
    if (/^0x[0-9a-fA-F]{64}$/.test(String(row.pact_settlement_tx_hash || ""))) {
      return { status: 200, body: { pact: publicPact(row, address, env, isChallenger) } };
    }
    if (row.pact_settlement_tx_hash === "SUBMITTING") {
      throw new PactApiError("Settlement is already being submitted. Refresh shortly.", { status: 409, code: "SETTLEMENT_IN_PROGRESS" });
    }
    const reserved = await db.prepare("UPDATE chog_challenge_invites SET pact_settlement_tx_hash = 'SUBMITTING' WHERE id = ?1 AND pact_settlement_tx_hash IS NULL AND pact_id = ?2")
      .bind(id, row.pact_id).run();
    if (!reserved.meta || reserved.meta.changes !== 1) {
      throw new PactApiError("Another settlement request is already in progress. Refresh shortly.", { status: 409, code: "SETTLEMENT_IN_PROGRESS" });
    }
    const winnerWallet = battle.winner_discord_id === row.challenger_discord_id ? row.challenger_wallet : row.opponent_wallet;
    try {
      const txHash = await submitSettlement(env, row.pact_id, winnerWallet);
      const now = new Date().toISOString();
      await db.prepare("UPDATE chog_challenge_invites SET pact_settlement_tx_hash = ?1, pact_settled_at = ?2, status = 'CONDITION_PENDING', updated_at = ?2 WHERE id = ?3 AND pact_settlement_tx_hash = 'SUBMITTING'")
        .bind(txHash, now, id).run();
    } catch (error) {
      await db.prepare("UPDATE chog_challenge_invites SET pact_settlement_tx_hash = NULL WHERE id = ?1 AND pact_settlement_tx_hash = 'SUBMITTING'")
        .bind(id).run();
      throw error;
    }
    row = await db.prepare("SELECT * FROM chog_challenge_invites WHERE id = ?1 LIMIT 1").bind(id).first();
    return { status: 200, body: { pact: publicPact(row, address, env, isChallenger) } };
  }

  if (body.action === "recordFulfillment") {
    if (!row.pact_id || !row.pact_settlement_tx_hash || !/^0x[0-9a-fA-F]{64}$/.test(row.pact_settlement_tx_hash)) {
      throw new PactApiError("The match result must be settled on-chain first.", { status: 409, code: "PACT_NOT_SETTLED" });
    }
    if (row.pact_fulfillment_tx_hash) return { status: 200, body: { pact: publicPact(row, address, env, isChallenger) } };
    const battle = await db.prepare("SELECT status, winner_discord_id FROM chog_battles WHERE invite_id = ?1 LIMIT 1").bind(id).first();
    if (battle?.status !== "FINISHED" || battle.winner_discord_id !== user.discordId) {
      throw new PactApiError("Only the recorded winner can confirm fulfilment.", { status: 403, code: "NOT_MATCH_WINNER" });
    }
    const txHash = String(body.transactionHash || "");
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new PactApiError("A valid transaction hash is required.", { status: 400, code: "TX_HASH_INVALID" });
    const client = makePublicClient(env);
    let receipt;
    try { receipt = await client.getTransactionReceipt({ hash: txHash }); }
    catch { throw new PactApiError("The fulfilment transaction is not confirmed yet.", { status: 409, code: "TX_NOT_CONFIRMED" }); }
    const winnerWallet = battle.winner_discord_id === row.challenger_discord_id ? row.challenger_wallet : row.opponent_wallet;
    const loserWallet = battle.winner_discord_id === row.challenger_discord_id ? row.opponent_wallet : row.challenger_wallet;
    if (receipt.status !== "success" || receipt.to?.toLowerCase() !== address || receipt.from.toLowerCase() !== winnerWallet.toLowerCase()) {
      throw new PactApiError("That transaction was not a valid fulfilment confirmation from the winner.", { status: 400, code: "FULFILLMENT_TX_INVALID" });
    }
    const event = parseEventLogs({ abi: PACT_ABI, logs: receipt.logs, eventName: "ConditionFulfilled", strict: false })
      .find((item) => String(item.address || "").toLowerCase() === address
        && String(item.args.pactId) === String(row.pact_id)
        && String(item.args.winner).toLowerCase() === winnerWallet.toLowerCase()
        && String(item.args.loser).toLowerCase() === loserWallet.toLowerCase());
    if (!event) throw new PactApiError("The transaction did not emit the expected fulfilment event.", { status: 400, code: "FULFILLMENT_EVENT_MISMATCH" });
    const now = new Date().toISOString();
    await db.prepare("UPDATE chog_challenge_invites SET pact_fulfillment_tx_hash = ?1, pact_fulfilled_at = ?2, status = 'CONDITION_FULFILLED', updated_at = ?2 WHERE id = ?3 AND pact_fulfillment_tx_hash IS NULL")
      .bind(txHash, now, id).run();
    row = await db.prepare("SELECT * FROM chog_challenge_invites WHERE id = ?1 LIMIT 1").bind(id).first();
    return { status: 200, body: { pact: publicPact(row, address, env, isChallenger) } };
  }

  throw new PactApiError("Choose a supported Pact action.", { status: 400, code: "PACT_ACTION_INVALID" });
}
