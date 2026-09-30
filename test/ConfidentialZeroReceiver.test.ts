import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { ZeroAddress } from "ethers";
import { ConfidentialHarness } from "../typechain-types";

// `ERC20ConfidentialLib.confidentialMint` and `shieldTo` had no zero-receiver guard.
//  - `confidentialMint(address(0), x)` minted `x` public backing into CONFIDENTIAL_POOL while the
//    confidential credit landed on no account: unowned, never-unshieldable backing.
//  - `shieldTo(address(0), x)` is worse: the `__ledger` bridge reads a zero `from` as a MINT, so the
//    "move from `to` into the pool" leg created `x` public supply out of nothing.
// Both now revert `ConfidentialInvalidReceiver(address(0))`, mirroring `FHERC20Core._mint`, and the
// best-effort `autoShield` returns early instead of reverting.
const LIB_FQN = "contracts/ERC20Confidential/ERC20ConfidentialLib.sol:ERC20ConfidentialLib";

describe("ERC20ConfidentialLib zero-address receiver", function () {
  async function deployHarness(): Promise<ConfidentialHarness> {
    const lib = await ethers.deployContract(LIB_FQN);
    await lib.waitForDeployment();
    const Harness = await ethers.getContractFactory("ConfidentialHarness", {
      libraries: { [LIB_FQN]: await lib.getAddress() },
    });
    const h = (await Harness.deploy()) as unknown as ConfidentialHarness;
    await h.waitForDeployment();
    await (await h.initialize(6)).wait(); // rate = 1
    return h;
  }

  it("confidentialMint to address(0) reverts and leaves the pool untouched", async function () {
    const h = await deployHarness();
    const pool = await h.CONFIDENTIAL_POOL();

    await expect(h.mint(ZeroAddress, 1_000n))
      .to.be.revertedWithCustomError(h, "ConfidentialInvalidReceiver")
      .withArgs(ZeroAddress);
    expect(await h.balanceOf(pool)).to.equal(0n);
  });

  it("shieldTo address(0) reverts instead of minting unbacked public supply", async function () {
    const h = await deployHarness();
    const pool = await h.CONFIDENTIAL_POOL();

    await expect(h.shieldToPublic(ZeroAddress, 1_000n))
      .to.be.revertedWithCustomError(h, "ConfidentialInvalidReceiver")
      .withArgs(ZeroAddress);
    expect(await h.balanceOf(pool)).to.equal(0n);
  });

  it("autoShield to address(0) is a no-op (best-effort, never reverts)", async function () {
    const h = await deployHarness();
    const pool = await h.CONFIDENTIAL_POOL();
    const policy = await ethers.deployContract("MockMintModePolicy");

    await expect(h.autoShieldPublic(await policy.getAddress(), ZeroAddress, 1_000n)).to.not.be.reverted;
    expect(await h.balanceOf(pool)).to.equal(0n);
  });

  it("CONTROL: shieldTo and autoShield to a real account still credit it", async function () {
    const [, alice, bob] = await ethers.getSigners();
    const h = await deployHarness();
    const pool = await h.CONFIDENTIAL_POOL();
    const policy = await ethers.deployContract("MockMintModePolicy");

    await (await h.ledgerMintPublic(alice.address, 1_000n)).wait();
    await (await h.shieldToPublic(alice.address, 1_000n)).wait();
    await hre.cofhe.mocks.expectPlaintext(await h.confidentialBalanceOf(alice.address), 1_000n);

    await (await h.ledgerMintPublic(bob.address, 500n)).wait();
    await (await h.autoShieldPublic(await policy.getAddress(), bob.address, 500n)).wait();
    await hre.cofhe.mocks.expectPlaintext(await h.confidentialBalanceOf(bob.address), 500n);

    expect(await h.balanceOf(pool)).to.equal(1_500n);
  });
});
