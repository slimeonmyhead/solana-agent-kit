import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  Signer,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  TransactionSignature,
  VersionedTransaction,
} from "@solana/web3.js";

import { ComputeBudgetProgram } from "@solana/web3.js";
import { PriorityFeeResponse } from "../types/index";
import { SolanaAgentKit } from "../agent";
import bs58 from "bs58";

const feeTiers = {
  min: 0.01,
  mid: 0.5,
  max: 0.95,
};

/**
 * Get priority fees for the current block
 * @param connection - Solana RPC connection
 * @returns Priority fees statistics and instructions for different fee levels
 */
export async function getComputeBudgetInstructions(
  agent: SolanaAgentKit,
  instructions: TransactionInstruction[],
  feeTier: keyof typeof feeTiers,
): Promise<{
  blockhash: string;
  computeBudgetLimitInstruction: TransactionInstruction;
  computeBudgetPriorityFeeInstructions: TransactionInstruction;
}> {
  const { blockhash, lastValidBlockHeight } =
    await agent.connection.getLatestBlockhash();
  const messageV0 = new TransactionMessage({
    payerKey: agent.wallet_address,
    recentBlockhash: blockhash,
    instructions: instructions,
  }).compileToV0Message();
  const transaction = new VersionedTransaction(messageV0);
  const simulatedTx = agent.connection.simulateTransaction(transaction);
  const estimatedComputeUnits = (await simulatedTx).value.unitsConsumed;
  const safeComputeUnits = Math.ceil(
    estimatedComputeUnits
      ? Math.max(estimatedComputeUnits + 100000, estimatedComputeUnits * 1.2)
      : 200000,
  );
  const computeBudgetLimitInstruction =
    ComputeBudgetProgram.setComputeUnitLimit({
      units: safeComputeUnits,
    });

  let priorityFee: number;

  if (agent.config.HELIUS_API_KEY) {
    // Create and set up a legacy transaction for Helius fee estimation
    const legacyTransaction = new Transaction();
    legacyTransaction.recentBlockhash = blockhash;
    legacyTransaction.lastValidBlockHeight = lastValidBlockHeight;
    legacyTransaction.feePayer = agent.wallet_address;

    // Add the compute budget instruction and original instructions
    legacyTransaction.add(computeBudgetLimitInstruction, ...instructions);

    // Sign the transaction
    const signedTx = await agent.wallet.signTransaction(legacyTransaction);

    // Use Helius API for priority fee calculation
    const response = await fetch(
      `https://mainnet.helius-rpc.com/?api-key=${agent.config.HELIUS_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          method: "getPriorityFeeEstimate",
          params: [
            {
              transaction: bs58.encode(signedTx.serialize()),
              options: {
                priorityLevel:
                  feeTier === "min"
                    ? "Min"
                    : feeTier === "mid"
                      ? "Medium"
                      : "High",
              },
            },
          ],
        } as PriorityFeeResponse),
      },
    );

    const data = await response.json();
    if (data.error) {
      throw new Error("Error fetching priority fee from Helius API");
    }
    priorityFee = data.result.priorityFeeEstimate;
  } else {
    // Use default implementation for priority fee calculation
    priorityFee = await agent.connection
      .getRecentPrioritizationFees()
      .then(
        (fees) =>
          fees.sort((a, b) => a.prioritizationFee - b.prioritizationFee)[
            Math.floor(fees.length * feeTiers[feeTier])
          ].prioritizationFee,
      );
  }

  const computeBudgetPriorityFeeInstructions =
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: priorityFee,
    });

  return {
    blockhash,
    computeBudgetLimitInstruction,
    computeBudgetPriorityFeeInstructions,
  };
}

/**
 * Send a transaction with priority fees
 * @param agent - SolanaAgentKit instance
 * @param tx - Transaction to send
 * @returns Transaction ID
 */
export async function sendTx(
  agent: SolanaAgentKit,
  instructions: TransactionInstruction[],
  otherKeypairs?: Keypair[],
  lookupTables: AddressLookupTableAccount[] = [],
) {
  const ixComputeBudget = await getComputeBudgetInstructions(
    agent,
    instructions,
    "mid",
  );
  const allInstructions = [
    ixComputeBudget.computeBudgetLimitInstruction,
    ixComputeBudget.computeBudgetPriorityFeeInstructions,
    ...instructions,
  ];
  const messageV0 = new TransactionMessage({
    payerKey: agent.wallet_address,
    recentBlockhash: ixComputeBudget.blockhash,
    instructions: allInstructions,
  }).compileToV0Message(lookupTables);
  const transaction = new VersionedTransaction(messageV0);
  const signedTx = await agent.wallet.signTransaction(transaction);
  if (otherKeypairs) {
    signedTx.sign(otherKeypairs);
  }

  try {
    const timeout = 60000;
    const startTime = Date.now();
    let txtSig: TransactionSignature;

    while (Date.now() - startTime < timeout) {
      try {
        txtSig = await agent.connection.sendRawTransaction(
          transaction.serialize(),
          {
            skipPreflight: true,
          },
        );

        return await pollTransactionConfirmation(txtSig, agent);
      } catch (error) {
        continue;
      }
    }
  } catch (error) {
    throw new Error(`Error sending smart transaction: ${error}`);
  }

  const signature = await agent.connection.sendTransaction(signedTx, {
    maxRetries: 3,
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  const latestBlockhash = await agent.connection.getLatestBlockhash();
  await agent.connection.confirmTransaction({
    signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  });
  return signature;
}

async function pollTransactionConfirmation(
  txtSig: TransactionSignature,
  agent: SolanaAgentKit,
): Promise<TransactionSignature> {
  // 15 second timeout
  const timeout = 15000;
  // 5 second retry interval
  const interval = 5000;
  let elapsed = 0;

  return new Promise<TransactionSignature>((resolve, reject) => {
    const intervalId = setInterval(async () => {
      elapsed += interval;

      if (elapsed >= timeout) {
        clearInterval(intervalId);
        reject(new Error(`Transaction ${txtSig}'s confirmation timed out`));
      }

      const status = await agent.connection.getSignatureStatuses([txtSig]);

      if (status?.value[0]?.confirmationStatus === "confirmed") {
        clearInterval(intervalId);
        resolve(txtSig);
      }
    }, interval);
  });
}
