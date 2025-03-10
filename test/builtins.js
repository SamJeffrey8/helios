#!/usr/bin/env node
//@ts-check
import crypto from "crypto";
import * as helios from "../helios.js";
import { runIfEntryPoint } from "./util.js";

/**
 * @typedef {import('../helios.js').PropertyTest} PropertyTest
 */

const helios_ = helios.exportedForTesting;

// helper functions for script property tests
function asBool(value) {
    if (value instanceof helios_.UplcBool) {
        return value.bool;
    } else if (value instanceof helios_.ConstrData) {
        if (value.fields.length == 0) {
            if (value.index == 0) {
                return false;
            } else if (value.index == 1) {
                return true;
            } else {
                throw new Error(`unexpected ConstrData index ${value.index} (expected 0 or 1 for Bool)`);
            }
        } else {
            throw new Error(`expected ConstrData with 0 fields (Bool)`);
        }
    } else if (value instanceof helios_.UplcDataValue) {
        return asBool(value.data);
    }

    throw new Error(`expected UplcBool, got ${value.toString()}`);
}

function asInt(value) {
    if (value instanceof helios_.IntData) {
        return value.value;
    } else if (value instanceof helios_.UplcDataValue) {
        let data = value.data;
        if (data instanceof helios_.IntData) {
            return data.value;
        }
    }

    throw new Error(`expected IntData, got ${value.toString()}`);
}

function asBytes(value) {
    if (value instanceof helios_.ByteArrayData) {
        return value.bytes;
    } else if (value instanceof helios_.UplcDataValue) {
        let data = value.data;
        if (data instanceof helios_.ByteArrayData) {
            return data.bytes;
        }
    }

    throw new Error(`expected ByteArrayData, got ${value.toString()}`);
}

function equalsList(a, b) {
    let n = a.length;
    return n == b.length && a.every((v, i) => b[i] === v);
}

function decodeCbor(bs) {
    return helios_.UplcData.fromCbor(bs);
}

function isValidString(value) {
    if (value instanceof helios_.ByteArrayData) {
        try {
            void helios.bytesToText(value.bytes);

            return true;
        } catch(_) {
            return false;
        }
    } else if (value instanceof helios_.UplcDataValue) {
        let data = value.data;
        if (data instanceof helios_.ByteArrayData) {
            return isValidString(data);
        }
    }

    throw new Error(`expected ByteArrayData, got ${value.toString()}`);
}

function asString(value) {
    if (value instanceof helios_.ByteArrayData) {
        return helios.bytesToText(value.bytes);
    } else if (value instanceof helios_.UplcDataValue) {
        let data = value.data;
        if (data instanceof helios_.ByteArrayData) {
            return helios.bytesToText(data.bytes);
        }
    }

    throw new Error(`expected ByteArrayData, got ${value.toString()}`);
}

function asIntList(value) {
    if (value instanceof helios_.ListData) {
        let items = [];

        for (let item of value.list) {
            if (item instanceof helios_.IntData) {
                items.push(item.value);
            } else {
                throw new Error(`expected ListData of IntData, got ${value.toString()}`);
            }
        }

        return items;
    } else if (value instanceof helios_.UplcDataValue) {
        let data = value.data;
        
        return asIntList(data);
    }

    throw new Error(`expected ListData, got ${value.toString()}`);
}

function asBoolList(value) {
    if (value instanceof helios_.ListData) {
        let items = [];

        for (let item of value.list) {
            if (item instanceof helios_.ConstrData && item.fields.length == 0 && (item.index == 0 || item.index == 1)) {
                items.push(item.index == 1);
            } else {
                throw new Error(`expected ListData of bool-like ConstrData, got ${value.toString()}`);
            }
        }

        return items;
    } else if (value instanceof helios_.UplcDataValue) {
        let data = value.data;
        if (data instanceof helios_.ListData) {
           return asBoolList(data);
        }
    }

    throw new Error(`expected ListData, got ${value.toString()}`);
}

function asData(value) {
    if (value instanceof helios_.UplcData) {
        return value;
    } else if (value instanceof helios_.UplcDataValue) {
        return value.data;
    } else {
        throw new Error("expected UplcDataValue or UplcData");
    }
}

function constrIndex(value) {
    if (value instanceof helios_.ConstrData) {
        return value.index;
    } else if (value instanceof helios_.UplcDataValue) {
        let data = value.data;
        if (data instanceof helios_.ConstrData) {
            return data.index;
        }
    }

    throw new Error(`expected ConstrIndex, got ${value.toString()}`);
}


/**
 * Throws an error if 'err' isn't en Error
 * @param {any} err 
 * @param {string} info 
 * @returns {boolean}
 */
function isError(err, info) {
    if (err instanceof helios.UserError) {
        let parts = err.message.split(":");
        let n = parts.length;
        if (n < 2) {
            return false;
        } else if (parts[n-1].trim() == info) {
            return true
        } else {
            return false;
        }
    } else {
        throw new Error(`expected UserError, got ${err.toString()}`);
    }
}

/**
 * @type {PropertyTest}
 */
const serializeProp = ([a], res) => {
    return decodeCbor(asBytes(res)).isSame(a.data);
};

/**
 * @param {boolean} useInlineDatum 
 * @returns {string}
 */
function spendingScriptContextParam(useInlineDatum) {
    return `
        // a script context with a single input and a single output
        const PUB_KEY_HASH_BYTES = #01234567890123456789012345678901234567890123456789012345
        const TX_ID_IN_BYTES = #0123456789012345678901234567890123456789012345678901234567891234
        const TX_ID_IN: TxId = TxId::new(TX_ID_IN_BYTES)
        const CURRENT_VALIDATOR_BYTES = #01234567890123456789012345678901234567890123456789012346
        const CURRENT_VALIDATOR = ValidatorHash::new(CURRENT_VALIDATOR_BYTES)
        const HAS_STAKING_CRED_IN = false
        const STAKING_CRED_TYPE = false
        const SOME_STAKING_CRED_IN: StakingCredential = if (STAKING_CRED_TYPE) {
            StakingCredential::new_ptr(0, 0, 0)
        } else {
            StakingCredential::new_hash(StakingHash::new_stakekey(StakeKeyHash::new(PUB_KEY_HASH_BYTES)))
        }
        const STAKING_CRED_IN: Option[StakingCredential] = if (HAS_STAKING_CRED_IN) {
            Option[StakingCredential]::Some{SOME_STAKING_CRED_IN}
        } else {
            Option[StakingCredential]::None
        }
        const CURRENT_VALIDATOR_CRED = Credential::new_validator(CURRENT_VALIDATOR)
        const ADDRESS_IN = Address::new(CURRENT_VALIDATOR_CRED, STAKING_CRED_IN)
        const TX_OUTPUT_ID_IN = TxOutputId::new(TX_ID_IN, 0)
        const ADDRESS_OUT = Address::new(Credential::new_pubkey(PubKeyHash::new(PUB_KEY_HASH_BYTES)), Option[StakingCredential]::None)
        const ADDRESS_OUT_1 = Address::new(Credential::new_validator(CURRENT_VALIDATOR), Option[StakingCredential]::None)
        const QTY = 200000
        const QTY_1 = 100000
        const QTY_2 = 100000

        const FEE = 160000
        const VALUE_IN = Value::lovelace(QTY + QTY_1 + QTY_2)
        const VALUE_OUT = Value::lovelace(QTY - FEE)
        const VALUE_OUT_1 = Value::lovelace(QTY_1)
        const VALUE_OUT_2 = Value::lovelace(QTY_2)

        const DATUM_1 = 42
        const DATUM_HASH_1 = DatumHash::new(DATUM_1.serialize().blake2b())
        const OUTPUT_DATUM = ${useInlineDatum ? "OutputDatum::new_inline(DATUM_1)" : "OutputDatum::new_hash(DATUM_HASH_1)"}

        const CURRENT_TX_ID = TxId::CURRENT

        const FIRST_TX_INPUT = TxInput::new(TX_OUTPUT_ID_IN, TxOutput::new(ADDRESS_IN, VALUE_IN, OutputDatum::new_none()))
        const REF_INPUT = TxInput::new(TxOutputId::new(TX_ID_IN, 1), TxOutput::new(ADDRESS_IN, Value::lovelace(0), OutputDatum::new_inline(42)))
        const FIRST_TX_OUTPUT = TxOutput::new(ADDRESS_OUT, VALUE_OUT, OutputDatum::new_none())
        const TX = Tx::new(
            []TxInput{FIRST_TX_INPUT},
            []TxInput{REF_INPUT},
            []TxOutput{
                FIRST_TX_OUTPUT,
                TxOutput::new(ADDRESS_OUT, VALUE_OUT_1, OUTPUT_DATUM),
                TxOutput::new(ADDRESS_OUT_1, VALUE_OUT_2, OUTPUT_DATUM)
            },
            Value::lovelace(FEE),
            Value::ZERO,
            []DCert{},
            Map[StakingCredential]Int{},
            TimeRange::new(Time::new(0), Time::new(100)),
            []PubKeyHash{PubKeyHash::new(PUB_KEY_HASH_BYTES)},
            Map[ScriptPurpose]Int{},
            Map[DatumHash]Int{${useInlineDatum ? "" : "DATUM_HASH_1: DATUM_1"}}
        )
        const SCRIPT_CONTEXT = ScriptContext::new_spending(TX, TX_OUTPUT_ID_IN)
    `;
}

const mintingScriptContextParam = `
    // a script context with a single input and a single output
    const PUB_KEY_HASH_BYTES = #01234567890123456789012345678901234567890123456789012345
    const TX_ID_IN = TxId::CURRENT
    const CURRENT_MPH_BYTES = #01234567890123456789012345678901234567890123456789012346
    const CURRENT_MPH = MintingPolicyHash::new(CURRENT_MPH_BYTES)
    const ADDRESS_IN = Address::new(Credential::new_pubkey(PubKeyHash::new(PUB_KEY_HASH_BYTES)), Option[StakingCredential]::None)
    const ADDRESS_OUT: Address = ADDRESS_IN
    const QTY = 1000
    const VALUE = Value::lovelace(QTY)
    const MINTED = Value::new(AssetClass::new(CURRENT_MPH, #abcd), 1)
    const SCRIPT_CONTEXT = ScriptContext::new_minting(Tx::new(
        []TxInput{TxInput::new(TxOutputId::new(TX_ID_IN, 0), TxOutput::new(ADDRESS_IN, VALUE, OutputDatum::new_none()))},
        []TxInput{},
        []TxOutput{TxOutput::new(ADDRESS_OUT, VALUE + MINTED, OutputDatum::new_none())},
        Value::lovelace(160000),
        MINTED,
        []DCert{},
        Map[StakingCredential]Int{},
        TimeRange::ALWAYS,
        []PubKeyHash{},
        Map[ScriptPurpose]Int{},
        Map[DatumHash]Data{}
    ), CURRENT_MPH)
`;

const rewardingScriptContextParam = `
    // a script context with a single input and a single output
    const PUB_KEY_HASH_BYTES = #01234567890123456789012345678901234567890123456789012345
    const TX_ID_IN = TxId::CURRENT
    const CURRENT_STAKING_CRED_BYTES = #01234567890123456789012345678901234567890123456789012346
    const CURRENT_STAKING_CRED = StakingCredential::new_hash(StakingHash::new_stakekey(StakeKeyHash::new(CURRENT_STAKING_CRED_BYTES)))
    const REWARD_QTY = 2000
    const ADDRESS_IN = Address::new(Credential::new_pubkey(PubKeyHash::new(PUB_KEY_HASH_BYTES)), Option[StakingCredential]::None)
    const ADDRESS_OUT: Address = ADDRESS_IN
    const QTY = 1000
    const VALUE = Value::lovelace(QTY)
    const SCRIPT_CONTEXT = ScriptContext::new_rewarding(Tx::new(
        []TxInput{TxInput::new(TxOutputId::new(TX_ID_IN, 0), TxOutput::new(ADDRESS_IN, VALUE, OutputDatum::new_none()))},
        []TxInput{},
        []TxOutput{TxOutput::new(ADDRESS_OUT, VALUE + Value::lovelace(REWARD_QTY), OutputDatum::new_none())},
        Value::lovelace(160000),
        Value::ZERO,
        []DCert{},
        Map[StakingCredential]Int{
            CURRENT_STAKING_CRED: REWARD_QTY
        },
        TimeRange::ALWAYS,
        []PubKeyHash{},
        Map[ScriptPurpose]Int{},
        Map[DatumHash]Data{}
    ), CURRENT_STAKING_CRED)

    const STAKING_PURPOSE: StakingPurpose = SCRIPT_CONTEXT.get_staking_purpose()
`;

const certifyingScriptContextParam = `
    // a script context with a single input and a single output
    const PUB_KEY_HASH_BYTES = #01234567890123456789012345678901234567890123456789012345
    const TX_ID_IN = TxId::CURRENT
    const CURRENT_STAKING_CRED_BYTES = #01234567890123456789012345678901234567890123456789012346
    const CURRENT_STAKING_CRED = StakingCredential::new_hash(StakingHash::new_stakekey(StakeKeyHash::new(CURRENT_STAKING_CRED_BYTES)))
    const ADDRESS_IN = Address::new(Credential::new_pubkey(PubKeyHash::new(PUB_KEY_HASH_BYTES)), Option[StakingCredential]::None)
    const ADDRESS_OUT: Address = ADDRESS_IN
    const QTY_IN = 1000
    const VALUE = Value::lovelace(QTY_IN)
    const CURRENT_DCERT = DCert::new_register(CURRENT_STAKING_CRED)
    const DCERT_DEREGISTER = DCert::new_deregister(CURRENT_STAKING_CRED)
    const POOL_ID = PubKeyHash::new(#1253751235)
    const POOL_VFR = PubKeyHash::new(#125375123598)
    const EPOCH = 370
    const DCERT_DELEGATE = DCert::new_delegate(CURRENT_STAKING_CRED, POOL_ID)
    const DCERT_REGISTER_POOL = DCert::new_register_pool(POOL_ID, POOL_VFR)
    const DCERT_RETIRE_POOL = DCert::new_retire_pool(POOL_ID, EPOCH)
    const SCRIPT_CONTEXT = ScriptContext::new_certifying(Tx::new(
        []TxInput{TxInput::new(TxOutputId::new(TX_ID_IN, 0), TxOutput::new(ADDRESS_IN, VALUE, OutputDatum::new_none()))},
        []TxInput{},
        []TxOutput{TxOutput::new(ADDRESS_OUT, VALUE, OutputDatum::new_none())},
        Value::lovelace(0),
        Value::ZERO,
        []DCert{CURRENT_DCERT, DCERT_DEREGISTER, DCERT_DELEGATE, DCERT_REGISTER_POOL, DCERT_RETIRE_POOL},
        Map[StakingCredential]Int{},
        TimeRange::ALWAYS,
        []PubKeyHash{},
        Map[ScriptPurpose]Int{},
        Map[DatumHash]Data{}
    ), CURRENT_DCERT)
    const STAKING_PURPOSE: StakingPurpose = SCRIPT_CONTEXT.get_staking_purpose()
`;

