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
  // Suite'ler gerçek bagdam_dev DB'sini paylaşır; paralel worker'lar ortak satırlarda
  // (tier isRecommended, settings cache, audit) yarış yaratıp nadir flake üretiyordu → seri koş.
  maxWorkers: 1,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};

export default config;
