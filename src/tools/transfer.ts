import { SolanaAgentKit } from "../index";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getMint,
} from "@solana/spl-token";
import { sendTx } from "../utils/send_tx";

/**
 * Transfer SOL or SPL tokens to a recipient
 * @param agent SolanaAgentKit instance
 * @param to Recipient's public key
 * @param amount Amount to transfer
 * @param mint Optional mint address for SPL tokens
 * @returns Transaction signature
 */
export async function transfer(
  agent: SolanaAgentKit,
  to: PublicKey,
  amount: number,
  mint?: PublicKey,
): Promise<string> {
  try {
    let tx: string;

    if (!mint) {
      // Transfer native SOL
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: agent.wallet_address,
          toPubkey: to,
          lamports: amount * LAMPORTS_PER_SOL,
        }),
      );

      tx = await sendTx(agent, transaction.instructions);
    } else {
      const transaction = new Transaction();
      // Transfer SPL token
      const fromAta = await getAssociatedTokenAddress(
        mint,
        agent.wallet_address,
      );
      const toAta = await getAssociatedTokenAddress(mint, to);
      const toAtaAcc = await getAccount(agent.connection, toAta);
      if (!toAtaAcc) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            agent.wallet_address,
            toAta,
            to,
            mint,
          ),
        );
      }

      // Get mint info to determine decimals
      const mintInfo = await getMint(agent.connection, mint);
      const adjustedAmount = amount * Math.pow(10, mintInfo.decimals);

      transaction.add(
        createTransferInstruction(
          fromAta,
          toAta,
          agent.wallet_address,
          adjustedAmount,
        ),
      );

      tx = await sendTx(agent, transaction.instructions);
    }

    return tx;
  } catch (error: any) {
    throw new Error(`Transfer failed: ${error.message}`);
  }
}
