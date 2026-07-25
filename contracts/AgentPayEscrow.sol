// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title AgentPayEscrow
 * @dev Experimental escrow contract for AI agent payments on Arc Testnet
 *
 * SECURITY NOTES:
 * - This contract is EXPERIMENTAL and NOT AUDITED
 * - Use only on testnet with small amounts
 * - Do not use with real funds until professionally audited
 */
contract AgentPayEscrow is ReentrancyGuard, Ownable, Pausable {
    enum Status { None, Pending, Released, Disputed, Refunded }

    struct Job {
        address client;
        address worker;
        uint256 amount;
        uint256 disputeDeadline;
        uint256 createdAt;
        Status status;
    }

    IERC20 public immutable usdc;
    uint256 public disputeWindow = 8 seconds;
    uint256 public constant ARBITRATION_TIMEOUT = 7 days;

    mapping(bytes32 => Job) public jobs;

    event JobCreated(bytes32 indexed jobId, address indexed client, address indexed worker, uint256 amount, uint256 disputeDeadline);
    event JobDisputed(bytes32 indexed jobId, address indexed client);
    event JobReleased(bytes32 indexed jobId, address indexed worker, uint256 amount);
    event JobRefunded(bytes32 indexed jobId, address indexed client, uint256 amount);
    event DisputeWindowChanged(uint256 oldWindow, uint256 newWindow);

    modifier jobExists(bytes32 jobId) {
        require(jobs[jobId].status != Status.None, "AgentPayEscrow: job does not exist");
        _;
    }

    modifier jobStatus(bytes32 jobId, Status expected) {
        require(jobs[jobId].status == expected, "AgentPayEscrow: invalid job status");
        _;
    }

    constructor(address usdcToken, address ownerAddress) Ownable(ownerAddress) {
        require(usdcToken != address(0), "AgentPayEscrow: invalid USDC address");
        usdc = IERC20(usdcToken);
    }

    function createJob(bytes32 jobId, address worker, uint256 amount) external nonReentrant whenNotPaused {
        require(jobs[jobId].status == Status.None, "AgentPayEscrow: job already exists");
        require(worker != address(0), "AgentPayEscrow: invalid worker address");
        require(amount > 0, "AgentPayEscrow: amount must be > 0");

        require(usdc.transferFrom(msg.sender, address(this), amount), "AgentPayEscrow: USDC transfer failed");

        jobs[jobId] = Job({
            client: msg.sender,
            worker: worker,
            amount: amount,
            disputeDeadline: block.timestamp + disputeWindow,
            createdAt: block.timestamp,
            status: Status.Pending
        });

        emit JobCreated(jobId, msg.sender, worker, amount, block.timestamp + disputeWindow);
    }

    function dispute(bytes32 jobId) external jobExists(jobId) jobStatus(jobId, Status.Pending) {
        Job storage job = jobs[jobId];
        require(msg.sender == job.client, "AgentPayEscrow: only client can dispute");
        require(block.timestamp <= job.disputeDeadline, "AgentPayEscrow: dispute window closed");

        job.status = Status.Refunded;
        require(usdc.transfer(job.client, job.amount), "AgentPayEscrow: USDC transfer failed");
        emit JobDisputed(jobId, msg.sender);
        emit JobRefunded(jobId, job.client, job.amount);
    }

    function release(bytes32 jobId) external jobExists(jobId) jobStatus(jobId, Status.Pending) nonReentrant whenNotPaused {
        Job storage job = jobs[jobId];
        require(block.timestamp > job.disputeDeadline, "AgentPayEscrow: dispute window still open");

        job.status = Status.Released;
        require(usdc.transfer(job.worker, job.amount), "AgentPayEscrow: USDC transfer failed");
        emit JobReleased(jobId, job.worker, job.amount);
    }

    function setDisputeWindow(uint256 newWindow) external onlyOwner {
        require(newWindow > 0, "AgentPayEscrow: window must be > 0");
        require(newWindow <= 7 days, "AgentPayEscrow: window too long");
        emit DisputeWindowChanged(disputeWindow, newWindow);
        disputeWindow = newWindow;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function getJob(bytes32 jobId) external view jobExists(jobId) returns (Job memory) {
        return jobs[jobId];
    }

    function getBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}
