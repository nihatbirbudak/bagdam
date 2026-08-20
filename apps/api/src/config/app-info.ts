import { readFileSync } from 'fs';
import { resolve } from 'path';
import { APP_ROOT } from './paths';

interface PackageJsonLike {
  name?: string;
  version?: string;
}

/** apps/api/package.json'ı çalışma anında okur (rootDir dışı import yerine). */
function readPackageJson(): PackageJsonLike {
  try {
    return JSON.parse(readFileSync(resolve(APP_ROOT, 'package.json'), 'utf8')) as PackageJsonLike;
  } catch {
    return {};
  }
}

const pkg = readPackageJson();

/** Paket adı (health çıktısı / log). */
export const APP_NAME = pkg.name ?? '@bagdam/api';

/** Paket sürümü — health `version` alanı ve view `assetVersion` değeri. */
export const APP_VERSION = pkg.version ?? '0.0.0';
