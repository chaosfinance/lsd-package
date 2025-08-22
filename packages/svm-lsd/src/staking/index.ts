import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  TransactionResponse,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  getMint,
} from "@solana/spl-token";
import { createMemoInstruction } from "@solana/spl-memo";
import {
  getConnection,
  getTokenProgramId,
  ProgramIds,
  provider,
} from "../provider";
import {
  getSplTokenAccount,
  isSolanaCancelError,
  sendSolanaTransaction,
} from "../utils/solanaUtil";
import { AnchorProgram } from "../anchorProgram";
import {
  chainAmountToHuman,
  isValidNum,
  toChainAmount,
} from "../utils/numUtil";
import {
  ERR_EMPTY_PROGRAM_ID,
  ERR_EMPTY_TOKEN_MINT_ADDRESS,
  ERR_NOT_A_VALID_NUMBER,
  ERR_SPL_TOKEN_ACCOUNT_NOT_FOUND,
  ERR_TX_FAILED,
  ERR_TX_REJECTED,
  ERR_WALLET_NOT_REGISTERED,
} from "../constants";
import { isEmptyString, sleep } from "../utils/commonUtil";
import { BN } from "@coral-xyz/anchor";
import bs58 from "bs58";

const POOL_SEED = "pool_seed";
const TX_RETRY_COUNT = 20;

export interface WithdrawInfo {
  overallAmount: string;
  claimableAmount: string;
  remainingTimeInSeconds: number;
}

/**
 * Stake token to LSD Program
 * @param amount amount of token to stake
 * @returns transaction hash
 */
