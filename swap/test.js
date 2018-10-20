const bitcoin = require("bitcoinjs-lib")
const BigNumber = require("bignumber.js")

const assert = require('assert')
const eos = require('../eos')
const swap = require('./swap')
const config = require('./config.json')

const contract = config.account;
const swapID = 1;
const amount = 100;
const eosOwner = 'sevenflash11'
const btcOwner = 'sevenflash12'

const options = {
  authorization: [`${eosOwner}@active`, `${btcOwner}@active`],
  broadcast: true,
  sign: true
}

function quantity(amount) {
  const decimals = 4;
  return amount * 10 ** decimals;
}

function asset(amount) {
  return `${amount}.0000 EOS`;
}

const fromHexString = hexString =>
  new Uint8Array(hexString.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

async function hash(secret) {
  const sha256 = bitcoin.crypto.sha256

  const secretHash = sha256(fromHexString(secret))

  return secretHash
}

describe('swap', function() {
  this.timeout(0)

  before(async () => {
    this.contract = await swap()

    this.secret = '9e7a0c24cb284ed7939e5d37901428fb1b293e56445c571a176fad2b948c0aaa'
    this.secretHash = await hash(this.secret)
  });

  it('open atomic swap between btcOwner and eosOwner', async () => {
    await this.contract.open(eosOwner, btcOwner, asset(amount), this.secretHash, options);
  });

  it('find open swap between participants by swapID', async () => {
    const result = await eos.getTableRows({
      code: contract,
      scope: contract,
      table: 'swap',
      json: true,
      key_type: 'i64',
      index_position: 1,
      table_key: '1',
      lower_bound: swapID,
      upper_bound: swapID + 1
    })

    console.log(result.rows)
  })

  it('find swaps by creator index', async () => {
    const encodedEosOwner = new BigNumber(eos.modules.format.encodeName(eosOwner, false))

    const result = await eos.getTableRows({
      code: contract,
      scope: contract,
      table: 'swap',
      json: true,
      key_type: 'i64',
      index_position: 2,
      lower_bound: encodedEosOwner.toString(),
      upper_bound: encodedEosOwner.plus(1).toString()
    })

    console.log(result.rows)
  })

  it('find swaps by participant index', async () => {
    const encodedBtcOwner = new BigNumber(eos.modules.format.encodeName(btcOwner, false))

    const result = await eos.getTableRows({
      code: contract,
      scope: contract,
      table: 'swap',
      json: true,
      key_type: 'i64',
      index_position: 3,
      lower_bound: encodedBtcOwner.toString(),
      upper_bound: encodedBtcOwner.plus(1).toString()
    })

    console.log(result.rows)
  })

  it('check that swap was saved in the table', async () => {
    const result = await eos.getTableRows({
      code: contract,
      scope: contract,
      table: 'swap',
      json: true
    });

    const swap = result.rows.filter((row) => row.swapID == swapID).pop();

    assert.equal(swap.btcOwner, btcOwner);
    assert.equal(swap.eosOwner, eosOwner);
    assert.equal(swap.swapID, swapID);
    assert.equal(swap.secret, 0000000000000000000000000000000000000000);
    assert.equal(swap.requiredDeposit, asset(amount));
    assert.equal(swap.currentDeposit, `0.0000 EOS`);
    assert.equal(swap.status, 0);
  });

  it('transfer funds to the contract with memo', async () => {
    const result = await eos.transfer(eosOwner, config.account, asset(amount), swapID);

    assert.ok(result.transaction);
  });

  it('check that deposit was processed', async () => {
    const result = await eos.getTableRows({
      code: contract,
      scope: contract,
      table: 'swap',
      json: true
    });

    const swap = result.rows.filter((row) => row.swapID == swapID).pop();

    assert.equal(swap.status, 1);
  });

  it('withdraw', async () => {
    const result = await this.contract.withdraw(swapID, this.secret, options)

    console.log(result)
  })

  it('refund funds instead of withdrawal', async () => {
    await this.contract.refund(swapID, options);
  })
})
