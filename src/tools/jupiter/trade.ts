import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  DEFAULT_OPTIONS,
  JUP_API,
  JUP_REFERRAL_ADDRESS,
  TOKENS,
} from "../../constants";

import { SolanaAgentKit } from "../../index";
import { getMint } from "@solana/spl-token";
import { sendTx } from "../../utils/send_tx";

/**
 * Swap tokens using Jupiter Exchange
 * @param agent SolanaAgentKit instance
 * @param outputMint Target token mint address
 * @param inputAmount Amount to swap (in token decimals)
 * @param inputMint Source token mint address (defaults to USDC)
 * @param slippageBps Slippage tolerance in basis points (default: 300 = 3%)
 * @returns Transaction signature
 */

export async function trade(
  agent: SolanaAgentKit,
  outputMint: PublicKey,
  inputAmount: number,
  inputMint: PublicKey = TOKENS.USDC,
  // @deprecated use dynamicSlippage instead
  slippageBps: number = DEFAULT_OPTIONS.SLIPPAGE_BPS,
): Promise<string> {
  try {
    // Check if input token is native SOL
    const isNativeSol = inputMint.equals(TOKENS.SOL);

    // For native SOL, we use LAMPORTS_PER_SOL, otherwise fetch mint info
    const inputDecimals = isNativeSol
      ? 9 // SOL always has 9 decimals
      : (await getMint(agent.connection, inputMint)).decimals;

    // Calculate the correct amount based on actual decimals
    const scaledAmount = inputAmount * Math.pow(10, inputDecimals);

    const quoteResponse = await (
      await fetch(
        `${JUP_API}/quote?` +
          `inputMint=${isNativeSol ? TOKENS.SOL.toString() : inputMint.toString()}` +
          `&outputMint=${outputMint.toString()}` +
          `&amount=${scaledAmount}` +
          `&dynamicSlippage=true` +
          `&minimizeSlippage=false` +
          `&onlyDirectRoutes=false` +
          `&maxAccounts=64` +
          `&swapMode=ExactIn` +
          `${agent.config.JUPITER_FEE_BPS ? `&platformFeeBps=${agent.config.JUPITER_FEE_BPS}` : ""}`,
      )
    ).json();

    // Get serialized transaction
    let feeAccount;
    if (agent.config.JUPITER_REFERRAL_ACCOUNT) {
      [feeAccount] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("referral_ata"),
          new PublicKey(agent.config.JUPITER_REFERRAL_ACCOUNT).toBuffer(),
          TOKENS.SOL.toBuffer(),
        ],
        new PublicKey(JUP_REFERRAL_ADDRESS),
      );
    }

    const instructions = await (
      await fetch("https://quote-api.jup.ag/v6/swap-instructions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // quoteResponse from /quote or /swap api
          quoteResponse,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          dynamicSlippage: true,
          prioritizationFeeLamports: {
            priorityLevelWithMaxLamports: {
              maxLamports: 10000000,
              global: false,
              priorityLevel: agent.config.PRIORITY_LEVEL || "medium",
            },
          },
          feeAccount: feeAccount ? feeAccount.toString() : null,
          userPublicKey: agent.wallet.publicKey.toBase58(),
          // other Jupiter request fields if needed
        }),
      })
    ).json();
    // Deserialize transaction
    if (instructions.error) {
      throw new Error("Failed to get swap instructions: " + instructions.error);
    }

    const {
      tokenLedgerInstruction, // If using `useTokenLedger = true`
      computeBudgetInstructions, // Jupiter’s default compute budget instructions (we will NOT use these)
      setupInstructions, // Setup ATAs if needed
      swapInstruction: swapInstructionPayload,
      cleanupInstruction, // Unwrap SOL, if you used wrapAndUnwrapSol
      addressLookupTableAddresses,
    } = instructions;

    const deserializeInstruction = (instruction: any) => {
      return new TransactionInstruction({
        programId: new PublicKey(instruction.programId),
        keys: instruction.accounts.map((key: any) => ({
          pubkey: new PublicKey(key.pubkey),
          isSigner: key.isSigner,
          isWritable: key.isWritable,
        })),
        data: Buffer.from(instruction.data, "base64"),
      });
    };

    const getAddressLookupTableAccounts = async (
      keys: string[],
    ): Promise<AddressLookupTableAccount[]> => {
      const addressLookupTableAccountInfos =
        await agent.connection.getMultipleAccountsInfo(
          keys.map((key) => new PublicKey(key)),
        );

      return addressLookupTableAccountInfos.reduce(
        (acc: any, accountInfo: any, index: any) => {
          const addressLookupTableAddress = keys[index];
          if (accountInfo) {
            const addressLookupTableAccount = new AddressLookupTableAccount({
              key: new PublicKey(addressLookupTableAddress),
              state: AddressLookupTableAccount.deserialize(accountInfo.data),
            });
            acc.push(addressLookupTableAccount);
          }

          return acc;
        },
        new Array<AddressLookupTableAccount>(),
      );
    };

    const addressLookupTableAccounts: AddressLookupTableAccount[] = [];

    addressLookupTableAccounts.push(
      ...(await getAddressLookupTableAccounts(addressLookupTableAddresses)),
    );

    const signature = await sendTx(
      agent,
      [
        ...setupInstructions.map(deserializeInstruction),
        deserializeInstruction(swapInstructionPayload),
        deserializeInstruction(cleanupInstruction),
      ],
      undefined,
      addressLookupTableAccounts,
    );

    return signature;
  } catch (error: any) {
    throw new Error(`Swap failed: ${error.message}`);
  }
}
