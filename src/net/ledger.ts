import { toChecksumAddress } from '../core/evm.ts';
import {
  BLE_DEFAULT_MTU,
  BLE_MTU_REQUEST,
  BleAssembler,
  bleFrames,
  HidAssembler,
  hidFrames,
  LEDGER_BLE_SERVICES,
  LEDGER_VENDOR_ID,
  ledgerAddressCommand,
  ledgerAppConfigCommand,
  ledgerAppNameCommand,
  LedgerError,
  ledgerEvmPath,
  ledgerResponse,
  ledgerSignCommands,
  ledgerTokenCommand,
  ledgerTronAddressCommand,
  ledgerTronPath,
  ledgerTronSignCommands,
  parseBleMtu,
  parseLedgerAddress,
  parseLedgerAppName,
  parseLedgerAppVersion,
  parseLedgerSignature,
  parseLedgerTronAddress,
  parseLedgerTronSignature,
} from '../core/ledger.ts';
import { assembleTronTransaction, recoverTronSigner } from '../core/tron.ts';
import { assembleEvmTransaction, evmSigningPayload, recoverEvmSigner, type EvmTransaction } from '../core/tx-evm.ts';

/** How the device is reached. The commands are the same either way; only their delivery differs. */
export type LedgerWay = 'usb' | 'bluetooth';

/** The parts of the browser's WebHID and Web Bluetooth interfaces used here (neither is in TypeScript's standard definitions). */
interface HidDevice {
  opened: boolean;
  productName: string;
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: Uint8Array): Promise<void>;
  addEventListener(type: 'inputreport', listener: (event: { data: DataView }) => void): void;
  removeEventListener(type: 'inputreport', listener: (event: { data: DataView }) => void): void;
}
interface Hid {
  requestDevice(options: { filters: { vendorId: number }[] }): Promise<HidDevice[]>;
  /** Devices the user has already allowed this site to use. */
  getDevices?(): Promise<(HidDevice & { vendorId?: number })[]>;
  addEventListener(type: 'disconnect', listener: (event: { device: HidDevice }) => void): void;
  removeEventListener(type: 'disconnect', listener: (event: { device: HidDevice }) => void): void;
}
interface BleCharacteristic {
  value?: DataView | null;
  startNotifications(): Promise<unknown>;
  writeValue(data: Uint8Array): Promise<void>;
  writeValueWithResponse?(data: Uint8Array): Promise<void>;
  addEventListener(type: 'characteristicvaluechanged', listener: (event: { target: unknown }) => void): void;
  removeEventListener(type: 'characteristicvaluechanged', listener: (event: { target: unknown }) => void): void;
}
interface BleService {
  uuid: string;
  getCharacteristic(uuid: string): Promise<BleCharacteristic>;
}
interface BleDevice {
  name?: string;
  gatt?: { connected: boolean; connect(): Promise<unknown>; disconnect(): void; getPrimaryServices(): Promise<BleService[]> };
  addEventListener(type: 'gattserverdisconnected', listener: () => void): void;
  removeEventListener(type: 'gattserverdisconnected', listener: () => void): void;
}
interface Bluetooth {
  requestDevice(options: { filters: { services: string[] }[] }): Promise<BleDevice>;
}
const browser = (): { hid?: Hid; bluetooth?: Bluetooth } => (typeof navigator === 'undefined' ? {} : (navigator as unknown as { hid?: Hid; bluetooth?: Bluetooth }));

/**
 * Which ways of reaching a Ledger this browser offers. Chrome and its relatives
 * offer both; Safari and Firefox offer neither.
 */
export const ledgerWays = (): LedgerWay[] => [...(browser().hid ? (['usb'] as const) : []), ...(browser().bluetooth ? (['bluetooth'] as const) : [])];
export const ledgerSupported = (): boolean => ledgerWays().length > 0;

const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
const copy = (view: DataView) => new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A way to hand one command to the device and get its whole answer back, status included. */
interface Link {
  name: string;
  send(command: Uint8Array): Promise<Uint8Array>;
  close(): Promise<void>;
  /** Set by the session; called once when the device goes away. */
  onGone: (() => void) | null;
}

/** Packets arriving from the device, handed out one at a time to whoever is waiting. */
class Inbox {
  private waiting: ((packet: Uint8Array) => void) | null = null;
  private readonly held: Uint8Array[] = [];
  readonly put = (packet: Uint8Array) => {
    if (this.waiting) {
      const take = this.waiting;
      this.waiting = null;
      take(packet);
    } else {
      this.held.push(packet);
    }
  };
  next(): Promise<Uint8Array> {
    const ready = this.held.shift();
    if (ready) return Promise.resolve(ready);
    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }
  clear(): void {
    this.held.length = 0;
  }
}

