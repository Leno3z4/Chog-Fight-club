// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../contracts/ChogBattlePactFactory.sol";

interface Vm {
    function prank(address sender) external;
    function expectRevert(bytes4 selector) external;
    function warp(uint256 timestamp) external;
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
}

contract MockChog {
    mapping(uint256 => address) private owners;
    function mint(address to, uint256 tokenId) external { owners[tokenId] = to; }
    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner = owners[tokenId];
        require(owner != address(0), "NOT_MINTED");
        return owner;
    }
}

contract ChogBattlePactFactoryTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant CHALLENGER_KEY = 0xA11CE;
    uint256 private constant OPPONENT_KEY = 0xB0B;
    address private challenger;
    address private opponent;
    address private constant resolver = address(0xFACADE);
    MockChog private chog;
    ChogBattlePactFactory private factory;
    string private condition = "Post a harmless silly message for one day.";
    string private termsURI = "ipfs://terms-document";

    function setUp() public {
        challenger = vm.addr(CHALLENGER_KEY);
        opponent = vm.addr(OPPONENT_KEY);
        chog = new MockChog();
        chog.mint(challenger, 101);
        chog.mint(opponent, 202);
        factory = new ChogBattlePactFactory(address(chog), resolver);
    }

    function _sign(bytes32 inviteKey, uint64 expiry) private returns (bytes memory challengerSig, bytes memory opponentSig) {
        bytes32 digest = factory.agreementDigest(
            inviteKey, challenger, opponent, 101, 202, keccak256(bytes(condition)),
            keccak256(bytes(termsURI)), expiry
        );
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(CHALLENGER_KEY, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(OPPONENT_KEY, digest);
        challengerSig = abi.encodePacked(r1, s1, v1);
        opponentSig = abi.encodePacked(r2, s2, v2);
    }

    function _mintPact() private returns (uint256 pactId, bytes memory challengerSig, bytes memory opponentSig, uint64 expiry, bytes32 inviteKey) {
        inviteKey = keccak256("invite-1");
        expiry = uint64(block.timestamp + 1 days);
        (challengerSig, opponentSig) = _sign(inviteKey, expiry);
        pactId = factory.mintPact(inviteKey, challenger, opponent, 101, 202, condition, termsURI, expiry, challengerSig, opponentSig);
    }

    function testMintingCreatesTwoSoulboundReceipts() public {
        (uint256 pactId,,,,) = _mintPact();
        (,,,,,,,,,, uint8 status,, uint256 challengerReceipt, uint256 opponentReceipt) = factory.getPact(pactId);
        require(status == 1, "PACT_NOT_ACTIVE");
        require(factory.ownerOf(challengerReceipt) == challenger, "WRONG_CHALLENGER_OWNER");
        require(factory.ownerOf(opponentReceipt) == opponent, "WRONG_OPPONENT_OWNER");
        vm.expectRevert(ChogBattlePactFactory.Soulbound.selector);
        vm.prank(challenger);
        factory.transferFrom(challenger, opponent, challengerReceipt);
        vm.expectRevert(ChogBattlePactFactory.Soulbound.selector);
        vm.prank(challenger);
        factory.approve(opponent, challengerReceipt);
    }

    function testOnlyResolverCanSettleAndWinnerCanConfirmFulfillment() public {
        (uint256 pactId,,,,) = _mintPact();
        vm.expectRevert(ChogBattlePactFactory.NotResolver.selector);
        vm.prank(opponent);
        factory.settleMatch(pactId, challenger);
        vm.prank(resolver);
        factory.settleMatch(pactId, challenger);
        vm.expectRevert(ChogBattlePactFactory.NotWinner.selector);
        vm.prank(opponent);
        factory.confirmFulfillment(pactId);
        vm.prank(challenger);
        factory.confirmFulfillment(pactId);
        (,,,,,,,,,, uint8 status,,,) = factory.getPact(pactId);
        require(status == 3, "PACT_NOT_FULFILLED");
    }

    function testRejectsDuplicateInviteKey() public {
        (, bytes memory challengerSig, bytes memory opponentSig, uint64 expiry, bytes32 inviteKey) = _mintPact();
        vm.expectRevert(ChogBattlePactFactory.InviteAlreadyUsed.selector);
        factory.mintPact(inviteKey, challenger, opponent, 101, 202, condition, termsURI, expiry, challengerSig, opponentSig);
    }

    function testCannotMintAfterExpiry() public {
        bytes32 inviteKey = keccak256("invite-expiry");
        uint64 expiry = uint64(block.timestamp + 1 days);
        (bytes memory challengerSig, bytes memory opponentSig) = _sign(inviteKey, expiry);
        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert(ChogBattlePactFactory.InvalidExpiry.selector);
        factory.mintPact(inviteKey, challenger, opponent, 101, 202, condition, termsURI, expiry, challengerSig, opponentSig);
    }
}
