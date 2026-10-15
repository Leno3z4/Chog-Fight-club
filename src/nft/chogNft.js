const CHOG_COLLECTION_ADDRESS = "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763";
const MONAD_CHAIN_ID = "0x8f";
const MONAD_CHAIN_DECIMAL = 143;
const MONAD_RPC_URL = import.meta.env.VITE_MONAD_RPC_URL || "https://rpc.monad.xyz";
const INDEXER_URL = import.meta.env.VITE_CHOG_NFT_INDEXER_URL || "";
const IPFS_GATEWAY = (import.meta.env.VITE_IPFS_GATEWAY || "https://ipfs.io/ipfs/").replace(/\/$/, "") + "/";

const SELECTED_KEY = "chog-fight-club:selected-player";
const SELECTORS = {
  balanceOf: "0x70a08231",
  ownerOf: "0x6352211e",
  tokenURI: "0xc87b56dd",
  supportsInterface: "0x01ffc9a7",
  tokenOfOwnerByIndex: "0x2f745c59",
};

export { CHOG_COLLECTION_ADDRESS, MONAD_CHAIN_DECIMAL, SELECTED_KEY };

function getProvider() {
  if (!window.ethereum) {
    throw new Error("No wallet detected. Install or unlock an EVM wallet such as MetaMask.");
  }
  return window.ethereum;
}

function addressWord(address) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error("Wallet returned an invalid address.");
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function uintWord(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function decodeUint(hex) {
  return BigInt(hex || "0x0");
}

function decodeBool(hex) {
  return decodeUint(hex) !== 0n;
}

function decodeAbiString(hex) {
  if (!hex || hex === "0x") return "";
  const data = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (data.length < 128) return "";
  const offset = Number(BigInt("0x" + data.slice(0, 64)));
  const lengthStart = offset * 2;
  const length = Number(BigInt("0x" + data.slice(lengthStart, lengthStart + 64)));
  const bytes = data.slice(lengthStart + 64, lengthStart + 64 + length * 2);
  const decoded = new Uint8Array(bytes.match(/.{1,2}/g)?.map((part) => Number.parseInt(part, 16)) ?? []);
  return new TextDecoder().decode(decoded);
}

async function ethCall(data) {
  const provider = getProvider();
  return provider.request({
    method: "eth_call",
    params: [{ to: CHOG_COLLECTION_ADDRESS, data }, "latest"],
  });
}

export async function connectWallet() {
  const provider = getProvider();
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts?.length) throw new Error("No wallet account was returned.");

  let chainId = await provider.request({ method: "eth_chainId" });
  if (chainId.toLowerCase() !== MONAD_CHAIN_ID) {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: MONAD_CHAIN_ID }],
      });
    } catch (error) {
      if (error?.code !== 4902) throw error;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: MONAD_CHAIN_ID,
          chainName: "Monad Mainnet",
          nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
          rpcUrls: [MONAD_RPC_URL],
          blockExplorerUrls: ["https://monadscan.com"],
        }],
      });
    }
    chainId = await provider.request({ method: "eth_chainId" });
  }
  if (chainId.toLowerCase() !== MONAD_CHAIN_ID) {
    throw new Error("Switch your wallet to Monad Mainnet (chain ID 143) to load Chog Genesis.");
  }
  return accounts[0];
}

async function readBalance(owner) {
  const raw = await ethCall(SELECTORS.balanceOf + addressWord(owner));
  return Number(decodeUint(raw));
}

async function supportsEnumerable() {
  // ERC-721 Enumerable interface ID is 0x780e9d63. This extension is optional.
  const raw = await ethCall(SELECTORS.supportsInterface + "780e9d63".padEnd(64, "0"));
  return decodeBool(raw);
}

async function readOwnedTokenIdsEnumerable(owner, balance) {
  const tokenIds = [];
  for (let index = 0; index < balance; index += 1) {
    const raw = await ethCall(SELECTORS.tokenOfOwnerByIndex + addressWord(owner) + uintWord(index));
    tokenIds.push(decodeUint(raw).toString());
  }
  return tokenIds;
}