async function openUsb(quiet: boolean): Promise<Link> {
  const api = browser().hid;
  if (!api) throw new Error('Ledger: this browser cannot reach USB devices');
  // Coming back after the cable link dropped (it does whenever another app is opened on the device):
  // a device the user already allowed is reopened without showing the picker again.
  const allowed = quiet && api.getDevices ? (await api.getDevices()).filter((d) => d.vendorId === LEDGER_VENDOR_ID) : [];
  const [device] = allowed.length === 1 ? allowed : await api.requestDevice({ filters: [{ vendorId: LEDGER_VENDOR_ID }] });
  if (!device) throw new Error('Ledger: no device chosen');
  if (!device.opened) await device.open();
  const channel = Math.floor(Math.random() * 0xffff);
  const inbox = new Inbox();
  const onReport = (event: { data: DataView }) => inbox.put(copy(event.data));
  const link: Link = {
    name: device.productName || 'Ledger',
    onGone: null,
    async send(command) {
      inbox.clear();
      for (const frame of hidFrames(channel, command)) await device.sendReport(0, frame);
      const assembler = new HidAssembler(channel);
      for (;;) {
        const answer = assembler.push(await inbox.next());
        if (answer) return answer;
      }
    },
    async close() {
      device.removeEventListener('inputreport', onReport);
      api.removeEventListener('disconnect', onGone);
      try {
        await device.close();
      } catch {
        /* already gone */
      }
    },
  };
  const onGone = (event: { device: HidDevice }) => {
    if (event.device === device) link.onGone?.();
  };
  device.addEventListener('inputreport', onReport);
  api.addEventListener('disconnect', onGone);
  return link;
}

/** How long the device may take to say how large a Bluetooth piece can be. */
const MTU_TIMEOUT_MS = 15_000;

async function openBluetooth(): Promise<Link> {
  const api = browser().bluetooth;
  if (!api) throw new Error('Ledger: this browser cannot reach Bluetooth devices');
  const device = await api.requestDevice({ filters: LEDGER_BLE_SERVICES.map((s) => ({ services: [s.service] })) });
  const gatt = device.gatt;
  if (!gatt) throw new Error('Ledger: Bluetooth link unavailable');

  const attach = async () => {
    if (!gatt.connected) await gatt.connect();
    const [service] = await gatt.getPrimaryServices();
    const known = LEDGER_BLE_SERVICES.find((s) => s.service === service?.uuid.toLowerCase());
    if (!service || !known) throw new Error('Ledger: unknown Bluetooth device');
    const [write, notify] = await Promise.all([service.getCharacteristic(known.write), service.getCharacteristic(known.notify)]);
    const inbox = new Inbox();
    const onValue = (event: { target: unknown }) => {
      const value = (event.target as BleCharacteristic | null)?.value;
      if (value) inbox.put(copy(value));
    };
    notify.addEventListener('characteristicvaluechanged', onValue);
    await notify.startNotifications();
    const put = (data: Uint8Array) => (write.writeValueWithResponse ? write.writeValueWithResponse(data) : write.writeValue(data));

    // Agree on the size of a piece. The first time a device is paired this is also when the pairing prompt appears.
    const started = Date.now();
    await put(BLE_MTU_REQUEST);
    let mtu = BLE_DEFAULT_MTU;
    const deadline = sleep(MTU_TIMEOUT_MS).then(() => null);
    for (;;) {
      const packet = await Promise.race([inbox.next(), deadline]);
      if (!packet) throw new Error('Ledger: no answer over Bluetooth');
      const size = parseBleMtu(packet);
      if (size !== null) {
        mtu = size;
        break;
      }
    }
    return { name: device.name || known.name, inbox, put, mtu, slow: Date.now() - started > 1000, detach: () => notify.removeEventListener('characteristicvaluechanged', onValue) };
  };

  let session = await attach();
  // A slow first answer means the device was being paired just now. Ledger's firmware then needs
  // the link dropped and made again before it talks reliably (the same workaround Ledger's own code uses).
  if (session.slow) {
    session.detach();
    gatt.disconnect();
    await sleep(4000);
    session = await attach();
  }

  const link: Link = {
    name: session.name,
    onGone: null,
    async send(command) {
      session.inbox.clear();
      for (const frame of bleFrames(command, session.mtu)) await session.put(frame);
      const assembler = new BleAssembler();
      for (;;) {
        const answer = assembler.push(await session.inbox.next());
        if (answer) return answer;
      }
    },
    async close() {
      device.removeEventListener('gattserverdisconnected', onGone);
      session.detach();
      try {
        gatt.disconnect();
      } catch {
        /* already gone */
      }
    },
  };
  const onGone = () => link.onGone?.();
  device.addEventListener('gattserverdisconnected', onGone);
  return link;
}

