import { validatePack } from '../pack';
import type { Pack } from '../types';
import { readText } from './cli-util';

/**
 * Reads a pack JSON file and validates it (throws PackError listing every schema problem). A file
 * that cannot be read fails as `Cannot read <path> (<code>)`, as every ce input file does.
 */
export async function loadPack(path: string): Promise<Pack> {
  const text = await readText(path);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`${path} is not valid JSON (${(err as Error).message})`, { cause: err });
  }
  return validatePack(data);
}
