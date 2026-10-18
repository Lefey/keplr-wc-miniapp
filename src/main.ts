import QRCode from "qrcode";
import { SigningStargateClient, GasPrice } from "@cosmjs/stargate";
import type { OfflineAminoSigner } from "@cosmjs/amino";
import type { OfflineDirectSigner } from "@cosmjs/proto-signing";
import { KeplrWC, canOpenKeplr, inTelegram, openKeplr, type KeplrKey } from "./keplr-wc";
import { KeplrExtension, detectKeplr } from "./keplr-ext";
import { CHAIN_ID, DECIMALS, DENOM, DISPLAY_DENOM, GAS_PRICE, REST, RPC } from "./config";

declare const __BUILD__: string;

declare global {
  interface Window { Telegram?: { WebApp: any } }
}

const tg = window.Telegram?.WebApp;
document.getElementById("build")!.textContent = `build ${__BUILD__}`;
tg?.ready();
tg?.expand();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $("log");
function log(...args: unknown[]) {
  const line = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)))
    .join(" ");
  logEl.textContent = `[${new Date().toLocaleTimeString()}] ${line}\n` + logEl.textContent;
  console.log(...args);
}

/** Общий интерфейс для расширения и WalletConnect */
interface Wallet {
  kind: "extension" | "walletconnect";
  label: string;
  key: KeplrKey;
  getSigner(mode: "direct" | "amino"): OfflineDirectSigner | OfflineAminoSigner;
  signArbitrary(data: string): Promise<unknown>;
  disconnect(): Promise<void>;
}

const WALLET_KIND = "wallet-kind";
let ext: KeplrExtension | undefined;
let wcPromise: Promise<KeplrWC> | undefined;
let wallet: Wallet | undefined;

function show(connected: boolean) {
  $("connect-box").hidden = connected;
  $("wallet-box").hidden = !connected;
}

async function walletCall<T>(label: string, fn: () => Promise<T>): Promise<T> {
  log(`→ ${label}…`);
  const r = await fn();
  log(`✓ ${label}`);
  return r;
}

