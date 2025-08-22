import { PublicKey } from "@solana/web3.js";
import {
  getConnection,
  getTokenProgramId,
  ProgramIds,
  provider,
} from "../provider";
import { getLstRate } from "./rate";
import { isEmptyString } from "../utils/commonUtil";
import { ERR_EMPTY_PROGRAM_ID } from "../constants";
import { AnchorProgram } from "../anchorProgram";
import { chainAmountToHuman } from "../utils/numUtil";
import { getMint } from "@solana/spl-token";

/**
 * Get total LST suppy amount
 * @returns total LST amount
 */
export const getTotalLstAmount = async (programIds: ProgramIds) => {
  const { lsdProgramId, stakeManagerAddress } = programIds;
  if (isEmptyString(lsdProgramId) || isEmptyString(stakeManagerAddress)) {
    throw new Error(ERR_EMPTY_PROGRAM_ID);
  }

  const connection = getConnection();
  if (!connection) return;

  try {
    const anchorProgram = new AnchorProgram(programIds);
    await anchorProgram.init();

    const { lsdTokenMintAddress } = anchorProgram;
    const totalSupply = await connection.getTokenSupply(
      new PublicKey(lsdTokenMintAddress)
    );
    if (!totalSupply || !totalSupply.value) return;

    return totalSupply.value.uiAmount + "";
  } catch (err: any) {
    return;
  }
};

/**
 * Get total staked token amount
 * @returns total staked token amount
 */
export const getTotalStakedAmount = async (programIds: ProgramIds) => {
  const totalLstAmount = await getTotalLstAmount(programIds);
  const lstRate = await getLstRate(programIds);
  if (!totalLstAmount || !lstRate) return;

  return Number(totalLstAmount) * Number(lstRate) + "";
};

export const getUserMinStakeAmount = async (programIds: ProgramIds) => {
  const { lsdProgramId, stakeManagerAddress } = programIds;
  if (isEmptyString(lsdProgramId) || isEmptyString(stakeManagerAddress)) {
    throw new Error(ERR_EMPTY_PROGRAM_ID);
  }

  try {
    const anchorProgram = new AnchorProgram(programIds);
    await anchorProgram.init();

    const { program, stakingTokenMintAddress } = anchorProgram;
    if (!program) return;
    const stakeManagerAccount = await program.account.stakeManager.fetch(
      stakeManagerAddress
    );

    const tokenProgramId = await getTokenProgramId(stakingTokenMintAddress);
    if (!tokenProgramId) return;

    const connection = getConnection();
    if (!connection) return;

    const mintInfo = await getMint(
      connection,
      new PublicKey(stakingTokenMintAddress),
      undefined,
      new PublicKey(tokenProgramId)
    );
    if (!mintInfo) return;

    const { decimals } = mintInfo;

    return chainAmountToHuman(
      stakeManagerAccount.minStakeAmount.toString(),
      decimals
    );
  } catch (err: any) {
    console.log(err);
  }
};

export const getUnbondingDuration = async (programIds: ProgramIds) => {
  const { lsdProgramId, stakeManagerAddress } = programIds;
  if (isEmptyString(lsdProgramId) || isEmptyString(stakeManagerAddress)) {
    throw new Error(ERR_EMPTY_PROGRAM_ID);
  }

  try {
    const anchorProgram = new AnchorProgram(programIds);
    await anchorProgram.init();

    const { program } = anchorProgram;
    if (!program) return;
    const stakeManagerAccount = await program.account.stakeManager.fetch(
      stakeManagerAddress
    );

    return (
      Number(stakeManagerAccount.unbondingDuration) *
      Number(stakeManagerAccount.eraSeconds)
    );
  } catch (err: any) {
    console.log(err);
  }
};
