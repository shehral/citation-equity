// The root `pnpm test` runs Vitest directly, without this package's pretest
// script, so the generated samples file is written here as well.
import { generateSamples } from '../scripts/gen-samples.mjs';

export default function setup() {
  generateSamples();
}
