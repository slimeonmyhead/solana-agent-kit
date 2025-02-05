import {
  ConfirmOptions,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import type { BaseWallet } from "../types/wallet";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import { createWeb3JsEddsa } from "@metaplex-foundation/umi-eddsa-web3js";

/**
 * Check if a transaction object is a VersionedTransaction or not
 *
 * @param tx
 * @returns bool
 */
export const isVersionedTransaction = (
  tx: Transaction | VersionedTransaction,
): tx is VersionedTransaction => {
  return "version" in tx;
};

/**
 * A wallet implementation using a Keypair for signing transactions
 */
export class KeypairWallet implements BaseWallet {
  publicKey: PublicKey;
  private payer: Keypair;

  /**
   * Constructs a KeypairWallet with a given Keypair
   * @param keypair - The Keypair to use for signing transactions
   */
  constructor(keypair: Keypair) {
    this.publicKey = keypair.publicKey;
    this.payer = keypair;
  }

  defaultOptions: ConfirmOptions = {
    preflightCommitment: "processed",
    commitment: "processed",
  };

  async signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
  ): Promise<T> {
    if (isVersionedTransaction(transaction)) {
      transaction.sign([this.payer]);
    } else {
      transaction.partialSign(this.payer);
    }

    return transaction;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]> {
    return txs.map((t) => {
      if (isVersionedTransaction(t)) {
        t.sign([this.payer]);
      } else {
        t.partialSign(this.payer);
      }
      return t;
    });
  }
  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    return createWeb3JsEddsa().sign(message, fromWeb3JsKeypair(this.payer));
  }
}
