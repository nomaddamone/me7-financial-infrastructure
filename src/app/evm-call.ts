import { signEvmTransaction } from '../core/index.ts';
import { estimateCallGas, waitForReceipt, type Receipt } from '../net/peer.ts';
import { broadcastEvm, fetchEvmFees, fetchEvmNonce } from '../net/send.ts';
import { withEvmKey, type Wallet } from './wallet.ts';

const hexOf = (bytes: Uint8Array) => `0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;

/**
 * Sign a contract call, broadcast it and wait until it is included. The gas is
 * estimated first, and a call the node says would fail is never signed: the
 * node's reason is raised instead of burning a fee on it.
 */
export async function sendEvmCall(
  chain: { rpc: readonly string[]; chainId: bigint },
  wallet: Wallet,
  to: string,
  data: Uint8Array,
  value = 0n,
): Promise<Receipt & { hash: string }> {
  let gasLimit = 0n;
  // Right after an earlier transaction a lagging node may still see the old state; give it a moment.
  for (let attempt = 0; ; attempt++) {
    try {
      gasLimit = await estimateCallGas(chain.rpc, { from: wallet.evm, to, data: hexOf(data), ...(value > 0n ? { value: `0x${value.toString(16)}` } : {}) });
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  const [fees, nonce] = await Promise.all([fetchEvmFees(chain.rpc), fetchEvmNonce(chain.rpc, wallet.evm)]);
  const tx = {
    chainId: chain.chainId,
    nonce,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    maxFeePerGas: fees.maxFeePerGas,
    gasLimit,
    to,
    value,
    data,
  };
  const hash = await withEvmKey(wallet, (key) => {
    const signed = signEvmTransaction(tx, key);
    return broadcastEvm(chain.rpc, signed.raw, signed.hash);
  });
  const receipt = await waitForReceipt(chain.rpc, hash);
  if (!receipt.ok) throw new Error('The network rejected the transaction');
  return { ...receipt, hash };
}
