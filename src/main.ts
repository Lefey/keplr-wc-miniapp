import QRCode from "qrcode";
import { SigningStargateClient, GasPrice } from "@cosmjs/stargate";
import { KeplrWC, openKeplr, type KeplrKey } from "./keplr-wc";
import { CHAIN_ID, DECIMALS, DENOM, DISPLAY_DENOM, GAS_PRICE, REST, RPC } from "./config";

declare global {
  interface Window { Telegram?: { WebApp: any } }
}

const tg = window.Telegram?.WebApp;
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

let wc: KeplrWC;
let key: KeplrKey | undefined;

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

async function guard(btn: HTMLButtonElement, fn: () => Promise<void>) {
  btn.disabled = true;
  try {
    await fn();
  } catch (e: any) {
    log("✗ Ошибка:", e?.message ?? String(e));
  } finally {
    btn.disabled = false;
  }
}

async function refreshBalance() {
  if (!key) return;
  const r = await fetch(`${REST}/cosmos/bank/v1beta1/balances/${key.bech32Address}/by_denom?denom=${DENOM}`);
  const j = await r.json();
  const amount = Number(j.balance?.amount ?? 0);
  $("balance").textContent = `${(amount / 10 ** DECIMALS).toFixed(DECIMALS)} ${DISPLAY_DENOM}`;
}

async function afterSession() {
  // Сеть кастомная — сначала предлагаем её Keplr, затем enable и получаем ключ
  await walletCall("suggestChain", () => wc.suggestChain());
  await walletCall("enable", () => wc.enable());
  key = await walletCall("getKey", () => wc.getKey());
  log("Key:", key);
  localStorage.setItem("keplr-key", JSON.stringify(key));
  $("addr").textContent = key.bech32Address;
  show(true);
  refreshBalance().catch((e) => log("Баланс не получен:", e.message));
}

$<HTMLButtonElement>("btn-connect").onclick = (e) =>
  guard(e.currentTarget as HTMLButtonElement, async () => {
    const { uri, approval } = await wc.connect();
    log("WC URI:", uri);
    $("pairing").hidden = false;
    await QRCode.toCanvas($("qr"), uri, { width: 260, margin: 1 });
    $("btn-open-pair").onclick = () => openKeplr(uri);
    $("btn-copy").onclick = () => navigator.clipboard.writeText(uri).then(() => log("URI скопирован"));
    openKeplr(uri);
    const session = await approval;
    log("Сессия установлена:", session.peer.metadata.name, session.namespaces);
    $("pairing").hidden = true;
    await afterSession();
  });

$<HTMLButtonElement>("btn-sign-msg").onclick = (e) =>
  guard(e.currentTarget as HTMLButtonElement, async () => {
    const msg = $<HTMLInputElement>("msg").value;
    const sig = await walletCall("signArbitrary", () => wc.signArbitrary(key!.bech32Address, msg));
    log("Подпись:", sig);
  });

$<HTMLButtonElement>("btn-send").onclick = (e) =>
  guard(e.currentTarget as HTMLButtonElement, async () => {
    const mode = (document.querySelector('input[name="mode"]:checked') as HTMLInputElement).value as "direct" | "amino";
    const to = $<HTMLInputElement>("to").value.trim() || key!.bech32Address;
    const amount = $<HTMLInputElement>("amount").value.trim();
    const signer = wc.getSigner(key!, mode);
    const client = await SigningStargateClient.connectWithSigner(RPC, signer, {
      gasPrice: GasPrice.fromString(GAS_PRICE),
    });
    log(`Отправка ${amount}${DENOM} → ${to} (${mode})`);
    const res = await walletCall(`sign (${mode}) + broadcast`, () =>
      client.sendTokens(key!.bech32Address, to, [{ denom: DENOM, amount }], 1.5, "test from TG mini app"),
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

$("btn-refresh").onclick = () => refreshBalance().catch((e) => log("Баланс:", e.message));
$("btn-open").onclick = () => openKeplr();
$<HTMLButtonElement>("btn-disconnect").onclick = async () => {
  await wc.disconnect();
  key = undefined;
  localStorage.removeItem("keplr-key");
  show(false);
  log("Отключено");
};

(async () => {
  log(`Chain: ${CHAIN_ID}, Telegram: ${tg?.platform ?? "нет (обычный браузер)"}`);
  wc = await KeplrWC.init();
  $<HTMLButtonElement>("btn-connect").disabled = false;
  // Keplr открывается в момент отправки запроса на подпись (после симуляции газа и т.п.)
  wc.onRequest = (method) => {
    log(`  запрос в кошелёк: ${method}`);
    if ($<HTMLInputElement>("auto-open").checked) openKeplr();
  };
  wc.client.on("session_delete", () => {
    key = undefined;
    show(false);
    log("Кошелёк завершил сессию");
  });
  const saved = localStorage.getItem("keplr-key");
  if (wc.session && saved) {
    key = JSON.parse(saved);
    $("addr").textContent = key!.bech32Address;
    show(true);
    log("Восстановлена сессия", wc.session.topic);
    refreshBalance().catch((e) => log("Баланс не получен:", e.message));
  } else {
    show(false);
  }
})().catch((e) => log("Init error:", e.message));