/** An open connection to a Ledger. One command is in flight at a time. */
export class Ledger {
  private readonly link: Link;
  private queue: Promise<unknown> = Promise.resolve();
  private gone = false;
  readonly way: LedgerWay;
  /** Called once if the cable is pulled, the Bluetooth link drops or the device goes away. */
  onDisconnect: (() => void) | null = null;

  private constructor(link: Link, way: LedgerWay) {
    this.link = link;
    this.way = way;
    link.onGone = () => {
      if (this.gone) return;
      this.gone = true;
      this.onDisconnect?.();
    };
  }

  /**
   * Show the browser's device picker and open what the user chose. Must be called from a click.
   * With `quiet`, a cable device that was already allowed is reopened without the picker.
   */
  static async connect(way: LedgerWay = 'usb', quiet = false): Promise<Ledger> {
    return new Ledger(way === 'bluetooth' ? await openBluetooth() : await openUsb(quiet), way);
  }

  /** The app open on the device right now: "Ethereum", "Tron", or the home screen's own name. */
  async appName(): Promise<string> {
    return parseLedgerAppName(await this.exchange(ledgerAppNameCommand()));
  }

  /** The Tron account's address (needs the Tron app open). With `show`, the device displays it. */
  async tronAddress(show = false): Promise<string> {
    return parseLedgerTronAddress(await this.exchange(ledgerTronAddressCommand(ledgerTronPath(), show)));
  }

  /**
   * Have the device sign a Tron transaction after showing it to the user. The
   * signature is checked before it is returned: it must come from the Tron
   * account this session knows.
   */
  async signTron(raw: Uint8Array, expectedSigner: string): Promise<{ txid: string; signedHex: string }> {
    let answer: Uint8Array = new Uint8Array(0);
    for (const command of ledgerTronSignCommands(ledgerTronPath(), raw)) answer = await this.exchange(command);
    const signature = parseLedgerTronSignature(answer);
    if (recoverTronSigner(raw, signature) !== expectedSigner) throw new LedgerError('other', 0);
    return assembleTronTransaction(raw, signature);
  }

  get name(): string {
    return this.link.name;
  }

  /** Send one command and return the data of the answer. Anything but success is raised as a LedgerError. */
  exchange(command: Uint8Array): Promise<Uint8Array> {
    const run = async () => {
      if (this.gone) throw new Error('Ledger: disconnected');
      return ledgerResponse(await this.link.send(command));
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Version of the Ethereum app that is open. Fails with 'no-app' when it is not. */
  async appVersion(): Promise<string> {
    return parseLedgerAppVersion(await this.exchange(ledgerAppConfigCommand()));
  }

  /** The account's address. With `show`, the device displays it and waits for the user to confirm. */
  async address(show = false): Promise<string> {
    return toChecksumAddress(parseLedgerAddress(await this.exchange(ledgerAddressCommand(ledgerEvmPath(), show))));
  }

  /**
   * Have the device sign a transaction after showing it to the user. For a
   * token transfer, `token` is Ledger's signed description of the token, sent
   * first so the device can show the amount in the token's own units.
   *
   * The signature is checked before it is returned: it must come from the
   * account this session was opened with.
   */
  async sign(tx: EvmTransaction, expectedSigner: string, token?: string): Promise<{ raw: string; hash: string }> {
    if (token) await this.exchange(ledgerTokenCommand(fromHex(token)));
    let answer: Uint8Array = new Uint8Array(0);
    for (const command of ledgerSignCommands(ledgerEvmPath(), evmSigningPayload(tx))) answer = await this.exchange(command);
    const signature = parseLedgerSignature(answer);
    const signer = `0x${[...recoverEvmSigner(tx, signature)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    if (signer !== expectedSigner.toLowerCase()) throw new LedgerError('other', 0);
    return assembleEvmTransaction(tx, signature);
  }

  async close(): Promise<void> {
    this.gone = true;
    await this.link.close();
  }
}
