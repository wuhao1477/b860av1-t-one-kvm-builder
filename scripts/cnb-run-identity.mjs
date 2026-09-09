#!/usr/bin/env node

import { createHash } from 'node:crypto';

const buildId = process.env.CNB_BUILD_ID || process.env.CNB_COMMIT || '';
if (!buildId) throw new Error('CNB_BUILD_ID or CNB_COMMIT is required');
const digest = createHash('sha256').update(buildId).digest('hex');
const runNumber = (BigInt(`0x${digest.slice(0, 13)}`) % 9_000_000_000_000n) + 1n;
const runAttempt = process.env.CNB_IS_RETRY === 'true' ? 2 : 1;
process.stdout.write(`${runNumber}.${runAttempt}\n`);
