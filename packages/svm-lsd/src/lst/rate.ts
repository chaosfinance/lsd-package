import { getMint } from "@solana/spl-token";
import { AnchorProgram } from "../anchorProgram";
import { ERR_EMPTY_PROGRAM_ID } from "../constants";
import {
  getConnection,
  getTokenProgramId,
  ProgramIds,
  provider,
} from "../provider";
import { isEmptyString } from "../utils/commonUtil";
import { chainAmountToHuman } from "../utils/numUtil";
import { PublicKey } from "@solana/web3.js";

/**
 * Get LST rate
 * @returns LST rate
 */
export const getLstRate = async (programIds: ProgramIds) => {
  const { lsdProgramId, stakeManagerAddress } = programIds;
  if (isEmptyString(lsdProgramId) || isEmptyString(stakeManagerAddress)) {
    throw new Error(ERR_EMPTY_PROGRAM_ID);
  }

  const anchorProgram = new AnchorProgram(programIds);
  await anchorProgram.init();
  const { program, stakingTokenMintAddress } = anchorProgram;
  const connection = getConnection();
  if (!program || !connection) return;

  const stakeManagerAccount = await program.account.stakeManager.fetch(
    stakeManagerAddress
  );

  const tokenProgramId = await getTokenProgramId(stakingTokenMintAddress);
  if (!tokenProgramId) return;

  const mintInfo = await getMint(
    connection,
    new PublicKey(stakingTokenMintAddress),
    undefined,
    new PublicKey(tokenProgramId)
  );
  if (!mintInfo) return;

  const { decimals } = mintInfo;

  return chainAmountToHuman(stakeManagerAccount.rate.toString(), decimals);
};