async function guard(btn: HTMLButtonElement | null, fn: () => Promise<void>) {
  if (btn) btn.disabled = true;
  try {
    await fn();
  } catch (e: any) {
    log("✗ Ошибка:", e?.message ?? String(e));
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function refreshBalance() {
  if (!wallet) return;
  const r = await fetch(`${REST}/cosmos/bank/v1beta1/balances/${wallet.key.bech32Address}/by_denom?denom=${DENOM}`);
  const j = await r.json();
  const amount = Number(j.balance?.amount ?? 0);
  $("balance").textContent = `${(amount / 10 ** DECIMALS).toFixed(DECIMALS)} ${DISPLAY_DENOM}`;
}

function setWallet(w: Wallet) {
  wallet = w;
  localStorage.setItem(WALLET_KIND, w.kind);
  $("wallet-kind").textContent = w.label;
  $("addr").textContent = w.key.bech32Address;
  show(true);
  refreshBalance().catch((e) => log("Баланс не получен:", e.message));
}

function onDisconnected(msg: string) {
  wallet = undefined;
  localStorage.removeItem(WALLET_KIND);
  localStorage.removeItem("keplr-key");
  log(msg);
  showConnectOptions();
}

// ---------- WalletConnect ----------

function getWC(): Promise<KeplrWC> {
  wcPromise ??= KeplrWC.init().then((wc) => {
    // Keplr открывается в момент отправки запроса на подпись (после симуляции газа и т.п.)
    wc.onRequest = (method) => {
      log(`  запрос в кошелёк: ${method}`);
      if (!canOpenKeplr || !$<HTMLInputElement>("auto-open").checked) return;
      try {
        openKeplr();
      } catch (e: any) {
        // Telegram разрешает openLink только сразу после нажатия — тогда открывайте кнопкой
        log("  авто-открытие не сработало, нажмите «Открыть Keplr»:", e?.message ?? String(e));
      }
    };
    wc.client.on("session_delete", () => {
      if (wallet?.kind === "walletconnect") onDisconnected("Кошелёк завершил сессию");
    });
    return wc;
  });
  return wcPromise;
}

function wcWallet(wc: KeplrWC, key: KeplrKey): Wallet {
  return {
    kind: "walletconnect",
    label: "Keplr Mobile (WalletConnect)",
    key,
    getSigner: (mode) => wc.getSigner(key, mode),
    signArbitrary: (data) => wc.signArbitrary(key.bech32Address, data),
    disconnect: () => wc.disconnect(),
  };
}

/** Создаёт пару WalletConnect, показывает QR и ждёт одобрения в Keplr Mobile */
async function startPairing(gesture: boolean) {
  $("btn-connect").hidden = true;
  try {
    await pair(gesture);
  } catch (e) {
    // пара истекла, отклонена или relay недоступен — даём сгенерировать новую
    $("pairing").hidden = true;
    $("btn-connect").textContent = "Новый QR (WalletConnect)";
    $("btn-connect").hidden = false;
    throw e;
  }
}

async function pair(gesture: boolean) {
  log("Создаю QR WalletConnect…");
  const wc = await getWC();
  const { uri, approval } = await wc.connect();
  log("WC URI:", uri);
  $("pairing").hidden = false;
  await QRCode.toCanvas($("qr"), uri, { width: 260, margin: 1 });
  $("btn-open-pair").onclick = () => openKeplr(uri);
  $("btn-copy").onclick = () => navigator.clipboard.writeText(uri).then(() => log("URI скопирован"));
  // без нажатия пользователя deep link всё равно заблокируют — тогда открывают кнопкой
  if (gesture && canOpenKeplr) {
    try {
      openKeplr(uri);
    } catch (e: any) {
      log("Авто-открытие не сработало, нажмите «Открыть Keplr»:", e?.message ?? String(e));
    }
  }
  const session = await approval;
  if (wallet) {
    // пока ждали QR, пользователь уже подключился другим способом — лишнюю сессию закрываем
    log("WC сессия одобрена, но кошелёк уже подключён — закрываю её");
    await wc.disconnect();
    return;
  }
  log("Сессия установлена:", session.peer.metadata.name, session.namespaces);
  $("pairing").hidden = true;
  // Сеть кастомная — сначала предлагаем её Keplr, затем enable и получаем ключ
  await walletCall("suggestChain", () => wc.suggestChain());
  await walletCall("enable", () => wc.enable());
  const key = await walletCall("getKey", () => wc.getKey());
  log("Key:", key);
  localStorage.setItem("keplr-key", JSON.stringify(key));
  setWallet(wcWallet(wc, key));
}

// ---------- Расширение Keplr ----------

function extWallet(e: KeplrExtension, key: KeplrKey): Wallet {
  return {
    kind: "extension",
    label: e.mode === "mobile-web" ? "Keplr (встроенный браузер)" : "Расширение Keplr",
    key,
    getSigner: (mode) => e.getSigner(mode),
    signArbitrary: (data) => e.signArbitrary(key.bech32Address, data),
    disconnect: () => e.disconnect(),
  };
}

async function connectExtension() {
  const key = await walletCall(`Keplr ${ext!.mode}: suggestChain + enable + getKey`, () => ext!.connect());
  log("Key:", key);
  setWallet(extWallet(ext!, key));
}

// ---------- UI ----------

/** Экран подключения: расширение найдено — предлагаем его, иначе сразу QR WalletConnect */
function showConnectOptions() {
  show(false);
  $("pairing").hidden = true;
  $("ext-box").hidden = !ext;
  const btn = $<HTMLButtonElement>("btn-connect");
  btn.textContent = ext ? "Подключить Keplr Mobile (WalletConnect)" : "Подключить Keplr (WalletConnect)";
  btn.classList.toggle("secondary", !!ext);
  btn.disabled = false;
  btn.hidden = false;
  if (!ext) guard(null, () => startPairing(false));
}

$<HTMLButtonElement>("btn-connect").onclick = (e) =>
  guard(e.currentTarget as HTMLButtonElement, () => startPairing(true));

$<HTMLButtonElement>("btn-ext").onclick = (e) => guard(e.currentTarget as HTMLButtonElement, connectExtension);

$<HTMLButtonElement>("btn-sign-msg").onclick = (e) =>
  guard(e.currentTarget as HTMLButtonElement, async () => {
    const msg = $<HTMLInputElement>("msg").value;
    const sig = await walletCall("signArbitrary", () => wallet!.signArbitrary(msg));
    log("Подпись:", sig);
  });

$<HTMLButtonElement>("btn-send").onclick = (e) =>
  guard(e.currentTarget as HTMLButtonElement, async () => {
    const w = wallet!;
    const mode = (document.querySelector('input[name="mode"]:checked') as HTMLInputElement).value as "direct" | "amino";
    const to = $<HTMLInputElement>("to").value.trim() || w.key.bech32Address;
    const amount = $<HTMLInputElement>("amount").value.trim();
    const client = await SigningStargateClient.connectWithSigner(RPC, w.getSigner(mode), {
      gasPrice: GasPrice.fromString(GAS_PRICE),
    });
    log(`Отправка ${amount}${DENOM} → ${to} (${mode}, ${w.label})`);
    const res = await walletCall(`sign (${mode}) + broadcast`, () =>
      client.sendTokens(w.key.bech32Address, to, [{ denom: DENOM, amount }], 1.5, "test from TG mini app"),
    );
    log(res.code === 0 ? "✓ Tx в блоке:" : "✗ Tx отклонена:", {
      code: res.code,
      height: res.height,
      txhash: res.transactionHash,
      gasUsed: res.gasUsed.toString(),
      gasWanted: res.gasWanted.toString(),
      rawLog: res.rawLog,
    });
    refreshBalance().catch(() => {});
  });

// Пока открыт Keplr, браузер/Telegram ставит страницу на паузу и fetch может упасть —
// обновляем баланс при возврате в приложение
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshBalance().catch(() => {});
});

