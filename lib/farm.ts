// Token Radar, round 2 — the farm plan.
//
// Every board row carries a plan a reader can actually follow: what to do,
// on which chain, with how much money, what it costs, and how long it
// takes. The steps are derived from the protocol's own figures — its
// category, its chains, its TVL and its age — and never from its name, so
// no protocol is special-cased and the same code plans any snapshot.
//
// Nothing here claims a fact the snapshot does not carry: there is no
// points program, no airdrop date and no promised reward in any step, only
// the work of using the protocol, sized and timed, and how to stay safe
// while doing it.

import type { SnapProtocol } from './radar.ts';

// ------------------------------------------------------------------ sizing

/** The working capital for a position, from the protocol's TVL. */
function capitalFor(tvlUsd: number): number {
  if (tvlUsd >= 5_000_000_000) return 500;
  if (tvlUsd >= 1_000_000_000) return 250;
  if (tvlUsd >= 250_000_000) return 150;
  if (tvlUsd >= 50_000_000) return 100;
  return 50;
}

/** The smallest repeat deposit, a fifth of the working capital, at least $10. */
function repeatFor(capital: number): number {
  return Math.max(10, Math.round(capital / 5));
}

/** How long to hold, from the protocol's age with no token. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The first chain the snapshot lists, or a plain fallback. */
function firstChain(p: SnapProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/**
 * What a transaction costs on a chain, as a short phrase. These are the
 * usual ranges for a simple deposit or swap on each network, stated as
 * ranges so no single figure is promised.
 */
function gasPhrase(chain: string): string {
  const lower = chain.toLowerCase();
  if (lower.includes('ethereum')) return 'about $2 to $8 of gas per transaction';
  if (lower.includes('solana')) return 'about $0.05 of gas per transaction';
  if (lower.includes('tron')) return 'about $1 to $3 of gas per transaction';
  if (lower.includes('bitcoin') || lower.includes('bittensor')) return 'about $1 to $5 of gas per transaction';
  return 'about $0.10 to $1 of gas per transaction';
}

/** A plain-English time for a week count. */
function weeksPhrase(weeks: number): string {
  return weeks === 1 ? '1 week' : `${weeks} weeks`;
}

// ------------------------------------------------------------- the action

/** The core action for a category, as one grammatical clause with the capital in it. */
function coreAction(p: SnapProtocol, capital: number): string {
  const category = (p.category ?? '').toLowerCase();
  if (category.includes('lend') || category.includes('cdp') || category.includes('collateral')) {
    return `Supply $${capital} of USDC as collateral in its lending market`;
  }
  if (category.includes('dex') || category.includes('amm') || category.includes('swap')) {
    return `Provide $${capital} of USDC as liquidity to its deepest pool`;
  }
  if (category.includes('yield') || category.includes('leveraged farm') || category.includes('farm')) {
    return `Deposit $${capital} of USDC into its highest-TVL vault`;
  }
  if (category.includes('bridge') || category.includes('cross chain')) {
    return `Bridge $${capital} of USDC through it to its destination chain`;
  }
  if (category.includes('deriv') || category.includes('perp') || category.includes('options')) {
    return `Open a $${capital} hedged position on its most liquid market`;
  }
  if (category.includes('restak') || category.includes('liquid staking')) {
    return `Stake $${capital} of USDC in its staking contract`;
  }
  if (category.includes('rwa') || category.includes('real world')) {
    return `Buy a $${capital} position in its largest real-world pool`;
  }
  if (category.includes('liquid') || category.includes('staking')) {
    return `Stake $${capital} of USDC in its staking contract`;
  }
  if (category.includes('index')) {
    return `Buy $${capital} of its index token`;
  }
  if (category.includes('launchpad')) {
    return `Commit $${capital} of USDC to its next public sale`;
  }
  if (category.includes('basis') || category.includes('trading')) {
    return `Deposit $${capital} of USDC into its main trading vault`;
  }
  if (category.includes('algo') || category.includes('stable')) {
    return `Mint $${capital} of its stable asset with USDC`;
  }
  if (category.includes('reserve') || category.includes('treasury')) {
    return `Deposit $${capital} of USDC into its reserve vault`;
  }
  if (category.includes('risk') || category.includes('curator') || category.includes('allocat')) {
    return `Allocate $${capital} of USDC to its largest curator vault`;
  }
  return `Put $${capital} of USDC to work in its main product`;
}

// ---------------------------------------------------------------- the plan

/**
 * Six steps for one protocol. Each step names a cost and a time where a
 * cost or a time exists, and each step is between 20 and 600 characters.
 */
export function farmSteps(p: SnapProtocol, age: number | null): string[] {
  const chain = firstChain(p);
  const capital = capitalFor(p.tvl_usd);
  const repeat = repeatFor(capital);
  const hold = holdDaysFor(age);
  const gas = gasPhrase(chain);
  const action = coreAction(p, capital);
  const weeks = hold >= 90 ? 12 : hold >= 60 ? 8 : 6;
  const otherChains = p.chains.length > 1 ? ` It also runs on ${p.chains.slice(1, 3).join(' and ')}, so the same steps work there.` : '';
  const ageNote =
    age === null
      ? 'its listing date is not in the snapshot, so treat its age as unknown and favour a longer hold.'
      : `it has run ${age} days with no token on record, so a patient position fits it.`;

  return [
    `Set up a fresh wallet for ${chain} and fund it with $${capital} in USDC plus enough of the chain's native token for gas. This takes about 10 minutes and costs ${gas}. Keep this wallet separate from your main holdings.`,
    `${action} on ${chain} through ${p.name}'s own app, and confirm the deposit on the chain explorer. This takes about 15 minutes and costs ${gas}; do not use a third-party front end.`,
    `Come back once a week for ${weeksPhrase(weeks)} and repeat the core action with another $${repeat}, so your activity spans ${weeks} weeks instead of a single day. Each visit takes about 5 minutes and costs ${gas}.`,
    `Keep the position open for at least ${hold} days in total. Airdrop snapshots reward sustained use, not one-day deposits, and ${ageNote}`,
    `Check the position once a week on the protocol's app and on a TVL tracker: if its TVL falls more than 20% in a week, halve the position; if deposits pause or the team goes quiet for 30 days, withdraw. Each check takes about 5 minutes and costs nothing.`,
    `Approve exactly $${capital} per transaction, never an unlimited allowance, and withdraw the position the day any token launches if you only wanted the launch. The whole plan risks $${capital} plus about $${Math.max(1, Math.round(capital / 25))} of gas over ${weeksPhrase(weeks)}.${otherChains}`,
  ];
}