export const stakeToken = async (
  amount: string | number,
  programIds: ProgramIds
) => {
  if (!isValidNum(amount)) {
    throw new Error(ERR_NOT_A_VALID_NUMBER);
  }

  try {
    const { _provider } = provider;
    if (!_provider.publicKey || !_provider.signTransaction)
      throw new Error(ERR_WALLET_NOT_REGISTERED);

    const { lsdProgramId, stakeManagerAddress } = programIds;
    if (isEmptyString(lsdProgramId) || isEmptyString(stakeManagerAddress)) {
      throw new Error(ERR_EMPTY_PROGRAM_ID);
    }

    const anchorProgram = new AnchorProgram(programIds);
    await anchorProgram.init();

    const connection = getConnection();
    if (!_provider || !connection || !anchorProgram.program) return;
    const userAddress = _provider.publicKey.toString();

    const { lsdTokenMintAddress, stakingTokenMintAddress } = anchorProgram;
    if (
      isEmptyString(lsdTokenMintAddress) ||
      isEmptyString(stakingTokenMintAddress)
    ) {
      throw new Error(ERR_EMPTY_TOKEN_MINT_ADDRESS);
    }

    const tokenProgramId = await getTokenProgramId(stakingTokenMintAddress);
    if (!tokenProgramId) return;

    const lsdProgramPubkey = new PublicKey(lsdProgramId);
    const stakeManagerPubkey = new PublicKey(stakeManagerAddress);
    const lsdTokenMintPubkey = new PublicKey(lsdTokenMintAddress);
    const tokenProgramPubkey = new PublicKey(tokenProgramId);
    const stakingTokenMintPubkey = new PublicKey(stakingTokenMintAddress);

    const transaction = new Transaction();

    const userLsdTokenAddress = await getAssociatedTokenAddress(
      lsdTokenMintPubkey,
      _provider.publicKey,
      true,
      tokenProgramPubkey
    );
    const userStakingTokenAddress = await getAssociatedTokenAddress(
      stakingTokenMintPubkey,
      _provider.publicKey,
      true,
      tokenProgramPubkey
    );
    const stakeManagerStakingTokenAddress = await getAssociatedTokenAddress(
      stakingTokenMintPubkey,
      stakeManagerPubkey,
      true,
      tokenProgramPubkey
    );

    const userLsdTokenAccount = await connection.getAccountInfo(
      new PublicKey(userLsdTokenAddress)
    );

    if (!userLsdTokenAccount) {
      const createInstruction = createAssociatedTokenAccountInstruction(
        _provider.publicKey,
        userLsdTokenAddress,
        _provider.publicKey,
        lsdTokenMintPubkey,
        tokenProgramPubkey
      );
      transaction.add(createInstruction);
    }

    const mintInfo = await getMint(
      connection,
      stakingTokenMintPubkey,
      undefined,
      tokenProgramPubkey
    );
    if (!mintInfo) return;

    const { decimals } = mintInfo;

    const anchorInstruction = await anchorProgram.program.methods
      .stake(toChainAmount(amount, decimals))
      .accounts({
        user: _provider.publicKey,
        rentPayer: _provider.publicKey,
        stakeManager: stakeManagerPubkey,
        lsdTokenMint: lsdTokenMintPubkey,
        stakingTokenMint: stakingTokenMintPubkey,
        userLsdTokenAccount: userLsdTokenAddress,
        userStakingTokenAccount: userStakingTokenAddress,
        stakeManagerStakingTokenAccount: stakeManagerStakingTokenAddress,
        tokenProgram: tokenProgramPubkey,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    transaction.add(anchorInstruction);

    const memoInstruction = createMemoInstruction(`1:${provider._projectId}`, [
      _provider.publicKey,
    ]);
    transaction.add(memoInstruction);

    const txHash = await sendSolanaTransaction(
      transaction,
      connection,
      _provider.signTransaction,
      _provider.publicKey
    );

    let retryCount = 0;
    let transactionDetail: TransactionResponse | null | undefined = undefined;

    while (retryCount < TX_RETRY_COUNT && txHash) {
      retryCount++;
      transactionDetail = await connection.getTransaction(txHash, {
        commitment: "finalized",
      });
      if (transactionDetail) {
        break;
      }
      await sleep(3000);
    }

    if (!transactionDetail || transactionDetail.meta?.err) {
      throw new Error(ERR_TX_FAILED);
    }

    return txHash;
  } catch (err: any) {
    if (isSolanaCancelError(err)) {
      throw new Error(ERR_TX_REJECTED);
    }
    throw new Error(err.message);
  }
};

/**
 * Unstake lstToken from LSD Program
 * @param amount amount of lstToken to unstake
 * @returns transaction hash
 */
export const unstakeLstToken = async (
  amount: string | number,
  programIds: ProgramIds
) => {
  if (!isValidNum(amount)) {
    throw new Error(ERR_NOT_A_VALID_NUMBER);
  }

  try {
    const { _provider } = provider;
    if (!_provider.publicKey || !_provider.signTransaction)
      throw new Error(ERR_WALLET_NOT_REGISTERED);

    const { lsdProgramId, stakeManagerAddress } = programIds;
    if (isEmptyString(lsdProgramId) || isEmptyString(stakeManagerAddress)) {
      throw new Error(ERR_EMPTY_PROGRAM_ID);
    }

    const anchorProgram = new AnchorProgram(programIds);
    await anchorProgram.init();

    const connection = getConnection();
    if (!_provider || !connection || !anchorProgram.program) return;
    const userAddress = _provider.publicKey.toString();

    const { lsdTokenMintAddress, stakingTokenMintAddress } = anchorProgram;
    if (
      isEmptyString(lsdTokenMintAddress) ||
      isEmptyString(stakingTokenMintAddress)
    ) {
      throw new Error(ERR_EMPTY_TOKEN_MINT_ADDRESS);
    }

    const tokenProgramId = await getTokenProgramId(stakingTokenMintAddress);
    if (!tokenProgramId) return;

    const stakeManagerPubkey = new PublicKey(stakeManagerAddress);
    const lsdTokenMintPubkey = new PublicKey(lsdTokenMintAddress);
    const tokenProgramPubkey = new PublicKey(tokenProgramId);

    const splTokenAccount = await getSplTokenAccount(
      connection,
      userAddress,
      lsdTokenMintAddress
    );

    if (!splTokenAccount) {
      throw new Error(ERR_SPL_TOKEN_ACCOUNT_NOT_FOUND);
    }

    const transaction = new Transaction();

    const unstakeAccountKeypair = Keypair.generate();
    const unstakeAccountRent =
      await connection.getMinimumBalanceForRentExemption(100);

    const createAccountInstruction = SystemProgram.createAccount({
      fromPubkey: _provider.publicKey,
      newAccountPubkey: unstakeAccountKeypair.publicKey,
      lamports: unstakeAccountRent,
      space: 100,
      programId: stakeManagerPubkey,
    });

    // const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
    //   microLamports: COMPUTE_UNIT_PRICE,
    // });
    // transaction.add(addPriorityFee);

    const mintInfo = await getMint(
      connection,
      new PublicKey(stakingTokenMintAddress),
      undefined,
      tokenProgramPubkey
    );
    if (!mintInfo) return;

    const { decimals } = mintInfo;

    const anchorInstruction = await anchorProgram.program.methods
      .unstake(toChainAmount(amount, decimals))
      .accounts({
        user: _provider.publicKey,
        rentPayer: _provider.publicKey,
        stakeManager: stakeManagerPubkey,
        lsdTokenMint: lsdTokenMintPubkey,
        userLsdTokenAccount: splTokenAccount.pubkey,
        unstakeAccount: unstakeAccountKeypair.publicKey,
        tokenProgram: tokenProgramPubkey,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    transaction.add(anchorInstruction);

    const txHash = await sendSolanaTransaction(
      transaction,
      connection,
      _provider.signTransaction,
      _provider.publicKey,
      [unstakeAccountKeypair]
    );

    let retryCount = 0;
    let transactionDetail: TransactionResponse | null | undefined = undefined;

    while (retryCount < TX_RETRY_COUNT && txHash) {
      retryCount++;
      transactionDetail = await connection.getTransaction(txHash, {
        commitment: "finalized",
      });
      if (transactionDetail) {
        break;
      }
      await sleep(3000);
    }

    if (!transactionDetail || transactionDetail.meta?.err) {
      throw new Error(ERR_TX_FAILED);
    }

    return txHash;
  } catch (err: any) {
    if (isSolanaCancelError(err)) {
      throw new Error(ERR_TX_REJECTED);
    }
    throw new Error(err.message);
  }
};

/**
 * Get user's withdraw info from LSD Program
 * @returns user withdraw info
 */
export const getUserWithdrawInfo = async (
  programIds: ProgramIds
): Promise<WithdrawInfo | undefined> => {
  try {
    const { _provider } = provider;
    if (!_provider.publicKey || !_provider.signTransaction)
      throw new Error(ERR_WALLET_NOT_REGISTERED);

    const { lsdProgramId, stakeManagerAddress } = programIds;
    if (isEmptyString(lsdProgramId) || isEmptyString(stakeManagerAddress)) {
      throw new Error(ERR_EMPTY_PROGRAM_ID);
    }

    const anchorProgram = new AnchorProgram(programIds);
    await anchorProgram.init();

    const connection = getConnection();
    if (!_provider || !connection || !anchorProgram.program) return;

    const { stakingTokenMintAddress } = anchorProgram;

    const stakeManagerAccount =
      await anchorProgram.program.account.stakeManager.fetch(
        new PublicKey(stakeManagerAddress)
      );

    const { stakingPool } = stakeManagerAccount;
    const stakingPoolStakingTokenAddress = await getSplTokenAccount(
      connection,
      stakingPool.toString(),
      stakingTokenMintAddress
    );
    if (!stakingPoolStakingTokenAddress) return;
    // console.log({
    //   stakingPoolStakingTokenAddress:
    //     stakingPoolStakingTokenAddress.pubkey.toString(),
    // });

    const b1 = new PublicKey(stakeManagerAddress).toBytes();
    const b2 = _provider.publicKey.toBytes();
    const hexBts = new Uint8Array(b1.length + b2.length);
    hexBts.set(b1, 0);
    hexBts.set(b2, b1.length);
    const b = bs58.encode(hexBts);

    const accounts = await connection.getParsedProgramAccounts(
      new PublicKey(lsdProgramId),
      {
        commitment: "confirmed",
        filters: [
          { dataSize: 216 },
          {
            memcmp: {
              offset: 8,
              bytes: b,
              encoding: "base58",
            },
          },
        ],
      }
    );

    let overallWithdrawAmount = new BN(0);
    let withdrawableAmount = new BN(0);
    let remainingTimes: number[] = [];

    const { latestEra, eraSeconds } = stakeManagerAccount;

    const accountRequests = accounts.map((account) => {
      return (async () => {
        try {
          if (!anchorProgram.program) return;
          const unstakeAccount =
            await anchorProgram.program.account.unstakeAccount.fetch(
              account.pubkey
            );

          const { amount, withdrawableEra } = unstakeAccount;
          overallWithdrawAmount.iadd(amount);
          if (withdrawableEra.lte(latestEra)) {
            withdrawableAmount.iadd(amount);
            remainingTimes.push(0);
          } else {
            const _remainingTime = withdrawableEra
              .sub(latestEra)
              .mul(eraSeconds);
            remainingTimes.push(Number(_remainingTime.toString()));
          }
        } catch {}
      })();
    });

    await Promise.all(accountRequests);

    const minRemainingTime = Math.min(...remainingTimes);
    return {
      overallAmount: chainAmountToHuman(overallWithdrawAmount.toString()),
      claimableAmount: chainAmountToHuman(withdrawableAmount.toString()),
      remainingTimeInSeconds: minRemainingTime < 0 ? 0 : minRemainingTime,
    };
  } catch (err: any) {}
};

/**
 * Withdraw unstaked token
 * @returns transaction hash
 */
export const withdrawToken = async (programIds: ProgramIds) => {
  try {
    const { _provider } = provider;
    if (!_provider.publicKey || !_provider.signTransaction)
      throw new Error(ERR_WALLET_NOT_REGISTERED);

    const { lsdProgramId, stakeManagerAddress } = programIds;
    if (isEmptyString(lsdProgramId) || isEmptyString(stakeManagerAddress)) {
      throw new Error(ERR_EMPTY_PROGRAM_ID);
    }

    const anchorProgram = new AnchorProgram(programIds);
    await anchorProgram.init();

    const connection = getConnection();
    if (!_provider || !connection || !anchorProgram.program) return;
    const userAddress = _provider.publicKey.toString();

    const { stakingTokenMintAddress } = anchorProgram;
    if (isEmptyString(stakingTokenMintAddress)) {
      throw new Error(ERR_EMPTY_TOKEN_MINT_ADDRESS);
    }

    const tokenProgramId = await getTokenProgramId(stakingTokenMintAddress);
    if (!tokenProgramId) return;

    const stakeManagerAccount =
      await anchorProgram.program.account.stakeManager.fetch(
        new PublicKey(stakeManagerAddress)
      );

    const { latestEra } = stakeManagerAccount;

    const b1 = new PublicKey(stakeManagerAddress).toBytes();
    const b2 = _provider.publicKey.toBytes();
    const hexBts = new Uint8Array(b1.length + b2.length);
    hexBts.set(b1, 0);
    hexBts.set(b2, b1.length);

    const b = bs58.encode(hexBts);

    const unstakeAccounts = await connection.getParsedProgramAccounts(
      new PublicKey(lsdProgramId),
      {
        commitment: "confirmed",
        filters: [
          { dataSize: 216 },
          {
            memcmp: {
              offset: 8,
              bytes: b,
              encoding: "base58",
            },
          },
        ],
      }
    );

    const stakeManagerPubkey = new PublicKey(stakeManagerAddress);
    const stakingTokenMintPubkey = new PublicKey(stakingTokenMintAddress);
    const tokenProgramPubkey = new PublicKey(tokenProgramId);

    const userStakingTokenAddress = await getAssociatedTokenAddress(
      stakingTokenMintPubkey,
      _provider.publicKey,
      true,
      tokenProgramPubkey
    );
    const stakeManagerStakingTokenAddress = await getAssociatedTokenAddress(
      stakingTokenMintPubkey,
      stakeManagerPubkey,
      true,
      tokenProgramPubkey
    );

    const instructions: TransactionInstruction[] = [];

    const accountRequests = unstakeAccounts.map((account) => {
      return (async () => {
        if (!anchorProgram.program) return;
        const unstakeAccount =
          await anchorProgram.program.account.unstakeAccount.fetch(
            account.pubkey
          );
        const { withdrawableEra } = unstakeAccount;

        if (withdrawableEra.lte(latestEra)) {
          const anchorInstruction = await anchorProgram.program.methods
            .withdraw()
            .accounts({
              user: _provider.publicKey,
              rentPayer: _provider.publicKey,
              stakeManager: stakeManagerPubkey,
              unstakeAccount: account.pubkey,
              stakingTokenMint: stakingTokenMintPubkey,
              userStakingTokenAccount: userStakingTokenAddress,
              stakeManagerStakingTokenAccount: stakeManagerStakingTokenAddress,
              tokenProgram: tokenProgramPubkey,
              associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .instruction();
          instructions.push(anchorInstruction);
        }
      })();
    });

    await Promise.all(accountRequests);

    const txHashs: string[] = [];
    const chunkSize = 10;
    for (let i = 0; i < instructions.length; i += chunkSize) {
      const tx = new Transaction();
      const userStakingTokenAccount = await connection.getAccountInfo(
        userStakingTokenAddress
      );
      if (!userStakingTokenAccount) {
        const ataInstruction = createAssociatedTokenAccountInstruction(
          _provider.publicKey,
          userStakingTokenAddress,
          _provider.publicKey,
          stakingTokenMintPubkey,
          tokenProgramPubkey
        );
        tx.add(ataInstruction);
      }

      tx.add(...instructions.slice(i, i + chunkSize));

      const txHash = await sendSolanaTransaction(
        tx,
        connection,
        _provider.signTransaction,
        _provider.publicKey
      );

      let retryCount = 0;
      let transactionDetail: TransactionResponse | null | undefined = undefined;

      while (retryCount < TX_RETRY_COUNT && txHash) {
        retryCount++;
        transactionDetail = await connection.getTransaction(txHash, {
          commitment: "finalized",
        });
        if (transactionDetail) {
          break;
        }
        await sleep(3000);
      }

      if (!transactionDetail || transactionDetail.meta?.err) {
        throw new Error(ERR_TX_FAILED);
      }

      txHashs.push(txHash);
    }
    return txHashs;
  } catch (err: any) {
    if (isSolanaCancelError(err)) {
      throw new Error(ERR_TX_REJECTED);
    }
    throw new Error(err.message);
  }
};