// смена аккаунта в расширении
window.addEventListener("keplr_keystorechange", async () => {
  if (wallet?.kind !== "extension") return;
  const key = await ext!.getKey();
  log("Аккаунт в Keplr изменён:", key.bech32Address);
  setWallet(extWallet(ext!, key));
});

$("btn-refresh").onclick = () => refreshBalance().catch((e) => log("Баланс:", e.message));
$("btn-open").onclick = () => openKeplr();
$<HTMLButtonElement>("btn-disconnect").onclick = async () => {
  await wallet?.disconnect();
  onDisconnected("Отключено");
};

(async () => {
  if (!canOpenKeplr) {
    // на десктопе deep link не нужен: только QR, подтверждения — в Keplr на телефоне
    for (const id of ["btn-open-pair", "btn-open", "auto-open-label"]) $(id).hidden = true;
    $("pairing-hint").textContent = "Отсканируйте QR в Keplr Mobile (иконка сканера в шапке). Запросы на подпись подтверждайте в Keplr на телефоне.";
  }
  // В Telegram расширений нет; в браузере ищем window.keplr
  const keplr = inTelegram ? undefined : await detectKeplr();
  if (keplr) ext = new KeplrExtension(keplr);
  log(
    `Chain: ${CHAIN_ID}, Telegram: ${inTelegram ? `${tg.platform} v${tg.version}` : "нет (обычный браузер)"}, ` +
      `Keplr в браузере: ${ext ? ext.mode : "нет"}, build ${__BUILD__}`,
  );

  // восстановление прошлого подключения
  const kind = localStorage.getItem(WALLET_KIND);
  if (kind === "extension" && ext) {
    try {
      // сайт уже одобрен — enable/getKey проходят без окна Keplr
      const key = await ext.connect();
      setWallet(extWallet(ext, key));
      log("Восстановлено подключение к расширению");
      return;
    } catch (e: any) {
      log("Не удалось восстановить расширение:", e?.message ?? String(e));
    }
  }
  const saved = localStorage.getItem("keplr-key");
  if (kind === "walletconnect" && saved) {
    const wc = await getWC();
    if (wc.session) {
      setWallet(wcWallet(wc, JSON.parse(saved)));
      log("Восстановлена WC сессия", wc.session.topic);
      return;
    }
  }
  showConnectOptions();
})().catch((e) => log("Init error:", e.message));
