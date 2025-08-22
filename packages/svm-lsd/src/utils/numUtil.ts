import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

export const isValidNum = (num: string | number) => {
  if (num === "" || num === undefined || num === null || isNaN(Number(num))) {
    return false;
  }
  return true;
};

export const chainAmountToHuman = (num: string | number, decimals?: number) => {
  if (!isValidNum(num)) {
    return "--";
  }
  const factor = decimals ? 10 ** decimals : LAMPORTS_PER_SOL;

  return Number(num) / Number(factor) + "";
};

export const toChainAmount = (num: string | number, decimals?: number) => {
  if (!isValidNum(num)) {
    return new BN(0);
  }

  const factor = decimals ? 10 ** decimals : LAMPORTS_PER_SOL;

  return new BN((Number(num) * factor).toFixed(0));
};
