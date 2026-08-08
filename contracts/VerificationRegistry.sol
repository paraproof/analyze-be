// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title VerificationRegistry
/// @notice Registry on-chain buat catet hasil formal verification (Halmos + Z3)
///         dari smart contract yang udah lolos pipeline verifikasi.
///
/// @dev Kenapa ini penting: tanpa registry ini, hasil verifikasi cuma ada di
///      database/API backend — siapapun harus PERCAYA ke backend itu. Dengan
///      dicatet on-chain, siapapun (termasuk kontrak lain, secara trustless)
///      bisa cek `isVerified(address)` langsung dari chain, tanpa perlu
///      percaya ke API/database di luar chain sama sekali.
///
///      Access control WAJIB ada di sini — kalau `recordVerification` dibuka
///      buat siapa aja, siapapun bisa klaim kontrak apapun "verified" padahal
///      belum pernah diperiksa Halmos/Z3 sama sekali, yang bikin seluruh
///      sistem kepercayaan ini runtuh. Makanya cuma address yang di-authorize
///      (backend verifier) yang boleh manggil.
contract VerificationRegistry {
    // ============================================================
    // Types
    // ============================================================

    struct InvariantResult {
        string name; // "reentrancy" | "state_contention" | "race_condition"
        bool passed;
    }

    struct VerificationRecord {
        bool exists;
        address contractAddress;
        bytes32 specHash; // hash dari t.sol / spec yang dipakai verifikasi (integrity check)
        uint256 timestamp;
        address recordedBy; // address backend verifier yang mencatat
        InvariantResult[] invariants;
    }

    // ============================================================
    // State
    // ============================================================

    address public owner;

    /// @dev Address backend/verifier yang di-otorisasi manggil recordVerification.
    ///      Dipisah dari `owner` biar kalau backend key perlu di-rotate,
    ///      owner tinggal add/remove tanpa perlu transfer ownership.
    mapping(address => bool) public isAuthorizedVerifier;

    mapping(address => VerificationRecord) private records;

    /// @dev Buat enumerasi semua kontrak yang pernah tercatat (opsional, berguna buat UI listing).
    address[] public verifiedContractsList;
    mapping(address => bool) private _seenInList;

    // ============================================================
    // Events
    // ============================================================

    event VerificationRecorded(
        address indexed contractAddress,
        address indexed recordedBy,
        bytes32 specHash,
        bool overallPassed,
        uint256 timestamp
    );

    event VerificationRevoked(address indexed contractAddress, address indexed revokedBy, string reason);

    event VerifierAdded(address indexed verifier);
    event VerifierRemoved(address indexed verifier);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ============================================================
    // Errors
    // ============================================================

    error NotOwner();
    error NotAuthorizedVerifier();
    error ZeroAddress();
    error NoInvariantsProvided();
    error RecordNotFound();

    // ============================================================
    // Modifiers
    // ============================================================

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAuthorizedVerifier() {
        if (!isAuthorizedVerifier[msg.sender]) revert NotAuthorizedVerifier();
        _;
    }

    // ============================================================
    // Constructor
    // ============================================================

    /// @param initialVerifier Address backend yang langsung di-otorisasi sejak awal
    ///        (biasanya address wallet/relayer yang dipegang backend Go lu).
    constructor(address initialVerifier) {
        if (initialVerifier == address(0)) revert ZeroAddress();
        owner = msg.sender;
        isAuthorizedVerifier[initialVerifier] = true;
        emit VerifierAdded(initialVerifier);
    }

    // ============================================================
    // Admin functions
    // ============================================================

    function addVerifier(address verifier) external onlyOwner {
        if (verifier == address(0)) revert ZeroAddress();
        isAuthorizedVerifier[verifier] = true;
        emit VerifierAdded(verifier);
    }

    function removeVerifier(address verifier) external onlyOwner {
        isAuthorizedVerifier[verifier] = false;
        emit VerifierRemoved(verifier);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    // ============================================================
    // Core: record & query verification
    // ============================================================

    /// @notice Catet hasil verifikasi 1 kontrak. Dipanggil backend SETELAH
    ///         Halmos + Z3 selesai jalan dan hasilnya PASSED (lihat flow /deploy).
    /// @param contractAddress Address kontrak yang baru di-deploy via forge create.
    /// @param specHash Hash (misal keccak256) dari isi t.sol yang dipakai buat
    ///        verifikasi — buat integrity check, biar bisa dibuktikan spec yang
    ///        dipakai emang yang itu, bukan diganti diam-diam.
    /// @param invariants Daftar hasil per-invariant (reentrancy, state_contention, dst).
    function recordVerification(
        address contractAddress,
        bytes32 specHash,
        InvariantResult[] calldata invariants
    ) external onlyAuthorizedVerifier {
        if (contractAddress == address(0)) revert ZeroAddress();
        if (invariants.length == 0) revert NoInvariantsProvided();

        VerificationRecord storage record = records[contractAddress];
        record.exists = true;
        record.contractAddress = contractAddress;
        record.specHash = specHash;
        record.timestamp = block.timestamp;
        record.recordedBy = msg.sender;

        // hapus invariant lama (kalau ini re-verification) sebelum diisi ulang
        delete record.invariants;
        bool overallPassed = true;
        for (uint256 i = 0; i < invariants.length; i++) {
            record.invariants.push(invariants[i]);
            if (!invariants[i].passed) {
                overallPassed = false;
            }
        }

        if (!_seenInList[contractAddress]) {
            _seenInList[contractAddress] = true;
            verifiedContractsList.push(contractAddress);
        }

        emit VerificationRecorded(contractAddress, msg.sender, specHash, overallPassed, block.timestamp);
    }

    /// @notice Cabut status verifikasi (misal ternyata belakangan ketauan ada
    ///         masalah yang lolos dari Halmos/Z3). Nggak menghapus record,
    ///         cuma nandain `exists = false` biar histori tetap ada di event log.
    function revokeVerification(address contractAddress, string calldata reason) external onlyAuthorizedVerifier {
        if (!records[contractAddress].exists) revert RecordNotFound();
        records[contractAddress].exists = false;
        emit VerificationRevoked(contractAddress, msg.sender, reason);
    }

    /// @notice Cek cepat: apakah kontrak ini tercatat verified DAN semua invariant-nya passed.
    function isVerified(address contractAddress) external view returns (bool) {
        VerificationRecord storage record = records[contractAddress];
        if (!record.exists) return false;

        uint256 len = record.invariants.length;
        for (uint256 i = 0; i < len; i++) {
            if (!record.invariants[i].passed) return false;
        }
        return true;
    }

    /// @notice Ambil detail lengkap record verifikasi 1 kontrak, termasuk
    ///         hasil per-invariant. Dipakai frontend buat nampilin detail
    ///         (misal "reentrancy: PASSED, race_condition: PASSED").
    function getVerification(address contractAddress)
        external
        view
        returns (
            bool exists,
            bytes32 specHash,
            uint256 timestamp,
            address recordedBy,
            InvariantResult[] memory invariants
        )
    {
        VerificationRecord storage record = records[contractAddress];
        return (record.exists, record.specHash, record.timestamp, record.recordedBy, record.invariants);
    }

    /// @notice Total jumlah kontrak yang pernah tercatat (buat pagination di frontend kalau perlu).
    function totalVerifiedContracts() external view returns (uint256) {
        return verifiedContractsList.length;
    }
}
