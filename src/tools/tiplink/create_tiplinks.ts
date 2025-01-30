import {
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  getMint,
} from "@solana/spl-token";

import { SolanaAgentKit } from "../../index";
import { TipLink } from "@tiplink/api";

const MINIMUM_SOL_BALANCE = 0.003 * LAMPORTS_PER_SOL;

export async function create_TipLink(
  agent: SolanaAgentKit,
  amount: number,
  splmintAddress?: PublicKey,
): Promise<{ url: string; signature: string }> {
  try {
    const tiplink = await TipLink.create();

    if (!splmintAddress) {
      const transaction = new Transaction();
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: agent.wallet_address,
          toPubkey: tiplink.keypair.publicKey,
          lamports: amount * LAMPORTS_PER_SOL,
        }),
      );
      const signedTx = await agent.wallet.signTransaction(transaction);
      const signature = await agent.connection.sendRawTransaction(
        signedTx.serialize(),
      );
      await agent.connection.confirmTransaction(signature, "confirmed");

      return {
        url: tiplink.url.toString(),
        signature,
      };
    } else {
      const fromAta = await getAssociatedTokenAddress(
        splmintAddress,
        agent.wallet_address,
      );
      const toAta = await getAssociatedTokenAddress(
        splmintAddress,
        tiplink.keypair.publicKey,
      );

      const mintInfo = await getMint(agent.connection, splmintAddress);
      const adjustedAmount = amount * Math.pow(10, mintInfo.decimals);

      const transaction = new Transaction();

      transaction.add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: 5000,
        }),
      );

      transaction.add(
        SystemProgram.transfer({
          fromPubkey: agent.wallet_address,
          toPubkey: tiplink.keypair.publicKey,
          lamports: MINIMUM_SOL_BALANCE,
        }),
      );

      transaction.add(
        createAssociatedTokenAccountInstruction(
          agent.wallet_address,
          toAta,
          tiplink.keypair.publicKey,
          splmintAddress,
        ),
      );

      transaction.add(
        createTransferInstruction(
          fromAta,
          toAta,
          agent.wallet_address,
          adjustedAmount,
        ),
      );

      const signedTx = await agent.wallet.signTransaction(transaction);

      const signature = await agent.connection.sendRawTransaction(
        signedTx.serialize(),
      );
      await agent.connection.confirmTransaction(signature, "confirmed");

      return {
        url: tiplink.url.toString(),
        signature,
      };
    }
  } catch (error: any) {
    console.error("Error creating TipLink or sending funds:", error.message);
    throw new Error(`Failed to create TipLink: ${error.message}`);
  }
}
