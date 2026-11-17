/**
 * Networks, nodes and contracts. The app runs in one of two modes:
 *
 *   mainnet  real networks and real money (the default)
 *   testnet  test networks with worthless coins, for trying things safely
 *
 * Every host listed here ends up in the Content-Security-Policy at build time,
 * so a request to anything else is blocked by the browser. All nodes are free,
 * need no API key and answer cross-origin browser requests. Each one, and every
 * token contract, was checked against the network itself on 2026-11-10 (symbol
 * and decimals read from the contract, not taken from memory).
 */

export type NetworkMode = 'mainnet' | 'testnet';

export interface NetworkConfig {
  mode: NetworkMode;
  evm: {
    name: string;
    chainId: bigint;
    rpc: readonly string[];
    explorerTx: (hash: string) => string;
    /** Blockscout explorer API, used only for balance history. */
    history: string;
    /** `wbtc` and `cbbtc` are bitcoin held by a custodian and issued as a token; they exist on real networks only. */
    tokens: { usdt: string; usdc: string; dai: string; link: string; wbtc?: string; cbbtc?: string };
    /** The network's name at the swap aggregator; absent where swapping is not offered. */
    swap?: string;
  };
  btc: {
    name: string;
    /** Address format and derivation path. */
    network: 'mainnet' | 'testnet';
    esplora: readonly string[];
    explorerTx: (txid: string) => string;
  };
  tron: {
    name: string;
    nodes: readonly string[];
    explorerTx: (txid: string) => string;
    /** TronGrid, the only Tron API that serves an address's past transactions. */
    history: string;
    usdt: string;
  };
  /**
   * Base, a second EVM network (same address as Ethereum, far lower fees). Real network
   * only: it exists here for the withdrawal tab, which sells USDC on Base.
   */
  base?: {
    name: string;
    chainId: bigint;
    rpc: readonly string[];
    explorerTx: (hash: string) => string;
    /** Where an address can be looked up, for operations whose transaction cannot be named. */
    explorerAddress: (address: string) => string;
    /** Seconds between blocks, to find the block nearest to a moment in the past. */
    blockSeconds: number;
    usdc: string;
    /** Coinbase's wrapped bitcoin; the same address as on Ethereum. */
    cbbtc: string;
    swap?: string;
  };
}

export const NETWORKS: Record<NetworkMode, NetworkConfig> = {
  mainnet: {
    mode: 'mainnet',
    evm: {
      name: 'ethereum',
      chainId: 1n,
      rpc: [
        'https://ethereum-rpc.publicnode.com',
        'https://mainnet.gateway.tenderly.co',
        'https://0xrpc.io/eth',
        'https://eth.drpc.org',
      ],
      explorerTx: (hash) => `https://etherscan.io/tx/${hash}`,
      history: 'https://eth.blockscout.com',
      swap: 'ethereum',
      tokens: {
        usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        dai: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
        link: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
        // Wrapped bitcoin: WBTC (custodian BitGo) and cbBTC (custodian Coinbase). Symbol and decimals read from the contracts.
        wbtc: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
        cbbtc: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
      },
    },
    btc: {
      name: 'bitcoin',
      network: 'mainnet',
      esplora: ['https://mempool.space/api', 'https://blockstream.info/api'],
      explorerTx: (txid) => `https://mempool.space/tx/${txid}`,
    },
    tron: {
      name: 'tron',
      // TronGrid is last here: it is the only source of history (below) and rate-limits keyless use,
      // so everyday balance calls go to the other nodes first.
      nodes: ['https://tron-rpc.publicnode.com', 'https://api.tronstack.io', 'https://api.trongrid.io'],
      explorerTx: (txid) => `https://tronscan.org/#/transaction/${txid}`,
      history: 'https://api.trongrid.io',
      usdt: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    },
    base: {
      name: 'base',
      chainId: 8453n,
      rpc: [
        'https://mainnet.base.org',
        'https://base-rpc.publicnode.com',
        'https://base.gateway.tenderly.co',
        'https://base.drpc.org',
      ],
      explorerTx: (hash) => `https://basescan.org/tx/${hash}`,
      explorerAddress: (address) => `https://basescan.org/address/${address}`,
      blockSeconds: 2,
      swap: 'base',
      // Circle's native USDC on Base; symbol and decimals read from the contract.
      usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      cbbtc: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    },
  },
  testnet: {
    mode: 'testnet',
    evm: {
      name: 'sepolia',
      chainId: 11155111n,
      rpc: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://sepolia.gateway.tenderly.co', 'https://0xrpc.io/sep'],
      explorerTx: (hash) => `https://sepolia.etherscan.io/tx/${hash}`,
      history: 'https://eth-sepolia.blockscout.com',
      // Test tokens: USDC is Circle's, USDT and DAI are Aave's test deployment, LINK is Chainlink's.
      tokens: {
        usdt: '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0',
        usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        dai: '0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357',
        link: '0x779877A7B0D9E8603169DdbD7836e478b4624789',
      },
    },
    btc: {
      name: 'testnet4',
      network: 'testnet',
      esplora: ['https://mempool.space/testnet4/api'],
      explorerTx: (txid) => `https://mempool.space/testnet4/tx/${txid}`,
    },
    tron: {
      name: 'tron nile',
      nodes: ['https://nile.trongrid.io', 'https://api.nileex.io'],
      explorerTx: (txid) => `https://nile.tronscan.org/#/transaction/${txid}`,
      history: 'https://nile.trongrid.io',
      usdt: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
    },
  },
};

