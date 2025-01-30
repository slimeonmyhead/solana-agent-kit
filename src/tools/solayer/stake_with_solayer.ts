import { SolanaAgentKit } from "../../index";
import { VersionedTransaction } from "@solana/web3.js";

/**
 * Stake SOL with Solayer
 * @param agent SolanaAgentKit instance
 * @param amount Amount of SOL to stake
 * @returns Transaction signature
 */
export async function stakeWithSolayer(
  agent: SolanaAgentKit,
  amount: number,
): Promise<string> {
  try {
    const response = await fetch(
      `https://app.solayer.org/api/action/restake/ssol?amount=${amount}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          account: agent.wallet.publicKey.toBase58(),
        }),
      },
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || "Staking request failed");
    }

    const data = await response.json();

    // Deserialize and prepare transaction
    const txn = VersionedTransaction.deserialize(
      Buffer.from(data.transaction, "base64"),
    );

    // Update blockhash
    const { blockhash } = await agent.connection.getLatestBlockhash();
    txn.message.recentBlockhash = blockhash;

    // Sign and send transaction
    const signedTx = await agent.wallet.signTransaction(txn);
    const signature = await agent.connection.sendRawTransaction(
      signedTx.serialize(),
      {
        preflightCommitment: "confirmed",
        maxRetries: 3,
      },
    );

    // Wait for confirmation
    const latestBlockhash = await agent.connection.getLatestBlockhash();
    await agent.connection.confirmTransaction({
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    });

    return signature;
  } catch (error: any) {
    console.error(error);
    throw new Error(`Solayer sSOL staking failed: ${error.message}`);
  }
}
