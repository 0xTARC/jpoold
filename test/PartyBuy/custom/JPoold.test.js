// deploy partybuy targeting https://opensea.io/assets/ethereum/0xbd3531da5cf5857e7cfaa92426877b022e612cf8/5083
// pudgy conch addy: 0xBd3531dA5CF5857e7CfAA92426877b022e612cf8
// token id: 5083
// owner: 0x2BFe66759f0331066F3E7D57b3DC9a96bfC17927
// price is 6.24 eth

const { waffle } = require('hardhat');
const { provider } = waffle;
const { expect } = require('chai');
// ============ Internal Imports ============
const {
  deployTestContractSetup,
  getPartyBuyContractFromEventLogs,
} = require('../helpers/deploy');
const { Contract } = require('ethers');
const {
  PUDGY_PENGUINS_ABI,
  FOURTY_EIGHT_HOURS_IN_SECONDS,
  PARTY_STATUS,
  SEAPORT_ABI,
} = require('../helpers/constants');
const { parseEther, formatBytes32String } = require('ethers/lib/utils');
const { encodeData } = require('../../helpers/utils');
const { OpenSeaSDK, Network } = require('opensea-js');
const seaportAbi = require('../../../artifacts/contracts/external/IOpenseaExchange.sol/IOpenseaExchange.json');

