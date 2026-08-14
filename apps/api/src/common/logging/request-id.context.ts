import { AsyncLocalStorage } from 'async_hooks';

export const requestIdStorage = new AsyncLocalStorage<string>();
