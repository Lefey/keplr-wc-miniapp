import type { OfflineAminoSigner } from "@cosmjs/amino";
import type { OfflineDirectSigner } from "@cosmjs/proto-signing";
import { toBase64 } from "@cosmjs/encoding";
import { CHAIN_ID, CHAIN_INFO } from "./config";
import type { KeplrKey } from "./keplr-wc";

/** window.keplr от расширения (или встроенного браузера Keplr Mobile); undefined, если его нет */
export async function detectKeplr(): Promise<any | undefined> {
  const w = window as any;
  if (w.keplr) return w.keplr;
  // расширение может внедрить window.keplr позже — ждём window.onload, как советует документация Keplr
  if (document.readyState !== "complete") {
    await new Promise<void>((resolve) => window.addEventListener("load", () => resolve(), { once: true }));
  }
  return w.keplr;
}

export class KeplrExtension {
  constructor(public keplr: any) {
    // Комиссию задаёт приложение, Keplr её не переписывает
    keplr.defaultOptions = { sign: { preferNoSetFee: true, preferNoSetMemo: true } };
  }

  /** "extension" — браузерное расширение, "mobile-web" — встроенный браузер Keplr Mobile */
  get mode(): string {
    return this.keplr.mode ?? "extension";
  }

  async connect(): Promise<KeplrKey> {
    await this.keplr.experimentalSuggestChain(CHAIN_INFO);
    await this.keplr.enable(CHAIN_ID);
    return this.getKey();
  }

  async getKey(): Promise<KeplrKey> {
    const k = await this.keplr.getKey(CHAIN_ID);
    return {
      name: k.name,
      algo: k.algo,
      pubKey: toBase64(k.pubKey),
      address: toBase64(k.address),
      bech32Address: k.bech32Address,
      isNanoLedger: k.isNanoLedger,
    };
  }

  getSigner(mode: "direct" | "amino"): OfflineDirectSigner | OfflineAminoSigner {
    return mode === "amino"
      ? this.keplr.getOfflineSignerOnlyAmino(CHAIN_ID)
      : this.keplr.getOfflineSigner(CHAIN_ID);
  }

  signArbitrary(signer: string, data: string) {
    return this.keplr.signArbitrary(CHAIN_ID, signer, data);
  }

  async disconnect() {
    // disable есть не во всех версиях Keplr
    await this.keplr.disable?.(CHAIN_ID)?.catch?.(() => {});
  }
}
