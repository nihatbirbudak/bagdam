import type { Config } from 'jest';

// Birim/entegrasyon testleri: src altındaki *.spec.ts / *.test.ts dosyaları.
// DB gerektiren testler F2'de (globalSetup ile bagdam_test) eklenecek.
const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\.(spec|test)\.ts$',
  transform: {
    '^.+\.ts$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.ts'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};

export default config;
