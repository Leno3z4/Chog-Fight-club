// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../contracts/ChogBattlePactFactory.sol";

interface Vm {
    function prank(address sender) external;
    function expectRevert(bytes4 selector) external;
    function warp(uint256 timestamp) external;
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
    address private constant challenger = address(0xA11CE);
    address private constant opponent = address(0xB0B);
    address private constant resolver = address(0xFACADE);
    MockChog private chog;
    ChogBattlePactFactory private factory;

    function setUp() public {
        chog = new MockChog();
        chog.mint(challenger, 101);
        chog.mint(opponent, 202);
        factory = new ChogBattlePactFactory(address(chog), resolver);
    }

    function _propose() private returns (uint256 pactId) {
        vm.prank(challenger);
        pactId = factory.createPact(
            keccak256("invite-1"),
            opponent,
            101,
            "Post a harmless silly message for one day.",
            "ipfs://terms-document",
            uint64(block.timestamp + 1 days)
        );
    }

    function testAcceptanceMintsTwoSoulboundReceipts() public {
        uint256 pactId = _propose();
        vm.prank(opponent);
        factory.acceptPact(pactId, 202);
        (,,,,,,,,,, uint8 status,, uint256 challengerReceipt, uint256 opponentReceipt) = factory.getPact(pactId);
        require(status == 1, "PACT_NOT_ACTIVE");
        require(factory.ownerOf(challengerReceipt) == challenger, "WRONG_CHALLENGER_OWNER");
        require(factory.ownerOf(opponentReceipt) == opponent, "WRONG_OPPONENT_OWNER");
        vm.prank(challenger);
        vm.expectRevert(ChogBattlePactFactory.Soulbound.selector);
        factory.transferFrom(challenger, opponent, challengerReceipt);
        vm.prank(challenger);
        vm.expectRevert(ChogBattlePactFactory.Soulbound.selector);
        factory.approve(opponent, challengerReceipt);
    }

    function testOnlyResolverCanSettleAndWinnerCanConfirmFulfillment() public {
        uint256 pactId = _propose();
        vm.prank(opponent);
        factory.acceptPact(pactId, 202);
        vm.prank(opponent);
        vm.expectRevert(ChogBattlePactFactory.NotResolver.selector);
        factory.settleMatch(pactId, challenger);
        vm.prank(resolver);
        factory.settleMatch(pactId, challenger);
        vm.prank(opponent);
        vm.expectRevert(ChogBattlePactFactory.NotWinner.selector);
        factory.confirmFulfillment(pactId);
        vm.prank(challenger);
        factory.confirmFulfillment(pactId);
        (,,,,,,,,,, uint8 status,,,) = factory.getPact(pactId);
        require(status == 3, "PACT_NOT_FULFILLED");
    }

    function testRejectsDuplicateInviteKey() public {
        _propose();
        vm.prank(challenger);
        vm.expectRevert(ChogBattlePactFactory.InviteAlreadyUsed.selector);
        factory.createPact(
            keccak256("invite-1"), opponent, 101, "Another harmless condition.",
            "", uint64(block.timestamp + 1 days)
        );
    }

    function testCannotAcceptAfterExpiry() public {
        uint256 pactId = _propose();
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(opponent);
        vm.expectRevert(ChogBattlePactFactory.PactExpired.selector);
        factory.acceptPact(pactId, 202);
    }
}
