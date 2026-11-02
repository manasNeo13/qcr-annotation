import { env } from '../config/env.js';

/** Picks data source. Mongo driver loaded only when used. */
export const repo =
  env.DATA_SOURCE === 'mongo' ? (await import('./mongo.js')).mongoRepo : (await import('./memory.js')).memoryRepo;
