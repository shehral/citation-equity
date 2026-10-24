#!/usr/bin/env node
// The `ce` command. Runs the built code (pnpm build); from source use `pnpm ce ...`.
import { runCli } from '../dist/node/index.js';

process.exitCode = await runCli(process.argv.slice(2));