// Test Buying Pudgy Penguin 5083
describe('JPoold', async () => {
  const [signer, wallet1, wallet2, wallet3, wallet4, wallet5, wallet6] = provider.getWallets();

  const splitRecipient = '0x0000000000000000000000000000000000000000';
  const splitBasisPoints = 0;
  const maxPrice = parseEther('10');
  const tokenId = 5083;
  let partyBuy, partyDAOMultisig, factory, allowList;

  before(async () => {
    const secondsToTimeout = FOURTY_EIGHT_HOURS_IN_SECONDS;
    const gatedToken = '0x0000000000000000000000000000000000000000'
    const gatedTokenAmount = 0;
    const fakeMultisig = false;
    const shouldDeployTestParty = false;

    const contracts = await deployTestContractSetup(
      provider,
      signer,
      ethers.utils.parseEther(maxPrice.toString()),
      secondsToTimeout,
      splitRecipient,
      splitBasisPoints,
      tokenId,
      fakeMultisig,
      gatedToken,
      gatedTokenAmount,
      shouldDeployTestParty, // prevents default party from starting, we want to test it on the pengu
    );

    partyDAOMultisig = contracts.partyDAOMultisig;
    factory = contracts.factory;
    allowList = contracts.allowList;

    const nftContract = new Contract(
      '0xbd3531da5cf5857e7cfaa92426877b022e612cf8',
      PUDGY_PENGUINS_ABI,
      provider,
    );

    // Start pengu party
    await factory.startParty(
      nftContract.address,
      tokenId,
      maxPrice,
      secondsToTimeout,
      [splitRecipient, splitBasisPoints],
      ['0x0000000000000000000000000000000000000000', 0],
      'PenguinPool',
      'poolPPG',
    );

    // Get PartyBuy ethers contract
    partyBuy = await getPartyBuyContractFromEventLogs(
      provider,
      factory,
      signer,
    );
  });

  it('Is ACTIVE before Buy', async () => {
    const partyStatus = await partyBuy.partyStatus();
    expect(partyStatus).to.equal(PARTY_STATUS.ACTIVE);
  });

  it('Should take contributions from multiple Wallets', async () => {
    partyBuy.connect(signer);
    await partyBuy.contribute({
      value: parseEther('1'),
    });

    partyBuy.connect(wallet1);
    await partyBuy.contribute({
      value: parseEther('1'),
    });

    partyBuy.connect(wallet2);
    await partyBuy.contribute({
      value: parseEther('1'),
    });

    partyBuy.connect(wallet3);
    await partyBuy.contribute({
      value: parseEther('1'),
    });

    partyBuy.connect(wallet4);
    await partyBuy.contribute({
      value: parseEther('1'),
    });

    partyBuy.connect(wallet5);
    await partyBuy.contribute({
      value: parseEther('1'),
    });

    partyBuy.connect(wallet6);
    await partyBuy.contribute({
      value: parseEther('1'),
    });
    
    const partyBalance = await provider.getBalance(partyBuy.address);
    expect(partyBalance).to.equal(parseEther('7'));
  });

  it('Should allow someone to trigger a purchase on OpenSea', async () => {
    const seaportAddress = '0x00000000006c3852cbEf3e08E8dF289169EdE581';
    const seaport = new Contract(seaportAddress, seaportAbi.abi, signer);

    // do i need to do this from multisig manually? not set on deploy based on the config.json? bunnk af why is that file there then
    await allowList.setAllowed(seaport.address, true);

    // export declare type OrderParameters = {
    //   offerer: string;
    //   zone: string;
    //   orderType: OrderType;
    //   startTime: BigNumberish;
    //   endTime: BigNumberish;
    //   zoneHash: string;
    //   salt: string;
    //   offer: OfferItem[];
    //   consideration: ConsiderationItem[];
    //   totalOriginalConsiderationItems: BigNumberish;
    //   conduitKey: string;
    // };

    // export declare type OfferItem = {
    //   itemType: ItemType;
    //   token: string;
    //   identifierOrCriteria: string;
    //   startAmount: string;
    //   endAmount: string;
    // };


    // export declare type ConsiderationItem = {
    //   itemType: ItemType;
    //   token: string;
    //   identifierOrCriteria: string;
    //   startAmount: string;
    //   endAmount: string;
    //   recipient: string;
    // };

    // A buy order in opensea terminology is "fulfilling an order". Params documented here:
    // https://docs.opensea.io/v2.0/reference/seaport-overview
    // this might help too: https://github.com/ProjectOpenSea/seaport/issues/520

    // offer maxPrice eth
    const offerItem = {
      itemType: 0, // Native
      token: '0x0000000000000000000000000000000000000000', // use null address to offer ether
      identifierOrCriteria: '0', // ignored for native itemTypes. can't use empty string because that cant be encoded as uint256. the joys of trying to use raw js to interact with smart contracts.
      startAmount: maxPrice,
      endAmount: maxPrice,
    };

    // in consideration for 1 pudgy
    const considerationItem = {
      itemType: 2, // ERC721
      token: '0xbd3531da5cf5857e7cfaa92426877b022e612cf8', // pudgy contract
      identifierOrCriteria: '5083',
      startAmount: '1',
      endAmount: '1',
      recipient: partyBuy.address, // party should get the nft for further fractionalization etc etc
    }

    const startTime = await provider.getBlockNumber();
    // 32 byte 0 hash
    const zeroHash = '0x0000000000000000000000000000000000000000000000000000000000000000';
    const orderParams = {
      offerer: '0x2BFe66759f0331066F3E7D57b3DC9a96bfC17927',
      zone: '0x0000000000000000000000000000000000000000', // optional secondary account
      offer: [offerItem],
      consideration: [considerationItem],
      orderType: 0, // FULL_OPEN
      startTime: startTime,
      endTime: startTime + FOURTY_EIGHT_HOURS_IN_SECONDS,
      zoneHash: zeroHash, // arb 32 byte val supplied to zone when fulfilling restricted orders. zeroed out because we dgaf about a zone
      salt: '123456',
      conduitKey: zeroHash, // "conduit" is the source for approvals token approvals. you can approve Seaport manually and use 0 hash here
      totalOriginalConsiderationItems: '1',
    };

    const NULL_BYTES = "0x";
    const orderStruct  = { 
      parameters: orderParams,
      signature: NULL_BYTES,
    }

    // party bid v2 calls fulfill order here: https://github.com/PartyDAO/party-protocol/blob/0c8b3b2f99216b12695e211d412584537dd63fa1/tests/integration/seaport_proposals.t.ts#L197
    const func = seaport.interface.getFunction('fulfillOrder');
    const data = seaport.interface.encodeFunctionData(func, [orderStruct, zeroHash]);

    // buy NFT
    // TODO: get real list price from on chain instead of hardcoding
    // TODO: need to add in opensea fee to eth to send here
    const listPrice = '6.5';
    // const osfee = '?';
    await expect(
      partyBuy.buy(ethers.utils.parseEther(listPrice), seaport.address, data),
    ).to.emit(partyBuy, 'Bought');
  
    // query token vault
    // tokenVault = await getTokenVault(partyBuy, signers[0]);
  });

  // it('', async () => {
  // });
  //
  // Test for listing on opensea (lists a gov nft but fuck that we want to sell the pengu)
  // https://github.com/PartyDAO/party-protocol/blob/0c8b3b2f99216b12695e211d412584537dd63fa1/tests/deploy/mainnet.t.deploy.ts#L749
});
