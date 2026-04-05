const INDEXER_URL = 'https://indexer-storage-testnet-turbo.0g.ai';
const EVM_RPC     = 'https://evmrpc-testnet.0g.ai';

export interface DealRecord {
  agent_a: string;
  agent_b: string;
  messages: { speaker: string; text: string }[];
  outcome: string;
  deal_amount_usdc: number | null;
  arc_tx_hash: string | null;
  timestamp: string;
}

export interface StorageResult {
  root_hash: string;
  tx_hash: string;
}

export async function uploadDealRecord(record: DealRecord): Promise<StorageResult | null> {
  const privateKey = process.env.ZG_PRIVATE_KEY ?? process.env.BUYER_PRIVATE_KEY;
  if (!privateKey) {
    console.warn('0G upload skipped: no ZG_PRIVATE_KEY or BUYER_PRIVATE_KEY set');
    return null;
  }

  try {
    // Dynamic imports to avoid crashing the server if the SDK fails to load
    const [{ Indexer, MemData }, { ethers }] = await Promise.all([
      import('@0gfoundation/0g-ts-sdk'),
      import('ethers'),
    ]);

    // Log wallet address and balance before attempting upload
    const provider = new ethers.JsonRpcProvider(EVM_RPC);
    const signer   = new ethers.Wallet(privateKey, provider);
    const address  = await signer.getAddress();

    try {
      const balanceWei = await provider.getBalance(address);
      const balanceA0GI = ethers.formatEther(balanceWei);
      console.log(`0G wallet: ${address}, A0GI balance: ${balanceA0GI}`);
      if (balanceWei === 0n) {
        console.error('0G upload skipped: wallet has 0 A0GI — fund it at https://faucet.0g.ai');
        return null;
      }
    } catch (balErr) {
      console.warn('0G balance check failed:', balErr);
    }

    const json  = JSON.stringify(record, null, 2);
    const bytes = new TextEncoder().encode(json);
    const memData = new MemData(bytes);

    const indexer  = new Indexer(INDEXER_URL);

    console.log(`0G uploading deal record (${bytes.length} bytes)…`);
    const [tx, err] = await indexer.upload(memData, EVM_RPC, signer, {
      finalityRequired: false,   // return after L1 tx, don't wait for storage node sync
      expectedReplica: 1,
      taskSize: 1,
    });
    if (err !== null) throw new Error(String(err));

    const rootHash = 'rootHash' in tx ? tx.rootHash : (tx as any).rootHashes[0];
    const txHash   = 'txHash'   in tx ? tx.txHash   : (tx as any).txHashes[0];

    console.log(`0G upload success — rootHash: ${rootHash}, txHash: ${txHash}`);
    return { root_hash: rootHash, tx_hash: txHash };
  } catch (err) {
    console.error('0G upload failed:', String(err));
    return null;
  }
}
