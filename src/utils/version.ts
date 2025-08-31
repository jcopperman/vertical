import { readFileSync } from 'fs';
import { join } from 'path';

export function getVersion(): string {
  try {
    const packageJsonPath = join(__dirname, '../../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return packageJson.version || '1.0.0';
  } catch (error) {
    // Fallback version if package.json cannot be read
    return '1.0.0';
  }
}

export function getBuildInfo(): {
  version: string;
  buildDate: string;
  nodeVersion: string;
} {
  return {
    version: getVersion(),
    buildDate: new Date().toISOString(),
    nodeVersion: process.version,
  };
}
