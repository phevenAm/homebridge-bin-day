import { promises as fs } from 'fs';
import path from 'path';
import type {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';
import { COUNCILS, type BinCollection } from './councils';
import { isAlertActive, parseTime } from './schedule';
import { startHttpServer, type ApiState } from './http';

export const PLATFORM_NAME = 'BinDay';
export const PLUGIN_NAME = 'homebridge-bin-day';

interface BinDayConfig extends PlatformConfig {
  council?: string;
  postcode?: string;
  houseNumber?: string;
  alertTime?: string;
  endTime?: string;
  refreshHours?: number;
  httpPort?: number;
  apiKey?: string;
  binColours?: { bin?: string; colour?: string }[];
}

export class BinDayPlatform implements DynamicPlatformPlugin {
  private readonly accessories = new Map<string, PlatformAccessory>();
  private readonly lastState = new Map<string, boolean>();
  private readonly cacheFile: string;
  private bins: BinCollection[] = [];
  private address?: string;
  private lastAttempt?: string;
  private lastSuccess?: string;
  private lastError?: string;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  private readonly version = (require('../package.json') as { version: string }).version;

  constructor(
    private readonly log: Logging,
    private readonly config: BinDayConfig,
    private readonly api: API,
  ) {
    this.cacheFile = path.join(api.user.storagePath(), 'bin-day-cache.json');
    api.on('didFinishLaunching', () => {
      void this.start();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.set(accessory.UUID, accessory);
  }

  private async start(): Promise<void> {
    this.log.info(`Bin Day v${this.version} starting`);
    const { postcode, houseNumber } = this.config;
    const council = (this.config.council ?? 'wokingham').toLowerCase();
    if (!postcode || !houseNumber) {
      this.log.error('Please add your postcode and house number in the Bin Day settings.');
      return;
    }
    if (!COUNCILS[council]) {
      this.log.error(`Council "${council}" isn't supported yet.`);
      return;
    }

    await this.loadCache();

    const port = this.config.httpPort ?? 8586;
    if (port > 0) {
      startHttpServer(port, this.config.apiKey?.trim() || undefined, this.log, () => this.apiState());
    }

    this.syncAccessories(false);
    this.updateStates();

    await this.refresh();

    const hours = Math.max(1, this.config.refreshHours ?? 12);
    setInterval(() => void this.refresh(), hours * 60 * 60 * 1000);
    setInterval(() => this.updateStates(), 60 * 1000);
  }

  private async refresh(): Promise<void> {
    const council = (this.config.council ?? 'wokingham').toLowerCase();
    this.lastAttempt = new Date().toISOString();
    try {
      const result = await COUNCILS[council](this.config.postcode as string, this.config.houseNumber as string);
      if (result.bins.length === 0) {
        this.log.warn('Council site showed no bins. Keeping the saved dates.');
        return;
      }
      this.bins = result.bins;
      this.address = result.address;
      this.lastSuccess = new Date().toISOString();
      this.lastError = undefined;
      await this.saveCache();
      this.log.info(`Bin days for ${result.address}:`);
      for (const bin of this.bins) {
        this.log.info(`  ${bin.type}: ${bin.date}`);
      }
      this.syncAccessories(true);
      this.updateStates();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = message;
      this.log.warn(`Couldn't read the council site, using saved dates. (${message})`);
    }
  }

  private apiState(): ApiState {
    const colours: Record<string, string> = {};
    for (const entry of this.config.binColours ?? []) {
      if (entry.bin && entry.colour) {
        colours[entry.bin] = entry.colour;
      }
    }
    return {
      version: this.version,
      council: this.config.council ?? 'wokingham',
      address: this.address,
      bins: this.bins,
      alertTime: parseTime(this.config.alertTime, '18:00'),
      endTime: parseTime(this.config.endTime, '12:00'),
      colours,
      lastAttempt: this.lastAttempt,
      lastSuccess: this.lastSuccess,
      lastError: this.lastError,
    };
  }

  private uuidFor(type: string): string {
    return this.api.hap.uuid.generate(`bin-day:${type}`);
  }

  /** One occupancy sensor per bin type. Removes old ones only after a good refresh. */
  private syncAccessories(removeStale: boolean): void {
    const { Service, Characteristic } = this.api.hap;
    const wanted = new Set<string>();

    for (const bin of this.bins) {
      const uuid = this.uuidFor(bin.type);
      wanted.add(uuid);
      let accessory = this.accessories.get(uuid);
      if (!accessory) {
        accessory = new this.api.platformAccessory(bin.type, uuid);
        accessory.addService(Service.OccupancySensor, bin.type);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.set(uuid, accessory);
        this.log.info(`Added sensor: ${bin.type}`);
      }
      accessory.getService(Service.AccessoryInformation)
        ?.setCharacteristic(Characteristic.Manufacturer, 'Bin Day')
        .setCharacteristic(Characteristic.Model, this.config.council ?? 'wokingham')
        .setCharacteristic(Characteristic.SerialNumber, uuid.slice(0, 8));
    }

    if (removeStale) {
      const stale = [...this.accessories.values()].filter(a => !wanted.has(a.UUID));
      if (stale.length > 0) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
        for (const a of stale) {
          this.accessories.delete(a.UUID);
          this.log.info(`Removed sensor: ${a.displayName}`);
        }
      }
    }
  }

  private updateStates(): void {
    const { Service, Characteristic } = this.api.hap;
    const alert = parseTime(this.config.alertTime, '18:00');
    const end = parseTime(this.config.endTime, '12:00');
    const now = new Date();

    for (const bin of this.bins) {
      const accessory = this.accessories.get(this.uuidFor(bin.type));
      const service = accessory?.getService(Service.OccupancySensor);
      if (!service) {
        continue;
      }
      const active = isAlertActive(bin.date, now, alert, end);
      service.updateCharacteristic(
        Characteristic.OccupancyDetected,
        active
          ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
          : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
      );
      if (this.lastState.get(bin.type) !== active) {
        this.lastState.set(bin.type, active);
        this.log.info(`${bin.type}: ${active ? 'ON - put it out tonight' : 'off'}`);
      }
    }
  }

  private async loadCache(): Promise<void> {
    try {
      const saved = JSON.parse(await fs.readFile(this.cacheFile, 'utf8')) as {
        bins?: BinCollection[];
        address?: string;
        savedAt?: string;
      };
      if (Array.isArray(saved.bins)) {
        this.bins = saved.bins;
        this.address = saved.address;
        this.lastSuccess = saved.savedAt;
      }
    } catch {
      // No saved dates yet. That's fine on first run.
    }
  }

  private async saveCache(): Promise<void> {
    try {
      await fs.writeFile(this.cacheFile, JSON.stringify({ bins: this.bins, address: this.address, savedAt: this.lastSuccess }, null, 2));
    } catch (err) {
      this.log.warn(`Couldn't save bin dates: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
