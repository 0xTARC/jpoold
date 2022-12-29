const {ethers} = require("hardhat");

async function deploy(name, args = []) {
  const Implementation = await ethers.getContractFactory(name);
  const contract = await Implementation.deploy(...args);
  return contract.deployed();
}

async function getTokenVault(party, signer) {
  const vaultAddress = await party.tokenVault();
  const TokenVault = await ethers.getContractFactory('TokenVault');
  return new ethers.Contract(vaultAddress, TokenVault.interface, signer);
}

/// Deploys a test NFT, Fractional Vault Factory, AllowList, PartyBuyFactory, and starts a party and returns the active party contract
async function deployTestContractSetup(
  provider,
  artistSigner,
  maxPrice,
  secondsToTimeout,
  splitRecipient,
  splitBasisPoints,
  tokenId,
  fakeMultisig = false,
  gatedToken = '0x0000000000000000000000000000000000000000',
  gatedTokenAmount = 0,
  shouldDeployTestParty = true,
) {
  // Deploy WETH
  const weth = await deploy('EtherToken');

  // For other markets, deploy the test NFT Contract
  const nftContract = await deploy('TestERC721', []);
  // Mint token to artist
  await nftContract.mint(artistSigner.address, tokenId);

  // Deploy PartyDAO multisig
  let partyDAOMultisig;
  if (!fakeMultisig) {
    partyDAOMultisig = await deploy('PayableContract');
  } else {
    partyDAOMultisig = artistSigner;
  }

  const tokenVaultSettings = await deploy('Settings');
  const tokenVaultFactory = await deploy('ERC721VaultFactory', [
    tokenVaultSettings.address,
  ]);

  const allowList = await deploy('AllowList');

  // Deploy PartyBuy Factory (including PartyBuy Logic + Reseller Whitelist)
  const factory = await deploy('PartyBuyFactory', [
    partyDAOMultisig.address,
    tokenVaultFactory.address,
    weth.address,
    allowList.address,
  ]);

  let partyBuy = ethers.constants.AddressZero
  // Allows JPOOLd to integration test specific party buys on mainnet
  if (shouldDeployTestParty) {
    // Used to test with default party
    // Deploy a new PartyBid
    await factory.startParty(
      nftContract.address,
      tokenId,
      maxPrice,
      secondsToTimeout,
      [splitRecipient, splitBasisPoints],
      [gatedToken, gatedTokenAmount],
      'Parrrrti',
      'PRTI',
    );

    // Get PartyBuy ethers contract
    partyBuy = await getPartyBuyContractFromEventLogs(
      provider,
      factory,
      artistSigner,
    );
  }

  return {
    nftContract,
    partyBuy,
    partyDAOMultisig,
    weth,
    allowList,
    factory,
  };
}

async function getPartyBuyContractFromEventLogs(
  provider,
  factory,
  artistSigner,
) {
  // get logs emitted from PartyBid Factory
  const logs = await provider.getLogs({ address: factory.address });

  // parse events from logs
  const PartyBuyFactory = await ethers.getContractFactory('PartyBuyFactory');
  const events = logs.map((log) => PartyBuyFactory.interface.parseLog(log));

  // extract proxy address from PartyBuyDeployed log
  const proxyAddress = events[0]['args'][0];

  // instantiate ethers contract with PartyBid Logic interface + proxy address
  const PartyBuy = await ethers.getContractFactory('PartyBuy');
  const partyBuy = new ethers.Contract(
    proxyAddress,
    PartyBuy.interface,
    artistSigner,
  );
  return partyBuy;
}

module.exports = {
  deployTestContractSetup,
  getTokenVault,
  deploy,
  getPartyBuyContractFromEventLogs,
};
