import type { API } from 'homebridge';
import { BinDayPlatform, PLATFORM_NAME } from './platform';

export = (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, BinDayPlatform);
};
