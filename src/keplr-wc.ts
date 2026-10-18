import SignClient from "@walletconnect/sign-client";
import type { SessionTypes } from "@walletconnect/types";
import type { AccountData, AminoSignResponse, OfflineAminoSigner, StdSignDoc } from "@cosmjs/amino";
import type { DirectSignResponse, OfflineDirectSigner } from "@cosmjs/proto-signing";
import { fromBase64, toBase64 } from "@cosmjs/encoding";
import { SignDoc } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { CHAIN_ID, CHAIN_INFO, WC_PROJECT_ID } from "./config";

// Методы, которые Keplr Mobile обслуживает через WalletConnect v2
const METHODS = [
  "keplr_getKey",
  "keplr_signAmino",
  "keplr_signDirect",
  "keplr_signArbitrary",
  "keplr_enable",
  "keplr_experimentalSuggestChain",
];
// Keplr поднимает сессию на известной ему сети; кастомную сеть добавляем позже через suggestChain
const NAMESPACE_CHAIN = "cosmos:cosmoshub-4";

export interface KeplrKey {
  name: string;
  algo: string;
  pubKey: string; // base64
  address: string; // base64
  bech32Address: string;
  isNanoLedger: boolean;
}

const isAndroid = /android/i.test(navigator.userAgent);

export function keplrDeepLink(uri?: string): string {
  const q = uri ? `?${encodeURIComponent(uri)}` : "";
  return isAndroid
    ? `intent://wcV2${q}#Intent;package=com.chainapsis.keplr;scheme=keplrwallet;end;`
    : `keplrwallet://wcV2${q}`;
}

const tg = (window as any).Telegram?.WebApp;
const inTelegram = !!tg?.initData;

export function openKeplr(uri?: string) {
  const link = keplrDeepLink(uri);
  if (!inTelegram) {
    window.location.href = link;
    return;
  }
  // WebView Telegram даёт ERR_UNKNOWN_URL_SCHEME на intent:// и keplrwallet://,
  // поэтому открываем https-прокладку во внешнем браузере, а она перенаправляет в Keplr
  const bridge = new URL(`open.html?to=${encodeURIComponent(link)}`, window.location.href).href;
  tg.openLink(bridge);
}

export class KeplrWC {
  private constructor(public client: SignClient) {}
  session?: SessionTypes.Struct;
  /** Вызывается перед каждым запросом к кошельку (например, чтобы открыть Keplr) */
  onRequest?: (method: string) => void;

  static async init(): Promise<KeplrWC> {
    const client = await SignClient.init({
      projectId: WC_PROJECT_ID,
      metadata: {
        name: "Keplr WC Test",
        description: "Telegram Mini App: WalletConnect + Keplr test",
        url: window.location.origin,
        icons: [new URL("icon.png", window.location.href).href],
      },
    });
    const wc = new KeplrWC(client);
    const sessions = client.session.getAll();
    wc.session = sessions[sessions.length - 1];
    client.on("session_delete", () => (wc.session = undefined));
    client.on("session_expire", () => (wc.session = undefined));
    return wc;
  }

  /** Возвращает uri для QR/deeplink и промис, который резолвится при одобрении сессии в кошельке */
  async connect(): Promise<{ uri: string; approval: Promise<SessionTypes.Struct> }> {
    const { uri, approval } = await this.client.connect({
      optionalNamespaces: {
        cosmos: {
          methods: METHODS,
          chains: [NAMESPACE_CHAIN],
          events: ["accountsChanged", "chainChanged", "keplr_accountsChanged"],
        },
      },
    });
    if (!uri) throw new Error("WalletConnect не вернул URI");
    return {
      uri,
      approval: approval().then((s) => (this.session = s)),
    };
  }

  async disconnect() {
    if (!this.session) return;
    await this.client
      .disconnect({ topic: this.session.topic, reason: { code: 6000, message: "User disconnected" } })
      .catch(() => {});
    this.session = undefined;
  }

  private request<T>(method: string, params: unknown): Promise<T> {
    if (!this.session) throw new Error("Нет WalletConnect сессии");
    const acc = this.session.namespaces.cosmos?.accounts?.[0];
    const chainId = acc ? acc.split(":").slice(0, 2).join(":") : NAMESPACE_CHAIN;
    const p = this.client.request<T>({
      topic: this.session.topic,
      chainId,
      request: { method, params },
    });
    this.onRequest?.(method);
    return p;
  }

  suggestChain() {
    return this.request("keplr_experimentalSuggestChain", { chainInfo: CHAIN_INFO });
  }

  enable(chainId = CHAIN_ID) {
    return this.request("keplr_enable", { chainId: [chainId] });
  }

  getKey(chainId = CHAIN_ID) {
    return this.request<KeplrKey>("keplr_getKey", { chainId });
  }

  signArbitrary(signer: string, data: string, chainId = CHAIN_ID) {
    return this.request<{ pub_key: { type: string; value: string }; signature: string }>(
      "keplr_signArbitrary",
      { chainId, signer, type: "string", data },
    );
  }

  /** OfflineSigner для CosmJS (direct / amino), подписывающий через Keplr Mobile */
  getSigner(key: KeplrKey, mode: "direct" | "amino", chainId = CHAIN_ID): OfflineDirectSigner | OfflineAminoSigner {
    const account: AccountData = {
      address: key.bech32Address,
      algo: key.algo as AccountData["algo"],
      pubkey: fromBase64(key.pubKey),
    };
    // Комиссию задаёт приложение, Keplr её не переписывает
    const signOptions = { preferNoSetFee: true, preferNoSetMemo: true };
    const getAccounts = async () => [account];

    if (mode === "amino") {
      return {
        getAccounts,
        signAmino: (signer: string, signDoc: StdSignDoc) =>
          this.request<AminoSignResponse>("keplr_signAmino", { chainId, signer, signDoc, signOptions }),
      };
    }

    return {
      getAccounts,
      signDirect: async (signer: string, signDoc: SignDoc): Promise<DirectSignResponse> => {
        const res = await this.request<{
          signed: { chainId: string; accountNumber: string; bodyBytes: string; authInfoBytes: string };
          signature: DirectSignResponse["signature"];
        }>("keplr_signDirect", {
          chainId,
          signer,
          signDoc: {
            chainId: signDoc.chainId,
            accountNumber: signDoc.accountNumber.toString(),
            bodyBytes: toBase64(signDoc.bodyBytes),
            authInfoBytes: toBase64(signDoc.authInfoBytes),
          },
          signOptions,
        });
        return {
          signature: res.signature,
          signed: SignDoc.fromPartial({
            chainId: res.signed.chainId,
            accountNumber: BigInt(res.signed.accountNumber),
            bodyBytes: fromBase64(res.signed.bodyBytes),
            authInfoBytes: fromBase64(res.signed.authInfoBytes),
          }),
        };
      },
    };
  }
}