async function testBuiltins() {
    const ft = new helios.FuzzyTest(Math.random()*42, 100, true);


    /////////////
    // Data tests
    /////////////

    await ft.test([ft.constr(ft.newRand())], `
    testing data_tag
    func main(a: Data) -> Int {
        a.tag
    }`, ([a], res) => BigInt(a.data.index) == asInt(res));


    ////////////
    // Int tests
    ////////////

    await ft.test([ft.int()], `
    testing int_eq_1
    func main(a: Int) -> Bool {
        a == a
    }`, ([_], res) => asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing int_eq_2
    func main(a: Int, b: Int) -> Bool {
        a == b
    }`, ([a, b], res) => (asInt(a) === asInt(b)) === asBool(res));

    await ft.test([ft.int()], `
    testing int_neq_1
    func main(a: Int) -> Bool {
        a != a
    }`, ([_], res) => !asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing int_neq_2
    func main(a: Int, b: Int) -> Bool {
        a != b
    }`, ([a, b], res) => (asInt(a) === asInt(b)) === (!asBool(res)));

    await ft.test([ft.int()], `
    testing int_neg
    func main(a: Int) -> Int {
        -a
    }`, ([a], res) => asInt(a) === -asInt(res));

    await ft.test([ft.int()], `
    testing int_pos
    func main(a: Int) -> Int {
        +a
    }`, ([a], res) => asInt(a) === asInt(res));

    
    await ft.test([ft.int()], `
    testing int_add_0
    func main(a: Int) -> Int {
        a + 0
    }`, ([a], res) => asInt(a) === asInt(res));

    await ft.test([ft.int(), ft.int()], `
    testing int_add_2
    func main(a: Int, b: Int) -> Int {
        a + b
    }`, ([a, b], res) => asInt(a) + asInt(b) === asInt(res));

    await ft.test([ft.int()], `
    testing int_sub_0
    func main(a: Int) -> Int {
        a - 0
    }`, ([a], res) => asInt(a) === asInt(res));

    await ft.test([ft.int()], `
    testing int_sub_0_alt
    func main(a: Int) -> Int {
        0 - a
    }`, ([a], res) => asInt(a) === -asInt(res));

    await ft.test([ft.int()], `
    testing int_sub_self
    func main(a: Int) -> Int {
        a - a
    }`, ([_], res) => 0n === asInt(res));

    await ft.test([ft.int(), ft.int()], `
    testing int_sub_2
    func main(a: Int, b: Int) -> Int {
        a - b
    }`, ([a, b], res) => asInt(a) - asInt(b) === asInt(res));

    await ft.test([ft.int()], `
    testing int_mul_0
    func main(a: Int) -> Int {
        a*0
    }`, ([_], res) => 0n === asInt(res));

    await ft.test([ft.int()], `
    testing int_mul_1
    func main(a: Int) -> Int {
        a*1
    }`, ([a], res) => asInt(a) === asInt(res));

    await ft.test([ft.int(), ft.int()], `
    testing int_mul_2
    func main(a: Int, b: Int) -> Int {
        a * b
    }`, ([a, b], res) => asInt(a) * asInt(b) === asInt(res));

    await ft.test([ft.int()], `
    testing int_div_0
    func main(a: Int) -> Int {
        a / 0
    }`, ([_], res) => isError(res, "division by zero"));

    await ft.test([ft.int()], `
    testing int_div_0_alt
    func main(a: Int) -> Int {
        0 / a
    }`, ([_], res) => 0n === asInt(res));

    await ft.test([ft.int()], `
    testing int_div_1
    func main(a: Int) -> Int {
        a / 1
    }`, ([a], res) => asInt(a) === asInt(res));

    await ft.test([ft.int(-10, 10)], `
    testing int_div_1_alt
    func main(a: Int) -> Int {
        1 / a
    }`, ([a], res) => 
        asInt(a) === 0n ?
        isError(res, "division by zero") :
        (
            asInt(a) === 1n ? 
            1n === asInt(res) :
            (
                asInt(a) === -1n ?
                -1n === asInt(res) :
                0n === asInt(res)
            )
        )
    );

    await ft.test([ft.int(-20, 20)], `
    testing int_div_1_self
    func main(a: Int) -> Int {
        a / a
    }`, ([a], res) => 
        asInt(a) === 0n ?
        isError(res, "division by zero") :
        1n === asInt(res)
    );

    await ft.test([ft.int(), ft.int()], `
    testing int_div_2
    func main(a: Int, b: Int) -> Int {
        a / b
    }`, ([a, b], res) => 
        asInt(b) === 0n ? 
        isError(res, "division by zero") :
        asInt(a) / asInt(b) === asInt(res)
    );

    await ft.test([ft.int()], `
    testing int_mod_0
    func main(a: Int) -> Int {
        a % 0
    }`, ([_], res) => isError(res, "division by zero"));

    await ft.test([ft.int()], `
    testing int_mod_0_alt
    func main(a: Int) -> Int {
        0 % a
    }`, ([_], res) => 0n === asInt(res));

    await ft.test([ft.int()], `
    testing int_mod_1
    func main(a: Int) -> Int {
        a % 1
    }`, ([_], res) => 0n === asInt(res));

    await ft.test([ft.int(-20, 20)], `
    testing int_mod_1_alt
    func main(a: Int) -> Int {
        1 % a
    }`, ([a], res) => 
        asInt(a) === 0n ? 
        isError(res, "division by zero") :
        (
            asInt(a) === -1n || asInt(a) === 1n ?
            0n === asInt(res) :
            1n === asInt(res)
        )
    );

    await ft.test([ft.int(-10, 10)], `
    testing int_mod_1_self
    func main(a: Int) -> Int {
        a % a
    }`, ([a], res) => 
        asInt(a) === 0n ?
        isError(res, "division by zero") :
        0n === asInt(res)
    );

    await ft.test([ft.int(), ft.int(-10, 10)], `
    testing int_mod_2
    func main(a: Int, b: Int) -> Int {
        a % b
    }`, ([a, b], res) => 
        asInt(b) === 0n ? 
        isError(res, "division by zero") :
        asInt(a) % asInt(b) === asInt(res)
    );

    await ft.test([ft.int()], `
    testing int_geq_1
    func main(a: Int) -> Bool {
        a >= a
    }`, ([_], res) => asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing int_geq_2
    func main(a: Int, b: Int) -> Bool {
        a >= b
    }`, ([a, b], res) => (asInt(a) >= asInt(b)) === asBool(res));

    await ft.test([ft.int()], `
    testing int_gt_1
    func main(a: Int) -> Bool {
        a > a
    }`, ([_], res) => !asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing int_gt_2
    func main(a: Int, b: Int) -> Bool {
        a > b
    }`, ([a, b], res) => (asInt(a) > asInt(b)) === asBool(res));

    await ft.test([ft.int()], `
    testing int_leq_1
    func main(a: Int) -> Bool {
        a <= a
    }`, ([_], res) => asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing int_leq_2
    func main(a: Int, b: Int) -> Bool {
        a <= b
    }`, ([a, b], res) => (asInt(a) <= asInt(b)) === asBool(res));

    await ft.test([ft.int()], `
    testing int_lt_1
    func main(a: Int) -> Bool {
        a < a
    }`, ([a], res) => !asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing int_lt_2
    func main(a: Int, b: Int) -> Bool {
        a < b
    }`, ([a, b], res) => (asInt(a) < asInt(b)) === asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing int_min
    func main(a: Int, b: Int) -> Int {
        Int::min(a, b)
    }`, ([a, b], res) => {
        if (asInt(a) < asInt(b)) {
            return asInt(a) == asInt(res);
        } else {
            return asInt(b) == asInt(res);
        }
    });

    await ft.test([ft.int(), ft.int()], `
    testing int_max
    func main(a: Int, b: Int) -> Int {
        Int::max(a, b)
    }`, ([a, b], res) => {
        if (asInt(a) > asInt(b)) {
            return asInt(a) == asInt(res);
        } else {
            return asInt(b) == asInt(res);
        }
    });

    await ft.test([ft.int(), ft.int()], `
    testing int_bound_max
    func main(a: Int, b: Int) -> Int {
        a.bound_max(b)
    }`, ([a, b], res) => {
        if (asInt(a) < asInt(b)) {
            return asInt(a) == asInt(res);
        } else {
            return asInt(b) == asInt(res);
        }
    });

    await ft.test([ft.int(), ft.int()], `
    testing int_bound_min
    func main(a: Int, b: Int) -> Int {
        a.bound_min(b)
    }`, ([a, b], res) => {
        if (asInt(a) > asInt(b)) {
            return asInt(a) == asInt(res);
        } else {
            return asInt(b) == asInt(res);
        }
    });

    await ft.test([ft.int(), ft.int(), ft.int()], `
    testing int_bound
    func main(a: Int, b: Int, c: Int) -> Int{
        a.bound(Int::min(b, c), Int::max(b, c))
    }`, ([a, b, c], res) => {
        const lower = asInt(b) < asInt(c) ? asInt(b) : asInt(c);
        const upper = asInt(b) > asInt(c) ? asInt(b) : asInt(c);

        if (asInt(a) < lower) {
            return lower == asInt(res)
        } else if (asInt(a) > upper) {
            return upper == asInt(res)
        } else {
            return asInt(a) == asInt(res);
        }
    });

    await ft.test([ft.int(-10, 10)], `
    testing int_to_bool
    func main(a: Int) -> Bool {
        a.to_bool()
    }`, ([a], res) => (asInt(a) === 0n) === !asBool(res));

    await ft.test([ft.int()], `
    testing int_to_hex
    func main(a: Int) -> String {
        a.to_hex()
    }`, ([a], res) => (asInt(a).toString(16) === asString(res)));

    await ft.test([ft.int()], `
    testing int_show
    func main(a: Int) -> String {
        a.show()
    }`, ([a], res) => asInt(a).toString() === asString(res));

    await ft.test([ft.int()], `
    testing int_parse
    func main(a: Int) -> Bool {
        Int::parse(a.show()) == a
    }`, ([a], res) => asBool(res));

    await ft.test([ft.bytes(0, 10)], `
    testing int_from_little_endian
    func main(bytes: ByteArray) -> Int {
        Int::from_little_endian(bytes)
    }`, ([bytes], res) => {
        let sum = 0n;
        asBytes(bytes).forEach((b, i) => {sum += BigInt(b)*(1n << BigInt(i*8))});

        return asInt(res) === sum;
    });

    await ft.test([ft.int()], `
    testing int_from_data
    func main(a: Data) -> Int {
        Int::from_data(a)
    }`, ([a], res) => asInt(a) === asInt(res));

    await ft.test([ft.int()], `
    testing int_serialize
    func main(a: Int) -> ByteArray {
        a.serialize()
    }`, serializeProp);


    /////////////
    // Bool tests
    /////////////

    await ft.test([ft.bool(), ft.bool()], `
    testing bool_and
    func main(a: Bool, b: Bool) -> Bool {
        a && b
    }`, ([a, b], res) => (asBool(a) && asBool(b)) === asBool(res));

    // test branch deferral as well
    await ft.test([ft.bool(), ft.bool()], `
    testing bool_and_alt
    func main(a: Bool, b: Bool) -> Bool {
        Bool::and(() -> Bool {
            a
        }, () -> Bool {
            b && (0 / 0 == 0)
        })
    }`, ([a, b], res) => 
        asBool(a) ? (
            asBool(b) ?
            isError(res, "division by zero") :
            false === asBool(res)
        ) :
        false === asBool(res)
    );

    await ft.test([ft.bool(), ft.bool()], `
    testing bool_or
    func main(a: Bool, b: Bool) -> Bool {
        a || b
    }`, ([a, b], res) => (asBool(a) || asBool(b)) === asBool(res));

    await ft.test([ft.bool(), ft.bool()], `
    testing bool_or_alt
    func main(a: Bool, b: Bool) -> Bool {
        Bool::or(() -> Bool {
            a
        }, () -> Bool {
            b || (0 / 0 == 0)
        }) 
    }`, ([a, b], res) => 
        asBool(a) ? 
        true === asBool(res) :
        (
            asBool(b) ?
            true === asBool(res) :
            isError(res, "division by zero")
        )
    );

    await ft.test([ft.bool()], `
    testing bool_eq_1
    func main(a: Bool) -> Bool {
        a == a
    }`, ([a], res) => asBool(res));

    await ft.test([ft.bool(), ft.bool()], `
    testing bool_eq_2
    func main(a: Bool, b: Bool) -> Bool {
        a == b
    }`, ([a, b], res) => (asBool(a) === asBool(b)) === asBool(res));

    await ft.test([ft.bool()], `
    testing bool_neq_1
    func main(a: Bool) -> Bool {
        a != a
    }`, ([a], res) => !asBool(res));

    await ft.test([ft.bool(), ft.bool()], `
    testing bool_neq_2
    func main(a: Bool, b: Bool) -> Bool {
        a != b
    }`, ([a, b], res) => (asBool(a) === asBool(b)) === !asBool(res));

    await ft.test([ft.bool()], `
    testing bool_not
    func main(a: Bool) -> Bool {
        !a
    }`, ([a], res) => asBool(a) === !asBool(res));

    await ft.test([ft.bool()], `
    testing bool_to_int
    func main(a: Bool) -> Int {
        a.to_int()
    }`, ([a], res) => (asBool(a) ? 1n : 0n) === asInt(res));

    await ft.test([ft.bool()], `
    testing bool_show
    func main(a: Bool) -> String {
        a.show()
    }`, ([a], res) => (asBool(a) ? "true": "false") === asString(res));

    await ft.test([ft.bool()], `
    testing bool_from_data
    func main(a: Data) -> Bool {
        Bool::from_data(a)
    }`, ([a], res) => constrIndex(a) === (asBool(res) ? 1 : 0));

    await ft.test([ft.bool()], `
    testing bool_serialize
    func main(a: Bool) -> ByteArray {
        a.serialize()
    }`, serializeProp);

    await ft.test([ft.bool()], `
    testing bool_trace
    func main(a: Bool) -> Bool {
        a.trace("prefix")
    }`, ([a], res) => asBool(a) === asBool(res));


    ///////////////
    // String tests
    ///////////////

    await ft.test([ft.string()], `
    testing string_eq_1
    func main(a: String) -> Bool {
        a == a
    }`, ([_], res) => asBool(res));

    await ft.test([ft.string(), ft.string()], `
    testing string_eq_2
    func main(a: String, b: String) -> Bool {
        a == b
    }`, ([a, b], res) => (asString(a) === asString(b)) === asBool(res));

    await ft.test([ft.string()], `
    testing string_neq_1
    func main(a: String) -> Bool {
        a != a
    }`, ([_], res) => !asBool(res));

    await ft.test([ft.string(), ft.string()], `
    testing string_neq_2
    func main(a: String, b: String) -> Bool {
        a != b
    }`, ([a, b], res) => (asString(a) === asString(b)) === !asBool(res));

    await ft.test([ft.string()], `
    testing string_add_1
    func main(a: String) -> String {
        a + ""
    }`, ([a], res) => asString(a) === asString(res));

    await ft.test([ft.string()], `
    testing string_add_1_alt
    func main(a: String) -> String {
        "" + a
    }`, ([a], res) => asString(a) === asString(res));

    await ft.test([ft.string(), ft.string()], `
    testing string_add_2
    func main(a: String, b: String) -> String {
        a + b
    }`, ([a, b], res) => {
        let sa = asString(a);
        let sb = asString(b);
        let sRes = asString(res);

        return {
            "length": (sa + sb).length === sRes.length,
            "concat": (sa + sb) === sRes
        };
    });

    await ft.test([ft.string(0, 10), ft.string(0, 10)], `
    testing string_starts_with_1
    func main(a: String, b: String) -> Bool {
        (a+b).starts_with(a)
    }`, ([a, b], res) => asBool(res));

    await ft.test([ft.string(0, 10), ft.string(0, 10)], `
    testing string_starts_with_2
    func main(a: String, b: String) -> Bool {
        (a+b).starts_with(b)
    }`, ([a, b], res) => {
        let sa = asString(a);
        let sb = asString(b);
        
        let s = sa + sb;

        return s.startsWith(sb) === asBool(res);
    });

    await ft.test([ft.string(0, 10), ft.string(0, 10)], `
    testing string_ends_with_1
    func main(a: String, b: String) -> Bool {
        (a+b).ends_with(b)
    }`, ([a, b], res) => asBool(res));

    await ft.test([ft.string(0, 10), ft.string(0, 10)], `
    testing string_ends_with_2
    func main(a: String, b: String) -> Bool {
        (a+b).ends_with(a)
    }`, ([a, b], res) => {
        let sa = asString(a);
        let sb = asString(b);
        
        let s = sa + sb;

        return s.endsWith(sa) === asBool(res);
    });

    await ft.test([ft.string()], `
    testing string_encode_utf8
    func main(a: String) -> ByteArray {
        a.encode_utf8()
    }`, ([a], res) => {
        let bsa = Array.from((new TextEncoder()).encode(asString(a)));
        return equalsList(asBytes(res), bsa);
    });

    await ft.test([ft.string()], `
    testing string_from_data
    func main(a: Data) -> String {
        String::from_data(a)
    }`, ([a], res) => asString(a) == asString(res));

    await ft.test([ft.string()], `
    testing string_serialize
    func main(a: String) -> ByteArray {
        a.serialize()
    }`, serializeProp);


    //////////////////
    // ByteArray tests
    //////////////////

    let testByteArray = true;

    if (testByteArray) {
        await ft.test([ft.bytes()], `
        testing bytearray_eq_1
        func main(a: ByteArray) -> Bool {
            a == a
        }`, ([_], res) => asBool(res));

        await ft.test([ft.bytes(), ft.bytes()], `
        testing bytearray_eq_2
        func main(a: ByteArray, b: ByteArray) -> Bool {
            a == b
        }`, ([a, b], res) => equalsList(asBytes(a), asBytes(b)) === asBool(res));

        await ft.test([ft.bytes()], `
        testing bytearray_neq_1
        func main(a: ByteArray) -> Bool {
            a != a
        }`, ([_], res) => !asBool(res));

        await ft.test([ft.bytes(), ft.bytes()], `
        testing bytearray_neq_2
        func main(a: ByteArray, b: ByteArray) -> Bool {
            a != b
        }`, ([a, b], res) => equalsList(asBytes(a), asBytes(b)) === !asBool(res));

        await ft.test([ft.bytes()], `
        testing bytearray_add_1
        func main(a: ByteArray) -> ByteArray {
            a + #
        }`, ([a], res) => equalsList(asBytes(a), asBytes(res)));

        await ft.test([ft.bytes()], `
        testing bytearray_add_1_alt
        func main(a: ByteArray) -> ByteArray {
            # + a
        }`, ([a], res) => equalsList(asBytes(a), asBytes(res)));

        await ft.test([ft.bytes(), ft.bytes()], `
        testing bytearray_add_2
        func main(a: ByteArray, b: ByteArray) -> ByteArray {
            a + b
        }`, ([a, b], res) => equalsList(asBytes(a).concat(asBytes(b)), asBytes(res)));

		await ft.test([ft.bytes(0, 5), ft.bytes(0, 5)], `
		testing bytearray_lt
		func main(a: ByteArray, b: ByteArray) -> Bool {
			(a < b) == !(a >= b)
		}`, ([a, b], res) => asBool(res));

		await ft.test([ft.bytes(0, 5), ft.bytes(0, 5)], `
		testing bytearray_gt
		func main(a: ByteArray, b: ByteArray) -> Bool {
			(a > b) == !(a <= b)
		}`, ([a, b], res) => asBool(res));

        await ft.test([ft.bytes()], `
        testing bytearray_length
        func main(a: ByteArray) -> Int {
            a.length
        }`, ([a], res) => BigInt(asBytes(a).length) === asInt(res));

        await ft.test([ft.bytes(0, 64), ft.int(-10, 100)], `
        testing bytearray_slice_1
        func main(a: ByteArray, b: Int) -> ByteArray {
            a.slice(b, -1)
        }`, ([a, b], res) => {
            let bsa = asBytes(a);
            let n = bsa.length;

            let start = asInt(b) < 0n ? n + 1 + Number(asInt(b)) : Number(asInt(b));
            if (start < 0) {
                start = 0;
            } else if (start > n) {
                start = n;
            }

            let expected = bsa.slice(start);

            return equalsList(expected, asBytes(res));
        });

        await ft.test([ft.bytes(0, 64), ft.int(-10, 100), ft.int(-10, 100)], `
        testing bytearray_slice_2
        func main(a: ByteArray, b: Int, c: Int) -> ByteArray {
            a.slice(b, c)
        }`, ([a, b, c], res) => {
            let bsa = asBytes(a);
            let n = bsa.length;

            let start = asInt(b) < 0n ? n + 1 + Number(asInt(b)) : Number(asInt(b));
            if (start < 0) {
                start = 0;
            } else if (start > n) {
                start = n;
            }

            let end = asInt(c) < 0n ? n + 1 + Number(asInt(c)) : Number(asInt(c));
            if (end < 0) {
                end = 0;
            } else if (end > n) {
                end = n;
            }

            let expected = bsa.slice(start, end);

            return equalsList(expected, asBytes(res));
        });

        await ft.test([ft.bytes(0, 10), ft.bytes(0, 10)], `
        testing bytearray_starts_with_1
        func main(a: ByteArray, b: ByteArray) -> Bool {
            (a+b).starts_with(a)
        }`, ([a, b], res) => asBool(res));

        await ft.test([ft.bytes(0, 10), ft.bytes(0, 10)], `
        testing bytearray_starts_with_2
        func main(a: ByteArray, b: ByteArray) -> Bool {
            (a+b).starts_with(b)
        }`, ([a, b], res) => {
            let bsa = asBytes(a);
            let bsb = asBytes(b);
            
            let bs = bsa.concat(bsb);

            for (let i = 0; i < Math.min(bs.length, bsb.length); i++) {
                if (bs[i] != bsb[i]) {
                    return !asBool(res);
                }
            }

            return asBool(res);
        });

        await ft.test([ft.bytes(0, 10), ft.bytes(0, 10)], `
        testing bytearray_ends_with_1
        func main(a: ByteArray, b: ByteArray) -> Bool {
            (a+b).ends_with(b)
        }`, ([a, b], res) => asBool(res));

        await ft.test([ft.bytes(0, 10), ft.bytes(0, 10)], `
        testing bytearray_ends_with_2
        func main(a: ByteArray, b: ByteArray) -> Bool {
            (a+b).ends_with(a)
        }`, ([a, b], res) => {
            let bsa = asBytes(a);
            let bsb = asBytes(b);
            
            let bs = bsa.concat(bsb);

            for (let i = 0; i < Math.min(bs.length, bsa.length); i++) {
                if (bs[bs.length - 1 - i] != bsa[bsa.length - 1 - i]) {
                    return !asBool(res);
                }
            }

            return asBool(res);
        });

        await ft.test([ft.utf8Bytes()], `
        testing bytearray_decode_utf8_utf8
        func main(a: ByteArray) -> String {
            a.decode_utf8()
        }`, ([a], res) => asString(a) == asString(res));

        await ft.test([ft.bytes()], `
        testing bytearray_decode_utf8
        func main(a: ByteArray) -> String {
            a.decode_utf8()
        }`, ([a], res) => 
            isValidString(a) ?
            asString(a) == asString(res) :
            isError(res, "invalid utf-8")
        );

        await ft.test([ft.bytes(0, 10)], `
        testing bytearray_sha2
        func main(a: ByteArray) -> ByteArray {
            a.sha2()
        }`, ([a], res) => {
            let hasher = crypto.createHash("sha256");

            hasher.update(new DataView((new Uint8Array(asBytes(a))).buffer));

            return equalsList(Array.from(hasher.digest()), asBytes(res));
        });

        await ft.test([ft.bytes(55, 70)], `
        testing bytearray_sha2_alt
        func main(a: ByteArray) -> ByteArray {
            a.sha2()
        }`, ([a], res) => {
            let hasher = crypto.createHash("sha256");

            hasher.update(new DataView((new Uint8Array(asBytes(a))).buffer));

            return equalsList(Array.from(hasher.digest()), asBytes(res));
        });

        await ft.test([ft.bytes(0, 10)], `
        testing bytearray_sha3
        func main(a: ByteArray) -> ByteArray {
            a.sha3()
        }`, ([a], res) => {
            let hasher = crypto.createHash("sha3-256");

            hasher.update(new DataView((new Uint8Array(asBytes(a))).buffer));

            return equalsList(Array.from(hasher.digest()), asBytes(res));
        });

        await ft.test([ft.bytes(130, 140)], `
        testing bytearray_sha3_alt
        func main(a: ByteArray) -> ByteArray {
            a.sha3()
        }`, ([a], res) => {
            let hasher = crypto.createHash("sha3-256");

            hasher.update(new DataView((new Uint8Array(asBytes(a))).buffer));

            return equalsList(Array.from(hasher.digest()), asBytes(res));
        });

        // the crypto library only supports blake2b512 (and not blake2b256), so temporarily set digest size to 64 bytes for testing
        helios_.setBlake2bDigestSize(64);

        await ft.test([ft.bytes(0, 10)], `
        testing bytearray_blake2b
        func main(a: ByteArray) -> ByteArray {
            a.blake2b()
        }`, ([a], res) => {
            let hasher = crypto.createHash("blake2b512");

            hasher.update(new DataView((new Uint8Array(asBytes(a))).buffer));

            return equalsList(Array.from(hasher.digest()), asBytes(res));
        });

        await ft.test([ft.bytes(130, 140)], `
        testing bytearray_blake2b_alt
        func main(a: ByteArray) -> ByteArray {
            a.blake2b()
        }`, ([a], res) => {
            let hasher = crypto.createHash("blake2b512");

            hasher.update(new DataView((new Uint8Array(asBytes(a))).buffer));

            return equalsList(Array.from(hasher.digest()), asBytes(res));
        });

        helios_.setBlake2bDigestSize(32);

        await ft.test([ft.bytes()], `
        testing bytearray_show
        func main(a: ByteArray) -> String {
            a.show()
        }`, ([a], res) => {
            let s = Array.from(asBytes(a), byte => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join('');

            return s === asString(res);
        });

        await ft.test([ft.bytes()], `
        testing bytearray_from_data
        func main(a: Data) -> ByteArray {
            ByteArray::from_data(a)
        }`, ([a], res) => equalsList(asBytes(a), asBytes(res)));

        await ft.test([ft.bytes(0, 1024)], `
        testing bytearray_serialize
        func main(a: ByteArray) -> ByteArray {
            a.serialize()
        }`, serializeProp);

        await ft.test([ft.bytes()], `
        testing bytearray32_eq_1
        func main(a: ByteArray) -> Bool {
            a.blake2b() == a.blake2b()
        }`, ([_], res) => asBool(res));

        await ft.test([ft.bytes(), ft.bytes()], `
        testing bytearray32_eq_2
        func main(a: ByteArray, b: ByteArray) -> Bool {
            a.blake2b() == b.blake2b()
        }`, ([a, b], res) => equalsList(asBytes(a), asBytes(b)) === asBool(res));

        await ft.test([ft.bytes()], `
        testing bytearray32_neq_1
        func main(a: ByteArray) -> Bool {
            a.blake2b() != a.blake2b()
        }`, ([_], res) => !asBool(res));

        await ft.test([ft.bytes(), ft.bytes()], `
        testing bytearray32_neq_2
        func main(a: ByteArray, b: ByteArray) -> Bool {
            a.blake2b() != b.blake2b()
        }`, ([a, b], res) => equalsList(asBytes(a), asBytes(b)) === !asBool(res));

        await ft.test([ft.bytes()], `
        testing bytearray32_add_1
        func main(a: ByteArray) -> ByteArray {
            a.blake2b() + #
        }`, ([a], res) => equalsList(helios_.Crypto.blake2b(asBytes(a)), asBytes(res)));

        await ft.test([ft.bytes()], `
        testing bytearray32_add_1_alt
        func main(a: ByteArray) -> ByteArray {
            # + a.blake2b()
        }`, ([a], res) => equalsList(helios_.Crypto.blake2b(asBytes(a)), asBytes(res)));

        await ft.test([ft.bytes(), ft.bytes()], `
        testing bytearray32_add_2
        func main(a: ByteArray, b: ByteArray) -> ByteArray {
            a.blake2b() + b.blake2b()
        }`, ([a, b], res) => equalsList(helios_.Crypto.blake2b(asBytes(a)).concat(helios_.Crypto.blake2b(asBytes(b))), asBytes(res)));

        await ft.test([ft.bytes()], `
        testing bytearray32_length
        func main(a: ByteArray) -> Int {
            a.blake2b().length
        }`, ([a], res) => 32n === asInt(res));

        await ft.test([ft.bytes(0, 64), ft.int(-10, 100)], `
        testing bytearray32_slice_1
        func main(a: ByteArray, b: Int) -> ByteArray {
            a.blake2b().slice(b, -1)
        }`, ([a, b], res) => {
            let bsa = helios_.Crypto.blake2b(asBytes(a));
            let n = bsa.length;

            let start = asInt(b) < 0n ? n + 1 + Number(asInt(b)) : Number(asInt(b));
            if (start < 0) {
                start = 0;
            } else if (start > n) {
                start = n;
            }

            let expected = bsa.slice(start);

            return equalsList(expected, asBytes(res));
        });

        await ft.test([ft.bytes(0, 64), ft.int(-10, 100), ft.int(-10, 100)], `
        testing bytearray32_slice_2
        func main(a: ByteArray, b: Int, c: Int) -> ByteArray {
            a.blake2b().slice(b, c)
        }`, ([a, b, c], res) => {
            let bsa = helios_.Crypto.blake2b(asBytes(a));
            let n = bsa.length;

            let start = asInt(b) < 0n ? n + 1 + Number(asInt(b)) : Number(asInt(b));
            if (start < 0) {
                start = 0;
            } else if (start > n) {
                start = n;
            }

            let end = asInt(c) < 0n ? n + 1 + Number(asInt(c)) : Number(asInt(c));
            if (end < 0) {
                end = 0;
            } else if (end > n) {
                end = n;
            }

            let expected = bsa.slice(start, end);

            return equalsList(expected, asBytes(res));
        });

        await ft.test([ft.bytes(0, 10)], `
        testing bytearray32_starts_with_1
        func main(a: ByteArray) -> Bool {
            a.blake2b().starts_with(#)
        }`, ([a, b], res) => asBool(res));

        await ft.test([ft.bytes(0, 10)], `
        testing bytearray32_ends_with_1
        func main(a: ByteArray) -> Bool {
            a.blake2b().ends_with(#)
        }`, ([a, b], res) => asBool(res));
        
        await ft.test([ft.utf8Bytes()], `
        testing bytearray32_decode_utf8_utf8
        func main(a: ByteArray) -> String {
            a.blake2b().decode_utf8()
        }`, ([a], res) => {
            let bsa = helios_.Crypto.blake2b(asBytes(a));

            try {
                let aString = helios.bytesToText(bsa);

                return aString == asString(res);
            } catch (_) {
                return isError(res, "invalid utf-8");
            }
        });

        await ft.test([ft.bytes(0, 10)], `
        testing bytearray32_sha2
        func main(a: ByteArray) -> ByteArray {
            a.blake2b().sha2()
        }`, ([a], res) => {
            let hasher = crypto.createHash("sha256");

            hasher.update(new DataView((new Uint8Array(helios_.Crypto.blake2b(asBytes(a)))).buffer));

            return equalsList(Array.from(hasher.digest()), asBytes(res));
        });

        await ft.test([ft.bytes(55, 70)], `
        testing bytearray32_sha2_alt
        func main(a: ByteArray) -> ByteArray {
            a.blake2b().sha2()
        }`, ([a], res) => {
            let hasher = crypto.createHash("sha256");

            hasher.update(new DataView((new Uint8Array(helios_.Crypto.blake2b(asBytes(a)))).buffer));

            return equalsList(Array.from(hasher.digest()), asBytes(res));
        });

        await ft.test([ft.bytes(0, 10)], `
        testing bytearray32_sha3
        func main(a: ByteArray) -> ByteArray {
            a.blake2b().sha3()
        }`, ([a], res) => {
            let hasher = crypto.createHash("sha3-256");

            hasher.update(new DataView((new Uint8Array(helios_.Crypto.blake2b(asBytes(a)))).buffer));

            return equalsList(Array.from(hasher.digest()), asBytes(res));
        });

        await ft.test([ft.bytes(130, 140)], `
        testing bytearray32_sha3_alt
        func main(a: ByteArray) -> ByteArray {
            a.blake2b().sha3()
        }`, ([a], res) => {
            let hasher = crypto.createHash("sha3-256");

            hasher.update(new DataView((new Uint8Array(helios_.Crypto.blake2b(asBytes(a)))).buffer));

            return equalsList(Array.from(hasher.digest()), asBytes(res));
        });

        // the crypto library only supports blake2b512 (and not blake2b256), so temporarily set digest size to 64 bytes for testing
        helios_.setBlake2bDigestSize(64);

        await ft.test([ft.bytes(0, 10)], `
        testing bytearray32_blake2b
        func main(a: ByteArray) -> ByteArray {
            a.blake2b().blake2b()
        }`, ([a], res) => {
            let hasher = crypto.createHash("blake2b512");

            hasher.update(new DataView((new Uint8Array(helios_.Crypto.blake2b(asBytes(a)))).buffer));

            return equalsList(Array.from(hasher.digest()), asBytes(res));
        });

        await ft.test([ft.bytes(130, 140)], `
        testing bytearray32_blake2b_alt
        func main(a: ByteArray) -> ByteArray {
            a.blake2b().blake2b()
        }`, ([a], res) => {
            let hasher = crypto.createHash("blake2b512");

            hasher.update(new DataView((new Uint8Array(helios_.Crypto.blake2b(asBytes(a)))).buffer));

            return equalsList(Array.from(hasher.digest()), asBytes(res));
        });

        helios_.setBlake2bDigestSize(32);

        await ft.test([ft.bytes()], `
        testing bytearray32_show
        func main(a: ByteArray) -> String {
            a.blake2b().show()
        }`, ([a], res) => {
            let s = Array.from(helios_.Crypto.blake2b(asBytes(a)), byte => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join('');

            return s === asString(res);
        });

        await ft.test([ft.bytes(0, 1024)], `
        testing bytearray32_serialize
        func main(a: ByteArray) -> ByteArray {
            a.blake2b().serialize()
        }`, ([a], res) => decodeCbor(asBytes(res)).isSame(new helios_.ByteArrayData(helios_.Crypto.blake2b(asBytes(a)))));
    }


    /////////////
    // List tests
    /////////////

    let testList = true;

    if (testList) {
        await ft.test([ft.int(-20, 20), ft.int()], `
        testing list_new_const
        func main(n: Int, b: Int) -> Bool {
            lst: []Int = []Int::new_const(n, b);
            if (n < 0) {
                lst.length == 0
            } else {
                lst.length == n && lst.all((v: Int) -> Bool {v == b})
            }
        }`, ([a, b], res) => asBool(res));

        await ft.test([ft.int(-20, 20)], `
        testing list_new
        func main(n: Int) -> []Int {
            []Int::new(n, (i: Int) -> Int {i})
        }`, ([a], res) => {
            let n = Number(asInt(a));
            if (n < 0) {
                n = 0;
            }

            let lRes = asIntList(res);

            return n == lRes.length && lRes.every((v, i) => BigInt(i) == v);
        });

        await ft.test([ft.int(-20, 20)], `
        testing list_new
        func main(n: Int) -> Bool {
            lst: []Int = []Int::new(n, (i: Int) -> Int {i});
            if (n < 0) {
                lst.length == 0
            } else {
                lst.length == n && (
                    sum: Int = lst.fold((acc: Int, v: Int) -> Int {acc + v}, 0);
                    sum == n*(n-1)/2
                )
            }
        }`, ([a, b], res) => asBool(res));

        await ft.test([ft.list(ft.int(), 0, 20)], `
        testing list_eq_1
        func main(a: []Int) -> Bool {
            a == a
        }`, ([_], res) => asBool(res));

        await ft.test([ft.list(ft.int()), ft.list(ft.int())], `
        testing list_eq_2
        func main(a: []Int, b: []Int) -> Bool {
            (a == b) == ((a.length == b.length) && (
                []Int::new(a.length, (i: Int) -> Int {i}).all((i: Int) -> Bool {
                    a.get(i) == b.get(i)
                })
            ))
        }`, ([a, b], res) => asBool(res));

        await ft.test([ft.list(ft.int())], `
        testing list_neq_1
        func main(a: []Int) -> Bool {
            a != a
        }`, ([_], res) => !asBool(res));

        await ft.test([ft.list(ft.int()), ft.list(ft.int())], `
        testing list_neq_2
        func main(a: []Int, b: []Int) -> Bool {
            (a != b) == ((a.length != b.length) || (
                []Int::new(a.length, (i: Int) -> Int{i}).any((i: Int) -> Bool {
                    a.get(i) != b.get(i)
                })
            ))
        }`, ([a, b], res) => asBool(res));

        await ft.test([ft.list(ft.int())], `
        testing list_add_1
        func main(a: []Int) -> Bool {
            newLst: []Int = a + []Int{};
            newLst == a
        }`, ([a], res) => asBool(res));

        await ft.test([ft.list(ft.int())], `
        testing list_add_1_alt
        func main(a: []Int) -> Bool {
            newLst: []Int = []Int{} + a;
            newLst == a
        }`, ([a], res) => asBool(res));

        await ft.test([ft.list(ft.int()), ft.list(ft.int())], `
        testing list_add_2
        func main(a: []Int, b: []Int) -> Bool {
            newLst: []Int = a + b;
            n: Int = a.length;

            []Int::new(newLst.length, (i: Int) -> Int {i}).all(
                (i: Int) -> Bool {
                    if (i < n) {
                        newLst.get(i) == a.get(i)
                    } else {
                        newLst.get(i) == b.get(i - n)
                    }
                }
            )
        }`, ([a, b], res) => asBool(res));

        await ft.test([ft.list(ft.int(), 0, 50)], `
        testing list_length
        func main(a: []Int) -> Bool {
            a.length == a.fold((acc:Int, v: Int) -> Int {
                acc + if (v == v) {1} else {0}
            }, 0)
        }`, ([a], res) => asBool(res));

        await ft.test([ft.list(ft.int())], `
        testing list_head
        func main(a: []Int) -> Bool {
            if (a.length == 0) {
                true
            } else {
                a.head == a.get(0)
            }
        }`, ([a], res) => asBool(res));

        await ft.test([ft.list(ft.int())], `
        testing list_tail
        func main(a: []Int) -> Bool {
            if (a.length == 0) {
                true
            } else {
                tl: []Int = a.tail;
                ([]Int::new(tl.length, (i: Int) -> Int{i})).all(
                    (i: Int) -> Bool {
                        tl.get(i) == a.get(i+1)
                    }
                )
            }
        }`, ([a], res) => asBool(res));

        await ft.test([ft.list(ft.int(), 0, 10)], `
        testing list_is_empty
        func main(a: []Int) -> Bool {
            a.is_empty() == (a.length == 0)
        }`, ([a], res) => asBool(res));

        await ft.test([ft.list(ft.int()), ft.int()], `
        testing list_prepend
        func main(a: []Int, b: Int) -> Bool {
            newList: []Int = a.prepend(b);

            ([]Int::new(newList.length, (i: Int) -> Int{i})).all(
                (i: Int) -> Bool {
                    if (i == 0) {
                        newList.get(i) == b
                    } else {
                        newList.get(i) == a.get(i-1)
                    }
                }
            )
        }`, ([a, b], res) => asBool(res));

        await ft.test([ft.list(ft.int())], `
        testing list_any
        func main(a: []Int) -> Bool {
            (a + []Int{1}).any((x: Int) -> Bool {x > 0})
        }`, ([a], res) => asBool(res));

        await ft.test([ft.list(ft.int())], `
        testing list_all
        func main(a: []Int) -> Bool {
            (a + []Int{-1}).all((x: Int) -> Bool {x > 0})
        }`, ([a], res) => !asBool(res));

        await ft.test([ft.list(ft.int())], `
        testing list_find
        func main(a: []Int) -> Int {
            a.find((x: Int) -> Bool {x > 0})
        }`, ([a], res) => {
            let la = asIntList(a);

            if (la.every(i => i <= 0n)) {
                return isError(res, "not found");
            } else {
                return asInt(res) == la.find(i => i > 0n);
            }
        });

        await ft.test([ft.list(ft.int())], `
        testing list_find_safe
        func main(a: []Int) -> Option[Int] {
            a.find_safe((x: Int) -> Bool {x > 0})
        }`, ([a], res) => {
            let la = asIntList(a);

            if (la.every(i => i <= 0n)) {
                return asData(res).index == 1;
            } else {
                return asData(res).index == 0 && (asInt(asData(res).fields[0]) == la.find(i => i > 0n));
            }
        });

        await ft.test([ft.list(ft.int())], `
        testing list_filter
        func main(a: []Int) -> []Int {
            a.filter((x: Int) -> Bool {x > 0})
        }`, ([a], res) => {
            let la = asIntList(a).filter(i => i > 0n);
            let lRes = asIntList(res);

            return (la.length == lRes.length) && la.every((a, i) => a == lRes[i]);
        });

        await ft.test([ft.list(ft.int())], `
        testing list_for_each
        func main(a: []Int) -> Bool {
            a.for_each((x: Int) -> {
                assert(x >= 0, "neg x found")
            });
            true
        }`, ([a], res) => {
            let la = asIntList(a);

            if (la.every(i => i >= 0n)) {
                return asBool(res);
            } else {
                return isError(res, "assert failed");
            }
        });

        await ft.test([ft.list(ft.int())], `
        testing list_fold
        func main(a: []Int) -> Int {
            a.fold((sum: Int, x: Int) -> Int {sum + x}, 0)
        }`, ([a], res) => {
            let la = asIntList(a);

            return la.reduce((sum, i) => sum + i, 0n) === asInt(res);
        });

        await ft.test([ft.list(ft.int())], `
        testing list_fold_2
        func main(a: []Int) -> Int {
            (sa: Int, sb: Int) = a.fold((sum: () -> (Int, Int), x: Int) -> () -> (Int, Int) {
                (sa_: Int, sb_: Int) = sum();
                () -> {(sa_ + x, sb_ + x)}
            }, () -> {(0, 0)})();
            (sa + sb)/2
        }
        `, ([a], res) => {
            let la = asIntList(a);

            return la.reduce((sum, i) => sum + i, 0n) === asInt(res);
        });

        await ft.test([ft.list(ft.int(0, 1))], `
        testing list_fold_lazy_0
        func main(a: []Int) -> Int {
            a.fold_lazy((x: Int, next: () -> Int) -> Int { if (x == 0) { 0 } else { x / next() } }, 0)
        }`, (_, res) => {
            return 0n === asInt(res);
        });

        await ft.test([ft.list(ft.int())], `
        testing list_fold_lazy
        func main(a: []Int) -> Int {
            a.fold_lazy((item: Int, sum: () -> Int) -> Int {item + sum()}, 0)
        }`, ([a], res) => {
            let la = asIntList(a);

            return la.reduce((sum, i) => sum + i, 0n) === asInt(res);
        });

        await ft.test([ft.list(ft.int())], `
        testing list_fold_lazy2
        func main(a: []Int) -> []Int {
            a.fold_lazy((item: Int, next: () -> []Int) -> []Int {next().prepend(item)}, []Int{})
        }`, ([a], res) => {
            let la = asIntList(a);
            let lRes = asIntList(res);

            return la.every((x, i) => lRes[i] === x);
        });

        await ft.test([ft.list(ft.int())], `
        testing list_map
        func main(a: []Int) -> []Int {
            a.map((x: Int) -> Int {
                x*2
            })
        }`, ([a], res) => {
            let la = asIntList(a);
            let lRes = asIntList(res);

            return la.every((v, i) => v*2n == lRes[i]);
        });

        await ft.test([ft.list(ft.int())], `
        testing list_map_to_bool
        func main(a: []Int) -> []Bool {
            a.map((x: Int) -> Bool {
                x >= 0
            })
        }`, ([a], res) => {
            let la = asIntList(a);
            let lRes = asBoolList(res);

            return la.every((v, i) => (v >= 0n) === lRes[i]);
        });

        await ft.test([ft.list(ft.int())], `
        testing list_sort
        func main(lst: []Int) -> []Int {
            lst.sort((a: Int, b: Int) -> Bool {a < b})
        }`, ([a], res) => {
            let la = asIntList(a);
            let lRes = asIntList(res);

            la.sort((a, b) => Number(a - b));

            return la.every((v, i) => (v === lRes[i]));
        });

        await ft.test([ft.list(ft.int())], `
        testing list_from_data
        func main(a: Data) -> []Int {
            []Int::from_data(a)
        }`, ([a], res) => {
            let la = asIntList(a);
            let lRes = asIntList(res);

            return la.length == lRes.length && la.every((v, i) => v == lRes[i]);
        });

        await ft.test([ft.list(ft.int())], `
        testing list_serialize
        func main(a: []Int) -> ByteArray {
            a.serialize()
        }`, serializeProp);

        await ft.test([ft.int(-20, 20), ft.bool()], `
        testing boollist_new_const
        func main(a: Int, b: Bool) -> []Bool {
            []Bool::new_const(a, b)
        }`, ([a, b], res) => {
            let n = Number(asInt(a));
            if (n < 0) {
                n = 0;
            }

            return equalsList((new Array(n)).fill(asBool(b)), asBoolList(res));
        });

        await ft.test([ft.int(-20, 20)], `
        testing boollist_new
        func main(a: Int) -> []Bool {
            []Bool::new(a, (i: Int) -> Bool {i%2 == 0})
        }`, ([a], res) => {
            let n = Number(asInt(a));
            if (n < 0) {
                n = 0;
            }

            let lRes = asBoolList(res)
            return n == lRes.length && lRes.every((b, i) => b === (i%2 == 0));
        });

        await ft.test([ft.list(ft.bool(), 0, 20)], `
        testing boollist_eq_1
        func main(a: []Bool) -> Bool {
            a == a
        }`, ([_], res) => asBool(res));

        await ft.test([ft.list(ft.bool()), ft.list(ft.bool())], `
        testing boollist_eq_2
        func main(a: []Bool, b: []Bool) -> Bool {
            a == b
        }`, ([a, b], res) => equalsList(asBoolList(a), asBoolList(b)) === asBool(res));

        await ft.test([ft.list(ft.bool())], `
        testing boollist_neq_1
        func main(a: []Bool) -> Bool {
            a != a
        }`, ([_], res) => !asBool(res));

        await ft.test([ft.list(ft.bool()), ft.list(ft.bool())], `
        testing boollist_neq_2
        func main(a: []Bool, b: []Bool) -> Bool {
            a != b
        }`, ([a, b], res) => equalsList(asBoolList(a), asBoolList(b)) === !asBool(res));

        await ft.test([ft.list(ft.bool())], `
        testing boollist_add_1
        func main(a: []Bool) -> []Bool {
            a + []Bool{}
        }`, ([a], res) => equalsList(asBoolList(a), asBoolList(res)));

        await ft.test([ft.list(ft.bool())], `
        testing boollist_add_1_alt
        func main(a: []Bool) -> []Bool {
            []Bool{} + a
        }`, ([a], res) => equalsList(asBoolList(a), asBoolList(res)));

        await ft.test([ft.list(ft.bool()), ft.list(ft.bool())], `
        testing boollist_add_2
        func main(a: []Bool, b: []Bool) -> []Bool {
            a + b
        }`, ([a, b], res) => equalsList(asBoolList(a).concat(asBoolList(b)), asBoolList(res)));

        await ft.test([ft.list(ft.bool(), 0, 50)], `
        testing boollist_length
        func main(a: []Bool) -> Int {
            a.length
        }`, ([a], res) => BigInt(asBoolList(a).length) === asInt(res));

        await ft.test([ft.list(ft.bool())], `
        testing boollist_head
        func main(a: []Bool) -> Bool {
            a.head
        }`, ([a], res) => {
            let la = asBoolList(a);

            return (
                la.length == 0 ? 
                isError(res, "empty list") :
                asBool(res) === la[0]
            );
        });

        await ft.test([ft.list(ft.bool())], `
        testing boollist_tail
        func main(a: []Bool) -> []Bool {
            a.tail
        }`, ([a], res) => {
            let la = asBoolList(a);

            return  (
                la.length == 0 ?
                isError(res, "empty list") :
                equalsList(la.slice(1), asBoolList(res))
            );
        });

        await ft.test([ft.list(ft.bool(), 0, 10)], `
        testing boollist_is_empty
        func main(a: []Bool) -> Bool {
            a.is_empty()
        }`, ([a], res) => (asBoolList(a).length == 0) === asBool(res));

        await ft.test([ft.list(ft.bool(), 0, 10), ft.int(-5, 15)], `
        testing boollist_get
        func main(a: []Bool, b: Int) -> Bool {
            a.get(b)
        }`, ([a, b], res) => {
            let i = Number(asInt(b));
            let la = asBoolList(a);
            let n = la.length;

            if (i >= n || i < 0) {
                return isError(res, "index out of range");
            } else {
                return la[i] === asBool(res);
            }
        });

        await ft.test([ft.list(ft.bool()), ft.bool()], `
        testing boollist_prepend
        func main(a: []Bool, b: Bool) -> []Bool {
            a.prepend(b)
        }`, ([a, b], res) => {
            let expected = asBoolList(a);
            expected.unshift(asBool(b));
            return equalsList(expected, asBoolList(res));
        });

        await ft.test([ft.list(ft.bool())], `
        testing boollist_any
        func main(a: []Bool) -> Bool {
            a.any((x: Bool) -> Bool {x})
        }`, ([a], res) => asBoolList(a).some((i) => i) === asBool(res));

        await ft.test([ft.list(ft.bool())], `
        testing boollist_all
        func main(a: []Bool) -> Bool {
            a.all((x: Bool) -> Bool {x})
        }`, ([a], res) => asBoolList(a).every((i) => i) === asBool(res));

        await ft.test([ft.list(ft.bool())], `
        testing boollist_find
        func main(a: []Bool) -> Bool {
            a.find((x: Bool) -> Bool {x})
        }`, ([a], res) => {
            let la = asBoolList(a);

            if (la.every(i => !i)) {
                return isError(res, "not found");
            } else {
                return asBool(res);
            }
        });

        await ft.test([ft.list(ft.bool())], `
        testing boollist_find_safe
        func main(a: []Bool) -> Option[Bool] {
            a.find_safe((x: Bool) -> Bool {x})
        }`, ([a], res) => {
            let la = asBoolList(a);

            if (la.every(i => !i)) {
                return asData(res).index == 1;
            } else {
                return asData(res).index == 0 && (asData(res).fields[0].index == 1);
            }
        });

        await ft.test([ft.list(ft.bool())], `
        testing boollist_filter
        func main(a: []Bool) -> []Bool {
            a.filter((x: Bool) -> Bool {x})
        }`, ([a], res) => equalsList(asBoolList(a).filter(b => b), asBoolList(res)));

        await ft.test([ft.list(ft.bool())], `
        testing boollist_for_each
        func main(a: []Bool) -> Bool {
            a.for_each((x: Bool) -> () {
                assert(x, "false found")
            });
            true
        }`, ([a], res) => {
            let la = asBoolList(a);

            if (la.every(b => b)) {
                return asBool(res);
            } else {
                return isError(res, "assert failed");
            }
        });

        await ft.test([ft.list(ft.bool())], `
        testing boollist_fold
        func main(a: []Bool) -> Int {
            a.fold((sum: Int, x: Bool) -> Int {sum + x.to_int()}, 0)
        }`, ([a], res) => asBoolList(a).reduce((sum, b) => sum + (b ? 1n : 0n), 0n) === asInt(res));

        await ft.test([ft.list(ft.bool())], `
        testing boollist_fold_lazy
        func main(a: []Bool) -> Int {
            a.fold_lazy(
                (item: Bool, sum: () -> Int) -> Int {
                    sum() + item.to_int()
                }, 
                0
            )
        }`, ([a], res) => asBoolList(a).reduce((sum, b) => sum + (b ? 1n : 0n), 0n) === asInt(res));

        await ft.test([ft.list(ft.bool())], `
        testing boollist_map
        func main(a: []Bool) -> []Int {
            a.map((x: Bool) -> Int {
                x.to_int()
            })
        }`, ([a], res) => equalsList(asBoolList(a).map(b => b ? 1n : 0n), asIntList(res)));

        await ft.test([ft.list(ft.bool())], `
        testing boollist_map_to_bool
        func main(a: []Bool) -> []Bool {
            a.map((x: Bool) -> Bool {
                !x
            })
        }`, ([a], res) => equalsList(asBoolList(a).map(b => !b), asBoolList(res)));

        await ft.test([ft.list(ft.bool())], `
        testing boollist_from_data
        func main(a: Data) -> []Bool {
            []Bool::from_data(a)
        }`, ([a], res) => equalsList(asBoolList(a), asBoolList(res)));

        await ft.test([ft.list(ft.bool())], `
        testing boollist_serialize
        func main(a: []Bool) -> ByteArray {
            a.serialize()
        }`, serializeProp);
    }


    ////////////
    // Map tests
    ////////////

    const testMap = true;

    if (testMap) {
        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_eq
        func main(a: Map[Int]Int) -> Bool {
            a == a
        }`, ([_], res) => {
            return asBool(res);
        });

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_neq
        func main(a: Map[Int]Int) -> Bool {
            a != a
        }`, ([_], res) => !asBool(res));

        await ft.test([ft.map(ft.int(), ft.int(), 0, 10), ft.map(ft.int(), ft.int(), 0, 10)], `
        testing map_add
        func main(a: Map[Int]Int, b: Map[Int]Int) -> Map[Int]Int {
            a + b
        }`, ([a, b], res) => asData(res).isSame(new helios_.MapData(a.data.map.concat(b.data.map))));

        await ft.test([ft.map(ft.int(), ft.int(), 0, 10), ft.int(), ft.int()], `
        testing map_prepend
        func main(a: Map[Int]Int, k: Int, v: Int) -> Map[Int]Int {
            a.prepend(k, v)
        }`, ([a, k, v], res) => {
            let expected = a.data.map;
            expected.unshift([new helios.IntData(asInt(k)), new helios.IntData(asInt(v))]);
            return asData(res).isSame(new helios_.MapData(expected));
        });

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_head_key
        func main(a: Map[Int]Int) -> Int {
            a.head_key
        }
        `, ([a], res) => {
            if (a.data.map.length == 0) {
                return isError(res, "empty list");
            } else {
                return asInt(res) === asInt(a.data.map[0][0]);
            }
        });

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_head_key_alt
        func main(a: Map[Int]Int) -> Int {
            (k: Int, _) = a.head(); k
        }
        `, ([a], res) => {
            if (a.data.map.length == 0) {
                return isError(res, "empty list");
            } else {
                return asInt(res) === asInt(a.data.map[0][0]);
            }
        });

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_head_value
        func main(a: Map[Int]Int) -> Int {
            a.head_value
        }
        `, ([a], res) => {
            if (a.data.map.length == 0) {
                return isError(res, "empty list");
            } else {
                return asInt(res) === asInt(a.data.map[0][1]);
            }
        });

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_head_value_alt
        func main(a: Map[Int]Int) -> Int {
            (_, v: Int) = a.head(); v
        }
        `, ([a], res) => {
            if (a.data.map.length == 0) {
                return isError(res, "empty list");
            } else {
                return asInt(res) === asInt(a.data.map[0][1]);
            }
        });

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_length
        func main(a: Map[Int]Int) -> Int {
            a.length
        }`, ([a], res) => a.data.map.length == Number(asInt(res)));

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_tail
        func main(a: Map[Int]Int) -> Map[Int]Int {
            a.tail
        }`, ([a], res) => {
            if (a.data.map.length == 0) {
                return isError(res, "empty list");
            } else {
                let la = a.data.map.slice(1);
                let lRes = asData(res).map.slice();

                return la.length == lRes.length && la.every(([k,v], i) => asInt(k) === asInt(lRes[i][0]) && asInt(v) === asInt(lRes[i][1]));
            }
        });

        await ft.test([ft.map(ft.int(), ft.int(), 0, 10)], `
        testing map_is_empty
        func main(a: Map[Int]Int) -> Bool {
            a.is_empty()
        }`, ([a], res) => (a.data.map.length == 0) === asBool(res));

        await ft.test([ft.int(), ft.int(), ft.int(), ft.int()], `
        testing map_get
        func main(a: Int, b: Int, c: Int, d: Int) -> Int {
            m = Map[Int]Int{a: b, c: d};
            m.get(c)
        }`, ([a, b, c, d], res) => asInt(d) === asInt(res));

        await ft.test([ft.int(), ft.int(), ft.int(), ft.int()], `
        testing map_get_safe_1
        func main(a: Int, b: Int, c: Int, d: Int) -> Bool {
            m = Map[Int]Int{a: b, c: d};
            m.get_safe(c) == Option[Int]::Some{d}
        }`, ([a, b, c, d], res) => asBool(res));

        await ft.test([ft.int(), ft.int(), ft.int(), ft.int()], `
        testing map_get_safe_2
        func main(a: Int, b: Int, c: Int, d: Int) -> Bool {
            m = Map[Int]Int{a: b, c: d};
            m.get_safe(d) == Option[Int]::None
        }`, ([a, b, c, d], res) => asBool(res));

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_all
        func main(a: Map[Int]Int) -> Bool {
            a.all((k: Int, v: Int) -> Bool {
                k < v
            })
        }`, ([a], res) => (a.data.map.every(([k, v]) => asInt(k) < asInt(v))) === asBool(res));

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_all_keys
        func main(a: Map[Int]Int) -> Bool {
            a.all((k: Int, _) -> Bool {
                k > 0
            })
        }`, ([a], res) => (a.data.map.every(([k, _]) => asInt(k) > 0n)) === asBool(res));

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_all_values
        func main(a: Map[Int]Int) -> Bool {
            a.all((_, v: Int) -> Bool {
                v > 0
            })
        }`, ([a], res) => (a.data.map.every(([_, v]) => asInt(v) > 0n)) === asBool(res));

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_any
        func main(a: Map[Int]Int) -> Bool {
            a.any((k: Int, v: Int) -> Bool {
                k < v
            })
        }`, ([a], res) => (a.data.map.some(([k, v]) => asInt(k) < asInt(v))) === asBool(res));

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_any_key
        func main(a: Map[Int]Int) -> Bool {
            a.any((k: Int, _) -> Bool {
                k > 0
            })
        }`, ([a], res) => (a.data.map.some(([k, _]) => asInt(k) > 0n)) === asBool(res));

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_any_value
        func main(a: Map[Int]Int) -> Bool {
            a.any((_, v: Int) -> Bool {
                v > 0
            })
        }`, ([a], res) => (a.data.map.some(([_, v]) => asInt(v) > 0n)) === asBool(res));

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_filter
        func main(a: Map[Int]Int) -> Map[Int]Int {
            a.filter((k: Int, v: Int) -> Bool {
                k < v
            })
        }`, ([_], res) => asData(res).map.every(([k, v]) => asInt(k) < asInt(v)));

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_filter_by_key
        func main(a: Map[Int]Int) -> Map[Int]Int {
            a.filter((k: Int, _) -> Bool {
                k > 0
            })
        }`, ([_], res) => asData(res).map.every(([k, _]) => asInt(k) > 0n));

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_filter_by_value
        func main(a: Map[Int]Int) -> Map[Int]Int {
            a.filter((_, v: Int) -> Bool {
                v > 0
            })
        }`, ([_], res) => asData(res).map.every(([_, v]) => asInt(v) > 0n));

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_fold
        func main(a: Map[Int]Int) -> Int {
            a.fold((prev: Int, k: Int, v: Int) -> Int {
                prev + k + v
            }, 0)
        }`, ([a], res) => {
            let sum = 0n;
            a.data.map.forEach(([k, v]) => {
                sum += asInt(k) + asInt(v);
            });

            return sum === asInt(res);
        });

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_fold_keys
        func main(a: Map[Int]Int) -> Int {
            a.fold((prev: Int, k: Int, _) -> Int {
                prev + k
            }, 0)
        }`, ([a], res) => {
            let sum = 0n;
            a.data.map.forEach(([k, _]) => {
                sum += asInt(k);
            });

            return sum === asInt(res);
        });

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_fold_values
        func main(a: Map[Int]Int) -> Int {
            a.fold((prev: Int, _, v: Int) -> Int {
                prev + v
            }, 0)
        }`, ([a], res) => {
            let sum = 0n;
            a.data.map.forEach(([_, v]) => {
                sum += asInt(v);
            });

            return sum === asInt(res);
        });

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_fold_lazy
        func main(a: Map[Int]Int) -> Int {
            a.fold_lazy((k: Int, v: Int, next: () -> Int) -> Int {
                k + v + next()
            }, 0)
        }`, ([a], res) => {
            let sum = 0n;
            a.data.map.forEach(([k, v]) => {
                sum += asInt(k) + asInt(v);
            });

            return sum === asInt(res);
        });

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_fold_keys_lazy
        func main(a: Map[Int]Int) -> Int {
            a.fold_lazy((k: Int, _, next: () -> Int) -> Int {
                k + next()
            }, 0)
        }`, ([a], res) => {
            let sum = 0n;
            a.data.map.forEach(([k, _]) => {
                sum += asInt(k);
            });

            return sum === asInt(res);
        });

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_fold_values_lazy
        func main(a: Map[Int]Int) -> Int {
            a.fold_lazy((_, v: Int, next: () -> Int) -> Int {
                v + next()
            }, 0)
        }`, ([a], res) => {
            let sum = 0n;
            a.data.map.forEach(([_, v]) => {
                sum += asInt(v);
            });

            return sum === asInt(res);
        });

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_for_each
        func main(a: Map[Int]Int) -> Bool {
            a.for_each((key: Int, value: Int) -> {
                assert(key >= 0 && value >= 0, "neg key or value found")
            });
            true
        }`, ([a], res) => {
            let failed = false;

            a.data.map.forEach(([k, v]) => {
                if (asInt(k) < 0n || asInt(v) < 0n) {
                    failed = true;
                }
            });

            if (failed) {
                return isError(res, "assert failed");
            } else {
                return asBool(res);
            }
        });

        await ft.test([ft.map(ft.int(0, 10), ft.int())], `
        testing map_find_key
        func main(a: Map[Int]Int) -> Int {
            a.find_key((k: Int) -> Bool {k == 0})
        }`, ([a], res) => {
            if (a.data.map.some(([k, _]) => asInt(k) == 0n)) {
                return asInt(res) === 0n;
            } else {
                return isError(res, "not found");
            }
        });

        await ft.test([ft.map(ft.int(0, 10), ft.int())], `
        testing map_find_key_safe
        func main(a: Map[Int]Int) -> Option[Int] {
            a.find_key_safe((k: Int) -> Bool {k == 0})
        }`, ([a], res) => {            
            if (a.data.map.some(([k, _]) => asInt(k) == 0n)) {
                return asData(res).index == 0 && asInt(asData(res).fields[0]) === 0n;
            } else {
                return asData(res).index == 1;
            }
        });

        await ft.test([ft.map(ft.int(0, 10), ft.int())], `
        testing map_find_by_key
        func main(a: Map[Int]Int) -> Map[Int]Int {
            (k: Int, v: Int) = a.find((k: Int, _) -> Bool {k == 0}); Map[Int]Int{k: v}
        }`, ([a], res) => {
            if (a.data.map.some(([k, _]) => asInt(k) == 0n)) {
                return asData(res).map.length == 1 && asInt(asData(res).map[0][0]) === 0n;
            } else {
                return isError(res, "not found");
            }
        });

        await ft.test([ft.map(ft.int(0, 10), ft.int())], `
        testing map_find_value
        func main(a: Map[Int]Int) -> Int {
            (_, v: Int) = a.find((_, v: Int) -> Bool {v == 0}); v
        }`, ([a], res) => {
            if (a.data.map.some(([_, v]) => asInt(v) == 0n)) {
                return asInt(res) === 0n;
            } else {
                return isError(res, "not found");
            }
        });

        await ft.test([ft.map(ft.int(0, 10), ft.int())], `
        testing map_find_value_safe
        func main(a: Map[Int]Int) -> Option[Int] {
            (result: () -> (Int, Int), ok: Bool) = a.find_safe((_, v: Int) -> Bool {v == 0}); 
            if (ok) {
                (_, v: Int) = result(); 
                Option[Int]::Some{v}
            } else {
                Option[Int]::None
            }
        }`, ([a], res) => {            
            if (a.data.map.some(([_, v]) => asInt(v) == 0n)) {
                return asData(res).index == 0 && asInt(asData(res).fields[0]) === 0n;
            } else {
                return asData(res).index == 1;
            }
        });

        await ft.test([ft.map(ft.int(0, 10), ft.int())], `
        testing map_find_by_value
        func main(a: Map[Int]Int) -> Map[Int]Int {
            (result: () -> (Int, Int), ok: Bool) = a.find_safe((_, v: Int) -> Bool {v == 0});
            if (ok) {
                (k: Int, v: Int) = result();
                Map[Int]Int{k: v}
            } else {
                Map[Int]Int{}
            }
        }`, ([a], res) => {
            if (a.data.map.some(([_, v]) => asInt(v) == 0n)) {
                return asData(res).map.length == 1 && asInt(asData(res).map[0][1]) === 0n;
            } else {
                return asData(res).map.length == 0;
            }
        });

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_map_keys
        func main(a: Map[Int]Int) -> Map[Int]Int {
            a.map((key: Int, value: Int) -> (Int, Int) {
                (key*2, value)
            })
        }`, ([a], res) => {
            let lRes = asData(res).map;

            return a.data.map.every(([k, _], i) => {
                return asInt(k)*2n === asInt(lRes[i][0]);
            });
        });

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_map_values
        func main(a: Map[Int]Int) -> Map[Int]Int {
            a.map((key: Int, value: Int) -> (Int, Int) {
                (key, value*2)
            })
        }`, ([a], res) => {
            let lRes = asData(res).map;

            return a.data.map.every(([_, v], i) => {
                return asInt(v)*2n === asInt(lRes[i][1]);
            });
        });

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_map_values_to_bool
        func main(a: Map[Int]Int) -> Map[Int]Bool {
            a.map((key: Int, value: Int) -> (Int, Bool) {
                (key, value >= 0)
            })
        }`, ([a], res) => {
            let lRes = asData(res).map;

            return a.data.map.every(([_, v], i) => {
                return (asInt(v) >= 0n) === asBool(lRes[i][1]);
            });
        });

        await ft.test([ft.map(ft.int(0, 3), ft.int()), ft.int(0, 3)], `
        testing map_delete
        func main(m: Map[Int]Int, key: Int) -> Map[Int]Int {
            m.delete(key)
        }`, ([_, key], res) => {
            return asData(res).map.every((pair) => {
                return asInt(pair[0]) !== asInt(key);
            });
        });

        await ft.test([ft.map(ft.int(), ft.int()), ft.int(), ft.int()], `
        testing map_set
        func main(m: Map[Int]Int, key: Int, value: Int) -> Map[Int]Int {
            m.delete(key).set(key, value)
        }`, ([_, key, value], res) => {
            return asData(res).map.some((pair) => {
                return (asInt(pair[0]) === asInt(key)) && (asInt(pair[1]) === asInt(value));
            });
        });

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_sort
        func main(m: Map[Int]Int) -> Map[Int]Int {
            m.sort((ak: Int, av: Int, bk: Int, bv: Int) -> Bool {
                ak + av < bk + bv
            })
        }`, ([_], res) => {
            return asData(res).map.every(([k, v], i) => {
                if (i > 0) {
                    let [kPrev, vPrev] = asData(res).map[i-1];

                    return (asInt(kPrev) + asInt(vPrev)) <= (asInt(k) + asInt(v));
                } else {
                    return true;
                }
            });
        });

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_sort_by_key
        func main(m: Map[Int]Int) -> Map[Int]Int {
            m.sort((a: Int, _, b: Int, _) -> Bool {
                a < b
            })
        }`, ([_], res) => {
            return asData(res).map.every(([k, _], i) => {
                if (i > 0) {
                    let [kPrev, _] = asData(res).map[i-1];

                    return asInt(kPrev) <= asInt(k);
                } else {
                    return true;
                }
            });
        });

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_sort_by_value
        func main(m: Map[Int]Int) -> Map[Int]Int {
            m.sort((_, a: Int, _, b: Int) -> Bool {
                a < b
            })
        }`, ([_], res) => {
            return asData(res).map.every(([_, v], i) => {
                if (i > 0) {
                    let [_, vPrev] = asData(res).map[i-1];

                    return asInt(vPrev) <= asInt(v);
                } else {
                    return true;
                }
            });
        });

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_from_data
        func main(a: Data) -> Map[Int]Int {
            Map[Int]Int::from_data(a)
        }`, ([a], res) => a.data.isSame(asData(res)));

        await ft.test([ft.map(ft.int(), ft.int())], `
        testing map_serialize
        func main(a: Map[Int]Int) -> ByteArray {
            a.serialize()
        }`, serializeProp);


        ////////////////
        // BoolMap tests
        ////////////////

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_eq
        func main(a: Map[Int]Bool) -> Bool {
            a == a
        }`, ([_], res) => asBool(res));

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_neq
        func main(a: Map[Int]Bool) -> Bool {
            a != a
        }`, ([_], res) => !asBool(res));

        await ft.test([ft.map(ft.int(), ft.bool(), 0, 10), ft.map(ft.int(), ft.bool(), 0, 10)], `
        testing boolmap_add
        func main(a: Map[Int]Bool, b: Map[Int]Bool) -> Map[Int]Bool {
            a + b
        }`, ([a, b], res) => asData(res).isSame(new helios_.MapData(a.data.map.concat(b.data.map))));

        await ft.test([ft.map(ft.int(), ft.bool(), 0, 10), ft.int(), ft.bool()], `
        testing boolmap_prepend
        func main(a: Map[Int]Bool, k: Int, v: Bool) -> Map[Int]Bool {
            a.prepend(k, v)
        }`, ([a, k, v], res) => {
            let expected = a.data.map;
            expected.unshift([new helios.IntData(asInt(k)), new helios.ConstrData(asBool(v) ? 1 : 0, [])]);
            return asData(res).isSame(new helios_.MapData(expected));
        });

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_head_key
        func main(a: Map[Int]Bool) -> Int {
            a.head_key
        }
        `, ([a], res) => {
            if (a.data.map.length == 0) {
                return isError(res, "empty list");
            } else {
                return asInt(res) === asInt(a.data.map[0][0]);
            }
        });

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_head_key_alt
        func main(a: Map[Int]Bool) -> Int {
            (k: Int, _) = a.head(); k
        }
        `, ([a], res) => {
            if (a.data.map.length == 0) {
                return isError(res, "empty list");
            } else {
                return asInt(res) === asInt(a.data.map[0][0]);
            }
        });

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_head_value
        func main(a: Map[Int]Bool) -> Bool {
            a.head_value
        }
        `, ([a], res) => {
            if (a.data.map.length == 0) {
                return isError(res, "empty list");
            } else {
                return asBool(res) === asBool(a.data.map[0][1]);
            }
        });

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_head_value_alt
        func main(a: Map[Int]Bool) -> Bool {
            (_, v: Bool) = a.head(); v
        }
        `, ([a], res) => {
            if (a.data.map.length == 0) {
                return isError(res, "empty list");
            } else {
                return asBool(res) === asBool(a.data.map[0][1]);
            }
        });

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_length
        func main(a: Map[Int]Bool) -> Int {
            a.length
        }`, ([a], res) => a.data.map.length == Number(asInt(res)));

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_tail
        func main(a: Map[Int]Bool) -> Map[Int]Bool {
            a.tail
        }`, ([a], res) => {
            if (a.data.map.length == 0) {
                return isError(res, "empty list");
            } else {
                let la = a.data.map.slice(1);
                let lRes = asData(res).map.slice();

                return la.length == lRes.length && la.every(([k,v], i) => asInt(k) === asInt(lRes[i][0]) && asBool(v) === asBool(lRes[i][1]));
            }
        });

        await ft.test([ft.map(ft.int(), ft.bool(), 0, 10)], `
        testing boolmap_is_empty
        func main(a: Map[Int]Bool) -> Bool {
            a.is_empty()
        }`, ([a], res) => (a.data.map.length == 0) === asBool(res));

        await ft.test([ft.int(), ft.bool(), ft.int(), ft.bool()], `
        testing boolmap_get
        func main(a: Int, b: Bool, c: Int, d: Bool) -> Bool {
            m = Map[Int]Bool{a: b, c: d};
            m.get(c)
        }`, ([a, b, c, d], res) => asBool(d) === asBool(res));

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_all
        func main(a: Map[Int]Bool) -> Bool {
            a.all((k: Int, v: Bool) -> Bool {
                k < v.to_int()
            })
        }`, ([a], res) => (a.data.map.every(([k, v]) => asInt(k) < BigInt(constrIndex(v)))) === asBool(res));

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_all_keys
        func main(a: Map[Int]Bool) -> Bool {
            a.all((k: Int, _) -> Bool {
                k > 0
            })
        }`, ([a], res) => (a.data.map.every(([k, _]) => asInt(k) > 0n)) === asBool(res));

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_all_values
        func main(a: Map[Int]Bool) -> Bool {
            a.all((_, v: Bool) -> Bool {
                v.to_int() > 0
            })
        }`, ([a], res) => (a.data.map.every(([_, v]) => constrIndex(v) > 0)) === asBool(res));

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_any
        func main(a: Map[Int]Bool) -> Bool {
            a.any((k: Int, v: Bool) -> Bool {
                k < v.to_int()
            })
        }`, ([a], res) => (a.data.map.some(([k, v]) => asInt(k) < BigInt(constrIndex(v)))) === asBool(res));

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_any_key
        func main(a: Map[Int]Bool) -> Bool {
            a.any((k: Int, _) -> Bool {
                k > 0
            })
        }`, ([a], res) => (a.data.map.some(([k, _]) => asInt(k) > 0n)) === asBool(res));

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_any_value
        func main(a: Map[Int]Bool) -> Bool {
            a.any((_, v: Bool) -> Bool {
                v.to_int() > 0
            })
        }`, ([a], res) => (a.data.map.some(([_, v]) => constrIndex(v) > 0)) === asBool(res));

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_filter
        func main(a: Map[Int]Bool) -> Map[Int]Bool {
            a.filter((k: Int, v: Bool) -> Bool {
                k < v.to_int()
            })
        }`, ([_], res) => asData(res).map.every(([k, v]) => asInt(k) < BigInt(constrIndex(v))));

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_filter_by_key
        func main(a: Map[Int]Bool) -> Map[Int]Bool {
            a.filter((k: Int, _) -> Bool {
                k > 0
            })
        }`, ([_], res) => asData(res).map.every(([k, _]) => asInt(k) > 0n));

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_filter_by_value
        func main(a: Map[Int]Bool) -> Map[Int]Bool {
            a.filter((_, v: Bool) -> Bool {
                v.to_int() > 0
            })
        }`, ([_], res) => asData(res).map.every(([_, v]) => constrIndex(v) > 0));

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_find
        func main(a: Map[Int]Bool) -> Map[Int]Bool {
            (k: Int, v: Bool) = a.find((k: Int, v: Bool) -> Bool {
                k < v.to_int()
            }); 
            Map[Int]Bool{k: v}
        }`, ([a], res) => {
            if (a.data.map.some(([k, v]) => asInt(k) < BigInt(constrIndex(v)))) {
                return asData(res).map.length == 1;
            } else {
                return isError(res, "not found");
            }
        });

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_find_by_key
        func main(a: Map[Int]Bool) -> Map[Int]Bool {
            (result: () -> (Int, Bool), ok: Bool) = a.find_safe((k: Int, _) -> Bool {
                k > 0
            });
            if (ok) {
                (k: Int, v: Bool) = result();
                Map[Int]Bool{k: v}
            } else {
                Map[Int]Bool{}
            }
        }`, ([a], res) => {
            if (a.data.map.some(([k, _]) => asInt(k) > 0n)) {
                return asData(res).map.length == 1;
            } else {
                return asData(res).map.length == 0;
            }
        });

        await ft.test([ft.map(ft.int(0, 10), ft.bool())], `
        testing boolmap_find_key
        func main(a: Map[Int]Bool) -> Int {
            a.find_key((k: Int) -> Bool {k == 0})
        }`, ([a], res) => {
            if (a.data.map.some(([k, _]) => asInt(k) == 0n)) {
                return asInt(res) === 0n;
            } else {
                return isError(res, "not found");
            }
        });

        await ft.test([ft.map(ft.int(0, 10), ft.bool())], `
        testing boolmap_find_key_safe
        func main(a: Map[Int]Bool) -> Option[Int] {
            a.find_key_safe((k: Int) -> Bool {k == 0})
        }`, ([a], res) => {            
            if (a.data.map.some(([k, _]) => asInt(k) == 0n)) {
                return asData(res).index == 0 && asInt(asData(res).fields[0]) === 0n;
            } else {
                return asData(res).index == 1;
            }
        });

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_find_by_value
        func main(a: Map[Int]Bool) -> Map[Int]Bool {
            (result: () -> (Int, Bool), ok: Bool) = a.find_safe((_, v: Bool) -> Bool {
                v.to_int() > 0
            });
            if (ok) {
                (k: Int, v: Bool) = result();
                Map[Int]Bool{k: v}
            } else {
                Map[Int]Bool{}
            }
        }`, ([a], res) => {
            if (a.data.map.some(([_, v]) => constrIndex(v) > 0)) {
                return asData(res).map.length == 1;
            } else {
                return asData(res).map.length == 0;
            }
        });

        await ft.test([ft.map(ft.int(0, 10), ft.bool())], `
        testing boolmap_find_value
        func main(a: Map[Int]Bool) -> Bool {
            a.find_value((v: Bool) -> Bool {v})
        }`, ([a], res) => {
            if (a.data.map.some(([_, v]) => asBool(v))) {
                return asBool(res);
            } else {
                return isError(res, "not found");
            }
        });

        await ft.test([ft.map(ft.int(0, 10), ft.bool())], `
        testing boolmap_find_value_safe
        func main(a: Map[Int]Bool) -> Option[Bool] {
            a.find_value_safe((v: Bool) -> Bool {v})
        }`, ([a], res) => {            
            if (a.data.map.some(([_, v]) => asBool(v))) {
                return asData(res).index == 0 && asBool(asData(res).fields[0]);
            } else {
                return asData(res).index == 1;
            }
        });

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_fold
        func main(a: Map[Int]Bool) -> Int {
            a.fold((prev: Int, k: Int, v: Bool) -> Int {
                prev + k + v.to_int()
            }, 0)
        }`, ([a], res) => {
            let sum = 0n;
            a.data.map.forEach(([k, v]) => {
                sum += asInt(k) + BigInt(constrIndex(v));
            });

            return sum === asInt(res);
        });

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_fold_keys
        func main(a: Map[Int]Bool) -> Int {
            a.fold((prev: Int, k: Int, _) -> Int {
                prev + k
            }, 0)
        }`, ([a], res) => {
            let sum = 0n;
            a.data.map.forEach(([k, _]) => {
                sum += asInt(k);
            });

            return sum === asInt(res);
        });

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_fold_values
        func main(a: Map[Int]Bool) -> Int {
            a.fold((prev: Int, _, v: Bool) -> Int {
                prev + v.to_int()
            }, 0)
        }`, ([a], res) => {
            let sum = 0n;
            a.data.map.forEach(([_, v]) => {
                sum += BigInt(constrIndex(v));
            });

            return sum === asInt(res);
        });

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_fold_lazy
        func main(a: Map[Int]Bool) -> Int {
            a.fold_lazy((k: Int, v: Bool, next: () -> Int) -> Int {
                k + v.to_int() + next()
            }, 0)
        }`, ([a], res) => {
            let sum = 0n;
            a.data.map.forEach(([k, v]) => {
                sum += asInt(k) + BigInt(constrIndex(v));
            });

            return sum === asInt(res);
        });

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_fold_keys_lazy
        func main(a: Map[Int]Bool) -> Int {
            a.fold_lazy((k: Int, _, next: () -> Int) -> Int {
                k + next()
            }, 0)
        }`, ([a], res) => {
            let sum = 0n;
            a.data.map.forEach(([k, _]) => {
                sum += asInt(k);
            });

            return sum === asInt(res);
        });

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_fold_values_lazy
        func main(a: Map[Int]Bool) -> Int {
            a.fold_lazy((_, v: Bool, next: () -> Int) -> Int {
                v.to_int() + next()
            }, 0)
        }`, ([a], res) => {
            let sum = 0n;
            a.data.map.forEach(([_, v]) => {
                sum += BigInt(constrIndex(v));
            });

            return sum === asInt(res);
        });

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_from_data
        func main(a: Data) -> Map[Int]Bool {
            Map[Int]Bool::from_data(a)
        }`, ([a], res) => {
            return a.data.map.length == asData(res).map.length && a.data.map.every((pair, i) => pair[0] === asData(res).map[i][0] && pair[1] === asData(res).map[i][1]);
        });

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_map_keys
        func main(a: Map[Int]Bool) -> Map[Int]Bool {
            a.map((key: Int, value: Bool) -> (Int, Bool) {
                (key*2, value)
            })
        }`, ([a], res) => {
            let lRes = asData(res).map;

            return a.data.map.every(([k, _], i) => {
                return asInt(k)*2n === asInt(lRes[i][0]);
            });
        });

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_map_values
        func main(a: Map[Int]Bool) -> Map[Int]Int {
            a.map((key: Int, value: Bool) -> (Int, Int) {
                (key, if (value) {1} else {0})
            })
        }`, ([a], res) => {
            let lRes = asData(res).map;

            return a.data.map.every(([_, v], i) => {
                return (asBool(v) ? 1n : 0n) === asInt(lRes[i][1]);
            });
        });

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_map_values_to_bool
        func main(a: Map[Int]Bool) -> Map[Int]Bool {
            a.map((key: Int, value: Bool) -> (Int, Bool) {
                (key, !value)
            })
        }`, ([a], res) => {
            let lRes = asData(res).map;

            return a.data.map.every(([_, v], i) => {
                return (!asBool(v)) === asBool(lRes[i][1]);
            });
        });

        await ft.test([ft.map(ft.int(0, 3), ft.bool()), ft.int(0, 3)], `
        testing boolmap_delete
        func main(m: Map[Int]Bool, key: Int) -> Map[Int]Bool {
            m.delete(key)
        }`, ([_, key], res) => {
            return asData(res).map.every((pair) => {
                return asInt(pair[0]) !== asInt(key);
            });
        });

        await ft.test([ft.map(ft.int(), ft.bool()), ft.int(), ft.bool()], `
        testing boolmap_set
        func main(m: Map[Int]Bool, key: Int, value: Bool) -> Map[Int]Bool {
            m.delete(key).set(key, value)
        }`, ([_, key, value], res) => {
            return asData(res).map.some((pair) => {
                return (asInt(pair[0]) === asInt(key)) && (asBool(pair[1]) === asBool(value));
            });
        });

        await ft.test([ft.map(ft.int(), ft.bool())], `
        testing boolmap_serialize
        func main(a: Map[Int]Bool) -> ByteArray {
            a.serialize()
        }`, serializeProp);
    }


    ///////////////
    // Option tests
    ///////////////

    await ft.test([ft.option(ft.int())], `
    testing option_eq_1
    func main(a: Option[Int]) -> Bool {
        a == a
    }`, ([_], res) => asBool(res));

    await ft.test([ft.option(ft.int(0, 5)), ft.option(ft.int(0, 5))], `
    testing option_eq_2
    func main(a: Option[Int], b: Option[Int]) -> Bool {
        a == b
    }`, ([a, b], res) => a.data.isSame(b.data) === asBool(res));

    await ft.test([ft.option(ft.int(0, 5)), ft.option(ft.int(0, 5))], `
    testing option_eq_2_alt
    func main(a: Option[Int], b: Option[Int]) -> Bool {
        a.switch{
            s: Some => s == b,
            n: None => n == b
        }
    }`, ([a, b], res) => a.data.isSame(b.data) === asBool(res));

    await ft.test([ft.option(ft.int())], `
    testing option_neq_1
    func main(a: Option[Int]) -> Bool {
        a != a
    }`, ([_], res) => !asBool(res));

    await ft.test([ft.option(ft.int(0, 5)), ft.option(ft.int(0, 5))], `
    testing option_neq_2
    func main(a: Option[Int], b: Option[Int]) -> Bool {
        a != b
    }`, ([a, b], res) => a.data.isSame(b.data) === !asBool(res));

    await ft.test([ft.option(ft.int(0, 5)), ft.option(ft.int(0, 5))], `
    testing option_neq_2_alt
    func main(a: Option[Int], b: Option[Int]) -> Bool {
        a.switch{
            s: Some => s != b,
            n: None => n != b
        }
    }`, ([a, b], res) => a.data.isSame(b.data) === !asBool(res));

    await ft.test([ft.option(ft.int())], `
    testing option_some
    func main(a: Option[Int]) -> Int {
        a.switch{
            s: Some => s.some,
            None    => -1
        }
    }`, ([a], res) => {
        if (a.data.index == 1) {
            return -1n === asInt(res);
        } else {
            return asInt(a.data.fields[0]) === asInt(res);
        }
    });

    await ft.test([ft.option(ft.int())], `
    testing option_unwrap
    func main(a: Option[Int]) -> Int {
        a.unwrap()
    }`, ([a], res) => {
        if (a.data.index == 1) {
            return isError(res, "empty list");
        } else {
            return asInt(a.data.fields[0]) === asInt(res);
        }
    });

    await ft.test([ft.option(ft.int())], `
    testing option_map
    func main(a: Option[Int]) -> Option[Int] {
        a.map((x: Int) -> {x*2})
    }`, ([a], res) => {
        if (a.data.index == 1) {
            return helios_.assertClass(res, helios.UplcValue).data.index == 1;
        } else {
            return asInt(helios_.assertClass(res, helios.UplcValue).data.fields[0]) == 2n*asInt(a.data.fields[0])
        }
    });

    await ft.test([ft.option(ft.int())], `
    testing option_map_to_bool
    func main(a: Option[Int]) -> Option[Bool] {
        a.map((x: Int) -> {x > 0})
    }`, ([a], res) => {
        if (a.data.index == 1) {
            return helios_.assertClass(res, helios.UplcValue).data.index == 1;
        } else {
            return asBool(helios_.assertClass(res, helios.UplcValue).data.fields[0]) == (asInt(a.data.fields[0]) > 0n)
        }
    });

    await ft.test([ft.option(ft.int())], `
    testing option_from_data
    func main(a: Data) -> Option[Int] {
        Option[Int]::from_data(a)
    }`, ([a], res) => a.data.isSame(asData(res)));

    await ft.test([ft.option(ft.int())], `
    testing option_serialize
    func main(a: Option[Int]) -> ByteArray {
        a.serialize()
    }`, serializeProp);

    await ft.test([ft.option(ft.int())], `
    testing option_sub_serialize
    func main(a: Option[Int]) -> ByteArray {
        a.switch{
            s: Some => s.serialize(),
            n: None => n.serialize()
        }
    }`, serializeProp);


    ///////////////////
    // BoolOption tests
    ///////////////////

    await ft.test([ft.option(ft.bool())], `
    testing booloption_eq_1
    func main(a: Option[Bool]) -> Bool {
        a == a
    }`, ([_], res) => asBool(res), 15);

    await ft.test([ft.option(ft.bool()), ft.option(ft.bool())], `
    testing booloption_eq_2
    func main(a: Option[Bool], b: Option[Bool]) -> Bool {
        a == b
    }`, ([a, b], res) => a.data.isSame(b.data) === asBool(res));

    await ft.test([ft.option(ft.bool()), ft.option(ft.bool())], `
    testing booloption_eq_2_alt
    func main(a: Option[Bool], b: Option[Bool]) -> Bool {
        a.switch{
            s: Some => s == b,
            n: None => n == b
        }
    }`, ([a, b], res) => a.data.isSame(b.data) === asBool(res));

    await ft.test([ft.option(ft.bool())], `
    testing booloption_neq_1
    func main(a: Option[Bool]) -> Bool {
        a != a
    }`, ([_], res) => !asBool(res));

    await ft.test([ft.option(ft.bool()), ft.option(ft.bool())], `
    testing booloption_neq_2
    func main(a: Option[Bool], b: Option[Bool]) -> Bool {
        a != b
    }`, ([a, b], res) => a.data.isSame(b.data) === !asBool(res));

    await ft.test([ft.option(ft.bool()), ft.option(ft.bool())], `
    testing booloption_neq_2_alt
    func main(a: Option[Bool], b: Option[Bool]) -> Bool {
        a.switch{
            s: Some => s != b,
            n: None => n != b
        }
    }`, ([a, b], res) => a.data.isSame(b.data) === !asBool(res));

    await ft.test([ft.option(ft.bool())], `
    testing booloption_some
    func main(a: Option[Bool]) -> Bool {
        a.switch{
            s: Some => s.some,
            None    => false
        }
    }`, ([a], res) => {
        if (a.data.index == 1) {
            return !asBool(res);
        } else {
            return constrIndex(a.data.fields[0]) === (asBool(res) ? 1 : 0);
        }
    });

    await ft.test([ft.option(ft.bool())], `
    testing booloption_unwrap
    func main(a: Option[Bool]) -> Bool {
        a.unwrap()
    }`, ([a], res) => {
        if (a.data.index == 1) {
            return isError(res, "empty list");
        } else {
            return asBool(a.data.fields[0]) === asBool(res);
        }
    });

    await ft.test([ft.option(ft.bool())], `
    testing booloption_map
    func main(a: Option[Bool]) -> Option[Int] {
        a.map((x: Bool) -> {x.to_int()})
    }`, ([a], res) => {
        if (res instanceof helios.UserError) {
            throw res;
        } else {
            if (a.data.index == 1) {
                return res.data.index == 1;
            } else {
                return (asInt(res.data.fields[0]) == 1n) == asBool(a.data.fields[0])
            }
        }
    });

    await ft.test([ft.option(ft.bool())], `
    testing booloption_map_to_bool
    func main(a: Option[Bool]) -> Option[Bool] {
        a.map((x: Bool) -> {!x})
    }`, ([a], res) => {
        if (a.data.index == 1) {
            return helios_.assertClass(res, helios.UplcValue).data.index == 1;
        } else {
            return asBool(helios_.assertClass(res, helios.UplcValue).data.fields[0]) != asBool(a.data.fields[0]);
        }
    });

    await ft.test([ft.option(ft.bool())], `
    testing booloption_from_data
    func main(a: Data) -> Option[Bool] {
        Option[Bool]::from_data(a)
    }`, ([a], res) => a.data.isSame(asData(res)));

    await ft.test([ft.option(ft.bool())], `
    testing booloption_serialize
    func main(a: Option[Bool]) -> ByteArray {
        a.serialize()
    }`, serializeProp);

    await ft.test([ft.option(ft.bool())], `
    testing option_sub_serialize
    func main(a: Option[Bool]) -> ByteArray {
        a.switch{
            s: Some => s.serialize(),
            n: None => n.serialize()
        }
    }`, serializeProp);


    /////////////
    // Hash tests
    /////////////

    // all hash types are equivalent, so we only need to test one
    
    await ft.test([ft.bytes(0, 1)], `
    testing hash_new
    func main(a: PubKeyHash) -> Bool {
        []ByteArray{#70, #71, #72, #73, #74, #75, #76, #77, #78, #79, #7a, #7b, #7c, #7d, #7e, #7f}.any((ba: ByteArray) -> Bool {
            PubKeyHash::new(ba) == a
        })
    }`, ([a], res) => {
        return [[0x70], [0x71], [0x72], [0x73], [0x74], [0x75], [0x76], [0x77], [0x78], [0x79], [0x7a], [0x7b], [0x7c], [0x7d], [0x7e], [0x7f]].some(ba => equalsList(asBytes(a), ba)) === asBool(res);
    });

    await ft.test([ft.bytes()], `
    testing hash_eq_1
    func main(a: PubKeyHash) -> Bool {
        a == a
    }`, ([_], res) => asBool(res));

    await ft.test([ft.bytes(), ft.bytes()], `
    testing hash_eq_2
    func main(a: PubKeyHash, b: PubKeyHash) -> Bool {
        a == b
    }`, ([a, b], res) => equalsList(asBytes(a), asBytes(b)) === asBool(res));

    await ft.test([ft.bytes()], `
    testing hash_neq_1
    func main(a: PubKeyHash) -> Bool {
        a != a
    }`, ([_], res) => !asBool(res));

    await ft.test([ft.bytes(), ft.bytes()], `
    testing hash_neq_2
    func main(a: PubKeyHash, b: PubKeyHash) -> Bool {
        a != b
    }`, ([a, b], res) => equalsList(asBytes(a), asBytes(b)) === !asBool(res));

    await ft.test([ft.bytes(0, 5), ft.bytes(0, 5)], `
    testing hash_lt_geq
    func main(a: PubKeyHash, b: PubKeyHash) -> Bool {
        (a < b) != (a >= b)
    }`, ([a, b], res) => asBool(res));

    await ft.test([ft.bytes(0, 5), ft.bytes(0, 5)], `
    testing hash_gt_leq
    func main(a: PubKeyHash, b: PubKeyHash) -> Bool {
        (a > b) != (a <= b)
    }`, ([a, b], res) => asBool(res));

    await ft.test([ft.bytes(0, 10)], `
    testing hash_show
    func main(a: PubKeyHash) -> String {
        a.show()
    }`, ([a], res) => {
        let s = Array.from(asBytes(a), byte => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join('');

        return s === asString(res);
    });

    await ft.test([ft.bytes()], `
    testing hash_from_data
    func main(a: Data) -> PubKeyHash {
        PubKeyHash::from_data(a)
    }`, ([a], res) => a.data.isSame(asData(res)));

    await ft.test([ft.bytes()], `
    testing hash_serialize
    func main(a: PubKeyHash) -> ByteArray {
        a.serialize()
    }`, serializeProp);


    ///////////////////
    // AssetClass tests
    ///////////////////

    await ft.test([ft.bytes(0, 1), ft.bytes(0, 1)], `
    testing assetclass_new
    func main(a: ByteArray, b: ByteArray) -> Bool {
        AssetClass::new(MintingPolicyHash::new(a), b) == AssetClass::ADA
    }`, ([a, b], res) => (asBytes(a).length == 0 && asBytes(b).length == 0) === asBool(res));

    await ft.test([ft.bytes(0, 1), ft.bytes(0, 1)], `
    testing assetclass_new
    func main(a: ByteArray, b: ByteArray) -> Bool {
        AssetClass::new(MintingPolicyHash::new(a), b) != AssetClass::ADA
    }`, ([a, b], res) => (asBytes(a).length == 0 && asBytes(b).length == 0) === !asBool(res));

    await ft.test([ft.constr(0, ft.bytes(), ft.bytes())], `
    testing assetclass_from_data
    func main(a: Data) -> AssetClass {
        AssetClass::from_data(a)
    }`, ([a], res) => a.data.isSame(asData(res)));

    await ft.test([ft.bytes(), ft.bytes()], `
    testing assetclass_serialize
    func main(a: ByteArray, b: ByteArray) -> ByteArray {
        AssetClass::new(MintingPolicyHash::new(a), b).serialize()
    }`, ([a, b], res) => {
        let ref = new helios_.ConstrData(0, [new helios_.ByteArrayData(asBytes(a)), new helios_.ByteArrayData(asBytes(b))]);
        return decodeCbor(asBytes(res)).isSame(ref);
    });


    ///////////////////
    // MoneyValue tests
    ///////////////////

    let testValue = true;

    if (testValue) {
        await ft.test([ft.int(-5, 5)], `
        testing value_is_zero
        func main(a: Int) -> Bool {
            Value::lovelace(a).is_zero()
        }`, ([a], res) => (asInt(a) === 0n) === asBool(res));

        await ft.test([ft.int()], `
        testing value_eq_1
        func main(a: Int) -> Bool {
            Value::lovelace(a) == Value::lovelace(a)
        }`, ([_], res) => asBool(res));

        await ft.test([ft.int(), ft.int()], `
        testing value_eq_2
        func main(a: Int, b: Int) -> Bool {
            Value::lovelace(a) == Value::lovelace(b)
        }`, ([a, b], res) => (asInt(a) === asInt(b)) === asBool(res));

        await ft.test([ft.int()], `
        testing value_neq_1
        func main(a: Int) -> Bool {
            Value::lovelace(a) != Value::lovelace(a)
        }`, ([_], res) => !asBool(res));

        await ft.test([ft.int(), ft.int()], `
        testing value_neq_2
        func main(a: Int, b: Int) -> Bool {
            Value::lovelace(a) != Value::lovelace(b)
        }`, ([a, b], res) => (asInt(a) === asInt(b)) === (!asBool(res)));

        await ft.test([ft.int()], `
        testing value_add_0
        func main(a: Int) -> Int {
            (Value::lovelace(a) + Value::ZERO).get(AssetClass::ADA)
        }`, ([a], res) => asInt(a) === asInt(res));

        await ft.test([ft.int(), ft.int()], `
        testing value_add_2
        func main(a: Int, b: Int) -> Int {
            (Value::lovelace(a) + Value::lovelace(b)).get(AssetClass::ADA)
        }`, ([a, b], res) => asInt(a) + asInt(b) === asInt(res));

        await ft.test([ft.int()], `
        testing value_sub_0
        func main(a: Int) -> Int {
            (Value::lovelace(a) - Value::ZERO).get(AssetClass::ADA)
        }`, ([a], res) => asInt(a) === asInt(res));

        await ft.test([ft.int()], `
        testing value_sub_0_alt
        func main(a: Int) -> Int {
            (Value::ZERO - Value::lovelace(a)).get(AssetClass::ADA)
        }`, ([a], res) => asInt(a) === -asInt(res));

        await ft.test([ft.int()], `
        testing value_sub_self
        func main(a: Int) -> Bool {
            (Value::lovelace(a) - Value::lovelace(a)).is_zero()
        }`, ([_], res) => asBool(res));

        await ft.test([ft.int(), ft.int()], `
        testing value_sub_2
        func main(a: Int, b: Int) -> Int {
            (Value::lovelace(a) - Value::lovelace(b)).get(AssetClass::ADA)
        }`, ([a, b], res) => asInt(a) - asInt(b) === asInt(res));

        await ft.test([ft.int()], `
        testing value_mul_1
        func main(a: Int) -> Int {
            (Value::lovelace(a)*1).get(AssetClass::ADA)
        }`, ([a], res) => asInt(a) === asInt(res));

        await ft.test([ft.int(), ft.int()], `
        testing value_mul_2
        func main(a: Int, b: Int) -> Int {
            (Value::lovelace(a)*b).get(AssetClass::ADA)
        }`, ([a, b], res) => asInt(a)*asInt(b) === asInt(res));

        await ft.test([ft.int(), ft.int(), ft.int()], `
        testing value_mul_3
        const MY_NFT: AssetClass = AssetClass::new(MintingPolicyHash::new(#abc), #abc)
        func main(a: Int, b: Int, c: Int) -> Int {
            ((Value::lovelace(a) + Value::new(MY_NFT, b))*c).get(AssetClass::ADA)
        }`, ([a, b, c], res) => asInt(a)*asInt(c) === asInt(res));

        await ft.test([ft.int()],`
        testing value_div_1
        func main(a: Int) -> Int {
            (Value::lovelace(a)/1).get(AssetClass::ADA)
        }`, ([a], res) => asInt(a) === asInt(res));

        await ft.test([ft.int(), ft.int()],`
        testing value_div_2
        func main(a: Int, b: Int) -> Int {
            (Value::lovelace(a)/b).get(AssetClass::ADA)
        }`, ([a, b], res) => {
            if (asInt(b) === 0n) {
                return isError(res, "division by zero");
            } else {
                return asInt(a)/asInt(b) === asInt(res);
            }
        });

        await ft.test([ft.int(), ft.int(), ft.int()],`
        testing value_div_3
        const MY_NFT: AssetClass = AssetClass::new(MintingPolicyHash::new(#abc), #abc)
        func main(a: Int, b: Int, c: Int) -> Int {
            ((Value::lovelace(a) + Value::new(MY_NFT, b))/c).get(AssetClass::ADA)
        }`, ([a, b, c], res) => {
            if (asInt(c) === 0n) {
                return isError(res, "division by zero");
            } else {
                return asInt(a)/asInt(c) === asInt(res);
            }
        });

        await ft.test([ft.int()], `
        testing value_geq_1
        func main(a: Int) -> Bool {
            Value::lovelace(a) >= Value::lovelace(a)
        }`, ([_], res) => asBool(res));

        await ft.test([ft.int(), ft.int()], `
        testing value_geq_2
        func main(a: Int, b: Int) -> Bool {
            Value::lovelace(a) >= Value::lovelace(b)
        }`, ([a, b], res) => (asInt(a) >= asInt(b)) === asBool(res));

        await ft.test([ft.int(), ft.int()], `
        testing value_contains
        func main(a: Int, b: Int) -> Bool {
            Value::lovelace(a).contains(Value::lovelace(b))
        }`, ([a, b], res) => (asInt(a) >= asInt(b)) === asBool(res));

        await ft.test([ft.int()], `
        testing value_gt_1
        func main(a: Int) -> Bool {
            Value::lovelace(a) > Value::lovelace(a)
        }`, ([_], res) => !asBool(res));

        await ft.test([ft.int(), ft.int()], `
        testing value_gt_2
        func main(a: Int, b: Int) -> Bool {
            Value::lovelace(a) > Value::lovelace(b)
        }`, ([a, b], res) => (asInt(a) > asInt(b)) === asBool(res));

        await ft.test([ft.int()], `
        testing value_leq_1
        func main(a: Int) -> Bool {
            Value::lovelace(a) <= Value::lovelace(a)
        }`, ([_], res) => asBool(res));

        await ft.test([ft.int(), ft.int()], `
        testing value_leq_2
        func main(a: Int, b: Int) -> Bool {
            Value::lovelace(a) <= Value::lovelace(b)
        }`, ([a, b], res) => (asInt(a) <= asInt(b)) === asBool(res));

        await ft.test([ft.int()], `
        testing value_lt_1
        func main(a: Int) -> Bool {
            Value::lovelace(a) < Value::lovelace(a)
        }`, ([a], res) => !asBool(res));

        await ft.test([ft.int(), ft.int()], `
        testing value_lt_2
        func main(a: Int, b: Int) -> Bool {
            Value::lovelace(a) < Value::lovelace(b)
        }`, ([a, b], res) => (asInt(a) < asInt(b)) === asBool(res));

        await ft.test([ft.int()], `
        testing value_get
        func main(a: Int) -> Int {
            Value::lovelace(a).get(AssetClass::ADA)
        }`, ([a], res) => asInt(a) === asInt(res));

        await ft.test([ft.int()], `
        testing value_get_safe
        func main(a: Int) -> Int {
            Value::new(AssetClass::new(MintingPolicyHash::new(#1234), #1234), a).get_safe(AssetClass::ADA)
        }`, ([a], res) => 0n === asInt(res));

        await ft.test([ft.int()], `
        testing value_get_lovelace
        func main(a: Int) -> Int {
            v: Value = Value::new(AssetClass::new(MintingPolicyHash::new(#1234), #1234), a) + Value::lovelace(a*2);
            v.get_lovelace()
        }`, ([a], res) => asInt(a)*2n === asInt(res), 10);

        await ft.test([ft.int()], `
        testing value_get_assets
        func main(a: Int) -> Value {
            v: Value = Value::new(AssetClass::new(MintingPolicyHash::new(#1234), #1234), a) + Value::lovelace(a*2);
            v.get_assets()
        }`, ([a], res) => {
            if (res instanceof helios.UplcValue) {
                return res.data.map.length == 1 && res.data.map[0][1].map[0][1].int == asInt(a);
            } else {
                return false;
            }
        });

        await ft.test([ft.bytes(10, 10), ft.string(5,5), ft.int(), ft.string(3,3), ft.int()], `
        testing value_get_policy
        func main(mph_bytes: ByteArray, tn_a: ByteArray, qty_a: Int, tn_b: ByteArray, qty_b: Int) -> Bool {
            sum: Value = Value::new(AssetClass::new(MintingPolicyHash::new(mph_bytes), tn_a), qty_a) + Value::new(AssetClass::new(MintingPolicyHash::new(mph_bytes), tn_b), qty_b);
            sum.get_policy(MintingPolicyHash::new(mph_bytes)) == Map[ByteArray]Int{tn_a: qty_a, tn_b: qty_b}
        }`, ([_], res) => asBool(res));

        await ft.test([ft.bool(), ft.bytes(11, 11), ft.bytes(10, 10), ft.string(5,5), ft.int(), ft.string(3,3), ft.int()], `
        testing value_contains_policy
        func main(pick1: Bool, mph_bytes1: ByteArray, mph_bytes2: ByteArray, tn_a: ByteArray, qty_a: Int, tn_b: ByteArray, qty_b: Int) -> Bool {
            mph_bytes: ByteArray = if (pick1) {mph_bytes1} else {mph_bytes2};
            sum: Value = Value::new(AssetClass::new(MintingPolicyHash::new(mph_bytes1), tn_a), qty_a) + Value::new(AssetClass::new(MintingPolicyHash::new(mph_bytes1), tn_b), qty_b);
            sum.contains_policy(MintingPolicyHash::new(mph_bytes))
        }`, ([pick1, _], res) => asBool(pick1) === asBool(res));

        await ft.test([ft.bytes(11, 11), ft.bytes(10, 10), ft.string(5,5), ft.int(), ft.string(3,3), ft.int()], `
        testing value_show
        func main(mph_bytes1: ByteArray, mph_bytes2: ByteArray, tn_a: ByteArray, qty_a: Int, tn_b: ByteArray, qty_b: Int) -> String {
            sum: Value = Value::new(AssetClass::new(MintingPolicyHash::new(mph_bytes1), tn_a), qty_a) + Value::new(AssetClass::new(MintingPolicyHash::new(mph_bytes2), tn_b), qty_b);
            sum.show()
        }`, ([mph1, mph2, tn_a, qty_a, tn_b, qty_b], res) => {
            const expected = [
                `${helios.bytesToHex(asBytes(mph1))}.${helios.bytesToHex(asBytes(tn_a))}: ${asInt(qty_a)}`,
                `${helios.bytesToHex(asBytes(mph2))}.${helios.bytesToHex(asBytes(tn_b))}: ${asInt(qty_b)}`
            ].join("\n");
            
            const got = helios.bytesToText(asBytes(res));

            return got.trim() == expected.trim();
        }, 5);

        await ft.test([ft.map(ft.bytes(), ft.map(ft.bytes(), ft.int()))], `
        testing value_from_data
        func main(a: Data) -> Value {
            Value::from_data(a)
        }`, ([a], res) => a.data.isSame(asData(res)));

        await ft.test([ft.map(ft.bytes(), ft.map(ft.bytes(), ft.int()))], `
        testing value_from_map
        func main(a: Map[MintingPolicyHash]Map[ByteArray]Int) -> Value {
            Value::from_map(a)
        }`, ([a], res) => a.data.isSame(asData(res)));

        await ft.test([ft.map(ft.bytes(), ft.map(ft.bytes(), ft.int()))], `
        testing value_to_map
        func main(a: Value) -> Int {
            a.to_map().length
        }`, ([a], res) => a.data.map.length === Number(asInt(res)));

        await ft.test([ft.int(), ft.bytes(), ft.bytes()], `
        testing value_serialize
        func main(qty: Int, mph: ByteArray, name: ByteArray) -> ByteArray {
            Value::new(AssetClass::new(MintingPolicyHash::new(mph), name), qty).serialize()
        }`, ([qty, mph, name], res) => {
            let ref = new helios_.MapData([
                [
                    new helios_.ByteArrayData(asBytes(mph)),
                    new helios_.MapData([[
                        new helios_.ByteArrayData(asBytes(name)),
                        new helios_.IntData(asInt(qty)),
                    ]])
                ]
            ]);
            
            return decodeCbor(asBytes(res)).isSame(ref);
        });
    }


    ///////////////
    // Ledger tests
    ///////////////

    const testScriptContext = true;

    if (testScriptContext) {
        await ft.testParams({"QTY": ft.int()}, ["SCRIPT_CONTEXT"], `
        testing scriptcontext_eq
        func main(ctx: ScriptContext) -> Bool {
            ctx == ctx
        }
        ${spendingScriptContextParam(false)}
        `, ([_], res) => asBool(res), 10);

        await ft.testParams({"QTY": ft.int()}, ["SCRIPT_CONTEXT"], `
        testing scriptcontext_neq
        func main(ctx: ScriptContext) -> Bool {
            ctx != ctx
        }
        ${spendingScriptContextParam(false)}
        `, ([_], res) => !asBool(res), 10);

        await ft.testParams({"QTY": ft.int()}, ["SCRIPT_CONTEXT"], `
        testing scriptcontext_tx
        func main(ctx: ScriptContext) -> Tx {
            ctx.tx
        }
        ${spendingScriptContextParam(false)}
        `, ([ctx], res) => ctx.data.fields[0].isSame(asData(res)), 10);

        await ft.testParams({"QTY": ft.int()}, ["SCRIPT_CONTEXT"], `
        testing scriptcontext_get_spending_purpose_output_id
        func main(ctx: ScriptContext) -> TxOutputId {
            ctx.get_spending_purpose_output_id()
        }
        ${spendingScriptContextParam(false)}
        `, ([ctx], res) => ctx.data.fields[1].fields[0].isSame(asData(res)), 10);

        await ft.testParams({"TX_ID_IN_BYTES": ft.bytes()}, ["FIRST_TX_INPUT", "SCRIPT_CONTEXT"], `
        testing scriptcontext_get_current_input
        func main(input: TxInput, ctx: ScriptContext) -> Bool {
            ctx.get_current_input() == input
        }
        ${spendingScriptContextParam(false)}
        `, ([ctx], res) => asBool(res), 10);

        await ft.testParams({"CURRENT_VALIDATOR_BYTES": ft.bytes(), "QTY_2": ft.int()}, ["QTY_2", "SCRIPT_CONTEXT"], `
        testing scriptcontext_get_cont_outputs
        func main(lovelace: Int, ctx: ScriptContext) -> Bool {
            outputs: []TxOutput = ctx.get_cont_outputs();
            outputs.length == 1 && outputs.head.value == Value::lovelace(lovelace)
        }
        ${spendingScriptContextParam(false)}
        `, ([ctx], res) => asBool(res), 5);

        await ft.testParams({"CURRENT_VALIDATOR_BYTES": ft.bytes()}, ["CURRENT_VALIDATOR", "SCRIPT_CONTEXT"], `
        testing scriptcontext_get_current_validator_hash
        func main(hash: ValidatorHash, ctx: ScriptContext) -> Bool {
            ctx.get_current_validator_hash() == hash
        }
        ${spendingScriptContextParam(false)}
        `, ([ctx], res) => asBool(res), 10);

        await ft.testParams({"CURRENT_MPH_BYTES": ft.bytes()}, ["CURRENT_MPH", "SCRIPT_CONTEXT"], `
        testing scriptcontext_get_current_minting_policy_hash
        func main(hash: MintingPolicyHash, ctx: ScriptContext) -> Bool {
            ctx.get_current_minting_policy_hash() == hash
        }
        ${mintingScriptContextParam}
        `, ([ctx], res) => asBool(res), 10);

        await ft.testParams({"CURRENT_STAKING_CRED_BYTES": ft.bytes()}, ["CURRENT_STAKING_CRED", "SCRIPT_CONTEXT"], `
        testing scriptcontext_get_staking_purpose
        func main(cred: StakingCredential, ctx: ScriptContext) -> Bool {
            ctx.get_staking_purpose().switch{
                r: Rewarding => r.credential == cred,
                Certifying => false
            }
        }
        ${rewardingScriptContextParam}
        `, ([ctx], res) => asBool(res), 10);

        await ft.testParams({"CURRENT_VALIDATOR_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing scriptcontext_from_data
        func main(ctx: Data) -> ScriptContext {
            ScriptContext::from_data(ctx)
        }
        ${spendingScriptContextParam(false)}
        `, ([ctx], res) => asData(res).isSame(ctx.data), 10);

        await ft.testParams({"CURRENT_VALIDATOR_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing scriptcontext_serialize
        func main(ctx: ScriptContext) -> ByteArray {
            ctx.serialize()
        }
        ${spendingScriptContextParam(false)}
        `, serializeProp, 10);
    }

    const testStakingPurpose = true;

    if (testStakingPurpose) {
        await ft.testParams({"CURRENT_STAKING_CRED_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing stakingpurpose_eq
        func main(ctx: ScriptContext) -> Bool {
            sp: StakingPurpose = ctx.get_staking_purpose();
            sp == sp
        }
        ${rewardingScriptContextParam}
        `, ([_], res) => asBool(res), 5);

        await ft.testParams({"CURRENT_STAKING_CRED_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing stakingpurpose_neq
        func main(ctx: ScriptContext) -> Bool {
            sp: StakingPurpose = ctx.get_staking_purpose();
            sp != sp
        }
        ${certifyingScriptContextParam}
        `, ([_], res) => !asBool(res), 5);

        await ft.testParams({"CURRENT_STAKING_CRED_BYTES": ft.bytes()}, ["STAKING_PURPOSE"], `
        testing stakingpurpose_from_data
        func main(sp: Data) -> StakingPurpose {
            StakingPurpose::from_data(sp)
        }
        ${rewardingScriptContextParam}
        `, ([sp], res) => sp.data.isSame(asData(res)), 5);

        await ft.testParams({"CURRENT_STAKING_CRED_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing stakingpurpose_serialize
        func main(ctx: ScriptContext) -> ByteArray {
            ctx.get_staking_purpose().serialize()
        }
        ${rewardingScriptContextParam}
        `, ([ctx], res) => {
            return decodeCbor(asBytes(res)).isSame(ctx.data.fields[1]);
        }, 5);

        await ft.testParams({"CURRENT_STAKING_CRED_BYTES": ft.bytes()}, ["STAKING_PURPOSE"], `
        testing stakingpurpose_rewarding_eq
        func main(sp: StakingPurpose::Rewarding) -> Bool {
            sp == sp
        }
        ${rewardingScriptContextParam}
        `, ([_], res) => asBool(res), 5);

        await ft.testParams({"CURRENT_STAKING_CRED_BYTES": ft.bytes()}, ["STAKING_PURPOSE"], `
        testing stakingpurpose_rewarding_neq
        func main(sp: StakingPurpose::Rewarding) -> Bool {
            sp != sp
        }
        ${rewardingScriptContextParam}
        `, ([_], res) => !asBool(res), 5);

        await ft.testParams({"CURRENT_STAKING_CRED_BYTES": ft.bytes()}, ["STAKING_PURPOSE"], `
        testing stakingpurpose_rewarding_serialize
        func main(sp: StakingPurpose::Rewarding) -> ByteArray {
        sp.serialize()
        }
        ${rewardingScriptContextParam}
        `, serializeProp, 5);

        await ft.testParams({"CURRENT_STAKING_CRED_BYTES": ft.bytes()}, ["STAKING_PURPOSE"], `
        testing stakingpurpose_certifying_eq
        func main(sp: StakingPurpose::Certifying) -> Bool {
            sp == sp
        }
        ${certifyingScriptContextParam}
        `, ([_], res) => asBool(res), 5);

        await ft.testParams({"CURRENT_STAKING_CRED_BYTES": ft.bytes()}, ["STAKING_PURPOSE"], `
        testing stakingpurpose_certifying_neq
        func main(sp: StakingPurpose::Certifying) -> Bool {
            sp != sp
        }
        ${certifyingScriptContextParam}
        `, ([_], res) => !asBool(res), 5);

        await ft.testParams({"CURRENT_STAKING_CRED_BYTES": ft.bytes()}, ["STAKING_PURPOSE"], `
        testing stakingpurpose_certifying_dcert
        func main(sp: StakingPurpose::Certifying) -> Bool {
            sp.dcert == sp.dcert
        }
        ${certifyingScriptContextParam}
        `, ([_], res) => asBool(res), 5);

        await ft.testParams({"CURRENT_STAKING_CRED_BYTES": ft.bytes()}, ["STAKING_PURPOSE"], `
        testing stakingpurpose_certifying_serialize
        func main(sp: StakingPurpose::Certifying) -> ByteArray {
        sp.serialize()
        }
        ${certifyingScriptContextParam}
        `, serializeProp, 5);
    }

    const testDCert = true;

    if (testDCert) {
        await ft.testParams({"CURRENT_STAKING_CRED_BYTES": ft.bytes()}, ["CURRENT_DCERT"], `
        testing dcert_eq
        func main(dcert: DCert) -> Bool {
            dcert == dcert
        }
        ${certifyingScriptContextParam}
        `, ([_], res) => asBool(res), 5);

        await ft.testParams({"CURRENT_STAKING_CRED_BYTES": ft.bytes()}, ["CURRENT_DCERT"], `
        testing dcert_neq
        func main(dcert: DCert) -> Bool {
            dcert != dcert
        }
        ${certifyingScriptContextParam}
        `, ([_], res) => !asBool(res), 5);

        await ft.testParams({"CURRENT_STAKING_CRED_BYTES": ft.bytes()}, ["CURRENT_DCERT"], `
        testing dcert_from_data
        func main(dcert: Data) -> DCert {
            DCert::from_data(dcert)
        }
        ${certifyingScriptContextParam}
        `, ([a], res) => a.data.isSame(asData(res)), 5);

        await ft.testParams({"CURRENT_STAKING_CRED_BYTES": ft.bytes()}, ["CURRENT_DCERT"], `
        testing dcert_serialize
        func main(dcert: DCert) -> ByteArray {
            dcert.serialize()
        }
        ${certifyingScriptContextParam}
        `, serializeProp, 5);

        await ft.testParams({"CURRENT_STAKING_CRED_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing dcert_member_eq
        func main(ctx: ScriptContext) -> Bool {
            ctx.tx.dcerts.all((dcert: DCert) -> Bool {
                dcert.switch{
                    r: Register => r == r,
                    d: Deregister => d == d,
                    del: Delegate => del == del,
                    rp: RegisterPool => rp == rp,
                    ret: RetirePool => ret == ret
                }
            })
        }
        ${certifyingScriptContextParam}
        `, ([_], res) => asBool(res), 5);

        await ft.testParams({"CURRENT_STAKING_CRED_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing dcert_member_neq
        func main(ctx: ScriptContext) -> Bool {
            ctx.tx.dcerts.any((dcert: DCert) -> Bool {
                dcert.switch{
                    r: Register => r != r,
                    d: Deregister => d != d,
                    del: Delegate => del != del,
                    rp: RegisterPool => rp != rp,
                    ret: RetirePool => ret != ret
                }
            })
        }
        ${certifyingScriptContextParam}
        `, ([_], res) => !asBool(res), 5);

        await ft.testParams({"CURRENT_STAKING_CRED_BYTES": ft.bytes()}, ["CURRENT_STAKING_CRED", "POOL_ID", "POOL_VFR", "EPOCH", "SCRIPT_CONTEXT"], `
        testing dcert_member_fields
        func main(staking_cred: StakingCredential, pool_id: PubKeyHash, pool_vrf: PubKeyHash, epoch: Int, ctx: ScriptContext) -> Bool {
            ctx.tx.dcerts.any((dcert: DCert) -> Bool {
                dcert.switch{
                    r: Register => r.credential == staking_cred,
                    d: Deregister => d.credential == staking_cred,
                    del: Delegate => del.delegator == staking_cred && del.pool_id == pool_id,
                    rp: RegisterPool => rp.pool_id == pool_id && rp.pool_vrf == pool_vrf,
                    ret: RetirePool => ret.pool_id == pool_id && ret.epoch == epoch
                }
            })
        }
        ${certifyingScriptContextParam}
        `, ([a], res) => asBool(res), 5);

        await ft.testParams({"CURRENT_STAKING_CRED_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing dcert_member_serialize
        func main(ctx: ScriptContext) -> []ByteArray {
            ctx.tx.dcerts.map((dcert: DCert) -> ByteArray {
                dcert.switch{
                    r: Register => r.serialize(),
                    d: Deregister => d.serialize(),
                    del: Delegate => del.serialize(),
                    rp: RegisterPool => rp.serialize(),
                    ret: RetirePool => ret.serialize()
                }
            })
        }
        ${certifyingScriptContextParam}
        `, ([ctx], res) => {
            return asData(res).list.every((d, i) => {
                let ref = ctx.data.fields[0].fields[5].list[i];
                return decodeCbor(asBytes(d)).isSame(ref);
            });
        }, 5);
    }

    const testTx = true;

    if (testTx) {
        await ft.testParams({"QTY": ft.int()}, ["SCRIPT_CONTEXT"], `
        testing tx_eq
        func main(ctx: ScriptContext) -> Bool {
            ctx.tx == ctx.tx
        }
        ${spendingScriptContextParam(false)}
        `, ([_], res) => asBool(res), 10);

        await ft.testParams({"QTY": ft.int()}, ["SCRIPT_CONTEXT"], `
        testing tx_neq
        func main(ctx: ScriptContext) -> Bool {
            ctx.tx != ctx.tx
        }
        ${spendingScriptContextParam(false)}
        `, ([_], res) => !asBool(res), 10);

        // test if transaction is balanced (should always be true)
        await ft.testParams({"QTY": ft.int()}, ["SCRIPT_CONTEXT"], `
        testing tx_is_balanced
        func main(ctx: ScriptContext) -> Bool {
            ctx.tx.inputs.fold((a: Value, b: TxInput) -> Value {
                a + b.output.value
            }, Value::ZERO) + ctx.tx.minted == ctx.tx.fee + ctx.tx.outputs.fold((a: Value, b: TxOutput) -> Value {
                a + b.value
            }, Value::ZERO)
        }
        ${spendingScriptContextParam(false)}
        `, ([_], res) => asBool(res), 3);

        await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing tx_ref_inputs
        func main(ctx: ScriptContext) -> Bool {
            ctx.tx.ref_inputs.length > 0
        }
        ${spendingScriptContextParam(false)}
        `, ([_], res) => asBool(res), 5);

        // test if a signatory also sent some outputs self
        await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing tx_signatories
        func main(ctx: ScriptContext) -> Bool {
            ctx.tx.signatories.all((s: PubKeyHash) -> Bool {
                ctx.tx.outputs.any((o: TxOutput) -> Bool {
                    o.address.credential.switch{
                        c: PubKey => c.hash == s,
                        else => false
                    }
                })
            })
        }
        ${spendingScriptContextParam(false)}
        `, ([_], res) => asBool(res), 4);

        await ft.testParams({"QTY": ft.int(200000, 3000000)}, ["CURRENT_TX_ID", "SCRIPT_CONTEXT"], `
        testing tx_id
        func main(tx_id: TxId, ctx: ScriptContext) -> Bool {
            ctx.tx.id == tx_id
        }
        ${spendingScriptContextParam(false)}
        `, ([ctx], res) => asBool(res), 5);

        await ft.testParams({"QTY": ft.int()}, ["SCRIPT_CONTEXT"], `
        testing tx_time_range
        func main(ctx: ScriptContext) -> Bool {
            ctx.tx.time_range.contains(ctx.tx.time_range.start + Duration::new(10))
        }
        ${spendingScriptContextParam(false)}
        `, ([_], res) => asBool(res), 10);

        await ft.testParams({"QTY": ft.int()}, ["SCRIPT_CONTEXT"], `
        testing tx_time_range
        func main(ctx: ScriptContext) -> Bool {
            ctx.tx.time_range.contains(ctx.tx.time_range.end - Duration::new(10))
        }
        ${spendingScriptContextParam(false)}
        `, ([_], res) => asBool(res), 10);

        await ft.testParams({"CURRENT_STAKING_CRED_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing tx_dcerts
        func main(ctx: ScriptContext) -> Bool {
            ctx.tx.dcerts.length > 0
        }
        ${certifyingScriptContextParam}
        `, ([_], res) => asBool(res), 5);

        await ft.testParams({"CURRENT_STAKING_CRED_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing tx_withdrawals
        func main(ctx: ScriptContext) -> Bool {
            ctx.tx.withdrawals.length > 0
        }
        ${rewardingScriptContextParam}
        `, ([_], res) => asBool(res), 5);
        
        await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing tx_outputs_sent_to
        func main(ctx: ScriptContext) -> Bool {
            if (ctx.tx.signatories.is_empty()) {
                true
            } else {
                ctx.tx.outputs_sent_to(ctx.tx.signatories.head).length > 0
            }
        }
        ${spendingScriptContextParam(false)}
        `, ([_], res) => asBool(res), 5);

        
        await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing tx_outputs_sent_to_datum
        func main(ctx: ScriptContext) -> Bool {
            if (ctx.tx.signatories.is_empty()) {
                true
            } else {
                ctx.tx.outputs_sent_to_datum(ctx.tx.signatories.head, 42, false).length > 0
            }
        }
        ${spendingScriptContextParam(false)}
        `, ([_], res) => asBool(res), 5);

        await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing tx_outputs_sent_to_datum
        func main(ctx: ScriptContext) -> Bool {
            if (ctx.tx.signatories.is_empty()) {
                true
            } else {
                ctx.tx.outputs_sent_to_datum(ctx.tx.signatories.head, 42, true).length > 0
            }
        }
        ${spendingScriptContextParam(true)}
        `, ([_], res) => asBool(res), 5);


        await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing tx_outputs_locked_by
        func main(ctx: ScriptContext) -> Bool {
            h: ValidatorHash = ctx.get_current_validator_hash();
            ctx.tx.outputs_locked_by(h) == ctx.tx.outputs.filter((o: TxOutput) -> Bool {
                o.address.credential.switch{
                    Validator => true,
                    else => false
                }
            })
        }
        ${spendingScriptContextParam(false)}
        `, ([_], res) => asBool(res), 5);

        await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing tx_outputs_locked_by_datum
        func main(ctx: ScriptContext) -> Bool {
            h: ValidatorHash = ctx.get_current_validator_hash();
            ctx.tx.outputs_locked_by_datum(h, 42, false) == ctx.tx.outputs.filter((o: TxOutput) -> Bool {
                o.address.credential.switch{
                    Validator => true,
                    else => false
                }
            })
        }
        ${spendingScriptContextParam(false)}
        `, ([_], res) => asBool(res), 5);

        await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing tx_outputs_locked_by_datum
        func main(ctx: ScriptContext) -> Bool {
            h: ValidatorHash = ctx.get_current_validator_hash();
            ctx.tx.outputs_locked_by_datum(h, 42, true) == ctx.tx.outputs.filter((o: TxOutput) -> Bool {
                o.address.credential.switch{
                    Validator => true,
                    else => false
                }
            })
        }
        ${spendingScriptContextParam(true)}
        `, ([_], res) => asBool(res), 5);

        await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing tx_value_sent_to
        func main(ctx: ScriptContext) -> Bool {
            if (ctx.tx.signatories.is_empty()) {
                true
            } else {
                h: PubKeyHash = ctx.tx.signatories.head;
                ctx.tx.value_sent_to(h) == ctx.tx.outputs.fold((sum: Value, o: TxOutput) -> Value {
                    sum + if (o.address.credential.switch{p: PubKey => p.hash == h, else => false}) {o.value} else {Value::ZERO}
                }, Value::ZERO)
            }
        }
        ${spendingScriptContextParam(false)}
        `, ([_], res) => asBool(res), 5);

        await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["DATUM_HASH_1", "SCRIPT_CONTEXT"], `
        testing tx_value_sent_to_datum
        func main(datum_hash: DatumHash, ctx: ScriptContext) -> Bool {
            if (ctx.tx.signatories.is_empty()) {
                true
            } else {
                h: PubKeyHash = ctx.tx.signatories.head;
                ctx.tx.value_sent_to_datum(h, 42, false) == ctx.tx.outputs.fold((sum: Value, o: TxOutput) -> Value {
                    sum + if (
                        o.address.credential.switch{p: PubKey => p.hash == h, else => false} && 
                        o.datum.switch{ha: Hash => ha.hash == datum_hash, None => false, Inline => false}
                    ) {
                        o.value
                    } else {
                        Value::ZERO
                    }
                }, Value::ZERO)
            }
        }
        ${spendingScriptContextParam(false)}
        `, ([_], res) => asBool(res), 5);

        await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["DATUM_1", "SCRIPT_CONTEXT"], `
        testing tx_value_sent_to_datum
        func main(datum: Int, ctx: ScriptContext) -> Bool {
            if (ctx.tx.signatories.is_empty()) {
                true
            } else {
                h: PubKeyHash = ctx.tx.signatories.head;
                ctx.tx.value_sent_to_datum(h, 42, true) == ctx.tx.outputs.fold((sum: Value, o: TxOutput) -> Value {
                    sum + if (
                        o.address.credential.switch{p: PubKey => p.hash == h, else => false} && 
                        o.datum.switch{Hash => false, None => false, in: Inline => Int::from_data(in.data) == datum}
                    ) {
                        o.value
                    } else {
                        Value::ZERO
                    }
                }, Value::ZERO)
            }
        }
        ${spendingScriptContextParam(true)}
        `, ([_], res) => asBool(res), 5);

        await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing tx_value_locked_by
        func main(ctx: ScriptContext) -> Bool {
            h: ValidatorHash = ctx.get_current_validator_hash();
            ctx.tx.value_locked_by(h) == ctx.tx.outputs.fold((sum: Value, o: TxOutput) -> Value {
                sum + if (o.address.credential.switch{v: Validator => v.hash == h, else => false}) {o.value} else {Value::ZERO}
            }, Value::ZERO)
        }
        ${spendingScriptContextParam(false)}
        `, ([_], res) => asBool(res), 5);

        await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["DATUM_HASH_1", "SCRIPT_CONTEXT"],`
        testing tx_value_locked_by_datum
        func main(datum_hash: DatumHash, ctx: ScriptContext) -> Bool {
            h: ValidatorHash = ctx.get_current_validator_hash();
            (ctx.tx.value_locked_by_datum(h, 42, false) == ctx.tx.outputs.fold((a: Value, o: TxOutput) -> Value {
                a + if (
                    o.address.credential.switch{v: Validator => v.hash == h, else => false} && 
                    o.datum.switch{ha: Hash => ha.hash == datum_hash, None => false, Inline => false}
                ) {
                    o.value
                } else {
                    Value::ZERO
                }
            }, Value::ZERO))
        }
        ${spendingScriptContextParam(false)}
        `, ([_], res) => asBool(res), 5);

        await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["DATUM_1", "SCRIPT_CONTEXT"],`
        testing tx_value_locked_by_datum
        func main(datum: Int, ctx: ScriptContext) -> Bool {
            h: ValidatorHash = ctx.get_current_validator_hash();
            (ctx.tx.value_locked_by_datum(h, 42, true) == ctx.tx.outputs.fold((a: Value, o: TxOutput) -> Value {
                a + if (
                    o.address.credential.switch{v: Validator => v.hash == h, else => false} && 
                    o.datum.switch{Hash => false, None => false, in: Inline => Int::from_data(in.data) == datum}
                ) {
                    o.value
                } else {
                    Value::ZERO
                }
            }, Value::ZERO))
        }
        ${spendingScriptContextParam(true)}
        `, ([_], res) => asBool(res), 5);


        await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing tx_is_signed_by
        func main(ctx: ScriptContext) -> Bool {
            if (ctx.tx.signatories.is_empty()) {
                true
            } else {
                ctx.tx.is_signed_by(ctx.tx.signatories.head)
            }
        }
        ${spendingScriptContextParam(false)}
        `, ([ctx], res) => asBool(res), 5);

        await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["TX"], `
        testing tx_from_data
        func main(tx: Data) -> Tx {
            Tx::from_data(tx)
        }
        ${spendingScriptContextParam(false)}
        `, ([tx], res) => asData(res).isSame(tx.data), 5);

        await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing tx_serialize
        func main(ctx: ScriptContext) -> ByteArray {
            ctx.tx.serialize()
        }
        ${spendingScriptContextParam(false)}
        `, ([ctx], res) => {
            return decodeCbor(asBytes(res)).isSame(ctx.data.fields[0]);
        }, 5);

        await ft.testParams({"DATUM_1": ft.int()}, ["DATUM_1", "SCRIPT_CONTEXT"], `
        testing tx_get_datum_data_hash
        func main(data: Data, ctx: ScriptContext) -> Bool {
            ctx.tx.get_datum_data(ctx.tx.outputs.tail.head) == data
        }
        ${spendingScriptContextParam(false)}
        `, ([d, ctx], res) => {
            return asBool(res);
        }, 2);

        await ft.testParams({"DATUM_1": ft.int()}, ["DATUM_1", "SCRIPT_CONTEXT"], `
        testing tx_get_datum_data_inline
        func main(data: Data, ctx: ScriptContext) -> Bool {
            ctx.tx.get_datum_data(ctx.tx.outputs.tail.head) == data
        }
        ${spendingScriptContextParam(true)}
        `, ([d, ctx], res) => {
            return asBool(res);
        }, 2);
    }

    await ft.testParams({"QTY": ft.int()}, ["SCRIPT_CONTEXT"], `
    testing txid_eq
    func main(ctx: ScriptContext) -> Bool {
        ctx.tx.id == ctx.tx.id
    }
    ${spendingScriptContextParam(false)}
    `, ([_], res) => asBool(res), 2);

    await ft.testParams({"QTY": ft.int()}, ["SCRIPT_CONTEXT"], `
    testing txid_neq
    func main(ctx: ScriptContext) -> Bool {
        ctx.tx.id != ctx.tx.id
    }
    ${spendingScriptContextParam(false)}
    `, ([_], res) => !asBool(res), 2);

    await ft.test([ft.bytes(0, 3), ft.bytes(0, 3)], `
    testing txid_lt_geq
    func main(as: ByteArray, bs: ByteArray) -> Bool {
        a = TxId::new(as);
        b = TxId::new(bs);
        (a < b) != (a >= b)
    }`, ([a, b], res) => asBool(res));

    await ft.test([ft.bytes(0, 3), ft.bytes(0, 3)], `
    testing txid_gt_leq
    func main(as: ByteArray, bs: ByteArray) -> Bool {
        a = TxId::new(as);
        b = TxId::new(bs);
        (a > b) != (a <= b)
    }`, ([a, b], res) => asBool(res));

    await ft.test([ft.bytes()], `
    testing txid_show
    func main(bs: ByteArray) -> String {
        TxId::new(bs).show()
    }`, ([a], res) => {
        return helios.bytesToHex(asBytes(a)) === asString(res);
    });
    await ft.testParams({"QTY": ft.int()}, ["CURRENT_TX_ID"], `
    testing txid_from_data
    func main(tx_id: Data) -> TxId {
        TxId::from_data(tx_id)
    }
    ${spendingScriptContextParam(false)}
    `, ([txId], res) => asData(res).isSame(txId.data), 2);

    await ft.testParams({"QTY": ft.int()}, ["CURRENT_TX_ID"], `
    testing txid_serialize
    func main(tx_id: TxId) -> ByteArray {
        tx_id.serialize()
    }
    ${spendingScriptContextParam(false)}
    `, serializeProp, 2);

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
    testing txinput_eq_neq
    func main(ctx: ScriptContext) -> Bool {
        if (ctx.tx.inputs.length == 1) {
            ctx.tx.inputs.head == ctx.tx.inputs.get(0)
        } else {
            ctx.tx.inputs.head != ctx.tx.inputs.get(1)
        }
    }
    ${spendingScriptContextParam(false)}
    `, ([_], res) => asBool(res), 5);

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["FIRST_TX_INPUT"], `
    testing txinput_from_data
    func main(txinput: Data) -> TxInput {
        TxInput::from_data(txinput)
    }
    ${spendingScriptContextParam(false)}
    `, ([a], res) => a.data.isSame(asData(res)), 5);

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
    testing txinput_serialize
    func main(ctx: ScriptContext) -> ByteArray {
        ctx.tx.inputs.head.serialize()
    }
    ${spendingScriptContextParam(false)}
    `, ([ctx], res) => {
        return decodeCbor(asBytes(res)).isSame(ctx.data.fields[0].fields[0].list[0]);
    }, 5);

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
    testing txoutput_eq_neq
    func main(ctx: ScriptContext) -> Bool {
        if (ctx.tx.outputs.length == 1) {
            ctx.tx.outputs.head == ctx.tx.outputs.get(0)
        } else {
            ctx.tx.outputs.head != ctx.tx.outputs.get(1)
        }
    }
    ${spendingScriptContextParam(false)}
    `, ([_], res) => asBool(res), 5);

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
    testing txoutput_datum
    func main(ctx: ScriptContext) -> Bool {
        ctx.tx.outputs.head.datum.switch{
            n: None => n == n,
            h: Hash => h == h && h.hash == h.hash,
            i: Inline => i == i && i.data == i.data
        }
    }
    ${spendingScriptContextParam(false)}
    `, ([_], res) => asBool(res), 5);

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
    testing txoutput_datum
    func main(ctx: ScriptContext) -> Bool {
        ctx.tx.outputs.head.datum.switch{
            n: None => n == n,
            h: Hash => h == h && h.hash == h.hash,
            i: Inline => i == i && i.data == i.data
        }
    }
    ${spendingScriptContextParam(true)}
    `, ([_], res) => asBool(res), 5);

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["FIRST_TX_OUTPUT"], `
    testing txoutput_from_data
    func main(data: Data) -> TxOutput {
        TxOutput::from_data(data)
    }
    ${spendingScriptContextParam(false)}
    `, ([a], res) => a.data.isSame(asData(res)), 5);

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
    testing txoutput_serialize
    func main(ctx: ScriptContext) -> ByteArray {
        ctx.tx.outputs.head.serialize()
    }
    ${spendingScriptContextParam(false)}
    `, ([ctx], res) => {
        return decodeCbor(asBytes(res)).isSame(ctx.data.fields[0].fields[2].list[0]);
    }, 5);

    const testOutputDatum = true;

    if (testOutputDatum) {
        await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing outputdatum_eq
        func main(ctx: ScriptContext) -> Bool {
            od: OutputDatum = ctx.tx.outputs.head.datum;
            od == od
        }
        ${spendingScriptContextParam(false)}
        `, ([_], res) => asBool(res), 2);

        await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing outputdatum_eq
        func main(ctx: ScriptContext) -> Bool {
            od: OutputDatum = ctx.tx.outputs.head.datum;
            od == od
        }
        ${spendingScriptContextParam(true)}
        `, ([_], res) => asBool(res), 2);

        await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing outputdatum_neq
        func main(ctx: ScriptContext) -> Bool {
            od: OutputDatum = ctx.tx.outputs.head.datum;
            od != od
        }
        ${spendingScriptContextParam(false)}
        `, ([_], res) => !asBool(res), 2);

        await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
        testing outputdatum_neq
        func main(ctx: ScriptContext) -> Bool {
            od: OutputDatum = ctx.tx.outputs.head.datum;
            od != od
        }
        ${spendingScriptContextParam(true)}
        `, ([_], res) => !asBool(res), 2);

        await ft.testParams({"INLINE_DATUM": ft.int()}, ["OUTPUT_DATUM"], `
        testing outputdatum_from_data
        func main(data: Data) -> OutputDatum {
            OutputDatum::from_data(data)
        }
        const INLINE_DATUM = 0

        const OUTPUT_DATUM: OutputDatum = OutputDatum::new_inline(INLINE_DATUM)
        `, ([a], res) => a.data.isSame(asData(res)), 5);

        await ft.testParams({"INLINE_DATUM": ft.int()}, ["OUTPUT_DATUM"], `
        testing outputdatum_serialize
        func main(od: OutputDatum) -> ByteArray {
            od.serialize()
        }
        const INLINE_DATUM = 0

        const OUTPUT_DATUM: OutputDatum = OutputDatum::new_inline(INLINE_DATUM)
        `, serializeProp, 5);

        const outputDatumParam = `
        const CONSTR_INDEX = 0
        const INLINE_DATA = 0
        const DATUM_HASH_BYTES = #
        const DATUM_HASH: DatumHash = DatumHash::new(DATUM_HASH_BYTES)

        const OUTPUT_DATUM: OutputDatum = if (CONSTR_INDEX == 0) {
            OutputDatum::new_none()
        } else if (CONSTR_INDEX == 1) {
            OutputDatum::new_hash(DATUM_HASH)
        } else {
            OutputDatum::new_inline(INLINE_DATA)
        }`;

        await ft.testParams({"CONSTR_INDEX": ft.int(0, 3), "INLINE_DATA": ft.int(), "DATUM_HASH_BYTES": ft.bytes()}, ["DATUM_HASH", "INLINE_DATA", "OUTPUT_DATUM"], `
        testing outputdatum_eq
        func main(datum_hash: DatumHash, inline_data: Data, od: OutputDatum) -> Bool {
            od.switch{
                n: None => n == n,
                dh: Hash => dh == dh && dh.hash == datum_hash,
                in: Inline => in == in && in.data == inline_data && inline_data == od.get_inline_data()
            }
        }
        ${outputDatumParam}
        `, ([_], res) => asBool(res), 10);

        await ft.testParams({"CONSTR_INDEX": ft.int(0, 3), "INLINE_DATA": ft.int(), "DATUM_HASH_BYTES": ft.bytes()}, ["OUTPUT_DATUM"], `
        testing outputdatum_neq
        func main(od: OutputDatum) -> Bool {
            od.switch{
                n: None => n != n,
                dh: Hash => dh != dh,
                in: Inline => in != in
            }
        }
        ${outputDatumParam}
        `, ([_], res) => !asBool(res), 10);

        await ft.testParams({"CONSTR_INDEX": ft.int(0, 3), "INLINE_DATA": ft.int(), "DATUM_HASH_BYTES": ft.bytes()}, ["OUTPUT_DATUM"], `
        testing outputdatum_serialize
        func main(od: OutputDatum) -> ByteArray {
            od.switch{
                n: None => n.serialize(),
                dh: Hash => dh.serialize(),
                in: Inline => in.serialize()
            }
        }
        ${outputDatumParam}
        `, serializeProp, 10);
    }

    await ft.testParams({"DATA": ft.int()}, ["DATA"], `
    testing data_eq
    func main(data: Data) -> Bool {
        data == data
    }
    const DATA = 0
    `, ([_], res) => asBool(res), 10);

    await ft.testParams({"DATA": ft.int()}, ["DATA"], `
    testing data_neq
    func main(data: Data) -> Bool {
        data != data
    }
    const DATA = 0
    `, ([_], res) => !asBool(res), 10);

    await ft.testParams({"DATA": ft.int()}, ["DATA"], `
    testing data_serialize
    func main(data: Data) -> ByteArray {
        data.serialize()
    }
    const DATA = 0
    `, serializeProp, 10);

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
    testing txoutputid_eq_neq
    func main(ctx: ScriptContext) -> Bool {
        if (ctx.tx.inputs.length == 1) {
            ctx.tx.inputs.head.output_id == ctx.tx.inputs.get(0).output_id
        } else {
            ctx.tx.inputs.head.output_id != ctx.tx.inputs.get(1).output_id
        }
    }
    ${spendingScriptContextParam(false)}
    `, ([_], res) => asBool(res), 5);

    await ft.test([ft.bytes(0, 3), ft.int(0, 2)], `
    testing txoutputid_txid
    func main(as: ByteArray, ai: Int) -> Bool {
        a = TxOutputId::new(TxId::new(as), ai);
        TxId::new(as) == a.tx_id
    }`, ([a, b], res) => asBool(res));

    await ft.test([ft.bytes(0, 3), ft.int(0, 2)], `
    testing txoutputid_index
    func main(as: ByteArray, ai: Int) -> Bool {
        a = TxOutputId::new(TxId::new(as), ai);
        ai == a.index
    }`, ([a, b], res) => asBool(res));

    await ft.test([ft.bytes(0, 3), ft.int(0, 2), ft.bytes(0, 3), ft.int(0, 2)], `
    testing txoutputid_lt_geq
    func main(as: ByteArray, ai: Int, bs: ByteArray, bi: Int) -> Bool {
        a = TxOutputId::new(TxId::new(as), ai);
        b = TxOutputId::new(TxId::new(bs), bi);
        (a < b) != (a >= b)
    }`, ([a, b], res) => asBool(res));

    await ft.test([ft.bytes(0, 3), ft.int(0, 2), ft.bytes(0, 3), ft.int(0, 2)], `
    testing txoutputid_gt_leq
    func main(as: ByteArray, ai: Int, bs: ByteArray, bi: Int) -> Bool {
        a = TxOutputId::new(TxId::new(as), ai);
        b = TxOutputId::new(TxId::new(bs), bi);
        (a > b) != (a <= b)
    }`, ([a, b], res) => asBool(res));

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
    testing txoutputid_new
    func main(ctx: ScriptContext) -> Bool {
        ctx.tx.inputs.head.output_id != TxOutputId::new(TxId::new(#1234), 0)
    }
    ${spendingScriptContextParam(false)}
    `, ([_], res) => asBool(res), 5);

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["TX_OUTPUT_ID_IN"], `
    testing txoutputid_from_data
    func main(data: Data) -> TxOutputId {
        TxOutputId::from_data(data)
    }
    ${spendingScriptContextParam(false)}
    `, ([a], res) => a.data.isSame(asData(res)), 5);

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
    testing txoutputid_serialize
    func main(ctx: ScriptContext) -> ByteArray {
        ctx.tx.inputs.head.output_id.serialize()
    }
    ${spendingScriptContextParam(false)}
    `, ([ctx], res) => {
        return decodeCbor(asBytes(res)).isSame(ctx.data.fields[0].fields[0].list[0].fields[0]);
    }, 5);

    await ft.test([], `
    testing address_new_empty
    func main() -> Bool {
        a = Address::new_empty();
        a.credential.switch{
            pk: PubKey => pk.hash == PubKeyHash::new(#),
            else => error("unexpected")
        } &&
        a.staking_credential.switch{
            None => true,
            else => error("unexpected")
        }
    }`, ([], res) => asBool(res), 1);

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
    testing address_eq
    func main(ctx: ScriptContext) -> Bool {
        ctx.tx.inputs.head.output.address == ctx.tx.inputs.get(0).output.address
    }
    ${spendingScriptContextParam(false)}
    `, ([_], res) => asBool(res), 5);

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
    testing address_neq
    func main(ctx: ScriptContext) -> Bool {
        ctx.tx.inputs.head.output.address != ctx.tx.inputs.get(0).output.address
    }
    ${spendingScriptContextParam(false)}
    `, ([_], res) => !asBool(res), 5);

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["STAKING_CRED_IN", "SCRIPT_CONTEXT"], `
    testing address_staking_credential
    func main(staking_cred: Option[StakingCredential], ctx: ScriptContext) -> Bool {
        ctx.tx.inputs.head.output.address.staking_credential == staking_cred
    }
    ${spendingScriptContextParam(false)}
    `, ([a], res) => asBool(res), 3);

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["ADDRESS"], `
    testing address_from_data
    func main(data: Data) -> Address {
        Address::from_data(data)
    }
    const PUB_KEY_HASH_BYTES = #
    const ADDRESS: Address = Address::new(Credential::new_pubkey(PubKeyHash::new(PUB_KEY_HASH_BYTES)), Option[StakingCredential]::None)
    `, ([a], res) => a.data.isSame(asData(res)), 10);

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
    testing address_serialize
    func main(ctx: ScriptContext) -> ByteArray {
        ctx.tx.inputs.head.output.address.serialize()
    }
    ${spendingScriptContextParam(false)}
    `, ([ctx], res) => {
        return decodeCbor(asBytes(res)).isSame(ctx.data.fields[0].fields[0].list[0].fields[1].fields[0])
    }, 5);

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
    testing credential_eq
    func main(ctx: ScriptContext) -> Bool {
        ctx.tx.inputs.head.output.address.credential == ctx.tx.inputs.get(0).output.address.credential
    }
    ${spendingScriptContextParam(false)}
    `, ([_], res) => asBool(res), 5);

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
    testing credential_neq
    func main(ctx: ScriptContext) -> Bool {
        ctx.tx.inputs.head.output.address.credential != ctx.tx.inputs.get(0).output.address.credential
    }
    ${spendingScriptContextParam(false)}
    `, ([_], res) => !asBool(res), 5);

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["CURRENT_VALIDATOR_CRED"], `
    testing credential_from_data
    func main(data: Data) -> Credential {
        Credential::from_data(data)
    }
    ${spendingScriptContextParam(false)}
    `, ([a], res) => a.data.isSame(asData(res)), 3);

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
    testing credential_serialize
    func main(ctx: ScriptContext) -> ByteArray {
        ctx.tx.inputs.head.output.address.credential.serialize()
    }
    ${spendingScriptContextParam(false)}
    `, ([ctx], res) => {
        return decodeCbor(asBytes(res)).isSame(ctx.data.fields[0].fields[0].list[0].fields[1].fields[0].fields[0]);
    }, 3);

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
    testing credential_member_eq
    func main(ctx: ScriptContext) -> Bool {
        ctx.tx.outputs.head.address.credential.switch{
            p: PubKey => p == p && p.hash == p.hash,
            v: Validator => v == v && v.hash == v.hash
        }
    }
    ${spendingScriptContextParam(false)}
    `, ([_], res) => asBool(res), 5);

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
    testing credential_member_neq
    func main(ctx: ScriptContext) -> Bool {
        ctx.tx.outputs.head.address.credential.switch{
            p: PubKey => p != p,
            v: Validator => v != v
        }
    }
    ${spendingScriptContextParam(false)}
    `, ([_], res) => !asBool(res), 5);

    await ft.testParams({"PUB_KEY_HASH_BYTES": ft.bytes()}, ["SCRIPT_CONTEXT"], `
    testing credential_member_serialize
    func main(ctx: ScriptContext) -> ByteArray {
        ctx.tx.inputs.head.output.address.credential.switch{
            p: PubKey => p.serialize(),
            v: Validator => v.serialize()
        }
    }
    ${spendingScriptContextParam(false)}
    `, ([ctx], res) => {
        return decodeCbor(asBytes(res)).isSame(ctx.data.fields[0].fields[0].list[0].fields[1].fields[0].fields[0]);
    }, 5);

    await ft.testParams({"HAS_STAKING_CRED_IN": ft.bool()}, ["SCRIPT_CONTEXT"], `
    testing staking_credential_eq
    func main(ctx: ScriptContext) -> Bool {
        ctx.tx.inputs.head.output.address.staking_credential.switch{
            s: Some => s.some == s.some,
            n: None => n == n
        }
    }
    ${spendingScriptContextParam(false)}
    `, ([_], res) => asBool(res), 5);

    await ft.testParams({"HAS_STAKING_CRED_IN": ft.bool()}, ["SCRIPT_CONTEXT"], `
    testing staking_credential_neq
    func main(ctx: ScriptContext) -> Bool {
        ctx.tx.inputs.head.output.address.staking_credential.switch{
            s: Some => s.some != s.some,
            n: None => n != n
        }
    }
    ${spendingScriptContextParam(false)}
    `, ([_], res) => !asBool(res), 5);

    await ft.testParams({"HAS_STAKING_CRED_IN": ft.bool()}, ["SOME_STAKING_CRED_IN"], `
    testing staking_credential_from_data
    func main(data: Data) -> StakingCredential {
        StakingCredential::from_data(data)
    }
    ${spendingScriptContextParam(false)}
    `, ([a], res) => a.data.isSame(asData(res)), 2);

    await ft.testParams({"HAS_STAKING_CRED_IN": ft.bool()}, ["SCRIPT_CONTEXT"], `
    testing staking_credential_serialize
    func main(ctx: ScriptContext) -> Bool {
        ctx.tx.inputs.head.output.address.staking_credential.switch{
            s: Some => s.some.serialize().length > 0,
            n: None => n.serialize().length > 0
        }
    }
    ${spendingScriptContextParam(false)}
    `, ([ctx], res) => asBool(res), 5);

    await ft.testParams({"HAS_STAKING_CRED_IN": ft.bool(), "STAKING_CRED_TYPE": ft.bool()}, ["SCRIPT_CONTEXT"], `
    testing staking_credential_eq
    func main(ctx: ScriptContext) -> Bool {
        ctx.tx.inputs.head.output.address.staking_credential.switch{
            s: Some => s.some.switch{
                sp: Ptr => sp == sp,
                sh: Hash => sh == sh
            },
            n: None => n == n
        }
    }
    ${spendingScriptContextParam(false)}
    `, ([_], res) => asBool(res), 5);

    await ft.testParams({"HAS_STAKING_CRED_IN": ft.bool(), "STAKING_CRED_TYPE": ft.bool()}, ["SCRIPT_CONTEXT"], `
    testing staking_credential_neq
    func main(ctx: ScriptContext) -> Bool {
        ctx.tx.inputs.head.output.address.staking_credential.switch{
            s: Some => s.some.switch{
                sp: Ptr => sp != sp,
                sh: Hash => sh != sh
            },
            n: None => n != n
        }
    }
    ${spendingScriptContextParam(false)}
    `, ([_], res) => !asBool(res), 5);

    await ft.testParams({"HAS_STAKING_CRED_IN": ft.bool(), "STAKING_CRED_TYPE": ft.bool()}, ["SCRIPT_CONTEXT"], `
    testing staking_credential_serialize
    func main(ctx: ScriptContext) -> Bool {
        ctx.tx.inputs.head.output.address.staking_credential.switch{
            s: Some => s.some.switch{
                sp: Ptr => sp.serialize().length > 0,
                sh: Hash => sh.serialize().length > 0
            },
            n: None => n.serialize().length > 0
        }
    }
    ${spendingScriptContextParam(false)}
    `, ([ctx], res) => asBool(res), 5);

    await ft.test([ft.int()], `
    testing time_eq_1
    func main(a: Int) -> Bool {
        Time::new(a) == Time::new(a)
    }`, ([_], res) => asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing time_eq_2
    func main(a: Int, b: Int) -> Bool {
        Time::new(a) == Time::new(b)
    }`, ([a, b], res) => (asInt(a) === asInt(b)) === asBool(res));

    await ft.test([ft.int()], `
    testing time_neq_1
    func main(a: Int) -> Bool {
        Time::new(a) != Time::new(a)
    }`, ([_], res) => !asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing time_neq_2
    func main(a: Int, b: Int) -> Bool {
        Time::new(a) != Time::new(b)
    }`, ([a, b], res) => (asInt(a) === asInt(b)) === (!asBool(res)));

    await ft.test([ft.int(), ft.int()], `
    testing time_add_2
    func main(a: Int, b: Int) -> Time {
        Time::new(a) + Duration::new(b)
    }`, ([a, b], res) => asInt(a) + asInt(b) === asInt(res));

    await ft.test([ft.int()], `
    testing time_sub_0
    func main(a: Int) -> Duration {
        Time::new(a) - Time::new(0)
    }`, ([a], res) => asInt(a) === asInt(res));

    await ft.test([ft.int()], `
    testing time_sub_self
    func main(a: Int) -> Duration {
        Time::new(a) - Time::new(a)
    }`, ([_], res) => 0n === asInt(res));

    await ft.test([ft.int(), ft.int()], `
    testing time_sub_2
    func main(a: Int, b: Int) -> Duration {
        Time::new(a) - Time::new(b)
    }`, ([a, b], res) => asInt(a) - asInt(b) === asInt(res));

    await ft.test([ft.int()], `
    testing time_geq_1
    func main(a: Int) -> Bool {
        Time::new(a) >= Time::new(a)
    }`, ([_], res) => asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing time_geq_2
    func main(a: Int, b: Int) -> Bool {
        Time::new(a) >= Time::new(b)
    }`, ([a, b], res) => (asInt(a) >= asInt(b)) === asBool(res));

    await ft.test([ft.int()], `
    testing time_gt_1
    func main(a: Int) -> Bool {
        Time::new(a) > Time::new(a)
    }`, ([_], res) => !asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing time_gt_2
    func main(a: Int, b: Int) -> Bool {
        Time::new(a) > Time::new(b)
    }`, ([a, b], res) => (asInt(a) > asInt(b)) === asBool(res));

    await ft.test([ft.int()], `
    testing time_leq_1
    func main(a: Int) -> Bool {
        Time::new(a) <= Time::new(a)
    }`, ([_], res) => asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing time_leq_2
    func main(a: Int, b: Int) -> Bool {
        Time::new(a) <= Time::new(b)
    }`, ([a, b], res) => (asInt(a) <= asInt(b)) === asBool(res));

    await ft.test([ft.int()], `
    testing time_lt_1
    func main(a: Int) -> Bool {
        Time::new(a) < Time::new(a)
    }`, ([a], res) => !asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing time_lt_2
    func main(a: Int, b: Int) -> Bool {
        Time::new(a) < Time::new(b)
    }`, ([a, b], res) => (asInt(a) < asInt(b)) === asBool(res));

    await ft.test([ft.int()], `
    testing time_show
    func main(a: Int) -> String {
        Time::new(a).show()
    }`, ([a], res) => asInt(a).toString() === asString(res));

    await ft.test([ft.int()], `
    testing time_from_data
    func main(data: Data) -> Bool {
        Time::from_data(data) == Time::new(Int::from_data(data))
    }`, ([_], res) => asBool(res));

    await ft.test([ft.int()], `
    testing time_serialize
    func main(a: Int) -> ByteArray {
        Time::new(a).serialize()
    }`, serializeProp);

    await ft.test([ft.int()], `
    testing duration_eq_1
    func main(a: Int) -> Bool {
        Duration::new(a) == Duration::new(a)
    }`, ([_], res) => asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing duration_eq_2
    func main(a: Int, b: Int) -> Bool {
        Duration::new(a) == Duration::new(b)
    }`, ([a, b], res) => (asInt(a) === asInt(b)) === asBool(res));

    await ft.test([ft.int()], `
    testing duration_neq_1
    func main(a: Int) -> Bool {
        Duration::new(a) != Duration::new(a)
    }`, ([_], res) => !asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing duration_neq_2
    func main(a: Int, b: Int) -> Bool {
        Duration::new(a) != Duration::new(b)
    }`, ([a, b], res) => (asInt(a) === asInt(b)) === (!asBool(res)));

    await ft.test([ft.int()], `
    testing duration_add_0
    func main(a: Int) -> Duration {
        Duration::new(a) + Duration::new(0)
    }`, ([a], res) => asInt(a) === asInt(res));

    await ft.test([ft.int(), ft.int()], `
    testing duration_add_2
    func main(a: Int, b: Int) -> Duration {
        Duration::new(a) + Duration::new(b)
    }`, ([a, b], res) => asInt(a) + asInt(b) === asInt(res));

    await ft.test([ft.int()], `
    testing duration_sub_0
    func main(a: Int) -> Duration {
        Duration::new(a) - Duration::new(0)
    }`, ([a], res) => asInt(a) === asInt(res));

    await ft.test([ft.int()], `
    testing duration_sub_0_alt
    func main(a: Int) -> Duration {
        Duration::new(0) - Duration::new(a)
    }`, ([a], res) => asInt(a) === -asInt(res));

    await ft.test([ft.int()], `
    testing duration_sub_self
    func main(a: Int) -> Duration {
        Duration::new(a) - Duration::new(a)
    }`, ([_], res) => 0n === asInt(res));

    await ft.test([ft.int(), ft.int()], `
    testing duration_sub_2
    func main(a: Int, b: Int) -> Duration {
        Duration::new(a) - Duration::new(b)
    }`, ([a, b], res) => asInt(a) - asInt(b) === asInt(res));

    await ft.test([ft.int()], `
    testing duration_mul_0
    func main(a: Int) -> Duration {
        Duration::new(a)*0
    }`, ([_], res) => 0n === asInt(res));

    await ft.test([ft.int()], `
    testing duration_mul_0_swap
    func main(a: Int) -> Duration {
        0*Duration::new(a)
    }`, ([_], res) => 0n === asInt(res));

    await ft.test([ft.int()], `
    testing duration_mul_1
    func main(a: Int) -> Duration {
        Duration::new(a)*1
    }`, ([a], res) => asInt(a) === asInt(res));

    await ft.test([ft.int()], `
    testing duration_mul_1_swap
    func main(a: Int) -> Duration {
        1*Duration::new(a)
    }`, ([a], res) => asInt(a) === asInt(res));

    await ft.test([ft.int(), ft.int()], `
    testing duration_mul_2
    func main(a: Int, b: Int) -> Duration {
        Duration::new(a) * b
    }`, ([a, b], res) => asInt(a) * asInt(b) === asInt(res));

    await ft.test([ft.int(), ft.int()], `
    testing duration_mul_2_swap
    func main(a: Int, b: Int) -> Duration {
        b*Duration::new(a)
    }`, ([a, b], res) => asInt(a) * asInt(b) === asInt(res));

    await ft.test([ft.int()], `
    testing duration_div_0
    func main(a: Int) -> Duration {
        Duration::new(a) / 0
    }`, ([_], res) => isError(res, "division by zero"));

    await ft.test([ft.int()], `
    testing duration_div_1
    func main(a: Int) -> Duration {
        Duration::new(a) / 1
    }`, ([a], res) => asInt(a) === asInt(res));

    await ft.test([ft.int(-20, 20)], `
    testing duration_div_1_self
    func main(a: Int) -> Duration {
        Duration::new(a) / a
    }`, ([a], res) => 
        asInt(a) === 0n ?
        isError(res, "division by zero") :
        1n === asInt(res)
    );

    await ft.test([ft.int(-20, 20)], `
    testing duration_div_1_self_alt
    func main(a: Int) -> Int {
        Duration::new(a) / Duration::new(a)
    }`, ([a], res) => 
        asInt(a) === 0n ?
        isError(res, "division by zero") :
        1n === asInt(res)
    );

    await ft.test([ft.int(), ft.int()], `
    testing duration_div_2
    func main(a: Int, b: Int) -> Duration {
        Duration::new(a) / b
    }`, ([a, b], res) => 
        asInt(b) === 0n ? 
        isError(res, "division by zero") :
        asInt(a) / asInt(b) === asInt(res)
    );

    await ft.test([ft.int()], `
    testing duration_mod_0
    func main(a: Int) -> Duration {
        Duration::new(a) % Duration::new(0)
    }`, ([_], res) => isError(res, "division by zero"));

    await ft.test([ft.int()], `
    testing duration_mod_1
    func main(a: Int) -> Duration {
        Duration::new(a) % Duration::new(1)
    }`, ([_], res) => 0n === asInt(res));

    await ft.test([ft.int(-20, 20)], `
    testing duration_mod_1_alt
    func main(a: Int) -> Duration {
        Duration::new(1) % Duration::new(a)
    }`, ([a], res) => 
        asInt(a) === 0n ? 
        isError(res, "division by zero") :
        (
            asInt(a) === -1n || asInt(a) === 1n ?
            0n === asInt(res) :
            1n === asInt(res)
        )
    );

    await ft.test([ft.int(-10, 10)], `
    testing duration_mod_1_self
    func main(a: Int) -> Duration {
        Duration::new(a) % Duration::new(a)
    }`, ([a], res) => 
        asInt(a) === 0n ?
        isError(res, "division by zero") :
        0n === asInt(res)
    );

    await ft.test([ft.int(), ft.int(-10, 10)], `
    testing duration_mod_2
    func main(a: Int, b: Int) -> Duration {
        Duration::new(a) % Duration::new(b)
    }`, ([a, b], res) => 
        asInt(b) === 0n ? 
        isError(res, "division by zero") :
        asInt(a) % asInt(b) === asInt(res)
    );

    await ft.test([ft.int()], `
    testing duration_geq_1
    func main(a: Int) -> Bool {
        Duration::new(a) >= Duration::new(a)
    }`, ([_], res) => asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing duration_geq_2
    func main(a: Int, b: Int) -> Bool {
        Duration::new(a) >= Duration::new(b)
    }`, ([a, b], res) => (asInt(a) >= asInt(b)) === asBool(res));

    await ft.test([ft.int()], `
    testing duration_gt_1
    func main(a: Int) -> Bool {
        Duration::new(a) > Duration::new(a)
    }`, ([_], res) => !asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing duration_gt_2
    func main(a: Int, b: Int) -> Bool {
        Duration::new(a) > Duration::new(b)
    }`, ([a, b], res) => (asInt(a) > asInt(b)) === asBool(res));

    await ft.test([ft.int()], `
    testing duration_leq_1
    func main(a: Int) -> Bool {
        Duration::new(a) <= Duration::new(a)
    }`, ([_], res) => asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing duration_leq_2
    func main(a: Int, b: Int) -> Bool {
        Duration::new(a) <= Duration::new(b)
    }`, ([a, b], res) => (asInt(a) <= asInt(b)) === asBool(res));

    await ft.test([ft.int()], `
    testing duration_lt_1
    func main(a: Int) -> Bool {
        Duration::new(a) < Duration::new(a)
    }`, ([a], res) => !asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing duration_lt_2
    func main(a: Int, b: Int) -> Bool {
        Duration::new(a) < Duration::new(b)
    }`, ([a, b], res) => (asInt(a) < asInt(b)) === asBool(res));
    
    await ft.test([ft.int()], `
    testing duration_from_data
    func main(a: Data) -> Bool {
        Duration::from_data(a) == Duration::new(Int::from_data(a))
    }`, ([_], res) => asBool(res));

    await ft.test([ft.int()], `
    testing duration_serialize
    func main(a: Int) -> ByteArray {
        Duration::new(a).serialize()
    }`, serializeProp);

    await ft.test([ft.int()], `
    testing timerange_always
    func main(a: Int) -> Bool {
        TimeRange::ALWAYS.contains(Time::new(a))
    }`, ([_], res) => asBool(res));

    await ft.test([ft.int()], `
    testing timerange_never
    func main(a: Int) -> Bool {
        TimeRange::NEVER.contains(Time::new(a))
    }`, ([_], res) => !asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing timerange_from
    func main(a: Int, b: Int) -> Bool {
        TimeRange::from(Time::new(a)).contains(Time::new(b))
    }`, ([a, b], res) => (asInt(b) >= asInt(a)) === asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing timerange_to
    func main(a: Int, b: Int) -> Bool {
        TimeRange::to(Time::new(a)).contains(Time::new(b))
    }`, ([a, b], res) => (asInt(b) <= asInt(a)) === asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing timerange_eq_1
    func main(a: Int, b: Int) -> Bool {
        TimeRange::new(Time::new(a), Time::new(b)) == TimeRange::new(Time::new(a), Time::new(b))
    }`, ([_], res) => asBool(res));

    await ft.test([ft.int(), ft.int(), ft.int(), ft.int()], `
    testing timerange_eq_2
    func main(a: Int, b: Int, c: Int, d: Int) -> Bool {
        TimeRange::new(Time::new(a), Time::new(b)) == TimeRange::new(Time::new(c), Time::new(d))
    }`, ([a, b, c, d], res) => ((asInt(a) == asInt(c)) && (asInt(b) == asInt(d))) === asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing timerange_neq_1
    func main(a: Int, b: Int) -> Bool {
        TimeRange::new(Time::new(a), Time::new(b)) != TimeRange::new(Time::new(a), Time::new(b))
    }`, ([_], res) => !asBool(res));

    await ft.test([ft.int(), ft.int(), ft.int(), ft.int()], `
    testing timerange_neq_2
    func main(a: Int, b: Int, c: Int, d: Int) -> Bool {
        TimeRange::new(Time::new(a), Time::new(b)) != TimeRange::new(Time::new(c), Time::new(d))
    }`, ([a, b, c, d], res) => ((asInt(a) == asInt(c)) && (asInt(b) == asInt(d))) === !asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing timerange_contains
    func main(a: Int, b: Int) -> Bool {
        TimeRange::new(Time::new(a), Time::new(b)).contains(Time::new((a+b)/2))
    }`, ([a, b], res) => (asInt(a) < asInt(b) - 1n) === asBool(res));

    await ft.test([ft.int()], `
    testing timerange_is_after_1
    func main(a: Int) -> Bool {
        TimeRange::NEVER.is_after(Time::new(a))
    }`, ([_], res) => asBool(res));

    await ft.test([ft.int()], `
    testing timerange_is_after_2
    func main(a: Int) -> Bool {
        TimeRange::ALWAYS.is_after(Time::new(a))
    }`, ([_], res) => !asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing timerange_is_after_3
    func main(a: Int, b: Int) -> Bool {
        TimeRange::to(Time::new(a)).is_after(Time::new(b))
    }`, ([a, b], res) => !asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing timerange_is_after_4
    func main(a: Int, b: Int) -> Bool {
        TimeRange::from(Time::new(a)).is_after(Time::new(b))
    }`, ([a, b], res) => (asInt(b) < asInt(a)) === asBool(res));

    await ft.test([ft.int(), ft.int(), ft.int()], `
    testing timerange_is_after_5
    func main(a: Int, b: Int, c: Int) -> Bool {
        TimeRange::new(Time::new(a), Time::new(b)).is_after(Time::new(c))
    }`, ([a, _, c], res) => (asInt(c) < asInt(a)) === asBool(res));

    await ft.test([ft.int()], `
    testing timerange_is_before_1
    func main(a: Int) -> Bool {
        TimeRange::NEVER.is_before(Time::new(a))
    }`, ([_], res) => asBool(res));

    await ft.test([ft.int()], `
    testing timerange_is_before_2
    func main(a: Int) -> Bool {
        TimeRange::ALWAYS.is_before(Time::new(a))
    }`, ([_], res) => !asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing timerange_is_before_3
    func main(a: Int, b: Int) -> Bool {
        TimeRange::to(Time::new(a)).is_before(Time::new(b))
    }`, ([a, b], res) => (asInt(a) < asInt(b)) === asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing timerange_is_before_4
    func main(a: Int, b: Int) -> Bool {
        TimeRange::from(Time::new(a)).is_before(Time::new(b))
    }`, ([a, b], res) => !asBool(res));

    await ft.test([ft.int(), ft.int(), ft.int()], `
    testing timerange_is_before_5
    func main(a: Int, b: Int, c: Int) -> Bool {
        TimeRange::new(Time::new(a), Time::new(b)).is_before(Time::new(c))
    }`, ([_, b, c], res) => (asInt(b) < asInt(c)) === asBool(res));

    await ft.test([ft.int(), ft.int()], `
    testing timerange_show
    func main(a: Int, b: Int) -> String {
        TimeRange::new(Time::new(a), Time::new(b)).show()
    }`, ([a, b], res) => {
        return asString(res) == `[${asInt(a).toString()},${asInt(b).toString()}]`
    }, 5);

    await ft.test([ft.int()], `
    testing timerange_show_from
    func main(a: Int) -> String {
        TimeRange::from(Time::new(a)).show()
    }`, ([a], res) => asString(res) == `[${asInt(a).toString()},+inf]`, 5);

    await ft.test([ft.int()], `
    testing timerange_show_to
    func main(a: Int) -> String {
        TimeRange::to(Time::new(a)).show()
    }`, ([a], res) => asString(res) == `[-inf,${asInt(a).toString()}]`, 5);

    await ft.test([], `
    testing timerange_show_inf
    func main() -> Bool {
        TimeRange::NEVER.show() == "[+inf,-inf]" &&
        TimeRange::ALWAYS.show() == "[-inf,+inf]"
    }`, ([_], res) => asBool(res), 1);

    await ft.testParams({"START": ft.int(), "DUR": ft.int()}, ["TR"], `
    testing timerange_from_data
    func main(a: Data) -> TimeRange {
        TimeRange::from_data(a)
    }
    const START = 0
    const DUR = 100

    const TR: TimeRange = TimeRange::new(Time::new(START), Time::new(START + DUR))
    `, ([a], res) => a.data.isSame(asData(res)));


    await ft.test([ft.int(), ft.int()], `
    testing timerange_serialize
    func main(a: Int, b: Int) -> Bool {
        tr: TimeRange = TimeRange::new(Time::new(a), Time::new(b));
        tr.serialize() == tr.serialize()
    }`, ([a, b], res) => asBool(res));
}

export default async function main() {
    let stats = new Map();

    helios_.setRawUsageNotifier(function (name, n) {
        if (!stats.has(name)) {
            stats.set(name, 0);
        }

        if (n != 0) {
            stats.set(name, stats.get(name) + n);
        }
    });

    await testBuiltins();

    // print statistics
    console.log("helios builtin coverage:");
    for (let [name, n] of stats) {
        console.log(n, name);
    }
}

runIfEntryPoint(main, "builtins.js");
