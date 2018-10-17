#include <eosiolib/eosio.hpp>
#include <eosiolib/currency.hpp>
#include <eosiolib/crypto.h>
#include <eosiolib/asset.hpp>

namespace eosio {
    class swaponline : public contract {
        private:
            struct swap
            {
                uint64_t swapID;
                account_name eosOwner;
                account_name btcOwner;
                asset requiredDeposit;
                asset currentDeposit;
                checksum256 secretHash;
                checksum256 secret;
                uint8_t status = 0; // 0 = open, 1 = active, 2 = withdrawn, 3 = refunded
                uint32_t createdAt;

                uint64_t primary_key() const { return swapID; }
            };

            multi_index<N(swap), swap> _swaps;

            account_name _this_contract;
        public:
            swaponline(account_name self)
            : contract(self),
            _swaps(self, self),
            _this_contract(self)
            {}

            const uint32_t LOCK_TIME = 5*60; // in seconds

            void open(account_name eosOwner, account_name btcOwner, asset quantity, checksum256& secretHash);
            void withdraw(uint64_t swapID, checksum256& secret);
            void refund(uint64_t swapID);
            void deposit(const currency::transfer& t, account_name code);

            void apply(account_name contract, account_name action);
    };

    void swaponline::open(
        account_name eosOwner,
        account_name btcOwner,
        asset quantity,
        checksum256& secretHash
    )
    {
        require_auth(eosOwner);

        for (auto& item : _swaps) {
            if(item.eosOwner == eosOwner && item.btcOwner == btcOwner) {
                eosio_assert(item.status == 3 || item.status == 2,
                "Between participants already exists open swap");
            }
        }

        _swaps.emplace(eosOwner, [&](auto& item) {
                item.swapID = _swaps.available_primary_key();
                item.eosOwner = eosOwner;
                item.btcOwner = btcOwner;
                item.requiredDeposit = quantity;
                item.currentDeposit = asset(0, symbol_type(S(4, EOS)));
                item.secretHash = secretHash;
                item.status = 0;
                item.createdAt = now();
        });
    }

    //@abi action
    void swaponline::withdraw(uint64_t swapID, checksum256& secret)
    {
        auto swapIterator = _swaps.find(swapID);
        eosio_assert(swapIterator != _swaps.end(), "Swap not found");

        require_auth(swapIterator->btcOwner);

        eosio_assert(swapIterator->status != 0, "EOS Owner should deposit funds");
        eosio_assert(swapIterator->status != 2, "Funds was already withdrawn");
        eosio_assert(swapIterator->status != 3, "Funds was refunded");

        eosio_assert(swapIterator->createdAt + LOCK_TIME > now(), "Refund phase");

        assert_sha256((char*)&secret, sizeof(secret), (const checksum256*)&swapIterator->secretHash);

        const account_name recipient = swapIterator->btcOwner;
        const asset& quantity = swapIterator->currentDeposit;

        action(
            permission_level{_self, N(active)},
            N(eosio.token), N(transfer),
            std::make_tuple(_self, recipient, quantity, std::string(""))
        ).send();

        _swaps.modify(swapIterator, swapIterator->eosOwner, [&](auto& item) {
            item.status = 2;
            item.secret = secret;
            item.currentDeposit = asset(0, symbol_type(S(4, EOS)));
        });
    }

    void swaponline::refund(uint64_t swapID)
    {
        auto swapIterator = _swaps.find(swapID);

        eosio_assert(swapIterator != _swaps.end(), "Swap not found");
        eosio_assert(swapIterator->status != 0, "Refund is allowed only after full deposit");
        eosio_assert(swapIterator->status != 2, "Funds was withdrawn");
        eosio_assert(swapIterator->status != 3, "Funds was already refunded");

        require_auth(swapIterator->eosOwner);

        eosio_assert(swapIterator->createdAt + LOCK_TIME < now(), "Withdraw phase");

        account_name recipient = swapIterator->eosOwner;
        const asset& quantity = swapIterator->currentDeposit;

        action(
            permission_level{_self, N(active)},
            N(eosio.token), N(transfer),
            std::make_tuple(_self, recipient, quantity, std::string(""))
        ).send();

        _swaps.modify(swapIterator, swapIterator->eosOwner, [&](auto& item) {
            item.status = 3;
            item.currentDeposit = asset(0, symbol_type(S(4, EOS)));
        });
    }

    void swaponline::deposit(const currency::transfer& transfer, account_name contract)
    {
        if(transfer.from == _this_contract)
            return;

        if(transfer.quantity.symbol != S(4, EOS))
            return;

        auto swapIterator = _swaps.find(stoll(transfer.memo));

        eosio_assert(swapIterator != _swaps.end(), "Swap not found");
        eosio_assert(swapIterator->status == 0, "Swap was processed already");

        _swaps.modify(swapIterator, swapIterator->eosOwner, [&](auto& item) {
            item.currentDeposit += transfer.quantity;

            if(item.currentDeposit >= item.requiredDeposit) {
                item.status = 1;
            }
        });
    }

    void swaponline::apply(account_name contract, account_name action)
    {
        if(contract == N(eosio.token) && action == N(transfer)) {
            deposit(unpack_action_data<currency::transfer>(), contract);
            return;
        }

        auto& thiscontract = *this;
        switch(action) {
            EOSIO_API(swaponline, (open)(withdraw)(refund))
        };
    }
}

extern "C" {
    [[noreturn]] void apply(uint64_t receiver, uint64_t code, uint64_t action) {
        eosio::swaponline swap(receiver);
        swap.apply(code, action);
        eosio_exit(0);
    }
}