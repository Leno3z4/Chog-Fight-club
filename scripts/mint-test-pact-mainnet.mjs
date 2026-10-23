import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseEther,
  parseEventLogs,
  stringToHex,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const FACTORY = "0x3a5485d41cAcE651dBAba9f292C12b1Df425f950";
const EXPECTED_RESOLVER = "0x77DF3ae15b994131797905e59675da3544C90DFF";
const CHOG_COLLECTION = "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763";
const RPC_URL = process.env.MONAD_RPC_URL || "https://rpc.monad.xyz";
const CONFIRMATION = "YES_MINT_AND_FINALIZE_REAL_MAINNET_NFTS";
const TEST_CONDITION = "Technical test Pact: this agreement verifies the real on-chain mint, settlement, and fulfilment flow. No off-chain action is required; this is a test record only.";

const chain = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL, { timeout: 30_000, retryCount: 2 }),
});

const chogAbi = [{
  type: "function", name: "ownerOf", stateMutability: "view",
  inputs: [{ name: "tokenId", type: "uint256" }],
  outputs: [{ name: "", type: "address" }],
}];
const factoryAbi = [
  { type: "function", name: "matchResolver", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "mintPact", stateMutability: "nonpayable", inputs: [
    { name: "inviteKey", type: "bytes32" }, { name: "challenger", type: "address" }, { name: "opponent", type: "address" },
    { name: "challengerChogId", type: "uint256" }, { name: "opponentChogId", type: "uint256" },
    { name: "condition", type: "string" }, { name: "termsURI", type: "string" }, { name: "expiresAt", type: "uint64" },
    { name: "challengerSignature", type: "bytes" }, { name: "opponentSignature", type: "bytes" },
  ], outputs: [{ name: "pactId", type: "uint256" }] },
  { type: "function", name: "settleMatch", stateMutability: "nonpayable", inputs: [{ name: "pactId", type: "uint256" }, { name: "winner", type: "address" }], outputs: [] },
  { type: "function", name: "confirmFulfillment", stateMutability: "nonpayable", inputs: [{ name: "pactId", type: "uint256" }], outputs: [] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "owner", type: "address" }] },
  { type: "function", name: "getPact", stateMutability: "view", inputs: [{ name: "pactId", type: "uint256" }], outputs: [
    { name: "inviteKey", type: "bytes32" }, { name: "challenger", type: "address" }, { name: "opponent", type: "address" },
    { name: "challengerChogId", type: "uint256" }, { name: "opponentChogId", type: "uint256" }, { name: "condition", type: "string" },
    { name: "termsURI", type: "string" }, { name: "termsHash", type: "bytes32" }, { name: "createdAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" }, { name: "status", type: "uint8" }, { name: "winner", type: "address" },
    { name: "challengerReceiptId", type: "uint256" }, { name: "opponentReceiptId", type: "uint256" },
  ]},
  { type: "function", name: "tokenURI", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "string" }] },
  { type: "event", name: "PactMinted", anonymous: false, inputs: [
    { indexed: true, name: "pactId", type: "uint256" }, { indexed: true, name: "inviteKey", type: "bytes32" },
    { indexed: true, name: "challenger", type: "address" }, { indexed: false, name: "opponent", type: "address" },
    { indexed: false, name: "challengerReceiptId", type: "uint256" }, { indexed: false, name: "opponentReceiptId", type: "uint256" },
    { indexed: false, name: "termsHash", type: "bytes32" },
  ]},
];
const types = {
  PactAgreement: [
    { name: "inviteKey", type: "bytes32" }, { name: "challenger", type: "address" }, { name: "opponent", type: "address" },
    { name: "challengerChogId", type: "uint256" }, { name: "opponentChogId", type: "uint256" },
    { name: "termsHash", type: "bytes32" }, { name: "termsURIHash", type: "bytes32" }, { name: "expiresAt", type: "uint64" },
  ],
};

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Required GitHub Actions secret/input '${name}' is missing. No mint transaction has been sent.`);
  return value;
}
function accountFromSecret(name) {
  let key = requiredEnv(name);
  if (!key.startsWith("0x")) key = `0x${key}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${name} must contain a valid 32-byte EVM private key. No mint transaction has been sent.`);
  return privateKeyToAccount(key);
}
async function tokenIdInput(name, owner, label) {
  const raw = String(process.env[name] || "").trim();
  if (raw) {
    if (!/^\d+$/.test(raw) || BigInt(raw) <= 0n) throw new Error(`${name} must be a positive numeric Chog token ID. No mint transaction has been sent.`);
    return BigInt(raw);
  }

  const apiKey = String(process.env.OPENSEA_API_KEY || "").trim();
  if (!apiKey) throw new Error(`No ${label} Chog ID was supplied and OPENSEA_API_KEY is not configured in GitHub Actions. Enter both token IDs in the workflow, or add that secret to let the workflow discover them. No mint transaction has been sent.`);
  const url = new URL(`https://api.opensea.io/api/v2/chain/monad/account/${owner}/nfts`);
  url.searchParams.set("collection", "chog-genesis");
  url.searchParams.set("limit", "50");
  const response = await fetch(url, { headers: { accept: "application/json", "X-API-KEY": apiKey } });
  if (!response.ok) throw new Error(`OpenSea lookup failed for the ${label} wallet (HTTP ${response.status}). Supply the token IDs manually and retry. No mint transaction has been sent.`);
  const payload = await response.json();
  const candidates = [...new Set((Array.isArray(payload?.nfts) ? payload.nfts : [])
    .filter((nft) => String(nft?.contract || "").toLowerCase() === CHOG_COLLECTION.toLowerCase() && /^\d+$/.test(String(nft?.identifier ?? "")))
    .map((nft) => String(nft.identifier)))];
  for (const candidate of candidates) {
    try {
      const actualOwner = await publicClient.readContract({ address: CHOG_COLLECTION, abi: chogAbi, functionName: "ownerOf", args: [BigInt(candidate)] });
      if (actualOwner.toLowerCase() === owner.toLowerCase()) {
        console.log(`Found ${label} Chog #${candidate} via OpenSea and verified it on-chain.`);
        return BigInt(candidate);
      }
    } catch { /* Ignore stale/indexer candidates; ownerOf is the authority. */ }
  }
  throw new Error(`No Chog Genesis NFT could be verified for the ${label} wallet. That wallet must own a real Chog to use this factory. No mint transaction has been sent.`);
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function mined(hash, label) {
  console.log(`${label} transaction submitted: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  assert(receipt.status === "success", `${label} transaction reverted: ${hash}`);
  console.log(`${label} confirmed in block ${receipt.blockNumber}.`);
  return receipt;
}
function decodeTokenURI(uri) {
  const marker = "data:application/json;base64,";
  assert(uri.startsWith(marker), "Unexpected tokenURI format from the factory.");
  return JSON.parse(Buffer.from(uri.slice(marker.length), "base64").toString("utf8"));
}

async function main() {
  // Gate the irreversible part first. Ordinary push/PR workflows cannot run this workflow.
  assert(process.env.MAINNET_CONFIRMATION === CONFIRMATION,
    `Refusing to transact. Manually run this workflow and choose confirmation '${CONFIRMATION}'.`);

  const key1 = accountFromSecret("PRIVATE_KEY1");
  const key2 = accountFromSecret("PRIVATE_KEY2");
  assert(key1.address.toLowerCase() !== key2.address.toLowerCase(), "PRIVATE_KEY1 and PRIVATE_KEY2 resolve to the same wallet.");
  const suppliedChallengerId = String(process.env.CHALLENGER_CHOG_ID || "").trim();
  const suppliedOpponentId = String(process.env.OPPONENT_CHOG_ID || "").trim();
  assert(Boolean(suppliedChallengerId) === Boolean(suppliedOpponentId),
    "Provide both Chog token IDs or leave both blank for OpenSea auto-discovery. No mint transaction has been sent.");
  const challengerChogId = await tokenIdInput("CHALLENGER_CHOG_ID", key1.address, "challenger");
  const opponentChogId = await tokenIdInput("OPPONENT_CHOG_ID", key2.address, "opponent");
  assert(challengerChogId !== opponentChogId, "The two Chog token IDs must be different.");

  // The already-deployed factory's resolver is immutable. Resolve its key before minting,
  // so a missing/mismatched resolver can never leave test receipts stuck in ACTIVE status.
  const resolverSecret = String(process.env.PACT_RESOLVER_PRIVATE_KEY || "").trim();
  let resolverAccount;
  if (resolverSecret) {
    let normalized = resolverSecret.startsWith("0x") ? resolverSecret : `0x${resolverSecret}`;
    assert(/^0x[0-9a-fA-F]{64}$/.test(normalized), "PACT_RESOLVER_PRIVATE_KEY is malformed.");
    resolverAccount = privateKeyToAccount(normalized);
  } else {
    resolverAccount = [key1, key2].find((account) => account.address.toLowerCase() === EXPECTED_RESOLVER.toLowerCase());
  }
  assert(resolverAccount, "Missing/mismatched PACT_RESOLVER_PRIVATE_KEY. Add the existing resolver key as a repository Actions secret (do not paste it into source), or use a test wallet only if it is the immutable resolver. No mint transaction has been sent.");

  const networkId = await publicClient.getChainId();
  assert(networkId === 143, `Expected Monad mainnet chain ID 143, received ${networkId}. No mint transaction has been sent.`);
  const bytecode = await publicClient.getBytecode({ address: FACTORY });
  assert(bytecode && bytecode !== "0x", "The configured Pact factory has no bytecode. No mint transaction has been sent.");
  const configuredResolver = await publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "matchResolver" });
  assert(configuredResolver.toLowerCase() === EXPECTED_RESOLVER.toLowerCase(), "The factory's on-chain resolver differs from the expected resolver. No mint transaction has been sent.");
  assert(resolverAccount.address.toLowerCase() === configuredResolver.toLowerCase(), "Resolver secret does not match the factory's immutable resolver. No mint transaction has been sent.");

  // No private keys are printed. Addresses are public and are printed only to make the
  // operator's token ownership checks auditable in the Actions log.
  console.log(`Challenger wallet: ${key1.address}`);
  console.log(`Opponent wallet: ${key2.address}`);
  console.log(`Resolver wallet: ${resolverAccount.address}`);
  console.log(`Checking Chog #${challengerChogId} for challenger and Chog #${opponentChogId} for opponent.`);

  const [owner1, owner2] = await Promise.all([
    publicClient.readContract({ address: CHOG_COLLECTION, abi: chogAbi, functionName: "ownerOf", args: [challengerChogId] }),
    publicClient.readContract({ address: CHOG_COLLECTION, abi: chogAbi, functionName: "ownerOf", args: [opponentChogId] }),
  ]);
  assert(owner1.toLowerCase() === key1.address.toLowerCase(),
    `Chog #${challengerChogId} is owned by ${owner1}, not PRIVATE_KEY1's wallet. No mint transaction has been sent.`);
  assert(owner2.toLowerCase() === key2.address.toLowerCase(),
    `Chog #${opponentChogId} is owned by ${owner2}, not PRIVATE_KEY2's wallet. No mint transaction has been sent.`);

  const uniqueAccounts = new Map([key1, key2, resolverAccount].map((account) => [account.address.toLowerCase(), account]));
  for (const account of uniqueAccounts.values()) {
    const balance = await publicClient.getBalance({ address: account.address });
    console.log(`Gas-wallet balance for ${account.address}: ${(Number(balance) / 1e18).toFixed(6)} MON`);
    assert(balance >= parseEther("0.02"),
      `Wallet ${account.address} has less than 0.02 MON. Fund gas before retrying; no mint transaction has been sent.`);
  }

  const runId = requiredEnv("GITHUB_RUN_ID");
  const runAttempt = requiredEnv("GITHUB_RUN_ATTEMPT");
  const inviteKey = keccak256(stringToHex(`chog-battle-arena-mainnet-test-${runId}-${runAttempt}`));
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 24 * 60 * 60);
  const termsURI = "";
  const termsHash = keccak256(stringToHex(TEST_CONDITION));
  const termsURIHash = keccak256(toBytes(termsURI));
  const domain = { name: "Chog Battle Arena Pact", version: "1", chainId: 143, verifyingContract: FACTORY };
  const message = {
    inviteKey,
    challenger: key1.address,
    opponent: key2.address,
    challengerChogId,
    opponentChogId,
    termsHash,
    termsURIHash,
    expiresAt,
  };
  const [signature1, signature2] = await Promise.all([
    key1.signTypedData({ domain, types, primaryType: "PactAgreement", message }),
    key2.signTypedData({ domain, types, primaryType: "PactAgreement", message }),
  ]);
  console.log("Both test wallets signed the same public, harmless test agreement.");

  // Simulate mintPact first; the factory rechecks both real on-chain Chog owners.
  const mintArgs = [inviteKey, key1.address, key2.address, challengerChogId, opponentChogId,
    TEST_CONDITION, termsURI, expiresAt, signature1, signature2];
  const simulation = await publicClient.simulateContract({
    account: key1, address: FACTORY, abi: factoryAbi, functionName: "mintPact", args: mintArgs,
  });
  const fees = await publicClient.estimateFeesPerGas();
  const gasPrice = fees.maxFeePerGas ?? fees.gasPrice;
  const gasEstimate = await publicClient.estimateContractGas({
    account: key1.address, address: FACTORY, abi: factoryAbi, functionName: "mintPact", args: mintArgs,
  });
  console.log(`Mint preflight passed. Estimated mint fee ceiling: ${(Number(gasEstimate * gasPrice) / 1e18).toFixed(8)} MON (excluding later settlement/fulfilment fees).`);

  const key1Wallet = createWalletClient({ account: key1, chain, transport: http(RPC_URL, { timeout: 30_000, retryCount: 2 }) });
  const resolverWallet = createWalletClient({ account: resolverAccount, chain, transport: http(RPC_URL, { timeout: 30_000, retryCount: 2 }) });

  // From here on, the workflow creates irreversible public mainnet records.
  const mintHash = await key1Wallet.writeContract(simulation.request);
  const mintReceipt = await mined(mintHash, "Pact mint");
  const mintEvents = parseEventLogs({ abi: factoryAbi, logs: mintReceipt.logs, eventName: "PactMinted", strict: false })
    .filter((event) => String(event.address).toLowerCase() === FACTORY.toLowerCase()
      && String(event.args.challenger).toLowerCase() === key1.address.toLowerCase()
      && String(event.args.opponent).toLowerCase() === key2.address.toLowerCase());
  assert(mintEvents.length === 1, `Mint receipt did not contain exactly one expected PactMinted event. Mint tx: ${mintHash}`);
  const minted = mintEvents[0].args;
  const pactId = minted.pactId;
  const challengerReceiptId = minted.challengerReceiptId;
  const opponentReceiptId = minted.opponentReceiptId;

  assert((await publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "ownerOf", args: [challengerReceiptId] })).toLowerCase() === key1.address.toLowerCase(), "Challenger Pact receipt owner verification failed.");
  assert((await publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "ownerOf", args: [opponentReceiptId] })).toLowerCase() === key2.address.toLowerCase(), "Opponent Pact receipt owner verification failed.");
  console.log(`Minted Pact #${pactId}: challenger receipt #${challengerReceiptId}, opponent receipt #${opponentReceiptId}.`);

  const settleHash = await resolverWallet.writeContract({
    address: FACTORY, abi: factoryAbi, functionName: "settleMatch", args: [pactId, key1.address],
  });
  await mined(settleHash, "Pact settlement");
  const fulfilHash = await key1Wallet.writeContract({
    address: FACTORY, abi: factoryAbi, functionName: "confirmFulfillment", args: [pactId],
  });
  await mined(fulfilHash, "Pact fulfilment");

  const pact = await publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "getPact", args: [pactId] });
  assert(Number(pact[10]) === 3, `Final Pact status must be FULFILLED (3), received ${pact[10]}.`);
  assert(String(pact[11]).toLowerCase() === key1.address.toLowerCase(), "On-chain winner does not match challenger wallet.");
  const [challengerMetadataUri, opponentMetadataUri] = await Promise.all([
    publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "tokenURI", args: [challengerReceiptId] }),
    publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "tokenURI", args: [opponentReceiptId] }),
  ]);
  const [challengerMetadata, opponentMetadata] = [decodeTokenURI(challengerMetadataUri), decodeTokenURI(opponentMetadataUri)];
  assert(JSON.stringify(challengerMetadata).includes("Winner - condition fulfilled"), "Challenger metadata does not show winner/fulfilled state.");
  assert(JSON.stringify(opponentMetadata).includes("Loser - condition fulfilled"), "Opponent metadata does not show loser/fulfilled state.");
  console.log("PASS: both real Pact NFTs exist on Monad mainnet; winner and fulfilment are reflected in on-chain metadata.");
  console.log(JSON.stringify({
    chainId: 143,
    factory: FACTORY,
    pactId: String(pactId),
    challenger: key1.address,
    challengerChogId: String(challengerChogId),
    challengerReceiptId: String(challengerReceiptId),
    opponent: key2.address,
    opponentChogId: String(opponentChogId),
    opponentReceiptId: String(opponentReceiptId),
    mintTransaction: mintHash,
    settlementTransaction: settleHash,
    fulfillmentTransaction: fulfilHash,
    finalStatus: "FULFILLED",
    condition: TEST_CONDITION,
  }, null, 2));
}

main().catch((error) => {
  // Never log secrets. Viem's transport errors, revert messages and tx hashes are safe to
  // print, but private keys are never included in custom error messages.
  console.error(`MAINNET PACT TEST FAILED: ${error?.shortMessage || error?.message || "Unknown error"}`);
  process.exitCode = 1;
});
