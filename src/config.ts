export const WC_PROJECT_ID = "5cce07bd1ae77f8df5af659ad1f8e0e5";

export const CHAIN_ID = "govbot-test-1";
export const RPC = "https://govbot-testnet-rpc.itrocket.net";
export const REST = "https://govbot-testnet-api.itrocket.net";
export const PREFIX = "cosmos";
export const DENOM = "uatom";
export const DISPLAY_DENOM = "ATOM";
export const DECIMALS = 6;
export const GAS_PRICE = "0.01uatom";

const currency = {
  coinDenom: DISPLAY_DENOM,
  coinMinimalDenom: DENOM,
  coinDecimals: DECIMALS,
};

// ChainInfo в формате Keplr для keplr_experimentalSuggestChain
export const CHAIN_INFO = {
  chainId: CHAIN_ID,
  chainName: "GovBot Testnet",
  rpc: RPC,
  rest: REST,
  bip44: { coinType: 118 },
  bech32Config: {
    bech32PrefixAccAddr: PREFIX,
    bech32PrefixAccPub: `${PREFIX}pub`,
    bech32PrefixValAddr: `${PREFIX}valoper`,
    bech32PrefixValPub: `${PREFIX}valoperpub`,
    bech32PrefixConsAddr: `${PREFIX}valcons`,
    bech32PrefixConsPub: `${PREFIX}valconspub`,
  },
  currencies: [currency],
  feeCurrencies: [
    { ...currency, gasPriceStep: { low: 0.01, average: 0.025, high: 0.04 } },
  ],
  stakeCurrency: currency,
  features: [],
};
