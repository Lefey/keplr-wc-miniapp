# Keplr × WalletConnect — тестовый Telegram Mini App

Минимальное приложение для проверки: подключение Keplr Mobile через WalletConnect v2,
добавление кастомной сети `govbot-test-1`, подпись сообщения (ADR-36) и подпись/отправка
`MsgSend` в режимах `SIGN_MODE_DIRECT` и `AMINO`.

## Запуск

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # статика в dist/
```

Telegram открывает Mini App только по **HTTPS**:

- для разработки: `npx cloudflared tunnel --url http://localhost:5173` (или ngrok);
- для постоянного URL: залить `dist/` на Vercel / Netlify / GitHub Pages / Cloudflare Pages.

Затем в @BotFather: `/newapp` (или Bot Settings → Menu Button) и указать HTTPS URL.

## Обязательно в Reown (WalletConnect) Cloud

В проекте `5cce07bd1ae77f8df5af659ad1f8e0e5` в разделе Domain / Allowlist добавьте домен,
с которого открыт Mini App (домен туннеля или хостинга). Иначе relay отклонит подключение.

## Выбор способа подключения

| Где открыто | Что происходит |
|---|---|
| Браузер с расширением Keplr (или встроенный браузер Keplr Mobile) | подключение через `window.keplr`; WalletConnect — вторая кнопка |
| Браузер без расширения | сразу QR WalletConnect; на телефоне ещё кнопка «Открыть Keplr» |
| Telegram Android / iOS | QR + кнопка «Открыть Keplr» (через https-прокладку `open.html`) |
| Telegram Desktop / macOS / Web | только QR |

## Как работает WalletConnect

1. `SignClient.connect` с namespace `cosmos:cosmoshub-4` (Keplr сессию для неизвестной сети
   не одобрит), методы `keplr_*`.
2. Deep link в Keplr: Android `intent://wcV2?<uri>#Intent;package=com.chainapsis.keplr;scheme=keplrwallet;end;`,
   iOS `keplrwallet://wcV2?<uri>`. Дополнительно показываются QR и кнопка «Скопировать URI».
3. После одобрения: `keplr_experimentalSuggestChain` → `keplr_enable` → `keplr_getKey`.
4. Транзакции собирает CosmJS (`SigningStargateClient`) с собственным `OfflineSigner`
   (`src/keplr-wc.ts`), который пересылает `signDirect`/`signAmino` в Keplr; бродкаст
   идёт через RPC приложения. `preferNoSetFee: true` — комиссию задаёт приложение (0.01uatom × gas × 1.5).

Файлы: `src/config.ts` — параметры сети, `src/keplr-wc.ts` — обёртка WalletConnect/Keplr,
`src/keplr-ext.ts` — подключение через расширение,
`src/main.ts` — UI и сценарии проверки.

## Тестовый кошелёк

Мнемоника из задачи → адрес `cosmos1e6sfptszs07wcnu4usm082g5mpjp4nk3uzd37m`
(путь m/44'/118'/0'/0/0). Импортируйте её в Keplr Mobile и пополните адрес тестовыми uatom.

## Если что-то не работает

- **Keplr не открывается из Telegram (особенно iOS)** — WebView Telegram может блокировать
  кастомные схемы. Тогда отсканируйте QR в Keplr (сканер в шапке приложения) или откройте Keplr
  вручную: запросы на подпись придут, когда приложение станет активным.
- **Подпись висит** — вернитесь в Keplr вручную (кнопка «Открыть Keplr»), запрос ждёт там.
- **`Account does not exist on chain`** — адрес ещё не получал средств.
