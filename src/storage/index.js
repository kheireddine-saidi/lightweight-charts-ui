/**
 * Storage barrel — import storage classes from one place.
 */
export { IMarketDataStorage, ITradeStorage, ISessionStorage } from './StorageInterfaces';
export { LocalStorageSessionStorage, localSessionStorage } from './LocalStorageSessionStorage';