const MODE_KEY = 'me7.net';

/** The mode chosen on this device; real networks unless the user switched to testing. */
export function loadMode(): NetworkMode {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(MODE_KEY) === 'testnet') return 'testnet';
  } catch {
    /* storage unavailable */
  }
  return 'mainnet';
}

/** Remember the mode. The caller reloads the page so nothing from the other mode stays in memory. */
export function saveMode(mode: NetworkMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* private mode: the choice just won't persist */
  }
}

/** The networks in use for this page load. */
export const NET: NetworkConfig = NETWORKS[loadMode()];

/** Price sources, tried in order. */
export const PRICE_LLAMA =
  'https://coins.llama.fi/prices/current/coingecko:ethereum,coingecko:bitcoin,coingecko:tether,coingecko:usd-coin,coingecko:dai,coingecko:chainlink,coingecko:tron';
export const PRICE_COINGECKO =
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether,usd-coin,dai,chainlink,tron&vs_currencies=usd';

/** Change of each price over the last day, in percent: append the coins. Same source as the prices. */
export const PRICE_CHANGE = 'https://coins.llama.fi/percentage/';

/** Price history for the balance chart: append the coins and the period. */
export const PRICE_CHART = 'https://coins.llama.fi/chart/';

/**
 * Peer (formerly ZKP2P), the protocol behind the withdrawal tab. Two of its servers are used:
 * the first turns a payment handle into the hash that goes on-chain (so a buyer can learn where
 * to pay), the second only finds the numbers of an address's orders. Neither needs a key, and
 * neither is trusted with amounts: those are always read from the contract itself.
 */
export const PEER_API = 'https://api.zkp2p.xyz';
export const PEER_INDEXER = 'https://indexer.zkp2p.xyz/v1/graphql';

/**
 * KyberSwap's aggregator, used for swaps: it finds a route and builds the transaction, which the
 * wallet then reads and checks field by field before signing (see src/core/swap.ts). No key needed.
 */
export const SWAP_API = 'https://aggregator-api.kyberswap.com';

/**
 * The project's cut of a swap, paid by the aggregator's contract inside the swap itself.
 * `bps` is hundredths of a percent. With an empty receiver no fee is asked for at all.
 */
export const SWAP_FEE: { bps: number; receiver: string } = {
  bps: 50,
  // The owner's pocket address, confirmed by the owner on 2026-11-11.
  receiver: '0x7f054A2016C9ceC7Cd5c4A2D21E650a2767AF737',
};

/**
 * Sending USDC on Base without ETH: the pocket signs permissions for the transfers and for a fee,
 * and me7's own relay, served from the same site under /relay, carries them to the network and
 * pays the gas (see src/core/gasless.ts and server/). The fee goes to the same address as the swap fee.
 *
 * The fee for one operation is the relay's gas expense plus `base`; an operation that pays more
 * than `free` recipients adds `extra` for each one beyond them. Chosen by the owner on 2026-11-12.
 */
export const GASLESS = {
  path: '/relay',
  /** 1 USDC, in the token's base units. */
  base: 1_000_000n,
  free: 5,
  /** 0.2 USDC for each recipient after the fifth. */
  extra: 200_000n,
  receiver: SWAP_FEE.receiver,
  /** How USDC names itself in its signature check; confirmed against the contract on Base on 2026-11-11. */
  domain: { name: 'USD Coin', version: '2' },
  /** Gas one transfer takes inside the relay's transaction, with room to spare (measured: about 70 thousand). */
  gasPerCall: 80_000n,
  /** Above this gas price (wei per gas, 0.5 gwei) the relay asks to wait instead of paying. */
  maxGasPrice: 500_000_000n,
  /** The pocket refuses a quote whose gas part is above this (0.50 USDC): the relay is wrong or the network is on fire. */
  maxGasPart: 500_000n,
  /** Issuing a name: the service's part of the fee (0.5 USDC, set by the owner on 2026-11-13) and the gas a registration takes, with room to spare (measured: about 255 thousand). */
  nameService: 500_000n,
  nameGas: 340_000n,
  /** The pocket refuses a quote for a name above this (300 USDC): the service is wrong. Three-letter names cost about 0.1 ETH a year. */
  nameMaxFee: 300_000_000n,
} as const;

/**
 * USDT on Tron without TRX (see src/core/trongas.ts and server/tron-core.ts). The service rents the
 * network's energy onto the sender's address and sends the two transfers the wallet has signed.
 * `receiver` is where the fee goes: the owner's own Tron address, which should hold some USDT
 * already (paying to an address with none costs twice the energy).
 */
