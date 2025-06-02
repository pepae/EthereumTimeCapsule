// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

contract TimeCapsule {
    struct Capsule {
        address creator;
        string title;
        string tags;
        bytes encryptedStory;    // Shutter-encrypted story ciphertext
        string decryptedStory;   // Plaintext story (after reveal)
        bool isRevealed;
        uint256 revealTime;      // Timestamp after which reveal is allowed
        string shutterIdentity;  // Shutter identity used for encryption
        string imageCID;         // IPFS CID of the encrypted image
    }

    mapping(uint256 => Capsule) public capsules;
    uint256 public capsuleCount;

    event CapsuleCreated(
        uint256 indexed id,
        address indexed creator,
        string title,
        string tags,
        uint256 revealTime,
        string shutterIdentity,
        string imageCID
    );
    event CapsuleRevealed(
        uint256 indexed id,
        address indexed revealer,
        string plaintextStory
    );

    /**
     * @dev Commit a new time capsule with encrypted content.
     * @param _title Plaintext title of the capsule.
     * @param _tags Plaintext tags for the capsule.
     * @param _encryptedStory Shutter-encrypted story bytes.
     * @param _revealTime UNIX timestamp when the story will be decryptable (one year from now).
     * @param _shutterIdentity Shutter identity associated with this encryption (from Shutter API).
     * @param _imageCID IPFS Content ID of the encrypted image file.
     */
    function commitCapsule(
        string calldata _title,
        string calldata _tags,
        bytes calldata _encryptedStory,
        uint256 _revealTime,
        string calldata _shutterIdentity,
        string calldata _imageCID
    )
        external
    {
        require(_revealTime > block.timestamp, "Reveal time must be in the future");
        // (Optional) enforce roughly one-year lockup:
        // require(_revealTime >= block.timestamp + 365 days, "Reveal time must be ~1 year out");

        // Store the capsule data on-chain
        capsules[capsuleCount] = Capsule({
            creator: msg.sender,
            title: _title,
            tags: _tags,
            encryptedStory: _encryptedStory,
            decryptedStory: "",
            isRevealed: false,
            revealTime: _revealTime,
            shutterIdentity: _shutterIdentity,
            imageCID: _imageCID
        });
        emit CapsuleCreated(capsuleCount, msg.sender, _title, _tags, _revealTime, _shutterIdentity, _imageCID);
        capsuleCount++;
    }

    /**
     * @dev Reveal the capsule’s story after the Shutter network has released the decryption key.
     * @param _id The capsule ID to reveal.
     * @param _plaintext The decrypted story text.
     */
    function revealCapsule(uint256 _id, string calldata _plaintext) external {
        Capsule storage c = capsules[_id];
        require(!c.isRevealed, "Capsule already revealed");
        require(block.timestamp >= c.revealTime, "Too early to reveal");  // Ensure one-year time lock elapsed

        c.decryptedStory = _plaintext;
        c.isRevealed = true;
        emit CapsuleRevealed(_id, msg.sender, _plaintext);
    }

    // (Optional) a helper to retrieve capsule data in one go
    function getCapsule(uint256 _id) external view returns (Capsule memory) {
        return capsules[_id];
    }
}
