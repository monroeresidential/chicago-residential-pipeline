/**
 * Transaction-level advisory lock taken by every submission and every approval, so intake never compares against
 * a filing or queue state that an approval is changing at the same moment (and parallel chunks see each other).
 */
export const INTAKE_LOCK = 727275;
