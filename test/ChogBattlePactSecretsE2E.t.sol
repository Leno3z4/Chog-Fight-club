// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../contracts/ChogBattlePactFactory.sol";

interface VmSecretsE2E {
    function envUint(string calldata key) external returns (uint256 value);
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

contract MockChogSecretsE2E {
    mapping(uint256 => address) private owners;
    function mint(address to, uint256 tokenId) external { owners[tokenId] = to; }
    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner = owners[tokenId];
        require(owner != address(0), "NOT_MINTED");
        return owner;
    }
}

contract ChogBattlePactSecretsE2ETest {
    VmSecretsE2E private constant vm = VmSecretsE2E(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private key1;
    uint256 private key2;
    address private player1;
    address private player2;
    address private constant resolver = address(0xFACADE);
    MockChogSecretsE2E private chog;
    ChogBattlePactFactory private factory;

    function setUp() public {
        key1 = vm.envUint("PRIVATE_KEY1");
        key2 = vm.envUint("PRIVATE_KEY2");
        require(key1 != 0 && key2 != 0 && key1 != key2, "TWO_DISTINCT_TEST_KEYS_REQUIRED");
        player1 = vm.addr(key1);
        player2 = vm.addr(key2);
        require(player1 != player2, "TEST_WALLETS_MUST_DIFFER");
        chog = new MockChogSecretsE2E();
        chog.mint(player1, 101);
        chog.mint(player2, 202);
        factory = new ChogBattlePactFactory(address(chog), resolver);
    }

    function testSecretWalletsMintSettleAndFulfillPact() public {
        bytes32 inviteKey = keccak256("github-actions-two-wallet-e2e");
        string memory condition = "Post a harmless silly message for one day.";
        string memory termsURI = "";
        uint64 expiry = uint64(block.timestamp + 1 days);
        bytes32 termsHash = keccak256(bytes(condition));
        bytes32 uriHash = keccak256(bytes(termsURI));
        bytes32 digest = factory.agreementDigest(
            inviteKey, player1, player2, 101, 202, termsHash, uriHash, expiry
        );

        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(key1, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(key2, digest);
        bytes memory sig1 = abi.encodePacked(r1, s1, v1);
        bytes memory sig2 = abi.encodePacked(r2, s2, v2);

        uint256 pactId = factory.mintPact(
            inviteKey, player1, player2, 101, 202, condition, termsURI,
            expiry, sig1, sig2
        );
        require(pactId == 1, "PACT_NOT_MINTED");
        require(factory.ownerOf(1) == player1, "PLAYER1_RECEIPT_MISSING");
        require(factory.ownerOf(2) == player2, "PLAYER2_RECEIPT_MISSING");

        (,,,,,,,,,, uint8 statusBefore,,,) = factory.getPact(pactId);
        require(statusBefore == 1, "PACT_NOT_ACTIVE_AFTER_MINT");

        vm.prank(resolver);
        factory.settleMatch(pactId, player1);
        (,,,,,,,,,, uint8 statusSettled, address winner,,) = factory.getPact(pactId);
        require(statusSettled == 2 && winner == player1, "WINNER_SETTLEMENT_FAILED");

        vm.prank(player1);
        factory.confirmFulfillment(pactId);
        (,,,,,,,,,, uint8 statusFulfilled, address finalWinner,,) = factory.getPact(pactId);
        require(statusFulfilled == 3 && finalWinner == player1, "FULFILLMENT_FAILED");
    }
}