export const TRON_GASLESS = {
  path: '/relay/tron',
  /** The service's own part of the fee: 1.5 USDT, set by the owner on 2026-11-14. */
  service: 1_500_000n,
  /** The owner's Tron address, given by the owner on 2026-11-14; it holds USDT. */
  receiver: 'TMkkPBi7UcHb3SGTpxqTFFKF52e4cm95Vo',
  /** The pocket refuses a quote above this (15 USDT): the service is wrong or the network is on fire. */
  maxFee: 15_000_000n,
  /** The most TRX a relayed transfer may burn if something goes wrong: 30 TRX. With rented energy it burns none. */
  feeLimit: 30_000_000n,
  /** How long the signed transfers stay good, in milliseconds: time for the energy to arrive. */
  lifetime: 600_000,
} as const;

/**
 * Paying USDT on Tron out of USDC on Base. The two are different networks, so the money crosses
 * through a third party: NEAR Intents (its 1Click service). The wallet sends USDC to an address
 * the service names, and the service delivers USDT to a new Tron address of this wallet. While it
 * crosses, the money is in the service's hands: this is said on the screen before anything is sent.
 */
export const CROSS = {
  api: 'https://1click.chaindefuser.com/v0',
  /** The service's names for USDC on Base and USDT on Tron. */
  origin: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
  destination: 'nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near',
  /** How far the price may move while the money is on its way, in hundredths of a percent. */
  slippageBps: 50,
  /** The most the service may ask over what it delivers: two percent and two dollars. A dearer quote is refused. */
  maxOverBps: 200n,
  maxOverFlat: 2_000_000n,
  /** The least worth sending this way, in USDT's units: below it the fixed costs eat the payment. */
  min: 5_000_000n,
  /** How long the service is given to deliver before it must send the USDC back, in milliseconds. */
  lifetime: 3_600_000,
  /**
   * me7's own fees for a crossing, set by the owner on 2026-11-16: 0.5 USDC for sending the USDC (not 1) and
   * 1 USDT for paying the USDT on (not 1.5). They hold for this kind of payment only: me7's service asks the
   * crossing service whether the payment is one, and otherwise wants its ordinary fee.
   */
  baseFee: 500_000n,
  tronService: 1_000_000n,
  /**
   * A swap between networks (see src/core/cross.ts). me7's own part, in hundredths of a percent of what is given;
   * nought until the owner decides on it: the service credits such a fee inside its own accounts, not on a chain.
   */
  swapFeeBps: 0,
  /** What a swap may lose against outside prices before it is refused: three percent, and three dollars for the networks' own costs. */
  swapLossBps: 300n,
  swapFlatUsd: 3,
} as const;

/** Tron addresses under sanctions, one per line: the list the Tron side of the service refuses to serve. */
export const TRON_BLOCKED_LIST = 'https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_TRX.txt';

/**
 * Where the wallet keeps its address book between devices: me7's own store, on the same site under
 * /sync. It holds ciphertext only, under a name derived from the seed (see src/core/sync.ts).
 */
export const SYNC_PATH = '/sync';

/** Where the wallet's source code is published. A link for people to follow; the app itself never talks to it. */
export const SOURCE_URL = 'https://github.com/nomaddamone/me7-financial-infrastructure';

/**
 * What the relay checks every address against before carrying a transfer (it never serves either kind):
 * Chainalysis's free sanctions oracle, a contract on Base (confirmed 2026-11-12: it flags a known
 * sanctioned address and clears ordinary ones), and ScamSniffer's public list of scam addresses.
 * The page asks the oracle too, about those who paid to the wallet (see src/core/quarantine.ts); the scam list only the relay reads.
 */
export const SANCTIONS_ORACLE = '0x3A91A31cB3dC49b4db9Ce721F50a9D076c8D739B';
/** Chainlink's ETH / USD feed on Base (8 decimals; confirmed 2026-11-12). The relay prices its gas expense with it. */
export const ETH_USD_FEED = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';
export const SCAM_LIST = 'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json';

/**
 * Binance's public market data (candles, order book, recent trades), shown in the trading section
 * for reference. No key and no account; nothing about the user is sent there.
 */
export const MARKET_API = 'https://data-api.binance.vision';
export const MARKET_WS = 'wss://data-stream.binance.vision';

/** Everything the app may connect to, in both modes. Explorers are only ever opened as links. */
export const ALL_ENDPOINTS: readonly string[] = [
  ...Object.values(NETWORKS).flatMap((n) => [
    ...n.evm.rpc,
    ...n.btc.esplora,
    ...n.tron.nodes,
    n.evm.history,
    n.tron.history,
    ...(n.base?.rpc ?? []),
  ]),
  PEER_API,
  PEER_INDEXER,
  SWAP_API,
  CROSS.api,
  MARKET_API,
  MARKET_WS,
  PRICE_LLAMA,
  PRICE_COINGECKO,
];

export function hostOf(url: string): string {
  return new URL(url).host;
}