async function readOwnedTokenIdsFromMonadScan(owner, expectedBalance) {
  // Public MonadScan API requests without a key are rate limited. This fallback
  // is suitable for prototype use; production deployments should proxy a keyed
  // API through a server-side endpoint and keep that key out of browser code.
  const base = "https://api.monadscan.com/api";
  const offset = 1000;
  const latestOwnerByToken = new Map();

  for (let page = 1; page <= 20; page += 1) {
    const url = new URL(base);
    url.searchParams.set("module", "account");
    url.searchParams.set("action", "tokennfttx");
    url.searchParams.set("address", owner);
    url.searchParams.set("contractaddress", CHOG_COLLECTION_ADDRESS);
    url.searchParams.set("page", String(page));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("sort", "desc");
    url.searchParams.set("chainid", String(MONAD_CHAIN_DECIMAL));

    const response = await fetch(url.toString(), { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`MonadScan NFT lookup failed (${response.status}).`);
    const payload = await response.json();
    const records = Array.isArray(payload?.result) ? payload.result : [];

    if (!records.length) {
      throw new Error("MonadScan returned no NFT transfer history although balanceOf reports Chogs. Configure a server-side indexer endpoint and try again.");
    }

    for (const record of records) {
      const contract = record?.contractAddress ?? record?.contractaddress;
      if (contract && String(contract).toLowerCase() !== CHOG_COLLECTION_ADDRESS.toLowerCase()) continue;
      const tokenId = record?.tokenID ?? record?.tokenId ?? record?.token_id;
      if (tokenId === undefined || tokenId === null) continue;
      const key = String(tokenId);
      if (latestOwnerByToken.has(key)) continue;
      const from = String(record?.from ?? "").toLowerCase();
      const to = String(record?.to ?? "").toLowerCase();
      if (to === owner.toLowerCase()) latestOwnerByToken.set(key, true);
      else if (from === owner.toLowerCase()) latestOwnerByToken.set(key, false);
    }

    const ownedIds = [...latestOwnerByToken.entries()].filter(([, isOwner]) => isOwner).map(([id]) => id);
    if (ownedIds.length >= expectedBalance) return ownedIds.slice(0, expectedBalance);
    if (records.length < offset) break;

    // The no-key API allowance is intentionally slow. Only wait when pagination is needed.
    await new Promise((resolve) => setTimeout(resolve, 5200));
  }

  throw new Error("The public NFT index did not return every Chog owned by this wallet. Configure a server-side indexer endpoint for reliable paging.");
}

async function readOwnedTokenIdsFromIndexer(owner) {
  if (!INDEXER_URL) {
    const error = new Error(
      "This collection does not expose on-chain owner enumeration. Configure VITE_CHOG_NFT_INDEXER_URL to a server-side NFT indexer endpoint; do not put private API keys in VITE_ variables."
    );
    error.code = "CHOG_INDEXER_REQUIRED";
    throw error;
  }

  const url = new URL(INDEXER_URL, window.location.origin);
  url.searchParams.set("owner", owner);
  const response = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`NFT indexer request failed (${response.status}).`);
  const payload = await response.json();
  const root = payload?.result?.data ?? payload?.data ?? payload;
  let items = [];

  if (Array.isArray(payload?.tokenIds)) {
    return payload.tokenIds.map(String);
  }
  if (Array.isArray(payload?.items)) {
    items = payload.items;
  } else if (Array.isArray(root)) {
    const collection = root.find((entry) =>
      String(entry?.contractAddress ?? entry?.address ?? "").toLowerCase() === CHOG_COLLECTION_ADDRESS.toLowerCase()
    );
    if (collection) items = collection.items ?? collection.tokens ?? [];
    else items = root.filter((entry) => {
      const address = entry?.contractAddress ?? entry?.contract_address ?? entry?.token?.contractAddress;
      return !address || String(address).toLowerCase() === CHOG_COLLECTION_ADDRESS.toLowerCase();
    });
  } else if (Array.isArray(root?.items)) {
    items = root.items;
  } else if (Array.isArray(root?.tokenIds)) {
    return root.tokenIds.map(String);
  }

  return items
    .filter((item) => {
      const address = item?.contractAddress ?? item?.contract_address ?? item?.token?.contractAddress;
      return !address || String(address).toLowerCase() === CHOG_COLLECTION_ADDRESS.toLowerCase();
    })
    .map((item) => item?.tokenId ?? item?.token_id ?? item?.id ?? item?.token?.tokenId)
    .filter((id) => id !== undefined && id !== null)
    .map(String);
}

