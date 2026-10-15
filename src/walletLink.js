import { connectWallet } from "./nft/chogNft.js";

export async function connectAndLinkWallet() {
  const address = await connectWallet();
  const challengeResponse = await fetch("/api/wallet/challenge", {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  const challenge = await challengeResponse.json().catch(() => ({}));
  if (!challengeResponse.ok || !challenge.message) {
    throw new Error(challenge.error || "Could not start wallet verification.");
  }

  const signature = await window.ethereum.request({
    method: "personal_sign",
    params: [challenge.message, address],
  });
  const verifyResponse = await fetch("/api/wallet/verify", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ message: challenge.message, signature }),
  });
  const verified = await verifyResponse.json().catch(() => ({}));
  if (!verifyResponse.ok || !verified?.ok || !verified.walletAddress) {
    throw new Error(verified.error || "Wallet signature could not be verified.");
  }
  if (verified.walletAddress.toLowerCase() !== address.toLowerCase()) {
    throw new Error("The verified address differs from the connected wallet. Reconnect and try again.");
  }
  return verified.walletAddress;
}
