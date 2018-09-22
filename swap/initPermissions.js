const eosInstance = require('../eos')
const swap = require('./swap')

const addAuthToAccountPermission = async({
  eosInstance,
  accountName, permissionName,
  accountAuth = null, keyAuth = null
}) => {
  if (!accountName || !permissionName) throw new Error()
  if (accountAuth == null && keyAuth == null) throw new Error()

  const account = await eosInstance.getAccount(accountName)

  const { required_auth, parent, perm_name } = account.permissions
    .find(p => p.perm_name === permissionName) ||
  {
    required_auth: {
      threshold: 1,
      waits: [],
      accounts: [],
      keys: []
    },
    parent: '',
    perm_name: permissionName
  }


  let update_auth = {
    accounts: [],
    keys: []
  }

  if (typeof accountAuth === 'object' && accountAuth !== null && accountAuth.actor && accountAuth.permission) {
    update_auth.accounts.push({
      permission: accountAuth,
      weight: 1
    })
  }

  if (typeof keyAuth === 'string') {
    update_auth.keys.push({
      key: keyAuth,
      weight: 1
    })
  }

  const auth = {
    account: accountName,
    permission: perm_name,
    parent: parent,
    auth: {
      threshold: required_auth.threshold,
      waits: required_auth.waits,
      accounts: [
        ...required_auth.accounts,
        ...update_auth.accounts
      ],
      keys: [
        ...required_auth.keys,
        ...update_auth.keys
      ]
    }
  }

  const transaction = await eosInstance.transaction(tx => {
    tx.updateauth(auth, { authorization: `${accountName}@active` })
  })

  return transaction
}

(async () => {
  await addAuthToAccountPermission({
    eosInstance,
    accountName: 'swaponline42',
    permissionName: 'active',
    accountAuth: {
      actor: 'swaponline42',
      permission: 'eosio.code'
    }
  })
})()