function toHttpUri(uri) {
  if (typeof uri !== "string") return "";
  if (uri.startsWith("ipfs://")) {
    const path = uri.slice("ipfs://".length).replace(/^ipfs\//, "");
    return IPFS_GATEWAY + path;
  }
  if (uri.startsWith("ar://")) return "https://arweave.net/" + uri.slice("ar://".length);
  return uri;
}

async function fetchTokenMetadata(tokenId) {
  const rawUri = decodeAbiString(await ethCall(SELECTORS.tokenURI + uintWord(tokenId)));
  if (!rawUri) throw new Error(`Chog #${tokenId}: tokenURI is empty.`);

  let metadata;
  if (rawUri.startsWith("data:application/json;base64,")) {
    metadata = JSON.parse(atob(rawUri.slice("data:application/json;base64,".length)));
  } else if (rawUri.startsWith("data:application/json,")) {
    metadata = JSON.parse(decodeURIComponent(rawUri.slice("data:application/json,".length)));
  } else {
    const uri = toHttpUri(rawUri);
    const response = await fetch(uri, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Chog #${tokenId}: metadata request failed (${response.status}).`);
    metadata = await response.json();
  }

  const traits = {};
  const attributes = Array.isArray(metadata?.attributes) ? metadata.attributes : [];
  for (const attribute of attributes) {
    const key = attribute?.trait_type ?? attribute?.traitType ?? attribute?.name;
    if (key && attribute?.value !== undefined && attribute?.value !== null) traits[String(key)] = attribute.value;
  }

  const image = toHttpUri(metadata?.image ?? metadata?.image_url ?? metadata?.imageUrl ?? "");
  return {
    ...traits,
    tokenId: String(tokenId),
    name: metadata?.name ?? `Chog #${tokenId}`,
    description: metadata?.description ?? "",
    image,
    metadataUri: rawUri,
    attributes,
  };
}

export async function getOwnedChogs(owner) {
  const balance = await readBalance(owner);
  if (balance === 0) return [];

  let tokenIds;
  let enumerable = false;
  try {
    enumerable = await supportsEnumerable();
  } catch {
    // Some ERC-721 implementations do not expose ERC-165 reliably.
    // Fall through to an indexed ownership lookup rather than treating this as empty.
  }

  if (enumerable) {
    try {
      tokenIds = await readOwnedTokenIdsEnumerable(owner, balance);
    } catch {
      tokenIds = INDEXER_URL
        ? await readOwnedTokenIdsFromIndexer(owner)
        : await readOwnedTokenIdsFromMonadScan(owner, balance);
    }
  } else {
    tokenIds = INDEXER_URL
      ? await readOwnedTokenIdsFromIndexer(owner)
      : await readOwnedTokenIdsFromMonadScan(owner, balance);
  }

  const uniqueIds = [...new Set(tokenIds.map(String))];
  const chogs = await Promise.all(uniqueIds.map(async (tokenId) => {
    // The indexer is a discovery aid only. Verify current ownership on-chain before listing.
    const ownerResult = await ethCall(SELECTORS.ownerOf + uintWord(tokenId));
    const actualOwner = "0x" + ownerResult.slice(-40);
    if (actualOwner.toLowerCase() !== owner.toLowerCase()) return null;
    try {
      const metadata = await fetchTokenMetadata(tokenId);
      return { tokenId, metadata, metadataError: false };
    } catch (error) {
      return {
        tokenId,
        metadata: { tokenId, name: `Chog #${tokenId}`, Tier: "Common" },
        metadataError: true,
        metadataMessage: error?.message ?? "Metadata could not be loaded.",
      };
    }
  }));

  return chogs.filter(Boolean).sort((a, b) => Number(a.tokenId) - Number(b.tokenId));
}

export function saveSelectedFighter(selection) {
  sessionStorage.setItem(SELECTED_KEY, JSON.stringify(selection));
}

export function readSelectedFighter() {
  try {
    if (typeof window === "undefined") return null;
    const raw = sessionStorage.getItem(SELECTED_KEY);
    if (!raw) return null;
    const selection = JSON.parse(raw);
    if (!selection || !selection.metadata || typeof selection.metadata !== "object") return null;
    return selection;
  } catch {
    return null;
  }
}
