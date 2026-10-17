import { createPublicClient, createWalletClient, custom, defineChain, http } from "viem";

const DEFAULT_RPC = import.meta.env.VITE_MONAD_RPC_URL || "https://rpc.monad.xyz";
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
  { type: "function", name: "mintPact", stateMutability: "nonpayable", inputs: [
    { name: "inviteKey", type: "bytes32" },
    { name: "challenger", type: "address" },
    { name: "opponent", type: "address" },
    { name: "challengerChogId", type: "uint256" },
    { name: "opponentChogId", type: "uint256" },
    { name: "condition", type: "string" },
    { name: "termsURI", type: "string" },
    { name: "expiresAt", type: "uint64" },
    { name: "challengerSignature", type: "bytes" },
    { name: "opponentSignature", type: "bytes" },
  ], outputs: [{ name: "pactId", type: "uint256" }] },
];
function getChain(chainId = 143) {
  return defineChain({
    id: Number(chainId),
    name: Number(chainId) === 143 ? "Monad" : "Monad network",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [DEFAULT_RPC] } },
  });
}
function walletClient(wallet, chainId) {
  if (!window.ethereum) throw new Error("No EVM wallet was detected.");
  return createWalletClient({ account: wallet, chain: getChain(chainId), transport: custom(window.ethereum) });
}
function typedMessage(pact) {
  const message = pact.typedData.message;
  return {
    ...message,
    challengerChogId: BigInt(message.challengerChogId),
    opponentChogId: BigInt(message.opponentChogId),
    expiresAt: BigInt(message.expiresAt),
  };
}
export async function signPactAgreement(wallet, pact) {
  if (!pact?.configured || !pact?.typedData) throw new Error("Pact factory is not configured yet.");
  const client = walletClient(wallet, pact.typedData.domain.chainId);
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  if (BigInt(chainId) !== BigInt(pact.typedData.domain.chainId)) {
    throw new Error("Switch your wallet to the Monad network before signing the agreement.");
  }
  return client.signTypedData({
    account: wallet,
    domain: pact.typedData.domain,
    types: PACT_TYPES,
    primaryType: "PactAgreement",
    message: typedMessage(pact),
  });
}
export async function mintPactAgreement(wallet, pact) {
  if (!pact?.configured || !pact?.agreement || !pact?.challengerSignature || !pact?.opponentSignature) {
    throw new Error("Both players must sign the same agreement before minting.");
  }
  const chainId = pact.typedData.domain.chainId;
  const currentChain = await window.ethereum.request({ method: "eth_chainId" });
  if (BigInt(currentChain) !== BigInt(chainId)) throw new Error("Switch your wallet to Monad before minting.");
  const client = walletClient(wallet, chainId);
  const a = pact.agreement;
  const hash = await client.writeContract({
    address: pact.contractAddress,
    abi: PACT_ABI,
    functionName: "mintPact",
    args: [
      a.inviteKey,
      a.challenger,
      a.opponent,
      BigInt(a.challengerChogId),
      BigInt(a.opponentChogId),
      a.condition,
      a.termsURI,
      BigInt(a.expiresAt),
      pact.challengerSignature,
      pact.opponentSignature,
    ],
  });
  const chain = getChain(chainId);
  const publicClient = createPublicClient({ chain, transport: http(DEFAULT_RPC) });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
