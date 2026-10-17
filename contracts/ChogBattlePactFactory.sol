// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Chog Battle Arena Pact Factory
/// @notice Mints paired, soulbound receipts for an accepted challenge. Chog NFTs are never transferred.
/// @dev The match resolver is immutable. Use a dedicated, tightly controlled resolver address.
contract ChogBattlePactFactory {
    error ZeroAddress();
    error InvalidOpponent();
    error InvalidCondition();
    error InvalidExpiry();
    error InviteAlreadyUsed();
    error PactNotFound();
    error NotOpponent();
    error PactExpired();
    error PactNotAccepting();
    error NotParticipant();
    error NotResolver();
    error InvalidWinner();
    error AlreadySettled();
    error NotWinner();
    error ConditionAlreadyFulfilled();
    error Soulbound();
    error ChogOwnershipNotVerified();
    error InvalidTermsHash();

    event PactProposed(
        uint256 indexed pactId,
        bytes32 indexed inviteKey,
        address indexed challenger,
        address opponent,
        uint256 challengerChogId,
        bytes32 termsHash,
        uint64 expiresAt
    );
    event PactAccepted(
        uint256 indexed pactId,
        uint256 challengerReceiptId,
        uint256 opponentReceiptId,
        address challenger,
        address opponent
    );
    event MatchSettled(uint256 indexed pactId, address indexed winner, uint256 winnerReceiptId, uint256 loserReceiptId);
    event ConditionFulfilled(uint256 indexed pactId, address indexed winner, address indexed loser, uint256 loserReceiptId);

    uint8 private constant PROPOSED = 0;
    uint8 private constant ACTIVE = 1;
    uint8 private constant SETTLED = 2;
    uint8 private constant FULFILLED = 3;
    uint8 private constant CANCELLED = 4;

    string private constant COLLECTION_NAME = "Chog Battle Arena Pact";
    string private constant COLLECTION_SYMBOL = "CBAP";

    address public immutable chogCollection;
    address public immutable matchResolver;
    uint256 public nextPactId = 1;
    uint256 public nextTokenId = 1;

    struct Pact {
        bytes32 inviteKey;
        address challenger;
        address opponent;
        uint256 challengerChogId;
        uint256 opponentChogId;
        string condition;
        string termsURI;
        bytes32 termsHash;
        uint64 createdAt;
        uint64 expiresAt;
        uint8 status;
        address winner;
        uint256 challengerReceiptId;
        uint256 opponentReceiptId;
    }

    mapping(uint256 => Pact) private pacts;
    mapping(bytes32 => uint256) public pactIdForInvite;
    mapping(uint256 => address) private receiptOwner;
    mapping(address => uint256) private ownedReceiptCount;
    mapping(uint256 => uint256) public pactIdForReceipt;

    constructor(address chogCollection_, address matchResolver_) {
        if (chogCollection_ == address(0) || matchResolver_ == address(0)) revert ZeroAddress();
        chogCollection = chogCollection_;
        matchResolver = matchResolver_;
    }

    function name() external pure returns (string memory) { return COLLECTION_NAME; }
    function symbol() external pure returns (string memory) { return COLLECTION_SYMBOL; }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC165
            || interfaceId == 0x80ac58cd // ERC721
            || interfaceId == 0x5b5e139f; // ERC721Metadata
    }

    function balanceOf(address account) external view returns (uint256) {
        if (account == address(0)) revert ZeroAddress();
        return ownedReceiptCount[account];
    }

    function ownerOf(uint256 tokenId) public view returns (address owner) {
        owner = receiptOwner[tokenId];
        if (owner == address(0)) revert PactNotFound();
    }

    function getApproved(uint256) external pure returns (address) { return address(0); }
    function isApprovedForAll(address, address) external pure returns (bool) { return false; }

    function approve(address, uint256) external pure { revert Soulbound(); }
    function setApprovalForAll(address, bool) external pure { revert Soulbound(); }
    function transferFrom(address, address, uint256) external pure { revert Soulbound(); }
    function safeTransferFrom(address, address, uint256) external pure { revert Soulbound(); }
    function safeTransferFrom(address, address, uint256, bytes calldata) external pure { revert Soulbound(); }

    /// @notice Propose the exact condition. The NFT receipts are minted only when the opponent accepts.
    /// @param inviteKey A unique hash of the Arena invitation ID, used to prevent duplicate minting.
    /// @param opponent The wallet already linked to the challenged player's verified Discord account.
    /// @param challengerChogId The challenger's Chog token ID; the contract verifies ownership.
    /// @param condition The exact, public condition both players are agreeing to.
    /// @param termsURI Optional public document URI; the condition itself is also stored on-chain.
    /// @param expiresAt Unix timestamp by which the opponent must accept.
    function createPact(
        bytes32 inviteKey,
        address opponent,
        uint256 challengerChogId,
        string calldata condition,
        string calldata termsURI,
        uint64 expiresAt
    ) external returns (uint256 pactId) {
        if (inviteKey == bytes32(0) || pactIdForInvite[inviteKey] != 0) revert InviteAlreadyUsed();
        if (opponent == address(0) || opponent == msg.sender) revert InvalidOpponent();
        bytes memory conditionBytes = bytes(condition);
        if (conditionBytes.length < 5 || conditionBytes.length > 500) revert InvalidCondition();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();
        if (_ownerOfChog(challengerChogId) != msg.sender) revert ChogOwnershipNotVerified();

        pactId = nextPactId++;
        bytes32 termsHash = keccak256(conditionBytes);
        Pact storage pact = pacts[pactId];
        pact.inviteKey = inviteKey;
        pact.challenger = msg.sender;
        pact.opponent = opponent;
        pact.challengerChogId = challengerChogId;
        pact.condition = condition;
        pact.termsURI = termsURI;
        pact.termsHash = termsHash;
        pact.createdAt = uint64(block.timestamp);
        pact.expiresAt = expiresAt;
        pact.status = PROPOSED;
        pactIdForInvite[inviteKey] = pactId;

        emit PactProposed(pactId, inviteKey, msg.sender, opponent, challengerChogId, termsHash, expiresAt);
    }

    /// @notice Opponent explicitly accepts the exact on-chain condition and selects their own Chog.
    /// @dev Mints one linked, non-transferable receipt to each participant.
    function acceptPact(uint256 pactId, uint256 opponentChogId) external {
        Pact storage pact = pacts[pactId];
        if (pact.challenger == address(0)) revert PactNotFound();
        if (msg.sender != pact.opponent) revert NotOpponent();
        if (pact.status != PROPOSED) revert PactNotAccepting();
        if (block.timestamp > pact.expiresAt) revert PactExpired();
        if (_ownerOfChog(opponentChogId) != msg.sender) revert ChogOwnershipNotVerified();

        pact.opponentChogId = opponentChogId;
        pact.status = ACTIVE;
        uint256 challengerReceiptId = nextTokenId++;
        uint256 opponentReceiptId = nextTokenId++;
        pact.challengerReceiptId = challengerReceiptId;
        pact.opponentReceiptId = opponentReceiptId;
        pactIdForReceipt[challengerReceiptId] = pactId;
        pactIdForReceipt[opponentReceiptId] = pactId;
        _mintSoulbound(pact.challenger, challengerReceiptId);
        _mintSoulbound(pact.opponent, opponentReceiptId);

        emit PactAccepted(pactId, challengerReceiptId, opponentReceiptId, pact.challenger, pact.opponent);
    }

    /// @notice Record a validated match result once. Only the immutable resolver can settle matches.
    function settleMatch(uint256 pactId, address winner) external {
        if (msg.sender != matchResolver) revert NotResolver();
        Pact storage pact = pacts[pactId];
        if (pact.challenger == address(0)) revert PactNotFound();
        if (pact.status != ACTIVE) revert AlreadySettled();
        if (winner != pact.challenger && winner != pact.opponent) revert InvalidWinner();
        pact.winner = winner;
        pact.status = SETTLED;
        uint256 winnerReceipt = winner == pact.challenger ? pact.challengerReceiptId : pact.opponentReceiptId;
        uint256 loserReceipt = winner == pact.challenger ? pact.opponentReceiptId : pact.challengerReceiptId;
        emit MatchSettled(pactId, winner, winnerReceipt, loserReceipt);
    }

    /// @notice Winner confirms the agreed condition has been completed.
    function confirmFulfillment(uint256 pactId) external {
        Pact storage pact = pacts[pactId];
        if (pact.challenger == address(0)) revert PactNotFound();
        if (pact.status == FULFILLED) revert ConditionAlreadyFulfilled();
        if (pact.status != SETTLED) revert PactNotAccepting();
        if (msg.sender != pact.winner) revert NotWinner();
        pact.status = FULFILLED;
        address loser = pact.winner == pact.challenger ? pact.opponent : pact.challenger;
        uint256 loserReceipt = loser == pact.challenger ? pact.challengerReceiptId : pact.opponentReceiptId;
        emit ConditionFulfilled(pactId, pact.winner, loser, loserReceipt);
    }

    /// @notice A proposal can be cancelled only by its challenger and only before acceptance.
    function cancelProposal(uint256 pactId) external {
        Pact storage pact = pacts[pactId];
        if (pact.challenger == address(0)) revert PactNotFound();
        if (msg.sender != pact.challenger) revert NotParticipant();
        if (pact.status != PROPOSED) revert PactNotAccepting();
        pact.status = CANCELLED;
    }

    function getPact(uint256 pactId) external view returns (
        bytes32 inviteKey,
        address challenger,
        address opponent,
        uint256 challengerChogId,
        uint256 opponentChogId,
        string memory condition,
        string memory termsURI,
        bytes32 termsHash,
        uint64 createdAt,
        uint64 expiresAt,
        uint8 status,
        address winner,
        uint256 challengerReceiptId,
        uint256 opponentReceiptId
    ) {
        Pact storage p = pacts[pactId];
        if (p.challenger == address(0)) revert PactNotFound();
        return (p.inviteKey, p.challenger, p.opponent, p.challengerChogId, p.opponentChogId,
            p.condition, p.termsURI, p.termsHash, p.createdAt, p.expiresAt, p.status, p.winner,
            p.challengerReceiptId, p.opponentReceiptId);
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        address tokenOwner = ownerOf(tokenId);
        uint256 pactId = pactIdForReceipt[tokenId];
        Pact storage pact = pacts[pactId];
        bool isChallenger = tokenOwner == pact.challenger;
        string memory role = isChallenger ? "Challenger" : "Opponent";
        address rival = isChallenger ? pact.opponent : pact.challenger;
        uint256 ownChogId = isChallenger ? pact.challengerChogId : pact.opponentChogId;
        uint256 rivalChogId = isChallenger ? pact.opponentChogId : pact.challengerChogId;
        string memory outcome;
        if (pact.status == PROPOSED) outcome = "Awaiting acceptance";
        else if (pact.status == ACTIVE) outcome = "Accepted - awaiting battle";
        else if (pact.status == CANCELLED) outcome = "Cancelled";
        else if (pact.status == FULFILLED) outcome = tokenOwner == pact.winner
            ? "Winner - condition fulfilled" : "Challenge lost - condition fulfilled";
        else if (pact.status == SETTLED) outcome = tokenOwner == pact.winner
            ? "Winner - condition pending" : "Unfulfilled Challenge";

        string memory description = string.concat(
            "Chog Battle Arena soulbound agreement. Role: ", role,
            ". Opponent: ", _toHexAddress(rival),
            ". Condition: ", pact.condition,
            ". Status: ", outcome,
            ". Terms hash: ", _toHexBytes32(pact.termsHash),
            pact.termsURI.length == 0 ? "" : string.concat(". Terms document: ", _escapeJson(pact.termsURI))
        );
        string memory attributes = string.concat(
            '[{"trait_type":"Challenge ID","value":"', _toString(pactId),
            '"},{"trait_type":"Role","value":"', role,
            '"},{"trait_type":"Opponent","value":"', _toHexAddress(rival),
            '"},{"trait_type":"Your Chog","value":"', _toString(ownChogId),
            '"},{"trait_type":"Opponent Chog","value":"', _toString(rivalChogId),
            '"},{"trait_type":"Status","value":"', _escapeJson(outcome),
            '"},{"trait_type":"Terms Hash","value":"', _toHexBytes32(pact.termsHash), '"}]'
        );
        string memory json = string.concat(
            '{"name":"Chog Battle Pact #', _toString(pactId), ' - ', role,
            '","description":"', _escapeJson(description),
            '","external_url":"', _escapeJson(pact.termsURI),
            '","attributes":', attributes, '}'
        );
        return string.concat("data:application/json;base64,", _base64(bytes(json)));
    }

    function _mintSoulbound(address to, uint256 tokenId) private {
        receiptOwner[tokenId] = to;
        ownedReceiptCount[to] += 1;
        emit Transfer(address(0), to, tokenId);
    }

    function _ownerOfChog(uint256 tokenId) private view returns (address owner) {
        (bool ok, bytes memory data) = chogCollection.staticcall(
            abi.encodeWithSignature("ownerOf(uint256)", tokenId)
        );
        if (!ok || data.length < 32) return address(0);
        owner = abi.decode(data, (address));
    }

    function _escapeJson(string memory value) private pure returns (string memory) {
        bytes memory input = bytes(value);
        bytes memory output = new bytes(input.length * 6);
        bytes16 hexChars = "0123456789abcdef";
        uint256 j;
        for (uint256 i; i < input.length; i++) {
            uint8 c = uint8(input[i]);
            if (c == 0x22 || c == 0x5c) {
                output[j++] = bytes1(0x5c);
                output[j++] = bytes1(c);
            } else if (c == 0x0a) {
                output[j++] = "\\";
                output[j++] = "n";
            } else if (c == 0x0d) {
                output[j++] = "\\";
                output[j++] = "r";
            } else if (c == 0x09) {
                output[j++] = "\\";
                output[j++] = "t";
            } else if (c < 0x20) {
                output[j++] = "\\";
                output[j++] = "u";
                output[j++] = "0";
                output[j++] = "0";
                output[j++] = hexChars[c >> 4];
                output[j++] = hexChars[c & 0x0f];
            } else {
                output[j++] = bytes1(c);
            }
        }
        assembly { mstore(output, j) }
        return string(output);
    }

    function _toString(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }
        return string(buffer);
    }

    function _toHexAddress(address account) private pure returns (string memory) {
        return string.concat("0x", _toHexBytes20(bytes20(account)));
    }

    function _toHexBytes20(bytes20 value) private pure returns (string memory) {
        bytes16 alphabet = "0123456789abcdef";
        bytes memory out = new bytes(40);
        for (uint256 i; i < 20; i++) {
            uint8 b = uint8(value[i]);
            out[i * 2] = alphabet[b >> 4];
            out[i * 2 + 1] = alphabet[b & 0x0f];
        }
        return string(out);
    }

    function _toHexBytes32(bytes32 value) private pure returns (string memory) {
        bytes16 alphabet = "0123456789abcdef";
        bytes memory out = new bytes(64);
        for (uint256 i; i < 32; i++) {
            uint8 b = uint8(value[i]);
            out[i * 2] = alphabet[b >> 4];
            out[i * 2 + 1] = alphabet[b & 0x0f];
        }
        return string(out);
    }

    function _base64(bytes memory data) private pure returns (string memory) {
        bytes memory alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        if (data.length == 0) return "";
        bytes memory output = new bytes(4 * ((data.length + 2) / 3));
        uint256 i;
        uint256 j;
        while (i < data.length) {
            uint256 a = uint8(data[i++]);
            uint256 b = i < data.length ? uint8(data[i++]) : 0;
            uint256 c = i < data.length ? uint8(data[i++]) : 0;
            uint256 triple = (a << 16) | (b << 8) | c;
            output[j++] = alphabet[(triple >> 18) & 0x3f];
            output[j++] = alphabet[(triple >> 12) & 0x3f];
            output[j++] = alphabet[(triple >> 6) & 0x3f];
            output[j++] = alphabet[triple & 0x3f];
        }
        uint256 remainder = data.length % 3;
        if (remainder == 1) {
            output[output.length - 1] = bytes1("=");
            output[output.length - 2] = bytes1("=");
        } else if (remainder == 2) {
            output[output.length - 1] = bytes1("=");
        }
        return string(output);
    }
}
