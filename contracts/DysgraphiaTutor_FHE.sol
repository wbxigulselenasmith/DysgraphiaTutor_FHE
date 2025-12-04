// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract DysgraphiaTutor_FHE is SepoliaConfig {
    struct EncryptedWritingData {
        uint256 id;
        euint32 encryptedHandwriting;   // Encrypted handwriting sample
        euint32 encryptedProgressScore; // Encrypted progress score
        euint32 encryptedDifficulty;    // Encrypted difficulty level
        uint256 timestamp;
    }
    
    struct DecryptedWritingData {
        string handwritingPattern;
        uint32 progressScore;
        string difficultyLevel;
        bool isRevealed;
    }

    uint256 public studentCount;
    mapping(uint256 => EncryptedWritingData) public encryptedWritingData;
    mapping(uint256 => DecryptedWritingData) public decryptedWritingData;
    
    mapping(string => euint32) private encryptedLevelCount;
    string[] private difficultyLevels;
    
    mapping(uint256 => uint256) private requestToStudentId;
    
    event WritingDataSubmitted(uint256 indexed id, uint256 timestamp);
    event DecryptionRequested(uint256 indexed id);
    event WritingDataDecrypted(uint256 indexed id);
    
    modifier onlyTutor(uint256 studentId) {
        _;
    }
    
    function submitEncryptedWritingData(
        euint32 encryptedHandwriting,
        euint32 encryptedProgressScore,
        euint32 encryptedDifficulty
    ) public {
        studentCount += 1;
        uint256 newId = studentCount;
        
        encryptedWritingData[newId] = EncryptedWritingData({
            id: newId,
            encryptedHandwriting: encryptedHandwriting,
            encryptedProgressScore: encryptedProgressScore,
            encryptedDifficulty: encryptedDifficulty,
            timestamp: block.timestamp
        });
        
        decryptedWritingData[newId] = DecryptedWritingData({
            handwritingPattern: "",
            progressScore: 0,
            difficultyLevel: "",
            isRevealed: false
        });
        
        emit WritingDataSubmitted(newId, block.timestamp);
    }
    
    function requestWritingDataDecryption(uint256 studentId) public onlyTutor(studentId) {
        EncryptedWritingData storage data = encryptedWritingData[studentId];
        require(!decryptedWritingData[studentId].isRevealed, "Already decrypted");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(data.encryptedHandwriting);
        ciphertexts[1] = FHE.toBytes32(data.encryptedProgressScore);
        ciphertexts[2] = FHE.toBytes32(data.encryptedDifficulty);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptWritingData.selector);
        requestToStudentId[reqId] = studentId;
        
        emit DecryptionRequested(studentId);
    }
    
    function decryptWritingData(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 studentId = requestToStudentId[requestId];
        require(studentId != 0, "Invalid request");
        
        EncryptedWritingData storage eData = encryptedWritingData[studentId];
        DecryptedWritingData storage dData = decryptedWritingData[studentId];
        require(!dData.isRevealed, "Already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (string memory pattern, uint32 score, string memory level) = abi.decode(cleartexts, (string, uint32, string));
        
        dData.handwritingPattern = pattern;
        dData.progressScore = score;
        dData.difficultyLevel = level;
        dData.isRevealed = true;
        
        if (FHE.isInitialized(encryptedLevelCount[dData.difficultyLevel]) == false) {
            encryptedLevelCount[dData.difficultyLevel] = FHE.asEuint32(0);
            difficultyLevels.push(dData.difficultyLevel);
        }
        encryptedLevelCount[dData.difficultyLevel] = FHE.add(
            encryptedLevelCount[dData.difficultyLevel], 
            FHE.asEuint32(1)
        );
        
        emit WritingDataDecrypted(studentId);
    }
    
    function getDecryptedWritingData(uint256 studentId) public view returns (
        string memory handwritingPattern,
        uint32 progressScore,
        string memory difficultyLevel,
        bool isRevealed
    ) {
        DecryptedWritingData storage d = decryptedWritingData[studentId];
        return (d.handwritingPattern, d.progressScore, d.difficultyLevel, d.isRevealed);
    }
    
    function getEncryptedLevelCount(string memory level) public view returns (euint32) {
        return encryptedLevelCount[level];
    }
    
    function requestLevelCountDecryption(string memory level) public {
        euint32 count = encryptedLevelCount[level];
        require(FHE.isInitialized(count), "Level not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(count);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptLevelCount.selector);
        requestToStudentId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(level)));
    }
    
    function decryptLevelCount(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 levelHash = requestToStudentId[requestId];
        string memory level = getLevelFromHash(levelHash);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 count = abi.decode(cleartexts, (uint32));
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
    
    function getLevelFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < difficultyLevels.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(difficultyLevels[i]))) == hash) {
                return difficultyLevels[i];
            }
        }
        revert("Level not found");
    }
}