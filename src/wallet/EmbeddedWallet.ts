import { Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";

import { WalletAdapter } from "../types";
import bs58 from "bs58";

export class BaseWallet extends Keypair implements WalletAdapter {
  constructor(privateKey: string | Keypair) {
    super();
    try {
      const keypair =
        typeof privateKey === "string"
          ? Keypair.fromSecretKey(bs58.decode(privateKey))
          : privateKey;

      Object.assign(this, keypair);
    } catch (error) {
      throw new Error(
        `Failed to initialize wallet: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
  ): Promise<T> {
    try {
      if (transaction instanceof Transaction) {
        transaction.partialSign(this);
      } else if (transaction instanceof VersionedTransaction) {
        transaction.sign([this]);
      }
      return transaction;
    } catch (error) {
      throw new Error(
        `Failed to sign transaction: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[],
  ): Promise<T[]> {
    try {
      return transactions.map((tx) => {
        if (tx instanceof Transaction) {
          tx.partialSign(this);
        } else if (tx instanceof VersionedTransaction) {
          tx.sign([this]);
        }
        return tx;
      });
    } catch (error) {
      throw new Error(
        `Failed to sign transactions: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
}
